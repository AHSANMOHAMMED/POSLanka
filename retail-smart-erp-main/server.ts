// Custom Next.js server with WebSocket support
// Must run before any other Next code so globalThis.AsyncLocalStorage is set
import 'next/dist/server/node-environment'
import './server-env'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { Socket } from 'net'
import next from 'next'
import { wsManager } from './src/lib/websocket/server'
import type { EntityType } from './src/lib/websocket/events'
import { logError } from './src/lib/ai/error-logger'
import { startDevWarmup } from './src/lib/dev/warmup'
import { createLogger, ensureRequestId, runWithRequestContext } from './src/lib/logger'
import { recordHttpRequest, setShuttingDown } from './src/lib/observability/metrics'
import { isTrustedOrigin } from './src/lib/security/origin'

const log = createLogger('server')
const SLOW_REQUEST_MS = (() => {
  const n = parseInt(process.env.SLOW_REQUEST_MS || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 2000
})()

// Validate and set default environment variables for Railway
if (!process.env.NEXTAUTH_URL && process.env.RAILWAY_PUBLIC_URL) {
  process.env.NEXTAUTH_URL = process.env.RAILWAY_PUBLIC_URL
  log.info('NEXTAUTH_URL set from RAILWAY_PUBLIC_URL', { url: process.env.NEXTAUTH_URL })
}

if (!process.env.NEXTAUTH_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    log.error('FATAL: NEXTAUTH_SECRET is required in production')
    process.exit(1)
  }
  // Generate a stable dev-only secret (not secure for production!)
  log.warn('NEXTAUTH_SECRET is not set. Using a dev-only secret.')
  process.env.NEXTAUTH_SECRET = 'dev-only-secret-do-not-use-in-production'
}

if (!process.env.DATABASE_URL) {
  log.error('DATABASE_URL is required')
  process.exit(1)
}

// Global Node handlers. An uncaught exception leaves the process in an undefined state (even
// "network" ones: a half-handled socket, a pool client mid-query), so we always exit and let the
// orchestrator (App Platform / Docker restart policy) start a clean instance. Readiness flips to
// 503 first so the load balancer stops routing here while the error is persisted.
let fatalExitScheduled = false
process.on('uncaughtException', (err: Error) => {
  logError('uncaughtException', err)
  log.error('uncaught exception, exiting', { err })
  if (fatalExitScheduled) return
  fatalExitScheduled = true
  setShuttingDown(true)
  setTimeout(() => process.exit(1), 2000).unref()
})

process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  logError('unhandledRejection', err)
  log.error('unhandled rejection', { err })
})

const dev = process.env.NODE_ENV !== 'production'
// Use 0.0.0.0 to listen on all interfaces (localhost + network)
// Avoid using HOSTNAME env var on Windows as it resolves to computer name
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

// The listen address is NOT passed to Next: Next builds request.url from its `hostname` option, so
// every redirect (`new URL(path, request.url)` — sign-in, invites, payments, "Open as owner") went to
// http://0.0.0.0:<port> whatever host the browser or reverse proxy used. Without it, Next takes the
// request's Host header.
const app = next({ dev, port })
const handle = app.getRequestHandler()

/**
 * Parse JSON body from request (with size limit to prevent DoS)
 */
const MAX_BODY_SIZE = 1024 * 1024 // 1 MB
function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Handle internal broadcast requests from API routes
 */
async function handleInternalBroadcast(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || '', `http://${req.headers.host}`)

  // Only handle our internal broadcast endpoints
  if (url.pathname !== '/_internal/broadcast' && url.pathname !== '/_internal/account-broadcast') {
    return false
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return true
  }

  // Verify it's an internal request with shared secret
  const broadcastHeader = req.headers['x-internal-broadcast']
  if (broadcastHeader !== 'true' && broadcastHeader !== 'account') {
    res.statusCode = 403
    res.end('Forbidden')
    return true
  }

  // Verify shared secret to prevent unauthorized broadcast injection
  const broadcastSecret = req.headers['x-broadcast-secret']
  const expectedSecret = process.env.NEXTAUTH_SECRET
  if (!expectedSecret || broadcastSecret !== expectedSecret) {
    res.statusCode = 403
    res.end('Forbidden')
    return true
  }

  try {
    const body = await parseJsonBody(req)

    if (url.pathname === '/_internal/account-broadcast') {
      // Account-level broadcast (user-scoped)
      const { userId, entityType, action, id, data } = body as {
        userId: string
        entityType: EntityType
        action: 'created' | 'updated' | 'deleted'
        id: string
        data?: Record<string, unknown>
      }

      if (!userId || !entityType || !action || !id) {
        res.statusCode = 400
        res.end('Missing required fields')
        return true
      }

      wsManager.broadcastToUser(userId, {
        type: entityType,
        action,
        userId,
        id,
        data,
        timestamp: Date.now(),
      })
    } else {
      // Tenant-level broadcast
      const { tenantId, entityType, action, id, data } = body as {
        tenantId: string
        entityType: EntityType
        action: 'created' | 'updated' | 'deleted'
        id: string
        data?: Record<string, unknown>
      }

      if (!tenantId || !entityType || !action || !id) {
        res.statusCode = 400
        res.end('Missing required fields')
        return true
      }

      wsManager.broadcastToTenant(tenantId, entityType, {
        type: entityType,
        action,
        tenantId,
        id,
        data,
        timestamp: Date.now(),
      })
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true }))
  } catch (err) {
    log.error('internal broadcast failed', { err })
    res.statusCode = 500
    res.end('Internal Server Error')
  }

  return true
}

/**
 * Handle SSE (Server-Sent Events) connections — fallback transport when WebSocket is blocked by proxy.
 * Clients connect to /_events?token=<jwt> and receive a stream of data change events.
 */
function handleSSE(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url || '', `http://${req.headers.host}`)

  if (url.pathname !== '/_events') return false

  // CORS: only our own origins (same host, base domain + subdomains, ALLOWED_HOSTS) may read
  // the stream with credentials. Other origins get no CORS headers, so browsers block them.
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const publicHost = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host
  const corsHeaders: Record<string, string> = origin && isTrustedOrigin(origin, publicHost)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin' }
    : {}

  if (req.method === 'OPTIONS') {
    // CORS preflight for SSE
    res.writeHead(204, {
      ...corsHeaders,
      ...(corsHeaders['Access-Control-Allow-Origin'] ? {
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      } : {}),
    })
    res.end()
    return true
  }

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return true
  }

  const token = url.searchParams.get('token')
  if (!token) {
    res.statusCode = 401
    res.end('Token required')
    return true
  }

  // Write function that catches errors from dead connections
  const writeFn = (data: string): boolean => {
    try {
      return res.write(data)
    } catch {
      return false
    }
  }

  const endFn = () => {
    try { res.end() } catch { /* already closed */ }
  }

  const clientId = wsManager.addSSEClient(token, writeFn, endFn)
  if (!clientId) {
    res.statusCode = 403
    res.end('Invalid token')
    return true
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx/proxy buffering
    ...corsHeaders,
  })

  // Send initial authenticated event
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`)

  // Keep-alive comments every 20 seconds to prevent proxy idle timeout
  const keepAlive = setInterval(() => {
    try {
      res.write(':keepalive\n\n')
    } catch {
      clearInterval(keepAlive)
      wsManager.removeSSEClient(clientId)
    }
  }, 20000)

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(keepAlive)
    wsManager.removeSSEClient(clientId)
  })

  return true
}

app.prepare().then(() => {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Correlation id: accept the load balancer's x-request-id or mint one; it is visible to
    // route handlers (request header), returned to the client, and attached to every log line
    // and logError() record written while this request is being handled.
    const incoming = req.headers['x-request-id']
    const requestId = ensureRequestId(Array.isArray(incoming) ? incoming[0] : incoming)
    req.headers['x-request-id'] = requestId
    res.setHeader('x-request-id', requestId)
    const path = (req.url || '/').split('?')[0]
    const started = performance.now()
    if (path !== '/_events') {
      res.once('finish', () => {
        const ms = performance.now() - started
        const slow = ms >= SLOW_REQUEST_MS
        recordHttpRequest(res.statusCode, ms, slow)
        if (res.statusCode >= 500 || slow) {
          log[res.statusCode >= 500 ? 'error' : 'warn'](slow ? 'slow request' : 'request failed', {
            requestId, method: req.method, path, status: res.statusCode, durationMs: Math.round(ms),
          })
        }
      })
    }

    return runWithRequestContext({ requestId, method: req.method, path }, async () => {
      try {
        // Handle SSE connections first (before Next.js)
        if (handleSSE(req, res)) return

        // Handle internal broadcast endpoint (before Next.js)
        const handled = await handleInternalBroadcast(req, res)
        if (handled) {
          return
        }

        // Let Next.js handle all other requests (central API wrapper: any error bubbling out is logged)
        await handle(req, res)
      } catch (err) {
        logError('api-route-handler', err, { path, requestId })
        log.error('unhandled error in request', { err, method: req.method, path })
        if (!res.headersSent) res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  })

  let shuttingDown = false

  // Initialize WebSocket server for our app (noServer mode)
  wsManager.init()

  // Get Next.js upgrade handler for HMR WebSocket
  const nextUpgradeHandler = typeof app.getUpgradeHandler === 'function'
    ? app.getUpgradeHandler()
    : null

  log.debug('Next.js upgrade handler available', { available: !!nextUpgradeHandler })

  // Handle ALL upgrade requests - route to appropriate handler
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)

    if (url.pathname === '/ws') {
      if (shuttingDown) {
        socket.destroy()
        return
      }
      // Route to our WebSocket server
      wsManager.handleUpgrade(req, socket as Socket, head)
    } else if (nextUpgradeHandler) {
      // Route to Next.js for HMR and other paths
      nextUpgradeHandler(req, socket, head)
    }
  })

  // Graceful shutdown: readiness → 503 (load balancer drains us), stop accepting connections,
  // close WS + end SSE streams, close idle keep-alive sockets, let in-flight requests finish,
  // then close the DB pool. SHUTDOWN_TIMEOUT_MS (default 25 s, below App Platform's 30 s kill)
  // bounds the whole thing.
  const shutdownTimeoutMs = (() => {
    const n = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '', 10)
    return Number.isFinite(n) && n > 0 ? n : 25000
  })()
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    setShuttingDown(true)
    log.info('shutting down', { signal })
    wsManager.shutdown()
    server.close(async () => {
      // Close database pools to release connections
      try {
        const { closeAllPools } = await import('./src/lib/db')
        await closeAllPools()
        log.info('database pool closed')
      } catch {
        // Pool module may not be loaded yet
      }
      log.info('server closed')
      process.exit(0)
    })
    // Keep-alive sockets without an in-flight request would otherwise hold server.close() open
    server.closeIdleConnections()
    // Force exit if graceful shutdown hangs
    setTimeout(() => {
      log.error('forced shutdown after timeout', { timeoutMs: shutdownTimeoutMs })
      server.closeAllConnections()
      process.exit(1)
    }, shutdownTimeoutMs).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // Slow or stalled clients cannot hold sockets: headers within 20 s, a whole request (incl. body)
  // within 120 s (imports / uploads), idle keep-alive just above a load balancer's 60 s.
  // WebSocket and SSE upgrades are long-lived by design and are not affected by requestTimeout.
  server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 20_000)
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120_000)
  server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 65_000)
  server.maxRequestsPerSocket = 1000

  server.listen(port, hostname, () => {
    log.info(`ready on http://${hostname}:${port} (WebSocket /ws, SSE /_events)`, { port, dev })
    if (dev) startDevWarmup(port)
  })
}).catch((err) => {
  log.error('failed to prepare Next.js app', { err })
  process.exit(1)
})
