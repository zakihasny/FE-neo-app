import { readFile } from 'node:fs/promises'
import { openClient, keyPrefix } from './redis-client.js'
import { guardRedisCommand } from './redis-guard.js'
import { toJob, withDeadline } from './storage-utils.js'
import { HttpError, PermanentJobError } from './errors.js'
const scripts=Object.fromEntries(await Promise.all(['create-job','process','read'].map(async name=>[name,await readFile(new URL('./redis-scripts/'+name+'.lua',import.meta.url),'utf8')])))

function entity(row) {
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,/_id$/.test(key)?Number(value):value]))
}
function unique(command) {
  if(command.resourceType==='site')return JSON.stringify([command.siteName.toLowerCase(),command.city.toLowerCase()])
  return command.resourceType==='employee'?command.email.toLowerCase():command.serialNumber.toUpperCase()
}
export class DatabaseService {
  constructor(connectionString,{client,connection,prefix}={}) {
    this.prefix=keyPrefix(prefix)
    if(client){this.client=client;this.connection=connection||Promise.resolve(client)}
    else {const opened=openClient(connectionString);this.client=opened.client;this.connection=opened.connection}
  }
  async ready() {
    await this.connection
    if(!this.client.isReady)throw new Error('Redis is disconnected.')
    await this.client.ping()
    const info=await this.client.info('server')
    const version=info.match(/^redis_version:([^\r\n]+)/m)?.[1]
    if(!version?.startsWith('8.2.'))throw new Error('This branch requires Redis 8.2.')
    if(await this.client.hGet(this.prefix+'schema','version')!=='1')throw new Error('Redis key schema is not initialized.')
    return {database:this.prefix.slice(0,-1),engine:'redis',version}
  }
  async summary() {
    await this.connection
    const counts=await Promise.all(['sites','employees','devices'].map(name=>this.client.zCard(this.prefix+'ids:'+name)))
    return {sites:Number(counts[0]),employees:Number(counts[1]),devices:Number(counts[2])}
  }
  async records(plural,kind) {
    await this.connection
    const ids=await this.client.zRange(this.prefix+'ids:'+plural,0,-1)
    return Promise.all(ids.map(async id=>entity(await this.client.hGetAll(this.prefix+kind+':'+id))))
  }
  async meta() {
    const [sites,salaries,seating,employees]=await Promise.all([this.records('sites','site'),this.records('salaries','salary'),this.records('seating','seating'),this.records('employees','employee')])
    const bySite=new Map(sites.map(row=>[row.site_id,row.site_name]))
    return {
      sites:sites.sort((a,b)=>a.site_name.localeCompare(b.site_name)).map(({site_id,site_name,city})=>({site_id,site_name,city})),
      salaries:salaries.sort((a,b)=>Number(a.basic_salary)-Number(b.basic_salary)),
      seating:seating.sort((a,b)=>a.site_id-b.site_id||a.seat_code.localeCompare(b.seat_code)),
      employees:employees.sort((a,b)=>a.full_name.localeCompare(b.full_name)||a.employee_id-b.employee_id).map(({employee_id,full_name,site_id})=>({employee_id,full_name,site_id,site_name:bySite.get(site_id)}))
    }
  }
  async executeReadOnly(input) {
    const command=guardRedisCommand(input,this.prefix)
    await this.connection
    const started=performance.now()
    try{
      const keys=command[0]==='PING'?[]:command[0]==='EXISTS'?command.slice(1):command.slice(1,2)
      const result=await withDeadline(this.client.evalRo(scripts.read,{keys,arguments:[JSON.stringify(command)]}),5000)
      let columns=['value'],rows
      if(command[0]==='HGETALL'){
        columns=['field','value'];rows=[]
        for(let i=0;i<result.length;i+=2)rows.push([result[i],result[i+1]])
      }else if(command[0]==='HMGET'){
        columns=['field','value'];rows=result.map((value,i)=>[command[i+2],value])
      }else if(Array.isArray(result)){rows=result.map(value=>[value])}
      else rows=[[result]]
      return {columns,rows,rowCount:rows.length,durationMs:Math.max(1,Math.round(performance.now()-started)),executedCommand:command}
    }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Redis command failed, has the wrong key type, or exceeds the read limit.')}
  }
  async createJob(command) {
    await this.connection
    const result=JSON.parse(await this.client.eval(scripts['create-job'],{keys:[],arguments:[this.prefix,JSON.stringify(command),new Date().toISOString(),String(Date.now())]}))
    return {...await this.getJob(result.jobId),isNew:result.isNew}
  }
  async markJobPublished(jobId,acknowledgement) {
    await this.connection
    await this.client.eval("if redis.call('EXISTS',KEYS[1])==0 then return 0 end redis.call('HSET',KEYS[1],'nats_stream',ARGV[1],'nats_sequence',ARGV[2],'published_at',ARGV[3],'updated_at',ARGV[3]);return 1",{keys:[this.prefix+'job:'+jobId],arguments:[acknowledgement.stream,String(acknowledgement.seq),new Date().toISOString()]})
  }
  async markJobFailed(jobId,message) {
    await this.connection
    await this.client.eval("if redis.call('EXISTS',KEYS[1])==0 or redis.call('HGET',KEYS[1],'status')=='completed' then return 0 end redis.call('HSET',KEYS[1],'status','failed','error_message',ARGV[1],'completed_at',ARGV[2],'updated_at',ARGV[2]);return 1",{keys:[this.prefix+'job:'+jobId],arguments:[String(message).slice(0,500),new Date().toISOString()]})
  }
  async getJob(jobId) {await this.connection;return toJob(await this.client.hGetAll(this.prefix+'job:'+jobId))}
  async processCommand(command) {
    const persisted=await this.createJob(command)
    try{
      return JSON.parse(await this.client.eval(scripts.process,{keys:[],arguments:[this.prefix,JSON.stringify({...command,_unique:unique(command)}),persisted.jobId,new Date().toISOString()]}))
    }catch(error){
      if(error.message.includes('PERMANENT:')){
        const message=error.message.split('PERMANENT:').at(-1).trim().split(' script:')[0]
        await this.markJobFailed(persisted.jobId,message)
        throw new PermanentJobError(message)
      }
      throw error
    }
  }
  async processEmployeeCommand(command) {const result=await this.processCommand({...command,resourceType:'employee'});return {...result,employeeId:result.resourceId}}
  async close() {if(this.client.isOpen)this.client.destroy()}
}
