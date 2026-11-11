import { readFile } from 'node:fs/promises'
import { openClient, keyPrefix } from './redis-client.js'
export { environmentFlag } from './storage-utils.js'
const script=await readFile(new URL('./redis-scripts/bootstrap.lua',import.meta.url),'utf8')
export async function runMigrations(connectionString,{enabled=true,seedSampleData=false,attempts=30,retryDelayMs=2000,logger=console}={}) {
  if(!enabled)return {applied:[],skipped:[],seeded:false,disabled:true}
  const prefix=keyPrefix()
  const seed=JSON.parse(await readFile(new URL('../seeds/sample-data.json',import.meta.url),'utf8'))
  for(const row of seed.sites)row._unique=JSON.stringify([row.site_name.toLowerCase(),row.city.toLowerCase()])
  for(const row of seed.employees)row._unique=row.email.toLowerCase()
  for(const row of seed.employee_devices)row._unique=row.serial_number.toUpperCase()
  let opened
  for(let attempt=1;attempt<=attempts;attempt++){
    opened=openClient(connectionString,false)
    try{await opened.connection;break}catch{
      if(opened.client.isOpen)opened.client.destroy()
      if(attempt===attempts)throw new Error('Redis unavailable during bootstrap.')
      await new Promise(resolve=>setTimeout(resolve,retryDelayMs))
    }
  }
  try{
    const info=await opened.client.info('server')
    if(!/^redis_version:8\.2\./m.test(info))throw new Error('This branch requires Redis 8.2.')
    const result=JSON.parse(await opened.client.eval(script,{keys:[],arguments:[prefix,String(seedSampleData),JSON.stringify(seed),new Date().toISOString()]}))
    const summary={applied:result.applied?['001']:[],skipped:result.applied?[]:['001'],seeded:result.seeded}
    logger.info?.(JSON.stringify({event:'redis_bootstrap_completed',...summary}))
    return summary
  }finally{if(opened.client.isOpen)opened.client.destroy()}
}
