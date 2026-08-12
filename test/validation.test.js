import assert from 'node:assert/strict'
import test from 'node:test'

import { validateEmployeeCommand, validateEmployeeInput } from '../server/validation.js'

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
  assert.throws(() => validateEmployeeCommand({ jobId: 'not-a-uuid', ...validInput }))
})
