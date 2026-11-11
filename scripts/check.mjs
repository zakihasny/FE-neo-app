import { readdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
async function walk(root) {
  const output = []
  for (const entry of await readdir(root,{withFileTypes:true})) {
    const name=path.join(root,entry.name)
    if(entry.isDirectory()) output.push(...await walk(name))
    else if(/\.(m?js)$/.test(name)) output.push(name)
  }
  return output
}
let checked=0
for(const root of ['server','assets','scripts','test']) for(const name of await walk(root)) {
  const result=spawnSync(process.execPath,['--check',name],{encoding:'utf8'})
  if(result.status!==0) throw new Error('Syntax check failed: '+name+' '+result.stderr)
  checked++
}
for(const name of ['package.json','pnpm-lock.yaml','Dockerfile','compose.test.yaml','.env.example']) await readFile(name)
console.log('PASS: '+checked+' JavaScript files checked.')
