import { createClient } from 'redis'
import { withDeadline } from './storage-utils.js'

export function keyPrefix(value = process.env.REDIS_KEY_PREFIX || 'fe-neo-app') {
  const prefix = String(value).replace(/:+$/, '')
  if (!/^[A-Za-z][A-Za-z0-9:_-]{0,63}$/.test(prefix)) throw new Error('Invalid REDIS_KEY_PREFIX.')
  return prefix + ':'
}
export function connectionOptions(connectionString, reconnect = true) {
  let url
  try { url = new URL(connectionString) } catch { throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.') }
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || !/^\/\d*$/.test(url.pathname || '/')) {
    throw new Error('REDIS_URL must use redis:// or rediss:// with a numeric database index.')
  }
  return { url: connectionString, disableOfflineQueue: true, socket: {
    connectTimeout: 5000, reconnectStrategy: reconnect ? retries => Math.min(200 + retries * 100, 2000) : false,
    ...(url.protocol === 'rediss:' ? { tls: true, rejectUnauthorized: true } : {})
  } }
}
export function openClient(connectionString, reconnect = true) {
  const client = createClient(connectionOptions(connectionString, reconnect))
  client.on('error', () => console.error(JSON.stringify({ level: 'error', event: 'redis_connection_error' })))
  const connection = withDeadline(client.connect(), 6000, () => { if (client.isOpen) client.destroy() })
  connection.catch(() => {})
  return { client, connection }
}
