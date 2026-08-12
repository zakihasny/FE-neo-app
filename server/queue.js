import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'

import { PermanentJobError } from './errors.js'
import { validateEmployeeCommand } from './validation.js'

export const EMPLOYEE_STREAM = 'NEO_APP_COMMANDS'
export const EMPLOYEE_SUBJECT = 'employee.create.v1'
export const EMPLOYEE_CONSUMER = 'neo-app-employee-writer-v1'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export class QueueService {
  constructor(natsUrl, database) {
    this.servers = natsUrl.split(',').map((value) => value.trim()).filter(Boolean)
    this.database = database
    this.connection = null
    this.client = null
    this.messages = null
    this.loopPromise = null
    this.ready = false
    this.stopping = false
  }

  start() {
    if (!this.loopPromise) this.loopPromise = this.#runConnectionLoop()
  }

  isReady() {
    return this.ready
  }

  async publishEmployee(command) {
    if (!this.ready || !this.client) throw new Error('NEO Queue belum siap.')

    return this.client.publish(
      EMPLOYEE_SUBJECT,
      encoder.encode(JSON.stringify(command)),
      {
        msgID: command.idempotencyKey,
        timeout: 5000,
        expect: { streamName: EMPLOYEE_STREAM }
      }
    )
  }

  async #runConnectionLoop() {
    while (!this.stopping) {
      try {
        await this.#runConnectionSession()
      } catch (error) {
        if (!this.stopping) {
          console.error(JSON.stringify({
            level: 'error',
            event: 'nats_connection_error',
            message: safeMessage(error)
          }))
        }
      } finally {
        this.ready = false
        this.client = null
        this.messages = null
        this.connection = null
      }

      if (!this.stopping) await delay(3000)
    }
  }

  async #runConnectionSession() {
    const connection = await connect({
      servers: this.servers,
      name: 'fe-neo-app-http-service',
      timeout: 5000,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000
    })
    try {
      const client = jetstream(connection, { timeout: 5000 })
      const consumer = await client.consumers.get(EMPLOYEE_STREAM, EMPLOYEE_CONSUMER)
      const messages = await consumer.consume({ max_messages: 1 })

      this.connection = connection
      this.client = client
      this.messages = messages
      this.ready = true

      console.log(JSON.stringify({
        level: 'info',
        event: 'nats_worker_ready',
        stream: EMPLOYEE_STREAM,
        subject: EMPLOYEE_SUBJECT,
        consumer: EMPLOYEE_CONSUMER
      }))

      const worker = this.#consume(messages)
      const closedError = await connection.closed()
      messages.stop()
      await worker
      if (closedError) throw closedError
    } catch (error) {
      await connection.close().catch(() => {})
      throw error
    }
  }

  async #consume(messages) {
    for await (const message of messages) {
      await this.#processMessage(message)
    }
  }

  async #processMessage(message) {
    let command
    try {
      command = validateEmployeeCommand(JSON.parse(decoder.decode(message.data)))
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'employee_message_invalid',
        streamSequence: message.seq,
        message: safeMessage(error)
      }))
      message.term()
      return
    }

    try {
      message.working()
      const result = await this.database.processEmployeeCommand(command)
      message.ack()
      console.log(JSON.stringify({
        level: 'info',
        event: 'employee_message_completed',
        jobId: command.jobId,
        employeeId: result.employeeId,
        duplicate: result.duplicate,
        streamSequence: message.seq
      }))
    } catch (error) {
      if (error instanceof PermanentJobError) {
        message.ack()
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'employee_message_rejected',
          jobId: command.jobId,
          message: error.message,
          streamSequence: message.seq
        }))
        return
      }

      message.nak(5000)
      console.error(JSON.stringify({
        level: 'error',
        event: 'employee_message_retry',
        jobId: command.jobId,
        message: safeMessage(error),
        streamSequence: message.seq
      }))
    }
  }

  async stop() {
    this.stopping = true
    this.ready = false
    this.messages?.stop()
    if (this.connection) await this.connection.drain().catch(() => {})
    if (this.loopPromise) await this.loopPromise.catch(() => {})
  }
}
