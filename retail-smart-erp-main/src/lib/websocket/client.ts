// WebSocket client utilities (browser-side)
// Note: logError cannot be used in client components due to server-side imports
// import { logError } from '@/lib/ai/error-logger'
import type {
  ClientMessage,
  ServerMessage,
  DataChangeEvent,
  PresenceEvent,
  EntityType,
} from './events'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
export type TransportType = 'websocket' | 'sse' | 'polling'

export type MessageHandler = (message: ServerMessage) => void
export type DataChangeHandler = (event: DataChangeEvent) => void
export type PresenceHandler = (event: PresenceEvent) => void
export type StatusChangeHandler = (status: ConnectionStatus) => void

interface WebSocketClientOptions {
  /** Token for authentication */
  token: string
  /** URL to connect to (default: auto-detect from window.location) */
  url?: string
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Reconnect interval in ms (default: 3000) */
  reconnectInterval?: number
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number
  /** Ping interval in ms (default: 25000) */
  pingInterval?: number
  /** Optional callback to refresh the token before reconnect */
  tokenRefresher?: () => Promise<string | null>
}

class WebSocketClient {
  private ws: WebSocket | null = null
  private eventSource: EventSource | null = null
  private options: Required<WebSocketClientOptions>
  private status: ConnectionStatus = 'disconnected'
  private transport: TransportType = 'polling'
  private reconnectAttempts = 0
  private consecutiveQuickFailures = 0
  private lastConnectTime = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private pingTimeout: ReturnType<typeof setTimeout> | null = null
  private stableTimeout: ReturnType<typeof setTimeout> | null = null
  private subscriptions: Set<string> = new Set()

  // Event handlers
  private messageHandlers: Set<MessageHandler> = new Set()
  private dataChangeHandlers: Map<EntityType | '*', Set<DataChangeHandler>> = new Map()
  private presenceHandlers: Map<string, Set<PresenceHandler>> = new Map()
  private statusChangeHandlers: Set<StatusChangeHandler> = new Set()

  constructor(options: WebSocketClientOptions) {
    this.options = {
      url: this.getDefaultUrl(),
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      pingInterval: 25000,
      tokenRefresher: undefined as unknown as () => Promise<string | null>,
      ...options,
    }
  }

  private getDefaultUrl(): string {
    if (typeof window === 'undefined') return ''
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }

  private getSSEUrl(): string {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/_events`
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    // Prevent multiple parallel connect() calls
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return
    }

    // Clean up any previous socket in CLOSING state
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws = null
    }

    this.setStatus('connecting')
    this.lastConnectTime = Date.now()

    // Connect without token in URL to prevent token leakage in logs/history
    this.ws = new WebSocket(this.options.url)

    this.ws.onopen = () => {
      // Don't reset reconnectAttempts here — wait until 'authenticated' message
      // to prevent infinite attempt-1 loops when server rejects the token

      // Send token via message instead of URL query string
      this.send({ type: 'authenticate', token: this.options.token })

      // Resubscribe to channels after reconnect
      if (this.subscriptions.size > 0) {
        this.send({ type: 'subscribe', channels: Array.from(this.subscriptions) })
      }
    }

    this.ws.onclose = (event) => {
      this.stopPing()
      if (this.stableTimeout) { clearTimeout(this.stableTimeout); this.stableTimeout = null }
      this.setStatus('disconnected')

      const connectionDuration = Date.now() - this.lastConnectTime

      // Track connections that fail very quickly (< 5 seconds)
      // This detects infrastructure issues (e.g., proxy not supporting WebSocket)
      if (connectionDuration < 5000) {
        this.consecutiveQuickFailures++
      } else {
        this.consecutiveQuickFailures = 0
      }

      // Log close details for diagnostics (suppress after repeated quick failures)
      if (event.code !== 1000 && this.consecutiveQuickFailures <= 3) {
        console.warn(`[WebSocket] Closed: code=${event.code} reason="${event.reason || 'none'}"`)
      }

      // If connections keep failing instantly, try SSE fallback instead of polling
      if (this.consecutiveQuickFailures >= 3) {
        if (this.consecutiveQuickFailures === 3) {
          console.log('[Realtime] WebSocket unstable — trying SSE fallback')
        }
        this.options.autoReconnect = false
        this.connectSSE()
        return
      }

      // Don't reconnect on auth failures — trigger token refresh instead
      if (event.code === 4002) {
        console.warn('[WebSocket] Authentication failed — will refresh token before reconnecting')
      }

      if (this.options.autoReconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
        this.scheduleReconnect()
      }
      // If max attempts exhausted, status stays 'disconnected' — polling fallback takes over
    }

    this.ws.onerror = () => {
      // Only log errors if we haven't already detected persistent failures
      if (this.consecutiveQuickFailures < 3) {
        console.warn('[WebSocket] Connection error (attempt %d)', this.reconnectAttempts + 1)
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage
        this.handleMessage(message)
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error)
      }
    }
  }

  /**
   * Connect via SSE (Server-Sent Events) fallback
   */
  connectSSE(): void {
    if (this.eventSource) return
    if (typeof EventSource === 'undefined') return

    this.setStatus('connecting')
    const url = `${this.getSSEUrl()}?token=${encodeURIComponent(this.options.token)}`
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      this.transport = 'sse'
      this.setStatus('connected')
      console.log('[Realtime] SSE connected')
    }

    this.eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage
        // Skip the initial connection event
        if ('clientId' in message) return
        this.handleMessage(message)
      } catch {
        // Ignore parse errors
      }
    }

    this.eventSource.onerror = () => {
      // EventSource auto-reconnects, but if it keeps failing, give up
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        console.log('[Realtime] SSE connection failed — using polling fallback')
        this.disconnectSSE()
        this.transport = 'polling'
        this.setStatus('disconnected')
      }
    }
  }

  /**
   * Close SSE connection
   */
  private disconnectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  /**
   * Disconnect from WebSocket server and SSE
   */
  disconnect(): void {
    this.options.autoReconnect = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.stopPing()
    if (this.stableTimeout) { clearTimeout(this.stableTimeout); this.stableTimeout = null }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }

    this.disconnectSSE()
    this.transport = 'polling'
    this.setStatus('disconnected')
  }

  /**
   * Subscribe to channels
   */
  subscribe(channels: string[]): void {
    channels.forEach((channel) => this.subscriptions.add(channel))

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channels })
    }
  }

  /**
   * Unsubscribe from channels
   */
  unsubscribe(channels: string[]): void {
    channels.forEach((channel) => this.subscriptions.delete(channel))

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channels })
    }
  }

  /**
   * Add a general message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  /**
   * Add a data change handler for specific entity type (or '*' for all)
   */
  onDataChange(entityType: EntityType | '*', handler: DataChangeHandler): () => void {
    if (!this.dataChangeHandlers.has(entityType)) {
      this.dataChangeHandlers.set(entityType, new Set())
    }
    this.dataChangeHandlers.get(entityType)!.add(handler)
    return () => this.dataChangeHandlers.get(entityType)?.delete(handler)
  }

  /**
   * Add a presence handler for a resource
   */
  onPresence(resource: string, handler: PresenceHandler): () => void {
    if (!this.presenceHandlers.has(resource)) {
      this.presenceHandlers.set(resource, new Set())
    }
    this.presenceHandlers.get(resource)!.add(handler)
    return () => this.presenceHandlers.get(resource)?.delete(handler)
  }

  /**
   * Add a connection status handler
   */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusChangeHandlers.add(handler)
    return () => this.statusChangeHandlers.delete(handler)
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status
  }

  /**
   * Get current transport type
   */
  getTransport(): TransportType {
    return this.transport
  }

  /**
   * Check if connected (via WebSocket or SSE)
   */
  isConnected(): boolean {
    if (this.status !== 'connected') return false
    if (this.transport === 'sse' && this.eventSource?.readyState === EventSource.OPEN) return true
    if (this.ws?.readyState === WebSocket.OPEN) return true
    return false
  }

  /**
   * Reset reconnect attempts counter (e.g. when polling detects server is healthy)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0
  }

  /**
   * Update the token (e.g., after re-authentication)
   */
  updateToken(token: string): void {
    this.options.token = token
    // If SSE is active, reconnect with new token
    if (this.eventSource) {
      this.disconnectSSE()
      this.connectSSE()
    }
  }

  private handleMessage(message: ServerMessage): void {
    // Notify all general handlers
    this.messageHandlers.forEach((handler) => handler(message))

    // Handle specific message types
    switch (message.type) {
      case 'pong':
        // Heartbeat response, nothing to do
        break

      case 'error':
        console.error('[WebSocket] Server error:', message.message, message.code)
        break

      case 'authenticated':
        // Connection authenticated — now fully connected
        this.reconnectAttempts = 0
        this.transport = 'websocket'
        this.setStatus('connected')
        this.startPing()
        // Only clear quick-failure counter after connection stays alive > 5s
        // (Railway proxy drops connections after ~1-2s even after auth succeeds)
        if (this.stableTimeout) clearTimeout(this.stableTimeout)
        this.stableTimeout = setTimeout(() => {
          this.consecutiveQuickFailures = 0
        }, 5000)
        break

      case 'presence':
        // Notify presence handlers
        const presenceHandlers = this.presenceHandlers.get(message.resource)
        if (presenceHandlers) {
          presenceHandlers.forEach((handler) => handler(message))
        }
        break

      default:
        // Data change event — check for both tenant-scoped and user-scoped events
        if ('action' in message && ('tenantId' in message || 'userId' in message)) {
          const dataEvent = message as DataChangeEvent

          // Notify specific handlers
          const specificHandlers = this.dataChangeHandlers.get(dataEvent.type)
          if (specificHandlers) {
            specificHandlers.forEach((handler) => handler(dataEvent))
          }

          // Notify wildcard handlers
          const wildcardHandlers = this.dataChangeHandlers.get('*')
          if (wildcardHandlers) {
            wildcardHandlers.forEach((handler) => handler(dataEvent))
          }
        }
    }
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status
      this.statusChangeHandlers.forEach((handler) => handler(status))
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return

    this.reconnectAttempts++
    this.setStatus('reconnecting')

    // Exponential backoff with jitter
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000
    ) + Math.random() * 1000

    if (this.reconnectAttempts <= 3) {
      console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`)
    }

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null
      // Refresh token before reconnecting if a refresher is provided
      if (this.options.tokenRefresher) {
        try {
          const newToken = await this.options.tokenRefresher()
          if (newToken) {
            this.options.token = newToken
          } else {
            // No token available (e.g. logged out) — stop reconnecting
            this.setStatus('disconnected')
            return
          }
        } catch {
          // Token refresh failed — try connecting with existing token
        }
      }
      this.connect()
    }, delay)
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimeout = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' })
      }
    }, this.options.pingInterval)
  }

  private stopPing(): void {
    if (this.pingTimeout) {
      clearInterval(this.pingTimeout)
      this.pingTimeout = null
    }
  }
}

export { WebSocketClient }
export type { WebSocketClientOptions }
