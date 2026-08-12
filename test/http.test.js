import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createHttpServer } from '../server/http.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('HTTP service serves static pages and the API contract', async (context) => {
  let createdCommand
  const database = {
    async ready() { return { database: 'app', version: 150000 } },
    async summary() { return { sites: 2, employees: 3, devices: 4 } },
    async meta() { return { sites: [], salaries: [], seating: [] } },
    async executeReadOnly(sql) {
      return { columns: ['value'], rows: [[sql]], rowCount: 1, durationMs: 1 }
    },
    async createJob(command) {
      createdCommand = command
      return { jobId: command.jobId, status: 'queued', isNew: true }
    },
    async markJobPublished() {},
    async markJobFailed() {},
    async getJob(jobId) {
      return { jobId, status: 'completed', employeeId: 42 }
    }
  }
  const queue = {
    isReady() { return true },
    async publishEmployee() { return { stream: 'NEO_APP_COMMANDS', seq: 1 } }
  }

  const server = createHttpServer({ database, queue, publicRoot: repositoryRoot })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const home = await fetch(`${baseUrl}/`)
  assert.equal(home.status, 200)
  assert.match(home.headers.get('content-type'), /text\/html/)
  assert.match(await home.text(), /NEO App/)

  const summary = await fetch(`${baseUrl}/api/summary`)
  assert.deepEqual(await summary.json(), { sites: 2, employees: 3, devices: 4 })

  const query = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT 1' })
  })
  assert.equal(query.status, 200)
  assert.equal((await query.json()).rowCount, 1)

  const employee = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Dewi Anggraini',
      email: 'dewi@example.com',
      jobTitle: 'System Analyst',
      hiredDate: '2026-08-12',
      siteId: 1,
      salaryId: 2,
      seatingId: 3,
      idempotencyKey: 'request-12345678'
    })
  })
  const employeeBody = await employee.json()
  assert.equal(employee.status, 202)
  assert.equal(employeeBody.jobId, createdCommand.jobId)

  const job = await fetch(`${baseUrl}/api/jobs/${employeeBody.jobId}`)
  assert.equal((await job.json()).employeeId, 42)

  const ready = await fetch(`${baseUrl}/health/ready`)
  assert.equal(ready.status, 200)
  assert.equal((await ready.json()).postgresqlMajor, 15)
})
