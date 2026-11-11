import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionOptions, ENGINE, verifyVersion } from '../server/sql-client.js'
import { normalize, numericId, toJob, withDeadline, environmentFlag } from '../server/storage-utils.js'
import { guardReadOnlySql } from '../server/sql-guard.js'
import { permanentDatabaseError, DatabaseService } from '../server/database.js'
import { PermanentJobError } from '../server/errors.js'

test('URL credentials are decoded, and PostgreSQL URLs are rejected',()=>{
  const options=connectionOptions('mysql://test:p%40ss@localhost:3307/employee_test',{})
  assert.equal(options.password,'p@ss'); assert.equal(options.database,'employee_test'); assert.equal(options.port,3307)
  assert.equal(options.multipleStatements,false)
  assert.throws(()=>connectionOptions('postgresql://test:pass@localhost/app',{}))
})
test('TLS keeps certificate verification and requires explicit enablement for a CA',()=>{
  const upper=ENGINE.toUpperCase()
  const secure=connectionOptions('mysql://test:pass@localhost/app',{[upper+'_TLS']:'true'})
  assert.equal(secure.ssl.rejectUnauthorized,true);assert.equal(secure.ssl.verifyIdentity,true)
  assert.throws(()=>connectionOptions('mysql://test:pass@localhost/app',{[upper+'_CA_FILE']:'missing'}))
})
test('engine version checks distinguish MySQL and MariaDB',()=>{
  verifyVersion(ENGINE==='mysql'?'8.4.13':'11.4.13-MariaDB')
  assert.throws(()=>verifyVersion(ENGINE==='mysql'?'11.4.13-MariaDB':'8.4.13'))
})
test('driver BigInts, decimal strings and timestamps are JSON serializable',()=>{
  const value=normalize({count:3n,huge:9007199254740993n,amount:'6000000.00',at:new Date('2026-01-01T00:00:00Z')})
  assert.equal(value.count,3);assert.equal(value.huge,'9007199254740993');assert.equal(value.amount,'6000000.00')
  assert.doesNotThrow(()=>JSON.stringify(value));assert.equal(numericId(3n),3)
  assert.throws(()=>numericId(9007199254740993n))
  assert.equal(toJob({job_id:'job',status:'completed',resource_type:'device',resource_id:3n}).deviceId,3)
})
test('transient database failures are not classified as permanent constraints',()=>{
  for(const errno of [1062,1452,3819,4025]) assert.ok(permanentDatabaseError({errno},'employee') instanceof PermanentJobError)
  for(const errno of [1205,1213,2006]) assert.equal(permanentDatabaseError({errno},'employee'),null)
})
test('read-only queries get an outer limit even when a larger inner limit exists',()=>{
  assert.equal(guardReadOnlySql('SELECT 1 AS value;'),'SELECT * FROM (SELECT 1 AS value) AS fe_readonly_result LIMIT 200')
  assert.match(guardReadOnlySql('SELECT * FROM employees LIMIT 9999'),/LIMIT 9999\) AS fe_readonly_result LIMIT 200$/)
})
for(const sql of ["DELETE FROM employees", "SELECT 1; DROP TABLE employees", "SELECT 1 INTO OUTFILE '/tmp/test'",'SELECT LOAD_FILE("/etc/passwd")','SELECT SLEEP(1)','SELECT BENCHMARK(1,1)','SELECT GET_LOCK("x",0)','SELECT @x','SELECT 1 # comment','SELECT * FROM employees FOR UPDATE','WITH gone AS (DELETE FROM employees) SELECT 1']) {
  test('query console rejects '+sql.slice(0,45),()=>assert.throws(()=>guardReadOnlySql(sql)))
}
test('reporting deadlines abort the connection rather than leaving a running query',async()=>{
  let aborted=false
  await assert.rejects(withDeadline(new Promise(()=>{}),10,()=>{aborted=true}),/time limit/)
  assert.equal(aborted,true)
})
test('booleans accept dashboard values without treating false as true',()=>{
  assert.equal(environmentFlag('false',true),false);assert.equal(environmentFlag('1'),true);assert.throws(()=>environmentFlag('invalid'))
})
test('completed jobs are not recreated by redelivery',async()=>{
  const queries=[]
  const client={async query(sql){queries.push(sql);if(sql.includes('FOR UPDATE'))return {rows:[{job_id:'job',resource_type:'site',status:'completed',resource_id:7}]};return {rows:[]}},release(){}}
  const repository=new DatabaseService('',{pool:{async connect(){return client}}})
  repository.createJob=async()=>({jobId:'job'})
  const result=await repository.processCommand({jobId:'job',resourceType:'site',idempotencyKey:'test-key'})
  assert.equal(result.duplicate,true);assert.equal(result.resourceId,7);assert.equal(queries.at(-1),'COMMIT')
  assert.equal(queries.some(sql=>sql.startsWith('INSERT INTO sites')),false)
})

test('SQL console rejects stored or administrative function calls',()=>{
  for(const sql of ['SELECT dangerous_function()', 'SELECT sys.ps_setup_disable_thread(1)', 'SELECT `dangerous_function`()', 'SELECT RELEASE_LOCK("test")']) assert.throws(()=>guardReadOnlySql(sql))
  assert.ok(guardReadOnlySql('SELECT COUNT(*) FROM employees'))
  assert.ok(guardReadOnlySql('WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<250) SELECT n FROM seq'))
})
