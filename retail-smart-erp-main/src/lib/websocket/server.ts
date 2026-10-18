// WebSocket server implementation
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import jwt from 'jsonwebtoken'
import { logError } from '@/lib/ai/error-logger'
import {
  DataChangeEvent,
  PresenceEvent,
  ClientMessage,
  ServerMessage,
  EntityType,
} from './events'
import { canSubscribe, parseChannel, getDefaultTenantChannels, getAccountChannel } from './channels'
import { registerBroadcastProcessor, registerAccountBroadcastProcessor } from './broadcast'

// Connection limits to prevent resource exhaustion
const MAX_CONNECTIONS_PER_IP = 20
const MAX_CONNECTIONS_PER_TENANT = 100

interface AuthenticatedClient {
  ws: WebSocket
  userId: string
  userName: string
  tenantId?: string
  mode: 'tenant' | 'account'
  ip: string
  subscriptions: Set<string>
  isAlive: boolean
}

/** SSE client registered for server-sent events fallback */
interface SSEClient {
  id: string
  userId: string
  tenantId?: string
  mode: 'tenant' | 'account'
  write: (data: string) => boolean
}

class WebSocketManager {
  private wss: WebSocketServer | null = null
  private clients: Map<WebSocket, AuthenticatedClient> = new Map()
  private connectionsByIp: Map<string, number> = new Map()
  private connectionsByTenant: Map<string, number> = new Map()
  private sseClients: Map<string, SSEClient> = new Map()
  private sseIdCounter = 0
  private heartbeatInterval: NodeJS.Timeout | null = null
  private isShuttingDown = false

  /**
   * Initialize the WebSocket server (noServer mode for manual upgrade handling)
   */
  init() {
    console.log('[WebSocket] Initializing WebSocket server...')
    console.log('[WebSocket] NEXTAUTH_SECRET configured:', !!process.env.NEXTAUTH_SECRET)
    
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false, // Disable compression — conflicts with Cloudflare proxy
      maxPayload: 256 * 1024, // 256 KB max message size
    })

    this.wss.on('connection', this.handleConnection.bind(this))

    // Start heartbeat to detect dead connections and reconcile counters
    let heartbeatCycles = 0
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, ws) => {
        if (!client.isAlive) {
          this.removeClient(ws)
          ws.terminate()
          return
        }
        client.isAlive = false
        ws.ping()
      })

      // Every 10 cycles (~5 minutes), reconcile connection counters
      // to prevent drift from any edge-case miscount
      heartbeatCycles++
      if (heartbeatCycles >= 10) {
        heartbeatCycles = 0
        this.reconcileConnectionCounts()
      }
    }, 30000)

    // Register broadcast processor for tenant-scoped API routes
    registerBroadcastProcessor((msg) => {
      const event: DataChangeEvent = {
        type: msg.entityType,
        action: msg.action,
        tenantId: msg.tenantId,
        id: msg.id,
        data: msg.data,
        timestamp: Date.now(),
      }
      this.broadcastToTenant(msg.tenantId, msg.entityType, event)
    })

    // Register broadcast processor for account-level API routes
    registerAccountBroadcastProcessor((msg) => {
      const event: DataChangeEvent = {
        type: msg.entityType,
        action: msg.action,
        userId: msg.userId,
        id: msg.id,
        data: msg.data,
        timestamp: Date.now(),
      }
      this.broadcastToUser(msg.userId, event)
    })

    console.log('[WebSocket] Server initialized successfully')
  }

  /**
   * Authenticate and register a connected WebSocket client
   */
  private authenticateClient(ws: WebSocket, token: string, ip: string): boolean {
    const decoded = this.verifyToken(token)
    if (!decoded) {
      this.sendError(ws, 'Invalid token', 'INVALID_TOKEN')
      ws.close(4002, 'Invalid token')
      return false
    }

    // Check per-tenant connection limit (only for tenant-mode connections)
    if (decoded.mode === 'tenant' && decoded.tenantId) {
      const currentTenantCount = this.connectionsByTenant.get(decoded.tenantId) || 0
      if (currentTenantCount >= MAX_CONNECTIONS_PER_TENANT) {
        console.warn(`[WebSocket] Connection rejected: tenant ${decoded.tenantId} exceeded limit (${currentTenantCount}/${MAX_CONNECTIONS_PER_TENANT})`)
        this.sendError(ws, 'Too many connections for this tenant', 'TENANT_LIMIT_EXCEEDED')
        ws.close(4029, 'Too many connections')
        return false
      }
    }

    // Check if this is a re-authentication (client already exists)
    const existingClient = this.clients.get(ws)
    if (existingClient) {
      // Re-authentication: update context without creating a new entry
      // Decrement old tenant counter
      if (existingClient.tenantId) {
        const oldCount = (this.connectionsByTenant.get(existingClient.tenantId) || 1) - 1
        if (oldCount <= 0) this.connectionsByTenant.delete(existingClient.tenantId)
        else this.connectionsByTenant.set(existingClient.tenantId, oldCount)
      }

      // Update client context
      existingClient.userId = decoded.id
      existingClient.userName = decoded.name || 'Unknown'
      existingClient.tenantId = decoded.tenantId
      existingClient.mode = decoded.mode

      // Reset subscriptions
      existingClient.subscriptions.clear()

      // Subscribe to account channel (always)
      existingClient.subscriptions.add(getAccountChannel(decoded.id))

      // Subscribe to tenant channels if in tenant mode
      if (decoded.mode === 'tenant' && decoded.tenantId) {
        const defaultChannels = getDefaultTenantChannels(decoded.tenantId)
        defaultChannels.forEach((ch) => existingClient.subscriptions.add(ch))
        this.connectionsByTenant.set(decoded.tenantId, (this.connectionsByTenant.get(decoded.tenantId) || 0) + 1)
      }

      this.send(ws, {
        type: 'authenticated',
        tenantId: decoded.tenantId,
        userId: decoded.id,
        mode: decoded.mode,
      })

      console.log(`[WebSocket] Client re-authenticated: ${decoded.id} (mode: ${decoded.mode})`)
      return true
    }

    // Create new authenticated client
    const client: AuthenticatedClient = {
      ws,
      userId: decoded.id,
      userName: decoded.name || 'Unknown',
      tenantId: decoded.tenantId,
      mode: decoded.mode,
      ip,
      subscriptions: new Set(),
      isAlive: true,
    }

    this.clients.set(ws, client)

    // Increment connection counters
    this.connectionsByIp.set(ip, (this.connectionsByIp.get(ip) || 0) + 1)
    if (decoded.mode === 'tenant' && decoded.tenantId) {
      this.connectionsByTenant.set(decoded.tenantId, (this.connectionsByTenant.get(decoded.tenantId) || 0) + 1)
    }

    // Always subscribe to account channel
    client.subscriptions.add(getAccountChannel(decoded.id))

    // Auto-subscribe to default tenant channels if in tenant mode
    if (decoded.mode === 'tenant' && decoded.tenantId) {
      const defaultChannels = getDefaultTenantChannels(decoded.tenantId)
      defaultChannels.forEach((channel) => client.subscriptions.add(channel))
    }

    // Send authenticated confirmation
    this.send(ws, {
      type: 'authenticated',
      tenantId: decoded.tenantId,
      userId: decoded.id,
      mode: decoded.mode,
    })

    console.log(`[WebSocket] Client connected: ${decoded.id} (mode: ${decoded.mode}${decoded.tenantId ? `, tenant: ${decoded.tenantId}` : ''})`)
    return true
  }

  /**
   * Handle new WebSocket connection
   * Supports both URL query token (legacy) and message-based auth (preferred)
   */
  private async handleConnection(ws: WebSocket, req: IncomingMessage) {
    try {
      const ip = this.getClientIp(req)

      // Check for token in query string (backward compatibility)
      const url = new URL(req.url || '', `http://${req.headers.host}`)
      const token = url.searchParams.get('token')

      // Set up common event handlers
      ws.on('pong', () => {
        const c = this.clients.get(ws)
        if (c) c.isAlive = true
      })
      ws.on('close', () => this.handleDisconnect(ws))
      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err)
        this.removeClient(ws)
      })

      if (token) {
        // Legacy path: token in URL query string
        if (!this.authenticateClient(ws, token, ip)) return
        ws.on('message', (data) => this.handleMessage(ws, data))
      } else {
        // Preferred path: wait for authenticate message
        const authTimeout = setTimeout(() => {
          if (!this.clients.has(ws)) {
            this.sendError(ws, 'Authentication timeout', 'AUTH_TIMEOUT')
            ws.close(4001, 'Authentication timeout')
          }
        }, 10000) // 10 second timeout for auth message

        ws.on('message', (data) => {
          // If not yet authenticated, expect an authenticate message
          if (!this.clients.has(ws)) {
            try {
              const message = JSON.parse(data.toString())
              if (message.type === 'authenticate' && message.token) {
                clearTimeout(authTimeout)
                if (this.authenticateClient(ws, message.token, ip)) {
                  // Now set up normal message handling
                  ws.removeAllListeners('message')
                  ws.on('message', (d) => this.handleMessage(ws, d))
                }
              } else {
                this.sendError(ws, 'Authentication required', 'AUTH_REQUIRED')
                ws.close(4001, 'Authentication required')
                clearTimeout(authTimeout)
              }
            } catch {
              this.sendError(ws, 'Invalid message', 'INVALID_MESSAGE')
              ws.close(4001, 'Invalid message')
              clearTimeout(authTimeout)
            }
          } else {
            this.handleMessage(ws, data)
          }
        })
      }
    } catch (error) {
      console.error('[WebSocket] Connection error:', error)
      logError('websocket-server', error, {
        errorSource: 'system' as const,
        path: req.url || 'unknown',
        params: {
          method: 'WS_CONNECT',
          clientInfo: `${req.headers['user-agent'] || 'unknown'}`
        }
      })
      ws.close(4000, 'Connection error')
    }
  }

  /**
   * Verify JWT token
   */
  private verifyToken(token: string): {
    id: string
    name: string
    tenantId?: string
    tenantSlug: string
    role: string
    mode: 'tenant' | 'account'
  } | null {
    try {
      const secret = process.env.NEXTAUTH_SECRET
      if (!secret) {
        console.error('[WebSocket] NEXTAUTH_SECRET not set')
        logError('websocket-server', new Error('NEXTAUTH_SECRET not configured for WebSocket authentication'), {
          errorSource: 'system' as const,
          path: 'verifyToken'
        })
        return null
      }

      const decoded = jwt.verify(token, secret) as {
        id?: string
        sub?: string
        name?: string
        tenantId?: string
        tenantSlug?: string
        role?: string
        mode?: 'tenant' | 'account'
        accountId?: string
      }

      // Support both 'id' and 'sub' for user identification
      const userId = decoded.id || decoded.sub
      if (!userId) {
        return null
      }

      const mode = decoded.mode || (decoded.tenantId ? 'tenant' : 'account')

      // Tenant mode requires tenantId
      if (mode === 'tenant' && !decoded.tenantId) {
        return null
      }

      return {
        id: userId,
        name: decoded.name || 'Unknown',
        tenantId: decoded.tenantId,
        tenantSlug: decoded.tenantSlug || '',
        role: decoded.role || 'user',
        mode,
      }
    } catch (error) {
      const err = error as Error & { name?: string }
      if (err?.name === 'TokenExpiredError') {
        console.warn('[WebSocket] Token expired')
      } else {
        console.error('[WebSocket] Token verification failed:', err?.message || error)
        logError('websocket-server', error, {
          errorSource: 'system' as const,
          path: 'verifyToken',
          params: {
            errorType: err?.name || 'unknown',
            message: err?.message || String(error)
          }
        })
      }
      return null
    }
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(ws: WebSocket, data: Buffer | ArrayBuffer | Buffer[]) {
    const client = this.clients.get(ws)
    if (!client) return

    try {
      const message = JSON.parse(data.toString()) as ClientMessage

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message.channels)
          break

        case 'unsubscribe':
          this.handleUnsubscribe(client, message.channels)
          break

        case 'ping':
          this.send(ws, { type: 'pong' })
          break

        case 'authenticate':
          // Re-authentication: update context (e.g. account → tenant mode switch)
          this.authenticateClient(ws, message.token, client.ip)
          break

        default:
          this.sendError(ws, 'Unknown message type', 'UNKNOWN_MESSAGE')
      }
    } catch {
      this.sendError(ws, 'Invalid message format', 'INVALID_MESSAGE')
    }
  }

  /**
   * Handle subscribe request
   */
  private handleSubscribe(client: AuthenticatedClient, channels: string[]) {
    for (const channel of channels) {
      const parsed = parseChannel(channel)

      // For resource channels (work-order, estimate, staff-chat), use the
      // client's own tenantId as resourceTenantId. The client can only know
      // resource UUIDs they discovered through their own tenant's API, and
      // broadcasts are scoped by the API layer. This prevents cross-tenant
      // subscription while avoiding async DB lookups in the WS hot path.
      let resourceTenantId: string | undefined
      if (parsed.type === 'work-order' || parsed.type === 'estimate' || parsed.type === 'staff-chat') {
        resourceTenantId = client.tenantId
      }

      // Validate subscription permission
      if (!canSubscribe(channel, client.tenantId || '', client.userId, resourceTenantId)) {
        this.sendError(client.ws, `Cannot subscribe to channel: ${channel}`, 'FORBIDDEN')
        continue
      }
      client.subscriptions.add(channel)
    }
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(client: AuthenticatedClient, channels: string[]) {
    for (const channel of channels) {
      client.subscriptions.delete(channel)
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(ws: WebSocket) {
    const client = this.clients.get(ws)
    if (client) {
      this.removeClient(ws)
    }
  }

  /**
   * Remove client from tracking and decrement connection counters
   */
  private removeClient(ws: WebSocket) {
    const client = this.clients.get(ws)
    if (client) {
      // Decrement IP counter
      const ipCount = (this.connectionsByIp.get(client.ip) || 1) - 1
      if (ipCount <= 0) {
        this.connectionsByIp.delete(client.ip)
      } else {
        this.connectionsByIp.set(client.ip, ipCount)
      }

      // Decrement tenant counter (only for tenant-mode connections)
      if (client.tenantId) {
        const tenantCount = (this.connectionsByTenant.get(client.tenantId) || 1) - 1
        if (tenantCount <= 0) {
          this.connectionsByTenant.delete(client.tenantId)
        } else {
          this.connectionsByTenant.set(client.tenantId, tenantCount)
        }
      }
    }
    this.clients.delete(ws)
  }

  /**
   * Reconcile connection count maps with actual connected clients.
   * Prevents counter drift from edge cases (e.g., error paths that skip removeClient).
   */
  private reconcileConnectionCounts() {
    const actualIpCounts = new Map<string, number>()
    const actualTenantCounts = new Map<string, number>()

    this.clients.forEach((client) => {
      actualIpCounts.set(client.ip, (actualIpCounts.get(client.ip) || 0) + 1)
      if (client.tenantId) {
        actualTenantCounts.set(client.tenantId, (actualTenantCounts.get(client.tenantId) || 0) + 1)
      }
    })

    this.connectionsByIp = actualIpCounts
    this.connectionsByTenant = actualTenantCounts
  }

  /**
   * Send message to a specific WebSocket
   */
  private send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: WebSocket, message: string, code?: string) {
    this.send(ws, { type: 'error', message, code })
  }

  /**
   * Broadcast message to all clients subscribed to a channel
   */
  broadcast(channel: string, message: ServerMessage) {
    this.clients.forEach((client) => {
      if (client.subscriptions.has(channel)) {
        this.send(client.ws, message)
      }
    })
  }

  /**
   * Broadcast to a specific tenant — sends to ALL connected clients of that tenant.
   * Client-side filtering (useRealtimeData) handles entity-type matching.
   */
  broadcastToTenant(tenantId: string, _entityType: EntityType, message: DataChangeEvent) {
    // WebSocket clients
    this.clients.forEach((client) => {
      if (client.tenantId === tenantId) {
        this.send(client.ws, message)
      }
    })
    // SSE clients
    this.sendSSEToTenant(tenantId, message)
  }

  /**
   * Broadcast to a specific user — sends to ALL connected clients of that user.
   * Used for account-level events (notifications, wallet, subscriptions).
   */
  broadcastToUser(userId: string, message: DataChangeEvent) {
    // WebSocket clients
    this.clients.forEach((client) => {
      if (client.userId === userId) {
        this.send(client.ws, message)
      }
    })
    // SSE clients
    this.sendSSEToUser(userId, message)
  }

  // ==================== SSE Client Management ====================

  /**
   * Register an SSE client. Returns client ID on success, null on auth failure.
   */
  addSSEClient(token: string, writeFn: (data: string) => boolean): string | null {
    const decoded = this.verifyToken(token)
    if (!decoded) return null

    const id = `sse-${++this.sseIdCounter}`
    this.sseClients.set(id, {
      id,
      userId: decoded.id,
      tenantId: decoded.tenantId,
      mode: decoded.mode,
      write: writeFn,
    })

    console.log(`[SSE] Client connected: ${decoded.id} (mode: ${decoded.mode}${decoded.tenantId ? `, tenant: ${decoded.tenantId}` : ''})`)
    return id
  }

  /**
   * Remove an SSE client by ID.
   */
  removeSSEClient(id: string): void {
    this.sseClients.delete(id)
  }

  /** Send data to SSE clients for a specific tenant */
  private sendSSEToTenant(tenantId: string, message: ServerMessage): void {
    const json = JSON.stringify(message)
    this.sseClients.forEach((client, id) => {
      if (client.tenantId === tenantId) {
        if (!client.write(`data: ${json}\n\n`)) {
          this.sseClients.delete(id)
        }
      }
    })
  }

  /** Send data to SSE clients for a specific user */
  private sendSSEToUser(userId: string, message: ServerMessage): void {
    const json = JSON.stringify(message)
    this.sseClients.forEach((client, id) => {
      if (client.userId === userId) {
        if (!client.write(`data: ${json}\n\n`)) {
          this.sseClients.delete(id)
        }
      }
    })
  }

  /**
   * Send presence update for collaborative editing
   */
  sendPresence(resource: string, event: PresenceEvent) {
    this.broadcast(resource, event)
  }

  /**
   * Extract client IP address from request, checking proxy headers first
   */
  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) {
      // x-forwarded-for can be a comma-separated list; first entry is the original client
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0]
      return first.trim()
    }
    return req.socket.remoteAddress || 'unknown'
  }

  /**
   * Handle WebSocket upgrade request (for noServer mode).
   * Enforces per-IP connection limits before upgrading.
   */
  handleUpgrade(req: IncomingMessage, socket: import('net').Socket, head: Buffer) {
    if (!this.wss) return

    const ip = this.getClientIp(req)
    const currentIpCount = this.connectionsByIp.get(ip) || 0

    if (currentIpCount >= MAX_CONNECTIONS_PER_IP) {
      console.warn(`[WebSocket] Connection rejected: IP ${ip} exceeded limit (${currentIpCount}/${MAX_CONNECTIONS_PER_IP})`)
      // Complete the WebSocket handshake then immediately close with a custom
      // close code.  Writing raw HTTP (e.g. 429) on the socket can confuse
      // reverse proxies (Railway/Cloudflare) and corrupt the stream.
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(4029, 'Too many connections')
      })
      return
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req)
    })
  }

  /**
   * Gracefully shutdown the WebSocket server
   */
  shutdown() {
    this.isShuttingDown = true

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    this.clients.forEach((client, ws) => {
      ws.close(1001, 'Server shutting down')
    })
    this.clients.clear()
    this.connectionsByIp.clear()
    this.connectionsByTenant.clear()
    this.sseClients.clear()

    if (this.wss) {
      this.wss.close()
    }

    console.log('[WebSocket] Server shutdown complete')
  }

  /**
   * Get connected client count (WebSocket + SSE)
   */
  getClientCount(): number {
    return this.clients.size + this.sseClients.size
  }

  /**
   * Get clients for a specific tenant
   */
  getTenantClients(tenantId: string): AuthenticatedClient[] {
    const result: AuthenticatedClient[] = []
    this.clients.forEach((client) => {
      if (client.tenantId === tenantId) {
        result.push(client)
      }
    })
    return result
  }
}

// Singleton instance
export const wsManager = new WebSocketManager()

// Helper function to notify from API routes
export function notifyDataChange(
  tenantId: string,
  entityType: EntityType,
  action: 'created' | 'updated' | 'deleted',
  id: string,
  data?: Record<string, unknown>
) {
  const event: DataChangeEvent = {
    type: entityType,
    action,
    tenantId,
    id,
    data,
    timestamp: Date.now(),
  }
  wsManager.broadcastToTenant(tenantId, entityType, event)
}
