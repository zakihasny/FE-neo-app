local p=ARGV[1]
local c=cjson.decode(ARGV[2])
local jobKey=p..'job:'..ARGV[3]
local now=ARGV[4]
local function check(key,kind)
 local t=redis.call('TYPE',key).ok
 if t~='none' and t~=kind then error('STATE_CORRUPT: wrong key type') end
end
local function fail(message) error('PERMANENT: '..message) end
local function record(kind,id)
 local key=p..kind..':'..tostring(id)
 check(key,'hash')
 if redis.call('EXISTS',key)==0 then return nil end
 return key
end
check(jobKey,'hash')
if redis.call('HGET',jobKey,'resource_type')~=c.resourceType then fail('Idempotency key belongs to a different resource type.') end
if redis.call('HGET',jobKey,'status')=='completed' then
 return cjson.encode({status='completed',resourceType=c.resourceType,resourceId=tonumber(redis.call('HGET',jobKey,'resource_id')),duplicate=true})
end
local kinds={site='sites',employee='employees',device='devices'}
local plural=kinds[c.resourceType]
if not plural then fail('Unsupported resource type.') end
local uniqueName=({site='site',employee='email',device='serial'})[c.resourceType]
local uniqueKey=p..'unique:'..uniqueName
local counter=p..'next:'..c.resourceType
local ids=p..'ids:'..plural
check(uniqueKey,'hash');check(counter,'string');check(ids,'zset')
if redis.call('HGET',uniqueKey,c._unique) then fail('Duplicate '..uniqueName..'.') end
if c.resourceType=='employee' then
 if not record('site',c.siteId) then fail('Site not found.') end
 if not record('salary',c.salaryId) then fail('Salary grade not found.') end
 local seat=record('seating',c.seatingId)
 if not seat or tonumber(redis.call('HGET',seat,'site_id'))~=c.siteId then fail('The seat does not belong to the selected site.') end
elseif c.resourceType=='device' then
 local employee=record('employee',c.employeeId)
 if not employee then fail('Employee not found.') end
 if not record('site',c.siteId) or tonumber(redis.call('HGET',employee,'site_id'))~=c.siteId then fail('Device site must match the employee site.') end
end
local previous=tonumber(redis.call('GET',counter) or '0')
if not previous or previous<0 or previous~=math.floor(previous) or previous>=2147483647 then error('STATE_CORRUPT: invalid ID counter') end
local id=previous+1
local target=p..c.resourceType..':'..id
if redis.call('EXISTS',target)~=0 then error('STATE_CORRUPT: counter would overwrite a record') end
local values={target}
local function field(name,value) table.insert(values,name);table.insert(values,tostring(value)) end
if c.resourceType=='site' then
 field('site_id',id);field('site_name',c.siteName);field('city',c.city);field('address',c.address)
elseif c.resourceType=='employee' then
 field('employee_id',id);field('site_id',c.siteId);field('salary_id',c.salaryId);field('seating_id',c.seatingId)
 field('full_name',c.fullName);field('email',c.email);field('job_title',c.jobTitle);field('hired_date',c.hiredDate)
else
 field('employee_device_id',id);field('employee_id',c.employeeId);field('site_id',c.siteId)
 field('device_type',c.deviceType);field('device_brand',c.deviceBrand);field('serial_number',c.serialNumber);field('assigned_date',c.assignedDate)
end
-- All deterministic constraints and key types were checked before the first write.
redis.call('INCR',counter)
redis.call('HSET',unpack(values))
redis.call('ZADD',ids,id,id)
redis.call('HSET',uniqueKey,c._unique,id)
redis.call('HSET',jobKey,'status','completed','resource_id',id,'error_message','','completed_at',now,'updated_at',now)
return cjson.encode({status='completed',resourceType=c.resourceType,resourceId=id,duplicate=false})
