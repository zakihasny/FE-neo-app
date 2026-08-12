import pg from 'pg'

import { PermanentJobError } from './errors.js'
import { guardReadOnlySql } from './sql-guard.js'

const { Pool } = pg

function toJob(row) {
  if (!row) return null
  return {
    jobId: row.job_id,
    status: row.status,
    employeeId: row.employee_id,
    message: row.error_message || undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at
  }
}

function permanentDatabaseError(error) {
  if (error instanceof PermanentJobError) return error
  if (error?.code === '23505') {
    return new PermanentJobError('Alamat email tersebut sudah terdaftar.')
  }
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return new PermanentJobError('Data pegawai tidak memenuhi constraint database.')
  }
  return null
}

export class DatabaseService {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      application_name: 'fe-neo-app'
    })

    this.pool.on('error', (error) => {
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
    const [sites, salaries, seating] = await Promise.all([
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
      `)
    ])

    return {
      sites: sites.rows,
      salaries: salaries.rows,
      seating: seating.rows
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
        INSERT INTO employee_app.employee_jobs
          (job_id, idempotency_key, status, request_payload)
        VALUES ($1, $2, 'queued', $3::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING job_id, status, employee_id, error_message, created_at, completed_at
      `,
      values: [command.jobId, command.idempotencyKey, JSON.stringify(command)]
    })

    if (inserted.rowCount === 1) {
      return { ...toJob(inserted.rows[0]), isNew: true }
    }

    const existing = await this.pool.query({
      text: `
        SELECT job_id, status, employee_id, error_message, created_at, completed_at
        FROM employee_app.employee_jobs
        WHERE idempotency_key = $1
      `,
      values: [command.idempotencyKey]
    })
    return { ...toJob(existing.rows[0]), isNew: false }
  }

  async markJobPublished(jobId, acknowledgement) {
    await this.pool.query({
      text: `
        UPDATE employee_app.employee_jobs
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
        UPDATE employee_app.employee_jobs
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
    const result = await this.pool.query({
      text: `
        SELECT job_id, status, employee_id, error_message, created_at, completed_at
        FROM employee_app.employee_jobs
        WHERE job_id = $1
      `,
      values: [jobId]
    })
    return toJob(result.rows[0])
  }

  async processEmployeeCommand(command) {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      await client.query({
        text: `
          INSERT INTO employee_app.employee_jobs
            (job_id, idempotency_key, status, request_payload)
          VALUES ($1, $2, 'queued', $3::jsonb)
          ON CONFLICT (idempotency_key) DO NOTHING
        `,
        values: [command.jobId, command.idempotencyKey, JSON.stringify(command)]
      })

      const jobResult = await client.query({
        text: `
          SELECT job_id, status, employee_id
          FROM employee_app.employee_jobs
          WHERE idempotency_key = $1
          FOR UPDATE
        `,
        values: [command.idempotencyKey]
      })
      const job = jobResult.rows[0]
      if (!job) throw new Error('Job record tidak ditemukan.')

      if (job.status === 'completed') {
        await client.query('COMMIT')
        return { status: 'completed', employeeId: job.employee_id, duplicate: true }
      }

      await client.query({
        text: `
          UPDATE employee_app.employee_jobs
          SET status = 'processing', error_message = NULL, updated_at = current_timestamp
          WHERE job_id = $1
        `,
        values: [job.job_id]
      })

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

      const employee = await client.query({
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
      const employeeId = employee.rows[0].employee_id

      await client.query({
        text: `
          UPDATE employee_app.employee_jobs
          SET status = 'completed',
              employee_id = $2,
              error_message = NULL,
              completed_at = current_timestamp,
              updated_at = current_timestamp
          WHERE job_id = $1
        `,
        values: [job.job_id, employeeId]
      })
      await client.query('COMMIT')
      return { status: 'completed', employeeId, duplicate: false }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const permanent = permanentDatabaseError(error)
      if (permanent) {
        await this.markJobFailed(command.jobId, permanent.message)
        throw permanent
      }
      throw error
    } finally {
      client.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}
