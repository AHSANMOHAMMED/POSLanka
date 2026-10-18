// Custom Next.js server with WebSocket support
// Must run before any other Next code so globalThis.AsyncLocalStorage is set
import 'next/dist/server/node-environment'
import 'dotenv/config'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { Socket } from 'net'
import next from 'next'
import { wsManager } from './src/lib/websocket/server'
import type { EntityType } from './src/lib/websocket/events'
import { logError } from './src/lib/ai/error-logger'

// Validate and set default environment variables for Railway
if (!process.env.NEXTAUTH_URL && process.env.RAILWAY_PUBLIC_URL) {
  process.env.NEXTAUTH_URL = process.env.RAILWAY_PUBLIC_URL
  console.log('[Server] Set NEXTAUTH_URL from RAILWAY_PUBLIC_URL:', process.env.NEXTAUTH_URL)
}

if (!process.env.NEXTAUTH_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[Server] FATAL: NEXTAUTH_SECRET is required in production')
    process.exit(1)
  }
  // Generate a stable dev-only secret (not secure for production!)
  console.warn('[Server] WARNING: NEXTAUTH_SECRET is not set. Using a dev-only secret.')
  process.env.NEXTAUTH_SECRET = 'dev-only-secret-do-not-use-in-production'
}

if (!process.env.DATABASE_URL) {
  console.error('[Server] ERROR: DATABASE_URL is required')
  process.exit(1)
}

// Global Node handlers: log uncaught errors to AI error logger, then exit (uncaughtException) or continue (unhandledRejection)
process.on('uncaughtException', (err: Error) => {
  logError('uncaughtException', err)
  console.error('[Server] Uncaught exception:', err)
  setTimeout(() => process.exit(1), 2000)
})
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  logError('unhandledRejection', err)
  console.error('[Server] Unhandled rejection:', err)
})

const dev = process.env.NODE_ENV !== 'production'
// Use 0.0.0.0 to listen on all interfaces (localhost + network)
// Avoid using HOSTNAME env var on Windows as it resolves to computer name
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
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
    console.error('[Server] Error handling internal broadcast:', err)
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

  if (req.method === 'OPTIONS') {
    // CORS preflight for SSE
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
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

  const clientId = wsManager.addSSEClient(token, writeFn)
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
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
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
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
      const url = req.url ? new URL(req.url, `http://${req.headers.host}`).pathname : undefined
      logError('api-route-handler', err, { path: url })
      console.error('Error handling request:', err)
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  })

  // Initialize WebSocket server for our app (noServer mode)
  wsManager.init()

  // Get Next.js upgrade handler for HMR WebSocket
  const nextUpgradeHandler = typeof app.getUpgradeHandler === 'function'
    ? app.getUpgradeHandler()
    : null

  console.log('[Server] Next.js upgrade handler available:', !!nextUpgradeHandler)

  // Handle ALL upgrade requests - route to appropriate handler
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)

    if (url.pathname === '/ws') {
      // Route to our WebSocket server
      wsManager.handleUpgrade(req, socket as Socket, head)
    } else if (nextUpgradeHandler) {
      // Route to Next.js for HMR and other paths
      nextUpgradeHandler(req, socket, head)
    }
  })

  // Graceful shutdown — close WS, HTTP, and DB pools
  const shutdown = () => {
    console.log('\nShutting down server...')
    wsManager.shutdown()
    server.close(async () => {
      // Close database pools to release connections
      try {
        const { closeAllPools } = await import('./src/lib/db')
        await closeAllPools()
        console.log('Database pools closed')
      } catch {
        // Pool module may not be loaded yet
      }
      console.log('Server closed')
      process.exit(0)
    })
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      console.error('Forced shutdown after timeout')
      process.exit(1)
    }, 10000).unref()
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server running on ws://${hostname}:${port}/ws`)
  })
}).catch((err) => {
  console.error('Failed to prepare Next.js app:', err)
  process.exit(1)
})
