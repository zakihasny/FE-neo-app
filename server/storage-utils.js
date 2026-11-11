import { HttpError } from './errors.js'

export function environmentFlag(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off'].includes(text)) return false
  throw new Error('Invalid boolean configuration value.')
}

export function normalize(value) {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
  }
  return value
}

export function numericId(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid persisted resource ID.')
  return number
}

export function toJob(row) {
  if (!row || !row.job_id) return null
  const resourceType = row.resource_type || 'employee'
  const rawId = row.resource_id ?? row.employee_id
  const resourceId = rawId === undefined || rawId === null || rawId === '' ? null : numericId(rawId)
  const result = {
    jobId: row.job_id, resourceType, resourceId, status: row.status,
    message: row.error_message || undefined,
    createdAt: timestamp(row.created_at), completedAt: timestamp(row.completed_at) || null
  }
  if (resourceType === 'employee') result.employeeId = resourceId
  if (resourceType === 'site') result.siteId = resourceId
  if (resourceType === 'device') result.deviceId = resourceId
  return result
}

function timestamp(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z').toISOString()
  }
  return normalize(value)
}

export async function withDeadline(task, milliseconds, abort = () => {}) {
  let timer
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { abort() } finally { reject(new HttpError(408, 'Query exceeded its time limit.')) }
        }, milliseconds)
      })
    ])
  } finally { clearTimeout(timer) }
}
