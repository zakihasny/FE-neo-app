import assert from 'node:assert/strict'
import test from 'node:test'

import { applyMigrations, environmentFlag } from '../server/migrate.js'

class FakeMigrationClient {
  constructor({ applied = [], version = 150012 } = {}) {
    this.applied = new Set(applied)
    this.registryExists = applied.length > 0
    this.version = version
    this.executedMigrations = []
    this.seedRuns = 0
    this.locked = false
    this.unlocked = false
  }

  async query(input) {
    const text = typeof input === 'string' ? input : input.text
    const values = typeof input === 'string' ? [] : input.values
    const normalized = text.trim()

    if (normalized.startsWith("SELECT current_setting('server_version_num')")) {
      return { rows: [{ server_version_num: this.version }] }
    }
    if (text.includes('pg_advisory_unlock')) {
      this.locked = false
      this.unlocked = true
      return { rows: [{ unlocked: true }] }
    }
    if (text.includes('pg_advisory_lock')) {
      this.locked = true
      return { rows: [{}] }
    }
    if (text.includes("to_regclass('employee_app.schema_migrations')")) {
      return { rows: [{ exists: this.registryExists }] }
    }
    if (text.includes('FROM employee_app.schema_migrations') && values.length === 1) {
      return { rows: [{ applied: this.applied.has(values[0]) }] }
    }

    for (const version of ['001', '002', '003', '004']) {
      if (text.includes(`VALUES ('${version}'`)) {
        this.registryExists = true
        this.applied.add(version)
        this.executedMigrations.push(version)
        return { rows: [] }
      }
    }

    if (text.includes("'Ahmad Zaki'")) {
      this.seedRuns += 1
      return { rows: [] }
    }

    throw new Error(`Unexpected query in migration test: ${normalized.slice(0, 100)}`)
  }
}

const silentLogger = {
  info() {},
  warn() {},
  error() {},
  log() {}
}

test('environmentFlag accepts dashboard-friendly boolean values', () => {
  assert.equal(environmentFlag(undefined, true), true)
  assert.equal(environmentFlag('false', true), false)
  assert.equal(environmentFlag('YES', false), true)
  assert.equal(environmentFlag('0', true), false)
  assert.throws(() => environmentFlag('sometimes', true), /boolean tidak valid/)
})

test('applyMigrations applies missing migrations in order under an advisory lock', async () => {
  const client = new FakeMigrationClient()
  const result = await applyMigrations(client, { logger: silentLogger })

  assert.deepEqual(client.executedMigrations, ['001', '002', '003', '004'])
  assert.deepEqual(result.applied, ['001', '002', '003', '004'])
  assert.deepEqual(result.skipped, [])
  assert.equal(client.locked, false)
  assert.equal(client.unlocked, true)
})

test('applyMigrations skips recorded migrations and optionally seeds sample data', async () => {
  const client = new FakeMigrationClient({ applied: ['001', '002', '003', '004'] })
  const result = await applyMigrations(client, {
    logger: silentLogger,
    seedSampleData: true
  })

  assert.deepEqual(client.executedMigrations, [])
  assert.deepEqual(result.skipped, ['001', '002', '003', '004'])
  assert.equal(result.seeded, true)
  assert.equal(client.seedRuns, 1)
})

test('applyMigrations rejects databases other than PostgreSQL 15 before locking', async () => {
  const client = new FakeMigrationClient({ version: 160001 })

  await assert.rejects(
    applyMigrations(client, { logger: silentLogger }),
    /PostgreSQL 15 diperlukan/
  )
  assert.equal(client.locked, false)
})
