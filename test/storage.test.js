import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionOptions,keyPrefix } from '../server/redis-client.js'
import { guardRedisCommand } from '../server/redis-guard.js'
import { toJob,normalize,environmentFlag,withDeadline } from '../server/storage-utils.js'
test('Redis requires a Redis URL and enables verified TLS for rediss',()=>{
  assert.throws(()=>connectionOptions('postgresql://localhost/app'))
  assert.throws(()=>connectionOptions('redis://localhost/not-a-db'))
  assert.equal(connectionOptions('rediss://:pass@localhost:6379/0').socket.rejectUnauthorized,true)
  assert.equal(connectionOptions('redis://:pass@localhost:6379/0').disableOfflineQueue,true)
})
test('namespaces are validated and normalized',()=>{
  assert.equal(keyPrefix('example:'),'example:');assert.throws(()=>keyPrefix('*'));assert.throws(()=>keyPrefix(''))
})
for(const name of ['SET','DEL','FLUSHDB','FLUSHALL','EVAL','EVALSHA','CONFIG','ACL','AUTH','SELECT','KEYS','MULTI','SCRIPT']) {
  test('console rejects '+name,()=>assert.throws(()=>guardRedisCommand([name,'fe-neo-app:key'],'fe-neo-app:')))
}
test('all console key arguments stay inside the configured prefix',()=>{
  assert.throws(()=>guardRedisCommand(['GET','another-app:key'],'fe-neo-app:'))
  assert.throws(()=>guardRedisCommand(['EXISTS','fe-neo-app:employee:1','another-app:key'],'fe-neo-app:'))
  assert.deepEqual(guardRedisCommand(['hgetall','fe-neo-app:employee:1'],'fe-neo-app:'),['HGETALL','fe-neo-app:employee:1'])
})
test('console argument types and range bounds are enforced',()=>{
  for(const command of ['GET x',['PING','argument'],['ZRANGE','fe-neo-app:ids:employees','0','-1'],['ZRANGE','fe-neo-app:ids:employees','0','200'],['HMGET','fe-neo-app:key']]) assert.throws(()=>guardRedisCommand(command,'fe-neo-app:'))
  assert.doesNotThrow(()=>guardRedisCommand(['ZRANGE','fe-neo-app:ids:employees','0','199'],'fe-neo-app:'))
})
test('job hashes retain the public API types',()=>{
  const job=toJob({job_id:'job',resource_type:'employee',resource_id:'4',status:'completed',created_at:'2026-01-01T00:00:00.000Z',completed_at:''})
  assert.equal(job.employeeId,4);assert.equal(job.completedAt,null);assert.equal(toJob({}),null)
  assert.doesNotThrow(()=>JSON.stringify(normalize({count:3n})))
})
test('bootstrap booleans and client deadlines fail predictably',async()=>{
  assert.equal(environmentFlag('false',true),false)
  await assert.rejects(withDeadline(new Promise(()=>{}),10),/time limit/)
})
