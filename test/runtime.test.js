import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimePort } from '../server/runtime.js'

test('runtime defaults to the unprivileged port 8080', () => {
  assert.equal(runtimePort(''), 8080)
})

test('runtime honors an explicit PORT override', () => {
  assert.equal(runtimePort('9090'), 9090)
  assert.equal(runtimePort('80'), 80)
})

test('runtime rejects invalid ports', () => {
  for (const port of ['0', '65536', '-1', 'abc', '8.5']) {
    assert.throws(() => runtimePort(port), /PORT tidak valid/)
  }
})
