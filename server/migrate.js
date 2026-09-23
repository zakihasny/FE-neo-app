import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const { Pool } = pg

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = [
  { version: '001', filename: '001_schema.sql' },
  { version: '002', filename: '002_views.sql' },
  { version: '003', filename: '003_employee_jobs.sql' },
  { version: '004', filename: '004_command_jobs.sql' }
]
const MIGRATION_LOCK_SQL = `
  SELECT pg_advisory_lock(
    hashtext(current_database()),
    hashtext('fe-neo-app:migrations')
  )
`
const MIGRATION_UNLOCK_SQL = `
  SELECT pg_advisory_unlock(
    hashtext(current_database()),
    hashtext('fe-neo-app:migrations')
  ) AS unlocked
`

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function log(logger, level, event, details = {}) {
  const write = logger?.[level] || logger?.log
  write?.call(logger, JSON.stringify({ level, event, ...details }))
}

export function environmentFlag(value, defaultValue) {
  if (value === undefined || value === null || String(value).trim() === '') return defaultValue

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`Nilai boolean tidak valid: ${value}`)
}

async function migrationApplied(client, version) {
  const registry = await client.query(`
    SELECT to_regclass('employee_app.schema_migrations') IS NOT NULL AS exists
  `)
  if (!registry.rows[0]?.exists) return false

  const result = await client.query({
    text: `
      SELECT EXISTS(
        SELECT 1
        FROM employee_app.schema_migrations
        WHERE version = $1
      ) AS applied
    `,
    values: [version]
  })
  return result.rows[0]?.applied === true
}

async function verifyPostgresqlVersion(client) {
  const result = await client.query(`
    SELECT current_setting('server_version_num')::integer AS server_version_num
  `)
  const version = Number(result.rows[0]?.server_version_num || 0)
  const major = Math.floor(version / 10000)
  if (major !== 16) {
    throw new Error(`PostgreSQL 16 diperlukan; server version number adalah ${version}.`)
  }
}

export async function applyMigrations(client, {
  migrationsRoot = path.join(repositoryRoot, 'migrations'),
  seedFile = path.join(repositoryRoot, 'seeds', '001_sample_data.sql'),
  seedSampleData = false,
  logger = console
} = {}) {
  await verifyPostgresqlVersion(client)
  await client.query(MIGRATION_LOCK_SQL)
  log(logger, 'info', 'database_migration_lock_acquired')

  const applied = []
  const skipped = []

  try {
    for (const migration of MIGRATIONS) {
      if (await migrationApplied(client, migration.version)) {
        skipped.push(migration.version)
        log(logger, 'info', 'database_migration_skipped', { version: migration.version })
        continue
      }

      const sql = await readFile(path.join(migrationsRoot, migration.filename), 'utf8')
      log(logger, 'info', 'database_migration_started', { version: migration.version })
      await client.query(sql)

      if (!await migrationApplied(client, migration.version)) {
        throw new Error(`Migration ${migration.version} selesai tanpa mencatat versinya.`)
      }

      applied.push(migration.version)
      log(logger, 'info', 'database_migration_completed', { version: migration.version })
    }

    if (seedSampleData) {
      const seedSql = await readFile(seedFile, 'utf8')
      await client.query(seedSql)
      log(logger, 'info', 'database_sample_seed_completed')
    }

    return { applied, skipped, seeded: seedSampleData }
  } finally {
    try {
      const result = await client.query(MIGRATION_UNLOCK_SQL)
      log(logger, 'info', 'database_migration_lock_released', {
        unlocked: result.rows[0]?.unlocked === true
      })
    } catch (error) {
      log(logger, 'warn', 'database_migration_unlock_failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

async function connectWithRetry(pool, {
  attempts = 30,
  retryDelayMs = 2000,
  logger = console
} = {}) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const client = await pool.connect()
      log(logger, 'info', 'database_migration_connection_ready', { attempt })
      return client
    } catch (error) {
      lastError = error
      log(logger, 'warn', 'database_migration_connection_retry', {
        attempt,
        attempts,
        message: error instanceof Error ? error.message : String(error)
      })
      if (attempt < attempts) await delay(retryDelayMs)
    }
  }

  throw new Error(
    `NEO DB tidak dapat dijangkau setelah ${attempts} percobaan.`,
    { cause: lastError }
  )
}

export async function runMigrations(connectionString, {
  enabled = true,
  seedSampleData = false,
  logger = console,
  attempts,
  retryDelayMs
} = {}) {
  if (!enabled) {
    log(logger, 'info', 'database_migrations_disabled')
    return { applied: [], skipped: [], seeded: false, disabled: true }
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
    application_name: 'fe-neo-app-migrations'
  })
  let client

  try {
    client = await connectWithRetry(pool, { attempts, retryDelayMs, logger })
    return await applyMigrations(client, { seedSampleData, logger })
  } finally {
    client?.release()
    await pool.end()
  }
}
