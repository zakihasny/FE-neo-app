import assert from 'node:assert/strict'
import test from 'node:test'

import { guardReadOnlySql } from '../server/sql-guard.js'

test('guardReadOnlySql accepts a SELECT and applies a row limit', () => {
  assert.equal(
    guardReadOnlySql('SELECT employee_id FROM employee_app.employees'),
    'SELECT employee_id FROM employee_app.employees LIMIT 200'
  )
})

test('guardReadOnlySql preserves an explicit limit', () => {
  assert.equal(guardReadOnlySql('SELECT 1 LIMIT 10;'), 'SELECT 1 LIMIT 10')
})

test('guardReadOnlySql accepts a read-only CTE', () => {
  assert.equal(
    guardReadOnlySql('WITH employees AS (SELECT employee_id FROM employee_app.employees) SELECT * FROM employees'),
    'WITH employees AS (SELECT employee_id FROM employee_app.employees) SELECT * FROM employees LIMIT 200'
  )
})

for (const sql of [
  'DELETE FROM employee_app.employees',
  'SELECT 1; DROP TABLE employee_app.employees',
  'WITH deleted AS (DELETE FROM employee_app.employees RETURNING *) SELECT * FROM deleted',
  'SELECT * FROM employee_app.employees FOR UPDATE',
  'SELECT 1 -- comment'
]) {
  test(`guardReadOnlySql rejects unsafe SQL: ${sql}`, () => {
    assert.throws(() => guardReadOnlySql(sql))
  })
}
