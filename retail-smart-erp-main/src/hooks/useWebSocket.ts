'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  WebSocketClient,
  ConnectionStatus,
  TransportType,
  DataChangeHandler,
  PresenceHandler,
} from '@/lib/websocket/client'
import type { EntityType } from '@/lib/websocket/events'
import { getWorkOrderChannel, getEstimateChannel } from '@/lib/websocket/channels'

// Singleton WebSocket client instance (exported for direct access from useRealtimeData)
export let wsClient: WebSocketClient | null = null

// Module-level initialization guard - shared across all hook instances
let initPromise: Promise<void> | null = null

/**
 * Initialize the singleton WebSocket client (called once, shared by all hooks).
 * Uses a single shared promise to deduplicate concurrent callers.
 */
async function ensureConnected(): Promise<void> {
  // Already connected - nothing to do
  if (wsClient?.isConnected()) return

  // Another caller is already initializing - wait for the same promise
  if (initPromise) {
    await initPromise
    return
  }

  // Create a single promise that all concurrent callers share.
  // Only clear it AFTER the promise settles (not in finally, which clears too early).
  const promise = (async () => {
    try {
      const res = await fetch('/api/auth/ws-token')
      if (!res.ok) {
        // 401 = not logged in — expected, don't log
        if (res.status !== 401) {
          console.error('[useWebSocket] Failed to get WebSocket token:', res.status)
        }
        return
      }

      const data = await res.json()
      const { token } = data
      if (!token) {
        console.error('[useWebSocket] No token received')
        return
      }

      if (!wsClient) {
        wsClient = new WebSocketClient({
          token,
          maxReconnectAttempts: 10,
          tokenRefresher: async () => {
            try {
              const r = await fetch('/api/auth/ws-token')
              if (!r.ok) return null
              const d = await r.json()
              return d.token || null
            } catch {
              return null
            }
          },
        })
      }

      if (!wsClient.isConnected()) {
        wsClient.connect()
      }
    } catch (error) {
      console.error('[useWebSocket] Connection error:', error)
    }
  })()

  initPromise = promise
  await promise
  // Clear after settling so new callers can retry if connection failed
  initPromise = null
}

/**
 * Hook to access the WebSocket connection
 * Returns connection status and control methods
 */
export function useWebSocket() {
  const { data: sessionData, status: sessionStatus } = useSession()
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const clientRef = useRef<WebSocketClient | null>(null)
  const lastTenantIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (sessionStatus === 'loading') return

    if (sessionStatus !== 'authenticated') {
      setConnectionStatus('disconnected')
      return
    }

    // If client already exists, just subscribe to status changes
    if (wsClient) {
      clientRef.current = wsClient
      setConnectionStatus(wsClient.getStatus())
      const unsubscribe = wsClient.onStatusChange(setConnectionStatus)
      // Ensure connected (no-op if already connected, deduped if already in progress)
      ensureConnected()
      return () => { unsubscribe() }
    }

    // First hook to run - initialize the connection
    let cancelled = false
    ensureConnected().then(() => {
      if (cancelled || !wsClient) return
      clientRef.current = wsClient
      setConnectionStatus(wsClient.getStatus())
    })

    // Subscribe to status changes once client exists (poll briefly, max 15s)
    let unsubscribe: (() => void) | undefined
    let pollCount = 0
    const maxPolls = 75 // 75 × 200ms = 15 seconds
    const checkInterval = setInterval(() => {
      pollCount++
      if (wsClient && !unsubscribe) {
        clientRef.current = wsClient
        setConnectionStatus(wsClient.getStatus())
        unsubscribe = wsClient.onStatusChange(setConnectionStatus)
        clearInterval(checkInterval)
      } else if (pollCount >= maxPolls) {
        clearInterval(checkInterval)
      }
    }, 200)

    return () => {
      cancelled = true
      clearInterval(checkInterval)
      unsubscribe?.()
    }
  }, [sessionStatus])

  // Re-authenticate when tenant context changes (e.g., account page → tenant page)
  useEffect(() => {
    const currentTenantId = sessionData?.user?.tenantId
    if (lastTenantIdRef.current === undefined) {
      // First render — just store the value, don't re-auth
      lastTenantIdRef.current = currentTenantId || ''
      return
    }

    const prevTenantId = lastTenantIdRef.current
    lastTenantIdRef.current = currentTenantId || ''

    // If tenant context changed and we're connected, re-authenticate
    if (prevTenantId !== (currentTenantId || '') && wsClient?.isConnected()) {
      fetch('/api/auth/ws-token')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.token && wsClient) {
            // Update token and re-auth via the public method (works for both WS and SSE)
            wsClient.updateToken(data.token)
          }
        })
        .catch(() => { /* silent — re-auth is best-effort */ })
    }
  }, [sessionData?.user?.tenantId])

  const subscribe = useCallback((channels: string[]) => {
    clientRef.current?.subscribe(channels)
  }, [])

  const unsubscribe = useCallback((channels: string[]) => {
    clientRef.current?.unsubscribe(channels)
  }, [])

  return {
    status: connectionStatus,
    isConnected: connectionStatus === 'connected',
    transport: (wsClient?.getTransport() || 'polling') as TransportType,
    subscribe,
    unsubscribe,
  }
}

/**
 * Hook to subscribe to data changes for a specific entity type
 */
export function useDataChange(
  entityType: EntityType | '*',
  handler: DataChangeHandler,
  deps: React.DependencyList = []
) {
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler })

  // Track connection status so handler is re-registered when client connects
  const { isConnected } = useWebSocket()

  useEffect(() => {
    if (!wsClient || !isConnected) return

    const wrappedHandler: DataChangeHandler = (event) => {
      handlerRef.current(event)
    }

    return wsClient.onDataChange(entityType, wrappedHandler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, isConnected, ...deps])
}

/**
 * Hook to subscribe to presence updates for a specific resource
 */
export function usePresence(
  resourceType: 'work-order' | 'estimate',
  resourceId: string | null,
  handler: PresenceHandler
) {
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler })

  // Track connection status so subscription is re-established when client connects
  const { isConnected } = useWebSocket()

  useEffect(() => {
    if (!wsClient || !isConnected || !resourceId) return

    const channel =
      resourceType === 'work-order'
        ? getWorkOrderChannel(resourceId)
        : getEstimateChannel(resourceId)

    // Subscribe to the specific resource channel
    wsClient.subscribe([channel])

    const wrappedHandler: PresenceHandler = (event) => {
      handlerRef.current(event)
    }

    const unsubscribe = wsClient.onPresence(channel, wrappedHandler)

    return () => {
      unsubscribe()
      wsClient?.unsubscribe([channel])
    }
  }, [resourceType, resourceId, isConnected])
}

/**
 * Disconnect WebSocket (call on logout)
 */
export function disconnectWebSocket() {
  if (wsClient) {
    wsClient.disconnect()
    wsClient = null
  }
}
