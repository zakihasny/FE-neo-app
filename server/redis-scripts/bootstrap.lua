local p=ARGV[1]
local schema=p..'schema'
local kind=redis.call('TYPE',schema).ok
if kind~='none' and kind~='hash' then error('STATE_CORRUPT: invalid schema key') end
local version=redis.call('HGET',schema,'version')
if version and version~='1' then error('Unsupported Redis key schema version.') end
local seed=ARGV[2]=='true' and redis.call('HGET',schema,'seeded')~='1'
local data=cjson.decode(ARGV[3])
local tables={'sites','salaries','seating','employees','employee_devices'}
local kinds={sites='site',salaries='salary',seating='seating',employees='employee',employee_devices='device'}
local columns={sites='site_id',salaries='salary_id',seating='seating_id',employees='employee_id',employee_devices='employee_device_id'}
local plurals={sites='sites',salaries='salaries',seating='seating',employees='employees',employee_devices='devices'}
if seed then
 for _,name in ipairs(tables) do
  local k=kinds[name]
  if redis.call('EXISTS',p..'ids:'..plurals[name],p..'next:'..k)~=0 then error('Sample seed requires an empty application namespace.') end
  for _,row in ipairs(data[name]) do
   if redis.call('EXISTS',p..k..':'..row[columns[name]])~=0 then error('Sample seed would overwrite a record.') end
  end
 end
 for _,name in ipairs({'site','email','serial'}) do if redis.call('EXISTS',p..'unique:'..name)~=0 then error('Sample seed would overwrite an index.') end end
end
local applied=not version
if seed then
 for _,name in ipairs(tables) do
  local maximum=0
  for _,row in ipairs(data[name]) do
   local id=row[columns[name]]
   local values={p..kinds[name]..':'..id}
   for field,value in pairs(row) do if field~='_unique' then table.insert(values,field);table.insert(values,tostring(value)) end end
   redis.call('HSET',unpack(values))
   redis.call('ZADD',p..'ids:'..plurals[name],id,id)
   if id>maximum then maximum=id end
   if row._unique then redis.call('HSET',p..'unique:'..({sites='site',employees='email',employee_devices='serial'})[name],row._unique,id) end
  end
  redis.call('SET',p..'next:'..kinds[name],maximum)
 end
 redis.call('HSET',schema,'seeded','1')
end
redis.call('HSET',schema,'version','1')
if applied then redis.call('HSET',schema,'applied_at',ARGV[4]) end
return cjson.encode({applied=applied,seeded=seed})
