import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_CONSUMER,
  DEVICE_CONSUMER_CONFIG,
  EMPLOYEE_CONSUMER,
  EMPLOYEE_CONSUMER_CONFIG,
  EMPLOYEE_STREAM,
  EMPLOYEE_STREAM_CONFIG,
  QUEUE_COMMANDS,
  SITE_CONSUMER,
  SITE_CONSUMER_CONFIG,
  ensureEmployeeQueueResources,
  natsConnectionOptions
} from '../server/queue.js'

function jetStreamError(code, message = 'JetStream error') {
  return Object.assign(new Error(message), { code })
}

function compatibleStreamInfo(subjects = EMPLOYEE_STREAM_CONFIG.subjects) {
  return {
    config: {
      ...EMPLOYEE_STREAM_CONFIG,
      subjects: [...subjects]
    }
  }
}

const consumerConfigByName = new Map([
  [EMPLOYEE_CONSUMER, EMPLOYEE_CONSUMER_CONFIG],
  [SITE_CONSUMER, SITE_CONSUMER_CONFIG],
  [DEVICE_CONSUMER, DEVICE_CONSUMER_CONFIG]
])

function compatibleConsumerInfo(name) {
  return { config: { ...consumerConfigByName.get(name) } }
}

function existingConsumersApi(overrides = {}) {
  return {
    info: async (_stream, name) => compatibleConsumerInfo(name),
    add: async () => assert.fail('consumer should not be created'),
    ...overrides
  }
}

test('natsConnectionOptions extracts a NEO Queue token from NATS_URL', () => {
  assert.deepEqual(
    natsConnectionOptions('nats://secret-token@message-neo-app:4222'),
    {
      servers: ['message-neo-app:4222'],
      token: 'secret-token'
    }
  )
})

test('natsConnectionOptions decodes token and user/password credentials', () => {
  assert.deepEqual(
    natsConnectionOptions('nats://token%2Fwith%2Fslashes@message-neo-app:4222'),
    {
      servers: ['message-neo-app:4222'],
      token: 'token/with/slashes'
    }
  )

  assert.deepEqual(
    natsConnectionOptions('nats://service-user:p%40ssword@message-neo-app:4222'),
    {
      servers: ['message-neo-app:4222'],
      user: 'service-user',
      pass: 'p@ssword'
    }
  )
})

test('natsConnectionOptions supports multiple private endpoints with one token', () => {
  assert.deepEqual(
    natsConnectionOptions(
      'nats://shared-token@message-neo-app-a:4222,nats://shared-token@message-neo-app-b:4222'
    ),
    {
      servers: ['message-neo-app-a:4222', 'message-neo-app-b:4222'],
      token: 'shared-token'
    }
  )
})

test('natsConnectionOptions enables TLS only for tls URLs', () => {
  assert.deepEqual(
    natsConnectionOptions('tls://shared-token@message-neo-app:4222'),
    {
      servers: ['message-neo-app:4222'],
      token: 'shared-token',
      tls: {}
    }
  )
})

test('natsConnectionOptions rejects unsafe or ambiguous endpoint configuration', () => {
  assert.throws(() => natsConnectionOptions(''), /minimal satu endpoint/)
  assert.throws(() => natsConnectionOptions('http://message-neo-app:4222'), /protocol/)
  assert.throws(() => natsConnectionOptions('nats://:password@message-neo-app:4222'), /username/)
  assert.throws(
    () => natsConnectionOptions(
      'nats://token-one@message-a:4222,nats://token-two@message-b:4222'
    ),
    /credential yang sama/
  )
  assert.throws(
    () => natsConnectionOptions(
      'nats://token@message-a:4222,tls://token@message-b:4222'
    ),
    /protocol yang sama/
  )
})

test('ensureEmployeeQueueResources creates the stream and all command consumers', async () => {
  let streamInfo = null
  const consumers = new Map()
  const addedConsumers = []
  const manager = {
    streams: {
      async info() {
        if (!streamInfo) throw jetStreamError(10059, 'stream not found')
        return streamInfo
      },
      async add(config) {
        streamInfo = compatibleStreamInfo(config.subjects)
        return streamInfo
      }
    },
    consumers: {
      async info(_stream, name) {
        if (!consumers.has(name)) throw jetStreamError(10014, 'consumer not found')
        return consumers.get(name)
      },
      async add(stream, config) {
        assert.equal(stream, EMPLOYEE_STREAM)
        const info = { config: { ...config } }
        consumers.set(config.durable_name, info)
        addedConsumers.push(config.durable_name)
        return info
      }
    }
  }

  assert.deepEqual(await ensureEmployeeQueueResources(manager), {
    streamCreated: true,
    streamUpdated: false,
    consumerCreated: {
      employee: true,
      site: true,
      device: true
    }
  })
  assert.deepEqual(addedConsumers, QUEUE_COMMANDS.map((command) => command.consumer))
})

test('ensureEmployeeQueueResources leaves compatible resources unchanged', async () => {
  const manager = {
    streams: {
      info: async () => compatibleStreamInfo(),
      add: async () => assert.fail('stream should not be created'),
      update: async () => assert.fail('stream should not be updated')
    },
    consumers: existingConsumersApi()
  }

  assert.deepEqual(await ensureEmployeeQueueResources(manager), {
    streamCreated: false,
    streamUpdated: false,
    consumerCreated: {
      employee: false,
      site: false,
      device: false
    }
  })
})

test('ensureEmployeeQueueResources upgrades a legacy employee-only stream', async () => {
  let streamInfo = compatibleStreamInfo(['employee.create.v1'])
  let updatedSubjects
  const manager = {
    streams: {
      info: async () => streamInfo,
      add: async () => assert.fail('stream should not be created'),
      async update(name, config) {
        assert.equal(name, EMPLOYEE_STREAM)
        updatedSubjects = config.subjects
        streamInfo = compatibleStreamInfo(config.subjects)
        return streamInfo
      }
    },
    consumers: existingConsumersApi()
  }

  const result = await ensureEmployeeQueueResources(manager)
  assert.equal(result.streamCreated, false)
  assert.equal(result.streamUpdated, true)
  assert.deepEqual(updatedSubjects, EMPLOYEE_STREAM_CONFIG.subjects)
})

test('ensureEmployeeQueueResources tolerates concurrent stream creation', async () => {
  let infoCalls = 0
  const manager = {
    streams: {
      async info() {
        infoCalls += 1
        if (infoCalls === 1) throw jetStreamError(10059, 'stream not found')
        return compatibleStreamInfo()
      },
      async add() {
        throw jetStreamError(10058, 'stream name already in use')
      }
    },
    consumers: existingConsumersApi()
  }

  const result = await ensureEmployeeQueueResources(manager)
  assert.equal(result.streamCreated, false)
  assert.equal(infoCalls, 2)
})

test('ensureEmployeeQueueResources tolerates concurrent consumer creation', async () => {
  let siteInfoCalls = 0
  const manager = {
    streams: {
      info: async () => compatibleStreamInfo(),
      add: async () => assert.fail('stream should not be created')
    },
    consumers: existingConsumersApi({
      async info(_stream, name) {
        if (name !== SITE_CONSUMER) return compatibleConsumerInfo(name)
        siteInfoCalls += 1
        if (siteInfoCalls === 1) throw jetStreamError(10014, 'consumer not found')
        return compatibleConsumerInfo(name)
      },
      async add(_stream, config) {
        assert.equal(config.durable_name, SITE_CONSUMER)
        throw jetStreamError(10013, 'consumer name already in use')
      }
    })
  }

  const result = await ensureEmployeeQueueResources(manager)
  assert.equal(result.consumerCreated.site, false)
  assert.equal(siteInfoCalls, 2)
})

test('ensureEmployeeQueueResources rejects incompatible or unauthorized resources', async () => {
  const incompatibleManager = {
    streams: {
      info: async () => ({
        config: {
          ...EMPLOYEE_STREAM_CONFIG,
          retention: 'limits',
          subjects: [...EMPLOYEE_STREAM_CONFIG.subjects]
        }
      })
    },
    consumers: {}
  }

  await assert.rejects(
    ensureEmployeeQueueResources(incompatibleManager),
    /stream NEO_APP_COMMANDS.*tidak kompatibel/
  )

  const unauthorized = jetStreamError(10005, 'not authorized')
  const unauthorizedManager = {
    streams: {
      info: async () => { throw unauthorized }
    },
    consumers: {}
  }
  await assert.rejects(ensureEmployeeQueueResources(unauthorizedManager), unauthorized)
})
