import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DatabaseService } from './database.js'
import { createHttpServer } from './http.js'
import { QueueService } from './queue.js'

function requireEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} wajib diisi pada runtime environment.`)
  return value
}

const databaseUrl = requireEnvironment('DATABASE_URL')
const natsUrl = requireEnvironment('NATS_URL')
const port = Number(process.env.PORT || 8080)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid.')

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const database = new DatabaseService(databaseUrl)
const queue = new QueueService(natsUrl, database)
const server = createHttpServer({ database, queue, publicRoot: repositoryRoot })

queue.start()
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'http_service_started',
    host: '0.0.0.0',
    port
  }))
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }))

  const forceClose = setTimeout(() => server.closeAllConnections(), 10000)
  forceClose.unref()
  await new Promise((resolve) => server.close(resolve))
  await queue.stop()
  await database.close()
  clearTimeout(forceClose)
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_completed' }))
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(JSON.stringify({
          level: 'error',
          event: 'shutdown_failed',
          message: error.message
        }))
        process.exit(1)
      })
  })
}

process.on('unhandledRejection', (error) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'unhandled_rejection',
    message: error instanceof Error ? error.message : String(error)
  }))
})
