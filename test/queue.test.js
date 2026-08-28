import assert from 'node:assert/strict'
import test from 'node:test'

import { natsConnectionOptions } from '../server/queue.js'

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
