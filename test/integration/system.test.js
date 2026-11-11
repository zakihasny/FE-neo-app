import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseService } from '../../server/database.js'
import { runMigrations } from '../../server/migrate.js'
import { ENGINE } from '../../server/variant.js'
import { connect } from '@nats-io/transport-node'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'

const enabled=process.env.RUN_INTEGRATION==='true'
const base='http://127.0.0.1:18080'
const password='ci-password-not-for-production'
const databaseUrl=ENGINE==='redis'?'redis://:ci-redis-not-for-production@127.0.0.1:16379/0':`mysql://app:${password}@127.0.0.1:13306/employee_test`
const quiet={info(){},warn(){},log(){}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function ready(){
  const deadline=Date.now()+240000
  while(Date.now()<deadline){try{const response=await fetch(base+'/health/ready',{signal:AbortSignal.timeout(2000)});if(response.ok){const json=await response.json();assert.equal(json.engine,ENGINE);return json}}catch{}await sleep(1000)}
  throw new Error('Application did not become ready in 240 seconds.')
}
async function request(route,body){
  const response=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  return {status:response.status,data:await response.json()}
}
async function submit(type,payload,expected='completed'){
  const accepted=await request('/api/'+type,payload)
  assert.equal(accepted.status,202,JSON.stringify(accepted.data))
  for(let i=0;i<100;i++){
    const result=await request('/api/jobs/'+accepted.data.jobId)
    if(['completed','failed'].includes(result.data.status)){assert.equal(result.data.status,expected,JSON.stringify(result.data));return result.data}
    await sleep(100)
  }
  throw new Error('Job did not reach a terminal state.')
}

test('live database, NATS, HTTP, concurrency, bootstrap and restart persistence',{skip:!enabled,timeout:600000},async(t)=>{
  await ready()
  for(const route of ['/','/input.html','/query.html','/assets/app.js','/assets/styles.css','/healthz']){
    const response=await fetch(base+route);assert.equal(response.status,200,route);await response.text()
  }
  const repository=new DatabaseService(databaseUrl)
  t.after(()=>repository.close())
  await repository.ready()
  const before=await repository.summary()
  assert.deepEqual(before,{sites:2,employees:3,devices:4})
  const boot=await runMigrations(databaseUrl,{seedSampleData:true,logger:quiet})
  assert.equal(boot.seeded,false)
  assert.deepEqual(await repository.summary(),before)
  const meta=(await request('/api/meta')).data
  assert.equal(meta.salaries.length,3);assert.equal(meta.seating.length,3)
  assert.doesNotThrow(()=>JSON.stringify(meta))

  const site={siteName:'Integration '+randomUUID(),city:'Demo',address:'Synthetic only',idempotencyKey:randomUUID()}
  const concurrent=await Promise.all([request('/api/sites',site),request('/api/sites',site)])
  assert.ok(concurrent.every(result=>result.status===202));assert.equal(concurrent[0].data.jobId,concurrent[1].data.jobId)
  const siteJob=await submit('sites',site)
  assert.equal((await repository.summary()).sites,3)
  await submit('sites',{...site,siteName:site.siteName.toUpperCase(),city:site.city.toUpperCase(),idempotencyKey:randomUUID()},'failed')
  const employee={fullName:'Demo Integration',email:randomUUID()+'@example.test',jobTitle:'Tester',hiredDate:'2026-01-20',siteId:1,salaryId:1,seatingId:1,idempotencyKey:randomUUID()}
  const employeeJob=await submit('employees',employee)
  await submit('employees',{...employee,idempotencyKey:randomUUID()},'failed')
  await submit('employees',{...employee,email:randomUUID()+'@example.test',siteId:2,seatingId:1,idempotencyKey:randomUUID()},'failed')
  const device={employeeId:employeeJob.resourceId,siteId:1,deviceType:'Laptop',deviceBrand:'Demo',serialNumber:randomUUID().toUpperCase(),assignedDate:'2026-01-21',idempotencyKey:randomUUID()}
  const deviceJob=await submit('devices',device)
  await submit('devices',{...device,idempotencyKey:randomUUID()},'failed')
  await submit('devices',{...device,siteId:2,serialNumber:randomUUID(),idempotencyKey:randomUUID()},'failed')
  assert.deepEqual(await repository.summary(),{sites:3,employees:4,devices:5})

  const nats=await connect({servers:'127.0.0.1:14222',user:'ci',pass:'ci-nats-not-for-production'})
  try{
    const js=jetstream(nats),manager=await jetstreamManager(nats)
    assert.equal((await manager.streams.info('NEO_APP_COMMANDS')).config.storage,'file')
    const command={...site,jobId:siteJob.jobId,resourceType:'site'}
    await Promise.all([1,2].map(()=>js.publish('site.create.v1',new TextEncoder().encode(JSON.stringify(command)),{msgID:randomUUID()})))
    await sleep(1500)
    assert.deepEqual(await repository.summary(),{sites:3,employees:4,devices:5})
    assert.equal((await repository.getJob(siteJob.jobId)).resourceId,siteJob.resourceId)
  }finally{await nats.drain()}

  if(ENGINE==='redis'){
    const ping=await request('/api/query',{command:['PING']});assert.equal(ping.status,200)
    for(const command of [['SET','fe-neo-app:unsafe','1'],['EVAL','return 1','0'],['CONFIG','GET','*'],['KEYS','*'],['GET','another-app:secret'],['ZRANGE','fe-neo-app:ids:employees','0','9999']]){
      assert.equal((await request('/api/query',{command})).status,400,command[0])
    }
    const data=await request('/api/query',{command:['HGETALL','fe-neo-app:employee:1']})
    assert.equal(data.status,200);assert.ok(data.data.rows.length>0);assert.ok(data.data.executedCommand)
    await repository.connection
    await repository.client.hSet(repository.prefix+'test:oversized',Object.fromEntries(Array.from({length:201},(_,i)=>['f'+i,'v'])))
    assert.equal((await request('/api/query',{command:['HGETALL',repository.prefix+'test:oversized']})).status,400)
    await repository.client.del(repository.prefix+'test:oversized')
    const persistence=await repository.client.configGet('appendonly');assert.equal(persistence.appendonly,'yes')
  }else{
    assert.equal((await request('/api/query',{sql:'SELECT 1 AS value'})).status,200)
    const limited=await request('/api/query',{sql:'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<250) SELECT n FROM seq LIMIT 250'})
    assert.equal(limited.status,200,JSON.stringify(limited.data));assert.equal(limited.data.rowCount,200)
    for(const sql of ['DELETE FROM employees WHERE FALSE','SELECT SLEEP(1)',"SELECT 1 INTO OUTFILE '/tmp/never-created'",'SELECT @x']) assert.equal((await request('/api/query',{sql})).status,400)
    const {createPool}=await import('../../server/sql-client.js')
    const rootPool=createPool('mysql://root:ci-root-not-for-production@127.0.0.1:13306/employee_test')
    const recovery='fe_recovery_'+randomUUID().replaceAll('-','')
    const migrationDir=await mkdtemp(path.join(tmpdir(),'fe-migrations-'))
    try{
      await rootPool.query('CREATE DATABASE `'+recovery+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')
      const recoveryUrl='mysql://root:ci-root-not-for-production@127.0.0.1:13306/'+recovery
      await cp('migrations',migrationDir,{recursive:true})
      await appendFile(path.join(migrationDir,'002.sql'),'\n-- next-statement\nSELECT * FROM deliberately_missing_table;\n')
      await assert.rejects(runMigrations(recoveryUrl,{migrationsRoot:migrationDir,attempts:1,logger:quiet}))
      const recovered=await runMigrations(recoveryUrl,{seedSampleData:true,attempts:1,logger:quiet})
      assert.deepEqual(recovered.skipped,['001']);assert.deepEqual(recovered.applied,['002','003','004'])
      assert.equal((await runMigrations(recoveryUrl,{seedSampleData:true,logger:quiet})).seeded,false)
      if(ENGINE==='mariadb'){
        const json=await rootPool.query('SELECT JSON_VALID(request_payload) AS valid FROM command_jobs LIMIT 1');assert.equal(Number(json.rows[0].valid),1)
        await assert.rejects(rootPool.query('SET STATEMENT max_statement_time=0.05 FOR SELECT SLEEP(2)'))
      }
    }finally{
      if(!/^fe_recovery_[a-f0-9]+$/.test(recovery))throw new Error('Unsafe fixture database name')
      await rootPool.query('DROP DATABASE IF EXISTS `'+recovery+'`')
      await rootPool.end();await rm(migrationDir,{recursive:true,force:true})
    }
  }

  const snapshot=await repository.summary()
  const savedJobs=await Promise.all([siteJob,employeeJob,deviceJob].map(job=>repository.getJob(job.jobId)))
  const stopped=spawnSync('docker',['compose','-f','compose.test.yaml','stop','database'],{encoding:'utf8'})
  assert.equal(stopped.status,0,stopped.stderr)
  let unavailable=false
  for(let i=0;i<30;i++){const response=await fetch(base+'/health/ready');await response.text();if(response.status===503){unavailable=true;break}await sleep(500)}
  assert.equal(unavailable,true,'Readiness must fail when the database is stopped')
  const started=spawnSync('docker',['compose','-f','compose.test.yaml','start','database'],{encoding:'utf8'})
  assert.equal(started.status,0,started.stderr)
  const restart=spawnSync('docker',['compose','-f','compose.test.yaml','restart','queue','app','app2'],{encoding:'utf8'})
  assert.equal(restart.status,0,restart.stderr)
  await ready()
  assert.deepEqual(await repository.summary(),snapshot)
  assert.deepEqual(await Promise.all(savedJobs.map(job=>repository.getJob(job.jobId))),savedJobs)
  const podState=spawnSync('docker',['compose','-f','compose.test.yaml','ps','--format','json'],{encoding:'utf8'})
  assert.equal(podState.status,0)
  console.log('PASS: '+ENGINE+' live workflows, duplicate delivery, restartable bootstrap, query policy and durable restart.')
})
