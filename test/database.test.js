import assert from 'node:assert/strict'
import test from 'node:test'

import { DatabaseService } from '../server/database.js'
import { PermanentJobError } from '../server/errors.js'

function queryText(input) {
  return typeof input === 'string' ? input : input.text
}

class CommandClient {
  constructor({ resourceType, resourceId = 7, employeeSiteId = 1 } = {}) {
    this.resourceType = resourceType
    this.resourceId = resourceId
    this.employeeSiteId = employeeSiteId
    this.queries = []
    this.released = false
  }

  async query(input) {
    const text = queryText(input)
    this.queries.push(text.trim())

    if (text.trim() === 'BEGIN' || text.trim() === 'COMMIT' || text.trim() === 'ROLLBACK') {
      return { rows: [], rowCount: 0 }
    }
    if (text.includes('INSERT INTO employee_app.command_jobs')) return { rows: [], rowCount: 1 }
    if (text.includes('FROM employee_app.command_jobs') && text.includes('FOR UPDATE')) {
      return {
        rows: [{
          job_id: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
          resource_type: this.resourceType,
          status: 'queued',
          resource_id: null
        }],
        rowCount: 1
      }
    }
    if (text.includes("SET status = 'processing'")) return { rows: [], rowCount: 1 }
    if (text.includes("SET status = 'completed'")) return { rows: [], rowCount: 1 }
    if (text.includes('SELECT\n        EXISTS')) {
      return {
        rows: [{ site_exists: true, salary_exists: true, seating_matches: true }],
        rowCount: 1
      }
    }
    if (text.includes('INSERT INTO employee_app.employees')) {
      return { rows: [{ employee_id: this.resourceId }], rowCount: 1 }
    }
    if (text.includes('INSERT INTO employee_app.sites')) {
      return { rows: [{ site_id: this.resourceId }], rowCount: 1 }
    }
    if (text.includes('SELECT employee_id, site_id')) {
      return {
        rows: [{ employee_id: 3, site_id: this.employeeSiteId }],
        rowCount: 1
      }
    }
    if (text.includes('INSERT INTO employee_app.employee_devices')) {
      return { rows: [{ employee_device_id: this.resourceId }], rowCount: 1 }
    }

    throw new Error(`Unexpected command query: ${text.trim().slice(0, 100)}`)
  }

  release() {
    this.released = true
  }
}

function fakePool(client) {
  return {
    failedJobs: [],
    on() {},
    async connect() { return client },
    async query(input) {
      const text = queryText(input)
      if (text.includes("SET status = 'failed'")) {
        this.failedJobs.push(input.values)
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`Unexpected pool query: ${text.trim().slice(0, 100)}`)
    },
    async end() {}
  }
}

test('processCommand creates a site and completes its generic job transaction', async () => {
  const client = new CommandClient({ resourceType: 'site', resourceId: 9 })
  const pool = fakePool(client)
  const database = new DatabaseService('', { pool })
  const command = {
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'site',
    siteName: 'Surabaya Office',
    city: 'Surabaya',
    address: 'Jl. Pemuda No. 10',
    idempotencyKey: 'site-request-1234'
  }

  assert.deepEqual(await database.processCommand(command), {
    status: 'completed',
    resourceType: 'site',
    resourceId: 9,
    duplicate: false
  })
  assert.equal(client.queries.at(-1), 'COMMIT')
  assert.equal(client.released, true)
})

test('processCommand preserves the employee write workflow', async () => {
  const client = new CommandClient({ resourceType: 'employee', resourceId: 12 })
  const database = new DatabaseService('', { pool: fakePool(client) })
  const command = {
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'employee',
    fullName: 'Dewi Anggraini',
    email: 'dewi@example.com',
    jobTitle: 'System Analyst',
    hiredDate: '2026-08-31',
    siteId: 1,
    salaryId: 2,
    seatingId: 3,
    idempotencyKey: 'employee-request-1234'
  }

  assert.deepEqual(await database.processCommand(command), {
    status: 'completed',
    resourceType: 'employee',
    resourceId: 12,
    duplicate: false
  })
})

test('processCommand creates a device at the employee site', async () => {
  const client = new CommandClient({ resourceType: 'device', resourceId: 15, employeeSiteId: 1 })
  const database = new DatabaseService('', { pool: fakePool(client) })
  const command = {
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'device',
    employeeId: 3,
    siteId: 1,
    deviceType: 'Laptop',
    deviceBrand: 'Lenovo',
    serialNumber: 'ABC-123',
    assignedDate: '2026-08-31',
    idempotencyKey: 'device-request-1234'
  }

  assert.deepEqual(await database.processCommand(command), {
    status: 'completed',
    resourceType: 'device',
    resourceId: 15,
    duplicate: false
  })
})

test('processCommand rejects a device assigned to a different employee site', async () => {
  const client = new CommandClient({ resourceType: 'device', employeeSiteId: 1 })
  const pool = fakePool(client)
  const database = new DatabaseService('', { pool })
  const command = {
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'device',
    employeeId: 3,
    siteId: 2,
    deviceType: 'Laptop',
    deviceBrand: 'Lenovo',
    serialNumber: 'ABC-123',
    assignedDate: '2026-08-31',
    idempotencyKey: 'device-request-1234'
  }

  await assert.rejects(database.processCommand(command), PermanentJobError)
  assert.equal(pool.failedJobs.length, 1)
  assert.match(pool.failedJobs[0][1], /lokasi pegawai/i)
  assert.equal(client.released, true)
})
