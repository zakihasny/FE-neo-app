import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const forbidden = tracked.filter((file) => file.split('/').at(-1).toLowerCase() === 'dockerfile')
assert.deepEqual(forbidden, [], 'Every alternative branch must be free of tracked Dockerfiles')
assert.equal(existsSync('Dockerfile'), false, 'A root Dockerfile would override builder detection')
const variant = JSON.parse(readFileSync('build-variant.json', 'utf8'))
assert.ok(['railpack', 'nixpacks', 'containerfile', 'cloud-native-buildpacks', 'earthly', 'jib'].includes(variant.method))
for (const file of variant.configFiles) assert.ok(existsSync(file), 'Missing build configuration: ' + file)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(pkg.engines.node, '22.x')
assert.equal(pkg.packageManager, 'pnpm@11.16.0')
assert.equal(pkg.scripts.start, 'node server/index.js')
console.log('Source contract passed: ' + tracked.length + ' tracked files; no Dockerfile; method=' + variant.method)
