import { connect } from '@nats-io/transport-node'
import {
  AckPolicy,
  JetStreamApiCodes,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager
} from '@nats-io/jetstream'

import { PermanentJobError } from './errors.js'
import { validateEmployeeCommand } from './validation.js'

export const EMPLOYEE_STREAM = 'NEO_APP_COMMANDS'
export const EMPLOYEE_SUBJECT = 'employee.create.v1'
export const EMPLOYEE_CONSUMER = 'neo-app-employee-writer-v1'

export const EMPLOYEE_STREAM_CONFIG = Object.freeze({
  name: EMPLOYEE_STREAM,
  subjects: Object.freeze([EMPLOYEE_SUBJECT]),
  retention: RetentionPolicy.Workqueue,
  storage: StorageType.File
})

export const EMPLOYEE_CONSUMER_CONFIG = Object.freeze({
  durable_name: EMPLOYEE_CONSUMER,
  ack_policy: AckPolicy.Explicit,
  filter_subject: EMPLOYEE_SUBJECT
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function decodeCredential(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('NATS_URL memiliki credential encoding yang tidak valid.')
  }
}

function sameCredentials(left, right) {
  return left.token === right.token && left.user === right.user && left.pass === right.pass
}

function hasJetStreamApiCode(error, code) {
  return Boolean(error && typeof error === 'object' && Number(error.code) === code)
}

async function getOrCreateResource({ info, add, notFoundCode }) {
  try {
    return { info: await info(), created: false }
  } catch (error) {
    if (!hasJetStreamApiCode(error, notFoundCode)) throw error
  }

  try {
    return { info: await add(), created: true }
  } catch (addError) {
    // Another replica may create the same resource between info() and add().
    try {
      return { info: await info(), created: false }
    } catch (infoError) {
      if (hasJetStreamApiCode(infoError, notFoundCode)) throw addError
      throw infoError
    }
  }
}

function assertStreamCompatible(streamInfo) {
  const config = streamInfo?.config
  const subjects = Array.isArray(config?.subjects) ? config.subjects : []
  if (
    !subjects.includes(EMPLOYEE_SUBJECT) ||
    config?.retention !== RetentionPolicy.Workqueue ||
    config?.storage !== StorageType.File
  ) {
    throw new Error(
      `JetStream stream ${EMPLOYEE_STREAM} sudah ada tetapi konfigurasinya tidak kompatibel.`
    )
  }
}

function assertConsumerCompatible(consumerInfo) {
  const config = consumerInfo?.config
  if (
    config?.durable_name !== EMPLOYEE_CONSUMER ||
    config?.ack_policy !== AckPolicy.Explicit ||
    config?.filter_subject !== EMPLOYEE_SUBJECT
  ) {
    throw new Error(
      `JetStream consumer ${EMPLOYEE_CONSUMER} sudah ada tetapi konfigurasinya tidak kompatibel.`
    )
  }
}

export async function ensureEmployeeQueueResources(manager) {
  const stream = await getOrCreateResource({
    info: () => manager.streams.info(EMPLOYEE_STREAM),
    add: () => manager.streams.add({
      ...EMPLOYEE_STREAM_CONFIG,
      subjects: [...EMPLOYEE_STREAM_CONFIG.subjects]
    }),
    notFoundCode: JetStreamApiCodes.StreamNotFound
  })
  assertStreamCompatible(stream.info)

  const consumer = await getOrCreateResource({
    info: () => manager.consumers.info(EMPLOYEE_STREAM, EMPLOYEE_CONSUMER),
    add: () => manager.consumers.add(EMPLOYEE_STREAM, { ...EMPLOYEE_CONSUMER_CONFIG }),
    notFoundCode: JetStreamApiCodes.ConsumerNotFound
  })
  assertConsumerCompatible(consumer.info)

  return {
    streamCreated: stream.created,
    consumerCreated: consumer.created
  }
}

export function natsConnectionOptions(natsUrl) {
  const values = String(natsUrl || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) throw new Error('NATS_URL wajib berisi minimal satu endpoint.')

  const servers = []
  let credentials = null
  let tlsEnabled = null

  for (const value of values) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new Error('NATS_URL harus menggunakan format nats://token@host:port.')
    }

    if (!['nats:', 'tls:'].includes(parsed.protocol)) {
      throw new Error('NATS_URL hanya mendukung protocol nats:// atau tls://.')
    }
    if (!parsed.hostname) throw new Error('NATS_URL wajib memiliki hostname.')

    const endpointUsesTls = parsed.protocol === 'tls:'
    if (tlsEnabled !== null && tlsEnabled !== endpointUsesTls) {
      throw new Error('Semua endpoint NATS_URL harus menggunakan protocol yang sama.')
    }
    tlsEnabled = endpointUsesTls

    const username = parsed.username ? decodeCredential(parsed.username) : ''
    const password = parsed.password ? decodeCredential(parsed.password) : ''
    if (password && !username) {
      throw new Error('NATS_URL dengan password wajib memiliki username.')
    }
    const endpointCredentials = password
      ? { user: username, pass: password, token: undefined }
      : username
        ? { token: username, user: undefined, pass: undefined }
        : { token: undefined, user: undefined, pass: undefined }

    const hasCredentials = Boolean(endpointCredentials.token || endpointCredentials.user)
    if (hasCredentials) {
      if (credentials && !sameCredentials(credentials, endpointCredentials)) {
        throw new Error('Semua endpoint NATS_URL harus menggunakan credential yang sama.')
      }
      credentials = endpointCredentials
    }

    const hostname = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
      ? `[${parsed.hostname}]`
      : parsed.hostname
    servers.push(`${hostname}:${parsed.port || '4222'}`)
  }

  const options = { servers }
  if (credentials?.token) options.token = credentials.token
  if (credentials?.user) {
    options.user = credentials.user
    options.pass = credentials.pass
  }
  if (tlsEnabled) options.tls = {}
  return options
}

export class QueueService {
  constructor(natsUrl, database) {
    this.connectionOptions = natsConnectionOptions(natsUrl)
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
      ...this.connectionOptions,
      name: 'fe-neo-app-http-service',
      timeout: 5000,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000
    })
    try {
      const manager = await jetstreamManager(connection, { timeout: 5000 })
      const resources = await ensureEmployeeQueueResources(manager)
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
        consumer: EMPLOYEE_CONSUMER,
        streamCreated: resources.streamCreated,
        consumerCreated: resources.consumerCreated
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
