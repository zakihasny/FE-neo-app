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

export function validateEmployeeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Payload harus berupa object JSON.')
  }

  const email = requireText(body.email, 'Alamat email', 120).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, 'Masukkan alamat email yang valid.')
  }

  const hiredDate = typeof body.hiredDate === 'string' ? body.hiredDate.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hiredDate) || Number.isNaN(Date.parse(`${hiredDate}T00:00:00Z`))) {
    throw new HttpError(422, 'Masukkan tanggal bergabung yang valid.')
  }

  const idempotencyKey = typeof body.idempotencyKey === 'string'
    ? body.idempotencyKey.trim()
    : ''
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw new HttpError(422, 'Idempotency key tidak valid.')
  }

  return {
    fullName: requireText(body.fullName, 'Nama lengkap', 120),
    email,
    jobTitle: requireText(body.jobTitle, 'Jabatan', 100),
    hiredDate,
    siteId: requireId(body.siteId, 'lokasi kantor'),
    salaryId: requireId(body.salaryId, 'grade gaji'),
    seatingId: requireId(body.seatingId, 'tempat duduk'),
    idempotencyKey
  }
}

export function validateEmployeeCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'Message pegawai tidak valid.')
  }

  const jobId = typeof value.jobId === 'string' ? value.jobId.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new HttpError(422, 'Job ID tidak valid.')
  }

  return {
    jobId,
    ...validateEmployeeInput(value)
  }
}
