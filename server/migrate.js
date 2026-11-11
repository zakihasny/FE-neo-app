import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createPool, verifyVersion } from './sql-client.js'
export { environmentFlag } from './storage-utils.js'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function applyMigrations(client, { migrationsRoot = path.join(root, 'migrations'), seedFile = path.join(root, 'seeds/sample-data.json'), seedSampleData = false, logger = console } = {}) {
  const version = await client.query('SELECT VERSION() AS version, DATABASE() AS database_name')
  verifyVersion(version.rows[0].version)
  const lock = 'fe-migrations:' + createHash('sha256').update(version.rows[0].database_name).digest('hex').slice(0, 48)
  const locked = await client.query('SELECT GET_LOCK(?,30) AS acquired', [lock])
  if (Number(locked.rows[0].acquired) !== 1) throw new Error('Migration lock is busy.')
  const applied = [], skipped = []
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(50) PRIMARY KEY,description VARCHAR(255) NOT NULL,applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB')
    for (const number of ['001', '002', '003', '004']) {
      const existing = await client.query('SELECT version FROM schema_migrations WHERE version=?', [number])
      if (existing.rows.length) { skipped.push(number); continue }
      const text = await readFile(path.join(migrationsRoot, number + '.sql'), 'utf8')
      // Files contain authored single statements separated by this marker; driver multi-statements stay disabled.
      for (const statement of text.split(/^-- next-statement\s*$/m).map(item => item.trim()).filter(Boolean)) await client.query(statement)
      await client.query('INSERT INTO schema_migrations (version,description) VALUES (?,?)', [number, 'Database variant migration ' + number])
      applied.push(number)
    }
    let seeded = false
    if (seedSampleData) {
      const marker = await client.query("SELECT version FROM schema_migrations WHERE version='seed-v1'")
      if (!marker.rows.length) {
        const data = JSON.parse(await readFile(seedFile, 'utf8'))
        await client.query('START TRANSACTION')
        try {
          const count = await client.query('SELECT (SELECT COUNT(*) FROM sites)+(SELECT COUNT(*) FROM salaries)+(SELECT COUNT(*) FROM seating)+(SELECT COUNT(*) FROM employees)+(SELECT COUNT(*) FROM employee_devices) AS total')
          if (Number(count.rows[0].total) !== 0) throw new Error('Sample seed requires an empty application database.')
          for (const table of ['sites', 'salaries', 'seating', 'employees', 'employee_devices']) {
            for (const row of data[table]) {
              const columns = Object.keys(row)
              await client.query('INSERT INTO ' + table + ' (' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')', Object.values(row))
            }
          }
          await client.query("INSERT INTO schema_migrations (version,description) VALUES ('seed-v1','Synthetic sample seed')")
          await client.query('COMMIT')
          seeded = true
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
      }
    }
    logger.info?.(JSON.stringify({ event: 'database_bootstrap_completed', applied, skipped, seeded }))
    return { applied, skipped, seeded }
  } finally { await client.query('SELECT RELEASE_LOCK(?) AS released', [lock]).catch(() => {}) }
}

export async function runMigrations(connectionString, { enabled = true, attempts = 30, retryDelayMs = 2000, ...options } = {}) {
  if (!enabled) return { applied: [], skipped: [], seeded: false, disabled: true }
  const pool = createPool(connectionString)
  let client
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try { client = await pool.connect(); break }
      catch { if (attempt === attempts) throw new Error('Database unavailable during bootstrap.'); await new Promise(resolve => setTimeout(resolve, retryDelayMs)) }
    }
    return await applyMigrations(client, options)
  } finally { client?.release(); await pool.end() }
}
