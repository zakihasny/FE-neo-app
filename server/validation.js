import { HttpError } from './errors.js'

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || value.trim().length < 2) {
    throw new HttpError(422, `${label} minimal terdiri dari dua karakter.`)
  }

  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new HttpError(422, `${label} terlalu panjang.`)
  }
  return normalized
}

function requireId(value, label) {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(422, `Pilih ${label} yang valid.`)
  }
  return id
}

function requireDate(value, label) {
  const date = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new HttpError(422, `Masukkan ${label} yang valid.`)
  }
  return date
}

function requireIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new HttpError(422, 'Idempotency key tidak valid.')
  }
  return key
}

function validateCommandEnvelope(value, resourceType, { allowMissingResourceType = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'Message command tidak valid.')
  }

  const jobId = typeof value.jobId === 'string' ? value.jobId.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new HttpError(422, 'Job ID tidak valid.')
  }

  const missingAllowed = allowMissingResourceType && value.resourceType === undefined
  if (!missingAllowed && value.resourceType !== resourceType) {
    throw new HttpError(422, `Resource type command harus ${resourceType}.`)
  }
  return { jobId, resourceType }
}

export function validateEmployeeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Payload harus berupa object JSON.')
  }

  const email = requireText(body.email, 'Alamat email', 120).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, 'Masukkan alamat email yang valid.')
  }

  return {
    fullName: requireText(body.fullName, 'Nama lengkap', 120),
    email,
    jobTitle: requireText(body.jobTitle, 'Jabatan', 100),
    hiredDate: requireDate(body.hiredDate, 'tanggal bergabung'),
    siteId: requireId(body.siteId, 'lokasi kantor'),
    salaryId: requireId(body.salaryId, 'grade gaji'),
    seatingId: requireId(body.seatingId, 'tempat duduk'),
    idempotencyKey: requireIdempotencyKey(body.idempotencyKey)
  }
}

export function validateSiteInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Payload harus berupa object JSON.')
  }

  return {
    siteName: requireText(body.siteName, 'Nama site', 100),
    city: requireText(body.city, 'Kota', 100),
    address: requireText(body.address, 'Alamat', 255),
    idempotencyKey: requireIdempotencyKey(body.idempotencyKey)
  }
}

export function validateDeviceInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Payload harus berupa object JSON.')
  }

  return {
    employeeId: requireId(body.employeeId, 'pegawai'),
    siteId: requireId(body.siteId, 'lokasi kantor'),
    deviceType: requireText(body.deviceType, 'Jenis perangkat', 50),
    deviceBrand: requireText(body.deviceBrand, 'Merek perangkat', 50),
    serialNumber: requireText(body.serialNumber, 'Serial number', 100).toUpperCase(),
    assignedDate: requireDate(body.assignedDate, 'tanggal penugasan'),
    idempotencyKey: requireIdempotencyKey(body.idempotencyKey)
  }
}

export function validateEmployeeCommand(value) {
  const envelope = validateCommandEnvelope(value, 'employee', { allowMissingResourceType: true })

  return {
    ...envelope,
    ...validateEmployeeInput(value)
  }
}


export function validateSiteCommand(value) {
  return {
    ...validateCommandEnvelope(value, 'site'),
    ...validateSiteInput(value)
  }
}

export function validateDeviceCommand(value) {
  return {
    ...validateCommandEnvelope(value, 'device'),
    ...validateDeviceInput(value)
  }
}
