import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { image, run, sanitize, summary, versions } from './lib.mjs'

const id = randomBytes(5).toString('hex')
const prefix = 'fe-ci-' + id
const network = prefix + '-net'
const postgres = prefix + '-pg'
const nats = prefix + '-nats'
const app = prefix + '-app'
const password = randomBytes(24).toString('hex')
const databaseUrl = 'postgresql://ci:' + password + '@' + postgres + ':5432/app'
let baseUrl = ''
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(endpoint, { method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + endpoint, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data, type: response.headers.get('content-type') }
}

async function ready() {
  const deadline = Date.now() + 240000
  while (Date.now() < deadline) {
    try {
      const result = await request('/health/ready')
      if (result.status === 200) {
        assert.equal(result.data.postgresqlMajor, 16)
        assert.equal(result.data.queue, 'connected')
        return
      }
    } catch { /* dependencies and the app are allowed to start during the grace period */ }
    await sleep(1000)
  }
  throw new Error('Application readiness did not pass within 240 seconds')
}

async function startApp({ port = 8080, seed = false, override = false } = {}) {
  const args = ['run', '--detach', '--name', app, '--network', network, '--user', '1000:1000',
    '--publish', '127.0.0.1::' + port,
    '--env', 'DATABASE_URL=' + databaseUrl, '--env', 'NATS_URL=nats://' + nats + ':4222',
    '--env', 'RUN_DB_MIGRATIONS=true', '--env', 'SEED_SAMPLE_DATA=' + seed]
  if (override) args.push('--env', 'PORT=' + port)
  args.push(image)
  run('docker', args, { capture: true })
  const mapping = run('docker', ['port', app, port + '/tcp'], { capture: true })
  const match = mapping.match(/:(\d+)\s*$/)
  assert.ok(match, 'Published test port must be available')
  baseUrl = 'http://127.0.0.1:' + match[1]
  await ready()
  assert.notEqual(run('docker', ['exec', app, 'id', '-u'], { capture: true }), '0', 'Smoke test must run non-root')
}

async function create(endpoint, payload) {
  const submitted = await request(endpoint, { method: 'POST', body: payload })
  assert.equal(submitted.status, 202, endpoint + ' must accept a command')
  assert.ok(submitted.data.jobId)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const result = await request('/api/jobs/' + submitted.data.jobId)
    assert.equal(result.status, 200)
    if (result.data.status === 'failed') throw new Error('Command job failed: ' + endpoint)
    if (result.data.status === 'completed') {
      const repeated = await request(endpoint, { method: 'POST', body: payload })
      assert.equal(repeated.status, 202)
      assert.equal(repeated.data.jobId, submitted.data.jobId, 'Idempotency must preserve the job')
      return result.data
    }
    await sleep(500)
  }
  throw new Error('Command timed out: ' + endpoint)
}

async function migrationVersions() {
  const result = await request('/api/query', { method: 'POST', body: { sql: 'SELECT version FROM employee_app.schema_migrations ORDER BY version' } })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.rows.map((row) => row[0]), ['001', '002', '003', '004'])
}

try {
  run('docker', ['network', 'create', network], { capture: true })
  run('docker', ['run', '--detach', '--name', postgres, '--network', network,
    '--env', 'POSTGRES_USER=ci', '--env', 'POSTGRES_PASSWORD=' + password, '--env', 'POSTGRES_DB=app',
    versions.images.postgres], { capture: true })
  run('docker', ['run', '--detach', '--name', nats, '--network', network,
    versions.images.nats, '-js', '-sd', '/data'], { capture: true })
  await startApp({ seed: true })

  for (const endpoint of ['/', '/input.html', '/query.html', '/assets/app.js', '/assets/styles.css', '/assets/mark.svg']) {
    assert.equal((await request(endpoint)).status, 200, 'Missing runtime file: ' + endpoint)
  }
  assert.equal((await request('/healthz')).status, 200)
  const head = await fetch(baseUrl + '/healthz', { method: 'HEAD', signal: AbortSignal.timeout(10000) })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  await migrationVersions()
  const initial = (await request('/api/summary')).data
  const meta = (await request('/api/meta')).data
  assert.ok(meta.seating.length && meta.salaries.length && meta.employees.length, 'Sample seed must be present')
  const seat = meta.seating[0]
  await create('/api/sites', { siteName: 'CI Site ' + id, city: 'Jakarta', address: 'CI dummy address', idempotencyKey: 'ci-site-' + id })
  const employee = await create('/api/employees', {
    fullName: 'CI Employee ' + id, email: 'ci-' + id + '@example.invalid', jobTitle: 'CI Tester', hiredDate: '2026-01-01',
    siteId: seat.site_id, salaryId: meta.salaries[0].salary_id, seatingId: seat.seating_id, idempotencyKey: 'ci-employee-' + id
  })
  await create('/api/devices', {
    employeeId: employee.resourceId, siteId: seat.site_id, deviceType: 'Laptop', deviceBrand: 'Lenovo',
    serialNumber: 'CI-' + id, assignedDate: '2026-01-02', idempotencyKey: 'ci-device-' + id
  })
  const after = (await request('/api/summary')).data
  assert.deepEqual(after, { sites: initial.sites + 1, employees: initial.employees + 1, devices: initial.devices + 1 })
  const rejected = await request('/api/query', { method: 'POST', body: { sql: 'DELETE FROM employee_app.sites' } })
  assert.ok(rejected.status >= 400 && rejected.status < 500, 'Write queries must be rejected')
  const bootstrapLog = run('docker', ['logs', app], { capture: true, captureBoth: true })
  assert.match(bootstrapLog, /database_sample_seed_completed/)
  assert.match(bootstrapLog, /nats_worker_ready/)

  run('docker', ['rm', '-f', app], { capture: true })
  await startApp()
  await migrationVersions()
  assert.deepEqual((await request('/api/summary')).data, after, 'Data must survive an app restart')
  const restartedLog = run('docker', ['logs', app], { capture: true, captureBoth: true })
  assert.equal((restartedLog.match(/database_migration_skipped/g) || []).length, 4)
  assert.doesNotMatch(restartedLog, /database_sample_seed_completed/, 'Seed must be disabled after bootstrap')

  run('docker', ['rm', '-f', app], { capture: true })
  await startApp({ port: 9090, override: true })
  assert.deepEqual((await request('/api/summary')).data, after)
  summary('## Smoke tests passed\nNon-root runtime; default 8080 and PORT=9090; pages/assets; liveness/readiness; PostgreSQL 16 + JetStream; four migrations; seed; three command jobs; idempotency; read-only SQL; restart persistence.')
} catch (error) {
  for (const name of [app, postgres, nats]) {
    console.error('Sanitized log: ' + name)
    const logs = run('docker', ['logs', '--tail', '100', name], { capture: true, captureBoth: true, allowFailure: true })
    console.error(sanitize(logs).replaceAll(password, '[redacted]'))
  }
  throw error
} finally {
  for (const name of [app, postgres, nats]) run('docker', ['rm', '-f', name], { capture: true, allowFailure: true })
  run('docker', ['network', 'rm', network], { capture: true, allowFailure: true })
}
