import { createPool, ENGINE, verifyVersion } from './sql-client.js'
import { numericId, toJob, withDeadline } from './storage-utils.js'
import { HttpError, PermanentJobError } from './errors.js'
import { guardReadOnlySql } from './sql-guard.js'

export function permanentDatabaseError(error, resourceType) {
  if (error instanceof PermanentJobError) return error
  if (Number(error?.errno) === 1062 || error?.code === 'ER_DUP_ENTRY') {
    const labels = { employee: 'email address', site: 'site name and city', device: 'device serial number' }
    return new PermanentJobError('Duplicate ' + (labels[resourceType] || 'record') + '.')
  }
  if ([1451, 1452, 3819, 4025, 1292, 1366, 1406, 1048].includes(Number(error?.errno))) {
    return new PermanentJobError('Data violates a database relationship or constraint.')
  }
  return null
}

async function createResource(client, command) {
  if (command.resourceType === 'site') {
    const result = await client.query('INSERT INTO sites (site_name,city,address) VALUES (?,?,?)', [command.siteName, command.city, command.address])
    return numericId(result.insertId)
  }
  if (command.resourceType === 'employee') {
    const { rows } = await client.query(
      'SELECT EXISTS(SELECT 1 FROM sites WHERE site_id=?) AS site_exists, EXISTS(SELECT 1 FROM salaries WHERE salary_id=?) AS salary_exists, EXISTS(SELECT 1 FROM seating WHERE seating_id=? AND site_id=?) AS seating_matches',
      [command.siteId, command.salaryId, command.seatingId, command.siteId])
    if (!Number(rows[0].site_exists)) throw new PermanentJobError('Site not found.')
    if (!Number(rows[0].salary_exists)) throw new PermanentJobError('Salary grade not found.')
    if (!Number(rows[0].seating_matches)) throw new PermanentJobError('The seat does not belong to the selected site.')
    const result = await client.query('INSERT INTO employees (site_id,salary_id,seating_id,full_name,email,job_title,hired_date) VALUES (?,?,?,?,?,?,?)',
      [command.siteId, command.salaryId, command.seatingId, command.fullName, command.email, command.jobTitle, command.hiredDate])
    return numericId(result.insertId)
  }
  if (command.resourceType === 'device') {
    const { rows } = await client.query('SELECT employee_id,site_id FROM employees WHERE employee_id=?', [command.employeeId])
    if (!rows.length) throw new PermanentJobError('Employee not found.')
    if (Number(rows[0].site_id) !== command.siteId) throw new PermanentJobError('Device site must match the employee site.')
    const result = await client.query('INSERT INTO employee_devices (employee_id,site_id,device_type,device_brand,serial_number,assigned_date) VALUES (?,?,?,?,?,?)',
      [command.employeeId, command.siteId, command.deviceType, command.deviceBrand, command.serialNumber, command.assignedDate])
    return numericId(result.insertId)
  }
  throw new PermanentJobError('Unsupported resource type.')
}

export class DatabaseService {
  constructor(connectionString, { pool } = {}) { this.pool = pool || createPool(connectionString) }
  async ready() {
    const { rows } = await this.pool.query('SELECT VERSION() AS version, DATABASE() AS database_name')
    verifyVersion(rows[0].version)
    await this.pool.query("SELECT version FROM schema_migrations WHERE version='004'") .then(result => {
      if (result.rows.length !== 1) throw new Error('Database bootstrap is incomplete.')
    })
    return { database: rows[0].database_name, engine: ENGINE, version: rows[0].version }
  }
  async summary() {
    const { rows } = await this.pool.query('SELECT sites,employees,devices FROM database_summary')
    return Object.fromEntries(['sites', 'employees', 'devices'].map(key => [key, Number(rows[0][key])]))
  }
  async meta() {
    const [sites, salaries, seating, employees] = await Promise.all([
      this.pool.query('SELECT site_id,site_name,city FROM sites ORDER BY site_name'),
      this.pool.query('SELECT salary_id,salary_grade,basic_salary,allowance FROM salaries ORDER BY basic_salary'),
      this.pool.query('SELECT seating_id,site_id,floor_number,seat_code FROM seating ORDER BY site_id,floor_number,seat_code'),
      this.pool.query('SELECT e.employee_id,e.full_name,e.site_id,s.site_name FROM employees e JOIN sites s ON s.site_id=e.site_id ORDER BY e.full_name,e.employee_id')
    ])
    return { sites: sites.rows, salaries: salaries.rows, seating: seating.rows, employees: employees.rows }
  }
  async executeReadOnly(input) {
    const sql = guardReadOnlySql(input)
    const client = await this.pool.connect()
    const started = performance.now()
    try {
      await client.query('START TRANSACTION READ ONLY')
      await client.query(ENGINE === 'mysql' ? 'SET SESSION MAX_EXECUTION_TIME=5000' : 'SET SESSION max_statement_time=5')
      const result = await withDeadline(client.query(sql, [], true), 6000, () => client.destroy())
      await client.query('COMMIT')
      return { columns: result.fields.map(field => field.name), rows: result.rows, rowCount: result.rows.length,
        durationMs: Math.max(1, Math.round(performance.now() - started)), executedSql: sql }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'Query failed or exceeded its limits.')
    } finally {
      // Discard the reporting connection so read-only/session settings never leak to workers.
      client.destroy()
    }
  }
  async createJob(command) {
    try {
      await this.pool.query("INSERT INTO command_jobs (job_id,idempotency_key,resource_type,operation,status,request_payload) VALUES (?,?,?,'create','queued',?)",
        [command.jobId, command.idempotencyKey, command.resourceType, JSON.stringify(command)])
      return { ...await this.getJob(command.jobId), isNew: true }
    } catch (error) {
      if (Number(error?.errno) !== 1062 && error?.code !== 'ER_DUP_ENTRY') throw error
      const { rows } = await this.pool.query('SELECT * FROM command_jobs WHERE idempotency_key=?', [command.idempotencyKey])
      if (!rows.length) throw error
      return { ...toJob(rows[0]), isNew: false }
    }
  }
  async markJobPublished(jobId, acknowledgement) {
    await this.pool.query('UPDATE command_jobs SET nats_stream=?,nats_sequence=?,published_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=?',
      [acknowledgement.stream, acknowledgement.seq, jobId])
  }
  async markJobFailed(jobId, message) {
    await this.pool.query("UPDATE command_jobs SET status='failed',error_message=?,completed_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=? AND status<>'completed'",
      [String(message).slice(0, 500), jobId])
  }
  async getJob(jobId) {
    let result = await this.pool.query('SELECT * FROM command_jobs WHERE job_id=?', [jobId])
    if (!result.rows.length) result = await this.pool.query("SELECT *, 'employee' AS resource_type, employee_id AS resource_id FROM employee_jobs WHERE job_id=?", [jobId])
    return toJob(result.rows[0])
  }
  async processCommand(command) {
    const persisted = await this.createJob(command)
    const client = await this.pool.connect()
    try {
      await client.query('START TRANSACTION')
      const { rows } = await client.query('SELECT * FROM command_jobs WHERE idempotency_key=? FOR UPDATE', [command.idempotencyKey])
      const job = rows[0]
      if (!job) throw new Error('Persisted job not found.')
      if (job.resource_type !== command.resourceType) throw new PermanentJobError('Idempotency key belongs to a different resource type.')
      if (job.status === 'completed') {
        await client.query('COMMIT')
        return { status: 'completed', resourceType: job.resource_type, resourceId: numericId(job.resource_id), duplicate: true }
      }
      await client.query("UPDATE command_jobs SET status='processing',error_message=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=?", [job.job_id])
      const resourceId = await createResource(client, command)
      await client.query("UPDATE command_jobs SET status='completed',resource_id=?,error_message=NULL,completed_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=?", [resourceId, job.job_id])
      await client.query('COMMIT')
      return { status: 'completed', resourceType: command.resourceType, resourceId, duplicate: false }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const permanent = permanentDatabaseError(error, command.resourceType)
      if (permanent) { await this.markJobFailed(persisted.jobId, permanent.message); throw permanent }
      throw error
    } finally { client.release() }
  }
  async processEmployeeCommand(command) {
    const result = await this.processCommand({ ...command, resourceType: 'employee' })
    return { ...result, employeeId: result.resourceId }
  }
  async close() { await this.pool.end() }
}
