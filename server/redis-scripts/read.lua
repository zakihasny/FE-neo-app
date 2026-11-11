local command=cjson.decode(ARGV[1])
local name=command[1]
local function bounded(size)
 if size>65536 then error('READ_LIMIT: use a smaller read') end
end
if name=='GET' then
 bounded(redis.call('STRLEN',command[2]))
elseif name=='HGET' then
 bounded(redis.call('HSTRLEN',command[2],command[3]))
elseif name=='HMGET' then
 local total=0
 for i=3,#command do total=total+redis.call('HSTRLEN',command[2],command[i]) end
 bounded(total)
elseif name=='HGETALL' then
 if redis.call('HLEN',command[2])>200 then error('READ_LIMIT: use HMGET for selected fields') end
 local fields=redis.call('HKEYS',command[2])
 local total=0
 for _,field in ipairs(fields) do total=total+#field+redis.call('HSTRLEN',command[2],field) end
 bounded(total)
end
local result=redis.call(unpack(command))
if name=='ZRANGE' then
 local total=0
 for _,member in ipairs(result) do total=total+#member end
 bounded(total)
end
return result
