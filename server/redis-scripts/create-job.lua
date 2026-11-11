local p=ARGV[1]
local c=cjson.decode(ARGV[2])
local function check(key,kind)
 local t=redis.call('TYPE',key).ok
 if t~='none' and t~=kind then error('STATE_CORRUPT: wrong key type') end
end
local index=p..'index:idempotency'
check(index,'hash')
local existing=redis.call('HGET',index,c.idempotencyKey)
if existing then
 local key=p..'job:'..existing
 check(key,'hash')
 if redis.call('EXISTS',key)==0 then error('STATE_CORRUPT: missing job') end
 return cjson.encode({jobId=existing,isNew=false})
end
local key=p..'job:'..c.jobId
check(key,'hash');check(p..'ids:jobs','zset')
if redis.call('EXISTS',key)==1 then error('STATE_CORRUPT: job ID collision') end
redis.call('HSET',key,'job_id',c.jobId,'idempotency_key',c.idempotencyKey,'resource_type',c.resourceType,'operation','create','status','queued','request_payload',ARGV[2],'created_at',ARGV[3],'updated_at',ARGV[3],'completed_at','')
redis.call('HSET',index,c.idempotencyKey,c.jobId)
redis.call('ZADD',p..'ids:jobs',ARGV[4],c.jobId)
return cjson.encode({jobId=c.jobId,isNew=true})
