import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createHttpServer } from '../server/http.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('HTTP service serves static pages and the API contract', async (context) => {
  const createdCommands = []
  const database = {
    async ready() { return { database: 'app', version: 150000 } },
    async summary() { return { sites: 2, employees: 3, devices: 4 } },
    async meta() { return { sites: [], salaries: [], seating: [], employees: [] } },
    async executeReadOnly(sql) {
      return { columns: ['value'], rows: [[sql]], rowCount: 1, durationMs: 1 }
    },
    async createJob(command) {
      createdCommands.push(command)
      return {
        jobId: command.jobId,
        resourceType: command.resourceType,
        resourceId: null,
        status: 'queued',
        isNew: true
      }
    },
    async markJobPublished() {},
    async markJobFailed() {},
    async getJob(jobId) {
      const command = createdCommands.find((item) => item.jobId === jobId)
      const job = {
        jobId,
        status: 'completed',
        resourceType: command?.resourceType || 'employee',
        resourceId: 42
      }
      if (job.resourceType === 'employee') job.employeeId = job.resourceId
      return job
    }
  }
  const queue = {
    isReady() { return true },
    async publishCommand() { return { stream: 'NEO_APP_COMMANDS', seq: 1 } }
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

  const inputPage = await fetch(`${baseUrl}/input.html`)
  const inputHtml = await inputPage.text()
  assert.equal(inputPage.status, 200)
  assert.match(inputHtml, /<h1>Tambah Data<\/h1>/)
  assert.match(inputHtml, /data-entry-form="employee"/)
  assert.match(inputHtml, /data-entry-form="site"/)
  assert.match(inputHtml, /data-entry-form="device"/)

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
  assert.equal(employeeBody.jobId, createdCommands[0].jobId)
  assert.equal(createdCommands[0].resourceType, 'employee')

  const site = await fetch(`${baseUrl}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      siteName: 'Surabaya Office',
      city: 'Surabaya',
      address: 'Jl. Pemuda No. 10',
      idempotencyKey: 'site-request-1234'
    })
  })
  assert.equal(site.status, 202)
  assert.equal(createdCommands[1].resourceType, 'site')

  const device = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      employeeId: 1,
      siteId: 1,
      deviceType: 'Laptop',
      deviceBrand: 'Lenovo',
      serialNumber: 'LNV-TEST-0001',
      assignedDate: '2026-08-31',
      idempotencyKey: 'device-request-1234'
    })
  })
  assert.equal(device.status, 202)
  assert.equal(createdCommands[2].resourceType, 'device')

  const job = await fetch(`${baseUrl}/api/jobs/${employeeBody.jobId}`)
  const jobBody = await job.json()
  assert.equal(jobBody.resourceId, 42)
  assert.equal(jobBody.employeeId, 42)

  const ready = await fetch(`${baseUrl}/health/ready`)
  assert.equal(ready.status, 200)
  assert.equal((await ready.json()).postgresqlMajor, 15)
})
