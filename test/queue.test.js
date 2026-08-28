import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EMPLOYEE_CONSUMER,
  EMPLOYEE_CONSUMER_CONFIG,
  EMPLOYEE_STREAM,
  EMPLOYEE_STREAM_CONFIG,
  ensureEmployeeQueueResources,
  natsConnectionOptions
} from '../server/queue.js'

function jetStreamError(code, message = 'JetStream error') {
  return Object.assign(new Error(message), { code })
}

function compatibleStreamInfo() {
  return { config: { ...EMPLOYEE_STREAM_CONFIG, subjects: [...EMPLOYEE_STREAM_CONFIG.subjects] } }
}

function compatibleConsumerInfo() {
  return { config: { ...EMPLOYEE_CONSUMER_CONFIG } }
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

test('ensureEmployeeQueueResources creates a missing stream and consumer', async () => {
  const calls = []
  let streamInfo = null
  let consumerInfo = null
  const manager = {
    streams: {
      async info(name) {
        calls.push(['stream.info', name])
        if (!streamInfo) throw jetStreamError(10059, 'stream not found')
        return streamInfo
      },
      async add(config) {
        calls.push(['stream.add', config])
        streamInfo = compatibleStreamInfo()
        return streamInfo
      }
    },
    consumers: {
      async info(stream, consumer) {
        calls.push(['consumer.info', stream, consumer])
        if (!consumerInfo) throw jetStreamError(10014, 'consumer not found')
        return consumerInfo
      },
      async add(stream, config) {
        calls.push(['consumer.add', stream, config])
        consumerInfo = compatibleConsumerInfo()
        return consumerInfo
      }
    }
  }

  assert.deepEqual(await ensureEmployeeQueueResources(manager), {
    streamCreated: true,
    consumerCreated: true
  })
  assert.deepEqual(calls, [
    ['stream.info', EMPLOYEE_STREAM],
    ['stream.add', EMPLOYEE_STREAM_CONFIG],
    ['consumer.info', EMPLOYEE_STREAM, EMPLOYEE_CONSUMER],
    ['consumer.add', EMPLOYEE_STREAM, EMPLOYEE_CONSUMER_CONFIG]
  ])
})

test('ensureEmployeeQueueResources leaves compatible resources unchanged', async () => {
  const manager = {
    streams: {
      info: async () => compatibleStreamInfo(),
      add: async () => assert.fail('stream should not be created')
    },
    consumers: {
      info: async () => compatibleConsumerInfo(),
      add: async () => assert.fail('consumer should not be created')
    }
  }

  assert.deepEqual(await ensureEmployeeQueueResources(manager), {
    streamCreated: false,
    consumerCreated: false
  })
})

test('ensureEmployeeQueueResources tolerates a concurrent stream creation', async () => {
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
    consumers: {
      info: async () => compatibleConsumerInfo(),
      add: async () => assert.fail('consumer should not be created')
    }
  }

  assert.deepEqual(await ensureEmployeeQueueResources(manager), {
    streamCreated: false,
    consumerCreated: false
  })
  assert.equal(infoCalls, 2)
})

test('ensureEmployeeQueueResources tolerates a concurrent consumer creation', async () => {
  let infoCalls = 0
  const manager = {
    streams: {
      info: async () => compatibleStreamInfo(),
      add: async () => assert.fail('stream should not be created')
    },
    consumers: {
      async info() {
        infoCalls += 1
        if (infoCalls === 1) throw jetStreamError(10014, 'consumer not found')
        return compatibleConsumerInfo()
      },
      async add() {
        throw jetStreamError(10013, 'consumer name already in use')
      }
    }
  }

  assert.deepEqual(await ensureEmployeeQueueResources(manager), {
    streamCreated: false,
    consumerCreated: false
  })
  assert.equal(infoCalls, 2)
})

test('ensureEmployeeQueueResources rejects incompatible or unauthorized resources', async () => {
  const incompatibleManager = {
    streams: {
      info: async () => ({
        config: {
          ...EMPLOYEE_STREAM_CONFIG,
          subjects: ['different.subject']
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
