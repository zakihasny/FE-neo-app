import { spawnSync } from 'node:child_process'
const result=spawnSync('docker',['compose','-f','compose.test.yaml','logs','--tail','65'],{encoding:'utf8'})
const logs=(result.stdout||'')+'\n'+(result.stderr||'')
console.log(logs.replace(/(?:mysql|redis|rediss|nats|tls):\/\/[^\s"']+/gi,'[CONNECTION REDACTED]').replace(/ci-[A-Za-z-]+not-for-production/g,'[CI CREDENTIAL REDACTED]'))
