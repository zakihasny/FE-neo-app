import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { HttpError } from './errors.js'
import {
  validateDeviceInput,
  validateEmployeeInput,
  validateSiteInput
} from './validation.js'

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
])

const STATIC_PAGES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/input.html', 'input.html'],
  ['/query.html', 'query.html']
])

function applySecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com"
  ].join('; '))
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(request, response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.statusCode = statusCode
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', String(body.length))
  if (request.method === 'HEAD') return response.end()
  response.end(body)
}

async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type harus application/json.')
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 32768) throw new HttpError(413, 'Payload terlalu besar.')
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Payload JSON tidak valid.')
  }
}

function staticFileFor(publicRoot, pathname) {
  const page = STATIC_PAGES.get(pathname)
  if (page) return path.join(publicRoot, page)

  if (!pathname.startsWith('/assets/')) return null
  let decoded
  try {
    decoded = decodeURIComponent(pathname.slice('/assets/'.length))
  } catch {
    return null
  }
  if (!decoded || decoded.includes('\0')) return null

  const assetsRoot = path.resolve(publicRoot, 'assets')
  const candidate = path.resolve(assetsRoot, decoded)
  if (!candidate.startsWith(`${assetsRoot}${path.sep}`)) return null
  return candidate
}

async function serveStatic(request, response, publicRoot, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const filename = staticFileFor(publicRoot, pathname)
  if (!filename) return false

  try {
    const body = await readFile(filename)
    const extension = path.extname(filename).toLowerCase()
    response.statusCode = 200
    response.setHeader('Content-Type', MIME_TYPES.get(extension) || 'application/octet-stream')
    response.setHeader('Content-Length', String(body.length))
    response.setHeader(
      'Cache-Control',
      pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache'
    )
    if (request.method === 'HEAD') response.end()
    else response.end(body)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return false
    throw error
  }
  return true
}

function logRequestError(requestId, pathname, error) {
  console.error(JSON.stringify({
    level: 'error',
    event: 'http_request_error',
    requestId,
    path: pathname,
    code: error?.code,
    message: error instanceof Error ? error.message : String(error)
  }))
}

const createResourceRoutes = new Map([
  ['/api/employees', {
    resourceType: 'employee',
    label: 'Pegawai',
    validate: validateEmployeeInput
  }],
  ['/api/sites', {
    resourceType: 'site',
    label: 'Site',
    validate: validateSiteInput
  }],
  ['/api/devices', {
    resourceType: 'device',
    label: 'Perangkat',
    validate: validateDeviceInput
  }]
])

async function handleCreateResource({
  request,
  response,
  requestId,
  database,
  queue,
  route
}) {
  const input = route.validate(await readJson(request))
  const command = { jobId: randomUUID(), resourceType: route.resourceType, ...input }
  const job = await database.createJob(command)

  if (!job.isNew && job.resourceType !== route.resourceType) {
    throw new HttpError(409, 'Idempotency key sudah digunakan untuk tipe data lain.')
  }

  if (job.isNew) {
    if (!queue.isReady()) {
      await database.markJobFailed(command.jobId, 'NEO Queue belum siap.').catch(() => {})
      throw new HttpError(503, 'NEO Queue belum siap.')
    }

    let acknowledgement
    try {
      acknowledgement = await queue.publishCommand(command)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Message tidak dapat dikirim.'
      await database.markJobFailed(command.jobId, message).catch(() => {})
      throw new HttpError(503, 'NEO Queue tidak dapat menerima message saat ini.')
    }

    database.markJobPublished(command.jobId, acknowledgement).catch((error) => {
      console.error(JSON.stringify({
        level: 'error',
        event: 'job_publish_metadata_error',
        requestId,
        jobId: command.jobId,
        resourceType: route.resourceType,
        message: error instanceof Error ? error.message : String(error)
      }))
    })
  }

  sendJson(request, response, 202, {
    jobId: job.jobId,
    status: job.status,
    resourceType: job.resourceType,
    resourceId: job.resourceId,
    message: job.isNew
      ? `Permintaan tambah ${route.label.toLowerCase()} sudah diterima NEO Queue.`
      : 'Permintaan dengan idempotency key tersebut sudah tercatat.'
  })
}

function jobStatusMessage(job) {
  const labels = { employee: 'Pegawai', site: 'Site', device: 'Perangkat' }
  const label = labels[job.resourceType] || 'Data'
  if (job.status === 'completed') return `${label} berhasil ditambahkan.`
  if (job.status === 'failed') return job.message || `${label} gagal ditambahkan.`
  return 'Permintaan sedang diproses.'
}

export function createHttpServer({ database, queue, publicRoot }) {
  return createServer(async (request, response) => {
    const requestId = String(request.headers['x-request-id'] || randomUUID()).slice(0, 128)
    const url = new URL(request.url || '/', 'http://localhost')
    const { pathname } = url

    applySecurityHeaders(response)
    response.setHeader('X-Request-Id', requestId)

    try {
      if ((pathname === '/health/live' || pathname === '/api/health/live') &&
          (request.method === 'GET' || request.method === 'HEAD')) {
        sendJson(request, response, 200, { status: 'ok', service: 'fe-neo-app' })
        return
      }

      if ((pathname === '/health/ready' || pathname === '/api/health/ready') &&
          (request.method === 'GET' || request.method === 'HEAD')) {
        if (!queue.isReady()) throw new HttpError(503, 'NEO Queue belum siap.')
        const ready = await database.ready()
        sendJson(request, response, 200, {
          status: 'ready',
          database: ready.database,
          postgresqlMajor: 15,
          queue: 'connected'
        })
        return
      }

      if (pathname === '/api/summary' && request.method === 'GET') {
        try {
          sendJson(request, response, 200, await database.summary())
        } catch {
          throw new HttpError(503, 'Ringkasan NEO DB tidak tersedia.')
        }
        return
      }

      if (pathname === '/api/meta' && request.method === 'GET') {
        try {
          sendJson(request, response, 200, await database.meta())
        } catch {
          throw new HttpError(503, 'Referensi NEO DB tidak tersedia.')
        }
        return
      }

      if (pathname === '/api/query' && request.method === 'POST') {
        const body = await readJson(request)
        try {
          sendJson(request, response, 200, await database.executeReadOnly(body?.sql))
        } catch (error) {
          if (error instanceof HttpError) throw error
          throw new HttpError(400, error instanceof Error ? error.message : 'Query tidak dapat dijalankan.')
        }
        return
      }

      const createRoute = createResourceRoutes.get(pathname)
      if (createRoute && request.method === 'POST') {
        await handleCreateResource({
          request,
          response,
          requestId,
          database,
          queue,
          route: createRoute
        })
        return
      }

      const jobMatch = pathname.match(
        /^\/api\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
      )
      if (jobMatch && request.method === 'GET') {
        const job = await database.getJob(jobMatch[1])
        if (!job) throw new HttpError(404, 'Job tidak ditemukan.')
        sendJson(request, response, 200, {
          ...job,
          message: jobStatusMessage(job)
        })
        return
      }

      if (pathname.startsWith('/api/') || pathname.startsWith('/health/')) {
        throw new HttpError(404, 'Endpoint tidak ditemukan.')
      }

      if (await serveStatic(request, response, publicRoot, pathname)) return
      throw new HttpError(404, 'Halaman tidak ditemukan.')
    } catch (error) {
      if (!(error instanceof HttpError) || error.statusCode >= 500) {
        logRequestError(requestId, pathname, error)
      }
      const statusCode = error instanceof HttpError ? error.statusCode : 500
      sendJson(request, response, statusCode, {
        message: error instanceof HttpError ? error.message : 'Terjadi kesalahan pada service.',
        requestId
      })
    }
  })
}
