import pg from 'pg'

import { PermanentJobError } from './errors.js'
import { guardReadOnlySql } from './sql-guard.js'

const { Pool } = pg

function toJob(row) {
  if (!row) return null
  const resourceType = row.resource_type || 'employee'
  const resourceId = row.resource_id ?? row.employee_id ?? null
  const job = {
    jobId: row.job_id,
    status: row.status,
    resourceType,
    resourceId,
    message: row.error_message || undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at
  }
  if (resourceType === 'employee') job.employeeId = resourceId
  if (resourceType === 'site') job.siteId = resourceId
  if (resourceType === 'device') job.deviceId = resourceId
  return job
}

function permanentDatabaseError(error, resourceType) {
  if (error instanceof PermanentJobError) return error
  if (error?.code === '23505') {
    const messages = {
      employee: 'Alamat email tersebut sudah terdaftar.',
      site: 'Site dengan nama dan kota tersebut sudah terdaftar.',
      device: 'Serial number perangkat tersebut sudah terdaftar.'
    }
    return new PermanentJobError(messages[resourceType] || 'Data tersebut sudah terdaftar.')
  }
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return new PermanentJobError('Data tidak memenuhi constraint database.')
  }
  return null
}

async function createEmployee(client, command) {
  const relationships = await client.query({
    text: `
      SELECT
        EXISTS(SELECT 1 FROM employee_app.sites WHERE site_id = $1) AS site_exists,
        EXISTS(SELECT 1 FROM employee_app.salaries WHERE salary_id = $2) AS salary_exists,
        EXISTS(
          SELECT 1
          FROM employee_app.seating
          WHERE seating_id = $3 AND site_id = $1
        ) AS seating_matches
    `,
    values: [command.siteId, command.salaryId, command.seatingId]
  })
  const relation = relationships.rows[0]
  if (!relation?.site_exists) throw new PermanentJobError('Lokasi kantor tidak ditemukan.')
  if (!relation?.salary_exists) throw new PermanentJobError('Grade gaji tidak ditemukan.')
  if (!relation?.seating_matches) {
    throw new PermanentJobError('Tempat duduk tidak berada pada lokasi yang dipilih.')
  }

  const result = await client.query({
    text: `
      INSERT INTO employee_app.employees
        (site_id, salary_id, seating_id, full_name, email, job_title, hired_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7::date)
      RETURNING employee_id
    `,
    values: [
      command.siteId,
      command.salaryId,
      command.seatingId,
      command.fullName,
      command.email,
      command.jobTitle,
      command.hiredDate
    ]
  })
  return result.rows[0].employee_id
}

async function createSite(client, command) {
  const result = await client.query({
    text: `
      INSERT INTO employee_app.sites (site_name, city, address)
      VALUES ($1, $2, $3)
      RETURNING site_id
    `,
    values: [command.siteName, command.city, command.address]
  })
  return result.rows[0].site_id
}

async function createDevice(client, command) {
  const employee = await client.query({
    text: `
      SELECT employee_id, site_id
      FROM employee_app.employees
      WHERE employee_id = $1
    `,
    values: [command.employeeId]
  })
  if (employee.rowCount !== 1) throw new PermanentJobError('Pegawai tidak ditemukan.')
  if (Number(employee.rows[0].site_id) !== command.siteId) {
    throw new PermanentJobError('Lokasi perangkat harus sama dengan lokasi pegawai.')
  }

  const result = await client.query({
    text: `
      INSERT INTO employee_app.employee_devices
        (employee_id, site_id, device_type, device_brand, serial_number, assigned_date)
      VALUES ($1, $2, $3, $4, $5, $6::date)
      RETURNING employee_device_id
    `,
    values: [
      command.employeeId,
      command.siteId,
      command.deviceType,
      command.deviceBrand,
      command.serialNumber,
      command.assignedDate
    ]
  })
  return result.rows[0].employee_device_id
}

const commandHandlers = {
  employee: createEmployee,
  site: createSite,
  device: createDevice
}

export class DatabaseService {
  constructor(connectionString, { pool } = {}) {
    this.pool = pool || new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      application_name: 'fe-neo-app'
    })

    this.pool.on?.('error', (error) => {
      console.error(JSON.stringify({
        level: 'error',
        event: 'postgres_pool_error',
        message: error.message
      }))
    })
  }

  async ready() {
    const result = await this.pool.query(`
      SELECT
        current_setting('server_version_num')::integer AS server_version_num,
        current_database() AS database_name
    `)
    const version = Number(result.rows[0]?.server_version_num || 0)
    if (Math.floor(version / 10000) !== 15) {
      throw new Error(`PostgreSQL 15 diperlukan; server version number adalah ${version}.`)
    }
    return { database: result.rows[0].database_name, version }
  }

  async summary() {
    const result = await this.pool.query(`
      SELECT sites, employees, devices
      FROM employee_app.database_summary
    `)
    return {
      sites: Number(result.rows[0]?.sites || 0),
      employees: Number(result.rows[0]?.employees || 0),
      devices: Number(result.rows[0]?.devices || 0)
    }
  }

  async meta() {
    const [sites, salaries, seating, employees] = await Promise.all([
      this.pool.query(`
        SELECT site_id, site_name, city
        FROM employee_app.sites
        ORDER BY site_name
      `),
      this.pool.query(`
        SELECT salary_id, salary_grade, basic_salary, allowance
        FROM employee_app.salaries
        ORDER BY basic_salary
      `),
      this.pool.query(`
        SELECT seating_id, site_id, floor_number, seat_code
        FROM employee_app.seating
        ORDER BY site_id, floor_number, seat_code
      `),
      this.pool.query(`
        SELECT e.employee_id, e.full_name, e.site_id, s.site_name
        FROM employee_app.employees AS e
        JOIN employee_app.sites AS s ON s.site_id = e.site_id
        ORDER BY e.full_name, e.employee_id
      `)
    ])

    return {
      sites: sites.rows,
      salaries: salaries.rows,
      seating: seating.rows,
      employees: employees.rows
    }
  }

  async executeReadOnly(input) {
    const sql = guardReadOnlySql(input)
    const client = await this.pool.connect()
    const startedAt = performance.now()

    try {
      await client.query('BEGIN READ ONLY')
      await client.query("SET LOCAL statement_timeout = '5s'")
      await client.query("SET LOCAL lock_timeout = '2s'")
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '8s'")
      const result = await client.query({ text: sql, rowMode: 'array' })
      await client.query('COMMIT')

      return {
        columns: result.fields.map((field) => field.name),
        rows: result.rows,
        rowCount: result.rowCount || 0,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        executedSql: sql
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async createJob(command) {
    const inserted = await this.pool.query({
      text: `
        INSERT INTO employee_app.command_jobs
          (job_id, idempotency_key, resource_type, operation, status, request_payload)
        VALUES ($1, $2, $3, 'create', 'queued', $4::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING job_id, resource_type, status, resource_id,
                  error_message, created_at, completed_at
      `,
      values: [
        command.jobId,
        command.idempotencyKey,
        command.resourceType,
        JSON.stringify(command)
      ]
    })

    if (inserted.rowCount === 1) {
      return { ...toJob(inserted.rows[0]), isNew: true }
    }

    const existing = await this.pool.query({
      text: `
        SELECT job_id, resource_type, status, resource_id,
               error_message, created_at, completed_at
        FROM employee_app.command_jobs
        WHERE idempotency_key = $1
      `,
      values: [command.idempotencyKey]
    })
    return { ...toJob(existing.rows[0]), isNew: false }
  }

  async markJobPublished(jobId, acknowledgement) {
    await this.pool.query({
      text: `
        UPDATE employee_app.command_jobs
        SET nats_stream = $2,
            nats_sequence = $3,
            published_at = current_timestamp,
            error_message = NULL,
            updated_at = current_timestamp
        WHERE job_id = $1
      `,
      values: [jobId, acknowledgement.stream, acknowledgement.seq]
    })
  }

  async markJobFailed(jobId, message) {
    await this.pool.query({
      text: `
        UPDATE employee_app.command_jobs
        SET status = 'failed',
            error_message = left($2, 500),
            completed_at = current_timestamp,
            updated_at = current_timestamp
        WHERE job_id = $1
          AND status <> 'completed'
      `,
      values: [jobId, message]
    })
  }

  async getJob(jobId) {
    let result = await this.pool.query({
      text: `
        SELECT job_id, resource_type, status, resource_id,
               error_message, created_at, completed_at
        FROM employee_app.command_jobs
        WHERE job_id = $1
      `,
      values: [jobId]
    })
    if (result.rowCount === 0) {
      result = await this.pool.query({
        text: `
          SELECT job_id, 'employee' AS resource_type, status,
                 employee_id AS resource_id, error_message, created_at, completed_at
          FROM employee_app.employee_jobs
          WHERE job_id = $1
        `,
        values: [jobId]
      })
    }
    return toJob(result.rows[0])
  }

  async processCommand(command) {
    const client = await this.pool.connect()
    let persistedJobId = command.jobId

    try {
      await client.query('BEGIN')
      await client.query({
        text: `
          INSERT INTO employee_app.command_jobs
            (job_id, idempotency_key, resource_type, operation, status, request_payload)
          VALUES ($1, $2, $3, 'create', 'queued', $4::jsonb)
          ON CONFLICT (idempotency_key) DO NOTHING
        `,
        values: [
          command.jobId,
          command.idempotencyKey,
          command.resourceType,
          JSON.stringify(command)
        ]
      })

      const jobResult = await client.query({
        text: `
          SELECT job_id, resource_type, status, resource_id
          FROM employee_app.command_jobs
          WHERE idempotency_key = $1
          FOR UPDATE
        `,
        values: [command.idempotencyKey]
      })
      const job = jobResult.rows[0]
      if (!job) throw new Error('Job record tidak ditemukan.')
      persistedJobId = job.job_id
      if (job.resource_type !== command.resourceType) {
        throw new PermanentJobError('Idempotency key sudah digunakan untuk tipe data lain.')
      }

      if (job.status === 'completed') {
        await client.query('COMMIT')
        return {
          status: 'completed',
          resourceType: job.resource_type,
          resourceId: job.resource_id,
          duplicate: true
        }
      }

      await client.query({
        text: `
          UPDATE employee_app.command_jobs
          SET status = 'processing', error_message = NULL, updated_at = current_timestamp
          WHERE job_id = $1
        `,
        values: [job.job_id]
      })

      const handler = commandHandlers[command.resourceType]
      if (!handler) throw new PermanentJobError('Tipe command tidak didukung.')
      const resourceId = await handler(client, command)

      await client.query({
        text: `
          UPDATE employee_app.command_jobs
          SET status = 'completed',
              resource_id = $2,
              error_message = NULL,
              completed_at = current_timestamp,
              updated_at = current_timestamp
          WHERE job_id = $1
        `,
        values: [job.job_id, resourceId]
      })
      await client.query('COMMIT')
      return {
        status: 'completed',
        resourceType: command.resourceType,
        resourceId,
        duplicate: false
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const permanent = permanentDatabaseError(error, command.resourceType)
      if (permanent) {
        await this.markJobFailed(persistedJobId, permanent.message)
        throw permanent
      }
      throw error
    } finally {
      client.release()
    }
  }

  async processEmployeeCommand(command) {
    const result = await this.processCommand({ ...command, resourceType: 'employee' })
    return { ...result, employeeId: result.resourceId }
  }

  async close() {
    await this.pool.end()
  }
}
