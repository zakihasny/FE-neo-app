import driver from 'mysql2/promise'
import { readFileSync } from 'node:fs'
import { environmentFlag, normalize } from './storage-utils.js'

export const ENGINE = 'mysql'
export const VERSION_FAMILY = '8.4'

export function connectionOptions(connectionString, environment = process.env) {
  let url
  try { url = new URL(connectionString) } catch { throw new Error('DATABASE_URL must be a valid mysql:// URL.') }
  if (url.protocol !== 'mysql:' || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must select a database using mysql://.')
  }
  if (url.search || url.hash) throw new Error('Use the documented TLS environment variables, not URL options or fragments.')
  let user, password, database
  try {
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch { throw new Error('DATABASE_URL has invalid credential or database encoding.') }
  if (!user || !/^[A-Za-z0-9_$-]{1,64}$/.test(database)) throw new Error('Invalid database user or database name.')
  const tls = environmentFlag(environment.MYSQL_TLS)
  const caFile = environment.MYSQL_CA_FILE?.trim()
  if (caFile && !tls) throw new Error('MYSQL_CA_FILE requires MYSQL_TLS=true.')
  const ssl = tls ? {
    rejectUnauthorized: true, verifyIdentity: true,
    ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {})
  } : undefined
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 3306), user, password, database,
    connectionLimit: 5, connectTimeout: 5000, timezone: '+00:00', dateStrings: true,
    multipleStatements: false, ...(ssl ? { ssl } : {})
  }
}

export function verifyVersion(version) {
  const text = String(version)
  const matches = ENGINE === 'mysql'
    ? text.startsWith(VERSION_FAMILY + '.') && !/mariadb/i.test(text)
    : new RegExp('(?:^|-)' + VERSION_FAMILY.replace('.', '\\.') + '\\.\\d+.*MariaDB', 'i').test(text)
  if (!matches) throw new Error('This branch requires MySQL 8.4.')
}

export function createPool(connectionString, environment = process.env) {
  const native = driver.createPool(connectionOptions(connectionString, environment))
  native.on?.('error', (error) => console.error(JSON.stringify({ level: 'error', event: ENGINE + '_pool_error', code: error.code })))
  async function connect() {
    const connection = await native.getConnection()
    let destroyed = false
    return {
      async query(sql, values = [], rowsAsArray = false) {
        const [data, fields] = await connection.query({ sql, rowsAsArray }, values)
        return { rows: Array.isArray(data) ? data.map(normalize) : [], fields: (fields || []).map(field => ({ name: field.name })),
          insertId: normalize(data?.insertId), affectedRows: Number(data?.affectedRows || 0) }
      },
      release() { if (!destroyed) connection.release() },
      destroy() { destroyed = true; connection.destroy() }
    }
  }
  return {
    connect,
    async query(sql, values = [], rowsAsArray = false) {
      const connection = await connect()
      try { return await connection.query(sql, values, rowsAsArray) }
      finally { connection.release() }
    },
    async end() { await native.end() }
  }
}
