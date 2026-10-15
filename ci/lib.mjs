import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

export const versions = JSON.parse(readFileSync(new URL('./versions.json', import.meta.url), 'utf8'))
export const image = process.env.TEST_IMAGE || 'fe-neo-app:ci'
if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new Error('Invalid test image reference')

export function run(command, args, options = {}) {
  const { capture = false, captureBoth = false, allowFailure = false, ...spawnOptions } = options
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...spawnOptions
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    if (capture) process.stderr.write(sanitize(result.stderr || ''))
    throw new Error(command + ' exited with status ' + result.status)
  }
  return capture ? ((result.stdout || '') + (captureBoth ? result.stderr || '' : '')).trim() : result.status
}

export function sanitize(value) {
  return String(value)
    .replace(/((?:postgres(?:ql)?|nats|tls):\/\/)[^\s@]+@/gi, '$1[redacted]@')
    .replace(/("(?:password|token|secret)"\s*:\s*")[^"]+"/gi, '$1[redacted]"')
}

export function summary(text) {
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n')
}
