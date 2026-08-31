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
import {
  validateDeviceCommand,
  validateEmployeeCommand,
  validateSiteCommand
} from './validation.js'

export const EMPLOYEE_STREAM = 'NEO_APP_COMMANDS'
export const EMPLOYEE_SUBJECT = 'employee.create.v1'
export const EMPLOYEE_CONSUMER = 'neo-app-employee-writer-v1'
export const SITE_SUBJECT = 'site.create.v1'
export const SITE_CONSUMER = 'neo-app-site-writer-v1'
export const DEVICE_SUBJECT = 'device.create.v1'
export const DEVICE_CONSUMER = 'neo-app-device-writer-v1'

export const EMPLOYEE_STREAM_CONFIG = Object.freeze({
  name: EMPLOYEE_STREAM,
  subjects: Object.freeze([EMPLOYEE_SUBJECT, SITE_SUBJECT, DEVICE_SUBJECT]),
  retention: RetentionPolicy.Workqueue,
  storage: StorageType.File
})

export const EMPLOYEE_CONSUMER_CONFIG = Object.freeze({
  durable_name: EMPLOYEE_CONSUMER,
  ack_policy: AckPolicy.Explicit,
  filter_subject: EMPLOYEE_SUBJECT
})

export const SITE_CONSUMER_CONFIG = Object.freeze({
  durable_name: SITE_CONSUMER,
  ack_policy: AckPolicy.Explicit,
  filter_subject: SITE_SUBJECT
})

export const DEVICE_CONSUMER_CONFIG = Object.freeze({
  durable_name: DEVICE_CONSUMER,
  ack_policy: AckPolicy.Explicit,
  filter_subject: DEVICE_SUBJECT
})

export const QUEUE_COMMANDS = Object.freeze([
  Object.freeze({
    resourceType: 'employee',
    subject: EMPLOYEE_SUBJECT,
    consumer: EMPLOYEE_CONSUMER,
    consumerConfig: EMPLOYEE_CONSUMER_CONFIG,
    validate: validateEmployeeCommand
  }),
  Object.freeze({
    resourceType: 'site',
    subject: SITE_SUBJECT,
    consumer: SITE_CONSUMER,
    consumerConfig: SITE_CONSUMER_CONFIG,
    validate: validateSiteCommand
  }),
  Object.freeze({
    resourceType: 'device',
    subject: DEVICE_SUBJECT,
    consumer: DEVICE_CONSUMER,
    consumerConfig: DEVICE_CONSUMER_CONFIG,
    validate: validateDeviceCommand
  })
])

const queueCommandByResourceType = new Map(
  QUEUE_COMMANDS.map((definition) => [definition.resourceType, definition])
)

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

function assertStreamStorageCompatible(streamInfo) {
  const config = streamInfo?.config
  if (
    config?.retention !== RetentionPolicy.Workqueue ||
    config?.storage !== StorageType.File
  ) {
    throw new Error(
      `JetStream stream ${EMPLOYEE_STREAM} sudah ada tetapi konfigurasinya tidak kompatibel.`
    )
  }
}

function missingStreamSubjects(streamInfo) {
  const subjects = Array.isArray(streamInfo?.config?.subjects) ? streamInfo.config.subjects : []
  return EMPLOYEE_STREAM_CONFIG.subjects.filter((subject) => !subjects.includes(subject))
}

function assertStreamSubjectsCompatible(streamInfo) {
  if (missingStreamSubjects(streamInfo).length > 0) {
    throw new Error(
      `JetStream stream ${EMPLOYEE_STREAM} belum memiliki seluruh command subject.`
    )
  }
}

function assertConsumerCompatible(consumerInfo, definition) {
  const config = consumerInfo?.config
  if (
    config?.durable_name !== definition.consumer ||
    config?.ack_policy !== AckPolicy.Explicit ||
    config?.filter_subject !== definition.subject
  ) {
    throw new Error(
      `JetStream consumer ${definition.consumer} sudah ada tetapi konfigurasinya tidak kompatibel.`
    )
  }
}

export async function ensureCommandQueueResources(manager) {
  let stream = await getOrCreateResource({
    info: () => manager.streams.info(EMPLOYEE_STREAM),
    add: () => manager.streams.add({
      ...EMPLOYEE_STREAM_CONFIG,
      subjects: [...EMPLOYEE_STREAM_CONFIG.subjects]
    }),
    notFoundCode: JetStreamApiCodes.StreamNotFound
  })
  assertStreamStorageCompatible(stream.info)

  let streamUpdated = false
  const missingSubjects = missingStreamSubjects(stream.info)
  if (missingSubjects.length > 0) {
    const currentSubjects = Array.isArray(stream.info.config?.subjects)
      ? stream.info.config.subjects
      : []
    try {
      stream = {
        info: await manager.streams.update(EMPLOYEE_STREAM, {
          subjects: [...new Set([...currentSubjects, ...EMPLOYEE_STREAM_CONFIG.subjects])]
        }),
        created: stream.created
      }
      streamUpdated = true
    } catch (updateError) {
      const current = await manager.streams.info(EMPLOYEE_STREAM).catch(() => null)
      if (!current || missingStreamSubjects(current).length > 0) throw updateError
      stream = { info: current, created: stream.created }
    }
  }
  assertStreamSubjectsCompatible(stream.info)

  const consumerCreated = {}
  for (const definition of QUEUE_COMMANDS) {
    const consumer = await getOrCreateResource({
      info: () => manager.consumers.info(EMPLOYEE_STREAM, definition.consumer),
      add: () => manager.consumers.add(
        EMPLOYEE_STREAM,
        { ...definition.consumerConfig }
      ),
      notFoundCode: JetStreamApiCodes.ConsumerNotFound
    })
    assertConsumerCompatible(consumer.info, definition)
    consumerCreated[definition.resourceType] = consumer.created
  }

  return {
    streamCreated: stream.created,
    streamUpdated,
    consumerCreated
  }
}

// Backward-compatible export for existing integrations and tests.
export const ensureEmployeeQueueResources = ensureCommandQueueResources

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
    this.messageSources = []
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

  async publishCommand(command) {
    if (!this.ready || !this.client) throw new Error('NEO Queue belum siap.')
    const definition = queueCommandByResourceType.get(command.resourceType)
    if (!definition) throw new Error('Tipe command NEO Queue tidak didukung.')

    return this.client.publish(
      definition.subject,
      encoder.encode(JSON.stringify(command)),
      {
        msgID: command.idempotencyKey,
        timeout: 5000,
        expect: { streamName: EMPLOYEE_STREAM }
      }
    )
  }

  async publishEmployee(command) {
    return this.publishCommand({ ...command, resourceType: 'employee' })
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
        this.messageSources = []
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
      const resources = await ensureCommandQueueResources(manager)
      const client = jetstream(connection, { timeout: 5000 })
      const messageSources = []
      for (const definition of QUEUE_COMMANDS) {
        const consumer = await client.consumers.get(EMPLOYEE_STREAM, definition.consumer)
        const messages = await consumer.consume({ max_messages: 1 })
        messageSources.push({ definition, messages })
      }

      this.connection = connection
      this.client = client
      this.messageSources = messageSources
      this.ready = true

      console.log(JSON.stringify({
        level: 'info',
        event: 'nats_worker_ready',
        stream: EMPLOYEE_STREAM,
        subjects: EMPLOYEE_STREAM_CONFIG.subjects,
        consumers: QUEUE_COMMANDS.map((definition) => definition.consumer),
        streamCreated: resources.streamCreated,
        streamUpdated: resources.streamUpdated,
        consumerCreated: resources.consumerCreated
      }))

      const workers = messageSources.map(({ definition, messages }) => (
        this.#consume(definition, messages)
      ))
      const closedError = await connection.closed()
      for (const source of messageSources) source.messages.stop()
      await Promise.all(workers)
      if (closedError) throw closedError
    } catch (error) {
      await connection.close().catch(() => {})
      throw error
    }
  }

  async #consume(definition, messages) {
    for await (const message of messages) {
      await this.#processMessage(definition, message)
    }
  }

  async #processMessage(definition, message) {
    let command
    try {
      command = definition.validate(JSON.parse(decoder.decode(message.data)))
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'command_message_invalid',
        resourceType: definition.resourceType,
        streamSequence: message.seq,
        message: safeMessage(error)
      }))
      message.term()
      return
    }

    try {
      message.working()
      const result = await this.database.processCommand(command)
      message.ack()
      console.log(JSON.stringify({
        level: 'info',
        event: 'command_message_completed',
        jobId: command.jobId,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        duplicate: result.duplicate,
        streamSequence: message.seq
      }))
    } catch (error) {
      if (error instanceof PermanentJobError) {
        message.ack()
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'command_message_rejected',
          jobId: command.jobId,
          resourceType: definition.resourceType,
          message: error.message,
          streamSequence: message.seq
        }))
        return
      }

      message.nak(5000)
      console.error(JSON.stringify({
        level: 'error',
        event: 'command_message_retry',
        jobId: command.jobId,
        resourceType: definition.resourceType,
        message: safeMessage(error),
        streamSequence: message.seq
      }))
    }
  }

  async stop() {
    this.stopping = true
    this.ready = false
    for (const source of this.messageSources) source.messages.stop()
    if (this.connection) await this.connection.drain().catch(() => {})
    if (this.loopPromise) await this.loopPromise.catch(() => {})
  }
}
