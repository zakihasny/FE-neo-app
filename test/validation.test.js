import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateDeviceCommand,
  validateDeviceInput,
  validateEmployeeCommand,
  validateEmployeeInput,
  validateSiteCommand,
  validateSiteInput
} from '../server/validation.js'

const validInput = {
  fullName: 'Dewi Anggraini',
  email: 'Dewi.Anggraini@example.com',
  jobTitle: 'System Analyst',
  hiredDate: '2026-08-12',
  siteId: 1,
  salaryId: 2,
  seatingId: 3,
  idempotencyKey: 'request-12345678'
}

test('validateEmployeeInput normalizes trusted employee fields', () => {
  const result = validateEmployeeInput(validInput)
  assert.equal(result.email, 'dewi.anggraini@example.com')
  assert.equal(result.siteId, 1)
})

test('validateEmployeeInput rejects invalid relationships and email', () => {
  assert.throws(() => validateEmployeeInput({ ...validInput, email: 'invalid' }))
  assert.throws(() => validateEmployeeInput({ ...validInput, siteId: 0 }))
})

test('validateEmployeeCommand requires a UUID job ID', () => {
  const command = validateEmployeeCommand({
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    ...validInput
  })
  assert.equal(command.jobId, '019c4a58-f923-7b0c-896a-f62fb27e13dc')
  assert.equal(command.resourceType, 'employee')
  assert.throws(() => validateEmployeeCommand({ jobId: 'not-a-uuid', ...validInput }))
})

test('validateSiteInput normalizes a site command', () => {
  const input = {
    siteName: '  Surabaya Office  ',
    city: ' Surabaya ',
    address: ' Jl. Pemuda No. 10 ',
    idempotencyKey: 'site-request-1234'
  }
  assert.deepEqual(validateSiteInput(input), {
    siteName: 'Surabaya Office',
    city: 'Surabaya',
    address: 'Jl. Pemuda No. 10',
    idempotencyKey: 'site-request-1234'
  })
  assert.equal(validateSiteCommand({
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'site',
    ...input
  }).resourceType, 'site')
  assert.throws(() => validateSiteInput({ ...input, city: '' }))
})

test('validateDeviceInput normalizes device fields and requires its command type', () => {
  const input = {
    employeeId: 3,
    siteId: 2,
    deviceType: ' Laptop ',
    deviceBrand: ' Lenovo ',
    serialNumber: ' abc-123 ',
    assignedDate: '2026-08-31',
    idempotencyKey: 'device-request-1234'
  }
  assert.deepEqual(validateDeviceInput(input), {
    employeeId: 3,
    siteId: 2,
    deviceType: 'Laptop',
    deviceBrand: 'Lenovo',
    serialNumber: 'ABC-123',
    assignedDate: '2026-08-31',
    idempotencyKey: 'device-request-1234'
  })
  assert.equal(validateDeviceCommand({
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'device',
    ...input
  }).resourceType, 'device')
  assert.throws(() => validateDeviceCommand({
    jobId: '019c4a58-f923-7b0c-896a-f62fb27e13dc',
    resourceType: 'site',
    ...input
  }), /resource type/i)
})
