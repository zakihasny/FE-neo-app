import { HttpError } from './errors.js'
const commands = new Set(['PING','TYPE','EXISTS','GET','HGET','HMGET','HGETALL','HLEN','SCARD','ZCARD','ZRANGE'])
export function guardRedisCommand(input, prefix) {
  if (!Array.isArray(input) || !input.length || input.length>202 || input.some(value=>typeof value!=='string' || value.includes('\0'))) {
    throw new HttpError(400,'Enter a JSON array of command strings.')
  }
  const command=[input[0].toUpperCase(),...input.slice(1)]
  const name=command[0]
  if(!commands.has(name))throw new HttpError(400,'This Redis command is not allowed.')
  if(name==='PING') { if(command.length!==1)throw new HttpError(400,'PING takes no arguments.');return command }
  const keys=name==='EXISTS'?command.slice(1):command.slice(1,2)
  if(!keys.length || keys.length>200 || keys.some(key=>!key.startsWith(prefix)||key.length<=prefix.length||key.length>256)) {
    throw new HttpError(400,'Keys must belong to the configured application namespace.')
  }
  const exact={TYPE:2,GET:2,HGET:3,HGETALL:2,HLEN:2,SCARD:2,ZCARD:2,ZRANGE:4}
  if(exact[name] && command.length!==exact[name])throw new HttpError(400,'Invalid command argument count.')
  if(name==='HMGET' && (command.length<3 || command.length>202))throw new HttpError(400,'Read at most 200 hash fields.')
  if(name==='ZRANGE') {
    if(!/^\d+$/.test(command[2])||!/^\d+$/.test(command[3]))throw new HttpError(400,'Use a bounded nonnegative rank range.')
    const start=Number(command[2]),stop=Number(command[3])
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(stop)||stop<start||stop-start>=200)throw new HttpError(400,'Read at most 200 sorted-set members.')
  }
  return command
}
