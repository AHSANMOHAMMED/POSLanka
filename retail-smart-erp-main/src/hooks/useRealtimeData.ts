'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useWebSocket, wsClient } from './useWebSocket'
import type { EntityType, DataChangeEvent } from '@/lib/websocket/events'

interface UseRealtimeDataOptions {
  /** Entity type to listen for (e.g., 'item', 'work-order') */
  entityType: EntityType | EntityType[]
  /** Whether realtime updates are enabled (default: true) */
  enabled?: boolean
  /** Specific IDs to filter events for (optional, receives all if not specified) */
  filterIds?: string[]
  /** Whether to refresh on initial mount (default: true) */
  refreshOnMount?: boolean
  /** Polling interval in ms when WebSocket is disconnected (default: 15000, set 0 to disable) */
  pollingInterval?: number
}

/**
 * Hook for real-time data updates using WebSocket
 *
 * This hook provides real-time updates when WebSocket is connected.
 * Data is refreshed automatically when relevant WebSocket events are received.
 *
 * @param fetchFn - Function to fetch/refresh data
 * @param options - Configuration options
 *
 * @example
 * const { refresh, isRealtime } = useRealtimeData(
 *   fetchItems,
 *   { entityType: 'item' }
 * )
 */
export function useRealtimeData(
  fetchFn: () => void | Promise<void>,
  options: UseRealtimeDataOptions
) {
  const {
    entityType,
    enabled = true,
    filterIds,
    refreshOnMount = true,
    pollingInterval,
  } = options

  const { isConnected } = useWebSocket()
  const fetchFnRef = useRef(fetchFn)
  useEffect(() => { fetchFnRef.current = fetchFn })

  // Track if we're using realtime or polling
  const [isRealtime, setIsRealtime] = useState(false)

  // Initial fetch on mount
  useEffect(() => {
    if (refreshOnMount && enabled) {
      fetchFnRef.current()
    }
  }, [refreshOnMount, enabled])

  // Update realtime status based on connection
  useEffect(() => {
    setIsRealtime(enabled && isConnected)
  }, [enabled, isConnected])

  // Subscribe to data changes directly using useEffect (avoids rules-of-hooks violation)
  const entityTypes = Array.isArray(entityType) ? entityType : [entityType]
  const entityTypesKey = entityTypes.join(',')

  // Debounce timer for coalescing rapid-fire events (e.g., saving multiple items)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || !isConnected || !wsClient) return

    const handleDataChange = (event: DataChangeEvent) => {
      // Check if event type matches any of our entity types
      if (!entityTypes.includes(event.type)) return

      // If filter IDs are specified, only refresh for matching IDs
      if (filterIds && filterIds.length > 0) {
        if (!filterIds.includes(event.id)) {
          return
        }
      }

      // Debounce: coalesce rapid-fire events into a single refresh
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        fetchFnRef.current()
      }, 300)
    }

    // Subscribe to all events and filter in the handler
    const unsubscribe = wsClient.onDataChange('*', handleDataChange)

    return () => {
      unsubscribe()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityTypesKey, enabled, isConnected, filterIds])

  // Polling fallback when WebSocket is disconnected
  useEffect(() => {
    if (!enabled || isConnected) return

    const interval = pollingInterval ?? 15000
    if (interval <= 0) return

    // Stagger initial poll to avoid thundering herd
    const initialDelay = Math.random() * 3000
    let timer: ReturnType<typeof setTimeout> | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null
    let visible = !document.hidden

    const poll = () => {
      if (visible) fetchFnRef.current()
    }

    const handleVisibility = () => {
      visible = !document.hidden
      if (visible) poll()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    timer = setTimeout(() => {
      timer = null
      poll()
      intervalId = setInterval(poll, interval)
    }, initialDelay)

    return () => {
      if (timer) clearTimeout(timer)
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enabled, isConnected, pollingInterval])

  const refresh = useCallback(() => {
    fetchFnRef.current()
  }, [])

  return {
    refresh,
    isRealtime,
    isConnected,
  }
}

/**
 * Hook for real-time data with multiple fetch functions
 *
 * @example
 * const { refreshAll, isRealtime } = useRealtimeDataMultiple(
 *   [fetchItems, fetchCategories],
 *   { entityType: ['item', 'category'] }
 * )
 */
export function useRealtimeDataMultiple(
  fetchFns: Array<() => void | Promise<void>>,
  options: UseRealtimeDataOptions
) {
  const {
    entityType,
    enabled = true,
    refreshOnMount = true,
    pollingInterval,
  } = options

  const { isConnected } = useWebSocket()
  const fetchFnsRef = useRef(fetchFns)
  useEffect(() => { fetchFnsRef.current = fetchFns })

  const [isRealtime, setIsRealtime] = useState(false)

  // Initial fetch on mount
  useEffect(() => {
    if (refreshOnMount && enabled) {
      fetchFnsRef.current.forEach((fn) => fn())
    }
  }, [refreshOnMount, enabled])

  // Update realtime status
  useEffect(() => {
    setIsRealtime(enabled && isConnected)
  }, [enabled, isConnected])

  // Subscribe to data changes directly using useEffect
  const entityTypes = Array.isArray(entityType) ? entityType : [entityType]
  const entityTypesKey = entityTypes.join(',')

  // Debounce timer for coalescing rapid-fire events
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || !isConnected || !wsClient) return

    const handleDataChange = (event: DataChangeEvent) => {
      // Check if event type matches any of our entity types
      if (!entityTypes.includes(event.type)) return

      // Debounce: coalesce rapid-fire events into a single refresh
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        fetchFnsRef.current.forEach((fn) => fn())
      }, 300)
    }

    const unsubscribe = wsClient.onDataChange('*', handleDataChange)

    return () => {
      unsubscribe()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityTypesKey, enabled, isConnected])

  // Polling fallback when WebSocket is disconnected
  useEffect(() => {
    if (!enabled || isConnected) return

    const interval = pollingInterval ?? 15000
    if (interval <= 0) return

    const initialDelay = Math.random() * 3000
    let timer: ReturnType<typeof setTimeout> | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null
    let visible = !document.hidden

    const pollAll = () => {
      if (visible) fetchFnsRef.current.forEach((fn) => fn())
    }

    const handleVisibility = () => {
      visible = !document.hidden
      if (visible) pollAll()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    timer = setTimeout(() => {
      timer = null
      pollAll()
      intervalId = setInterval(pollAll, interval)
    }, initialDelay)

    return () => {
      if (timer) clearTimeout(timer)
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enabled, isConnected, pollingInterval])

  const refreshAll = useCallback(() => {
    fetchFnsRef.current.forEach((fn) => fn())
  }, [])

  return {
    refreshAll,
    isRealtime,
    isConnected,
  }
}

/**
 * Hook for watching a specific document (work order, estimate, etc.)
 * Includes presence awareness for collaborative editing
 *
 * @example
 * const { refresh, otherUsers, isRealtime } = useRealtimeDocument(
 *   'work-order',
 *   workOrderId,
 *   fetchWorkOrder
 * )
 */
export function useRealtimeDocument(
  resourceType: 'work-order' | 'estimate' | 'stock-transfer' | 'purchase' | 'purchase-order' | 'payment-entry' | 'employee-advance' | 'salary-slip' | 'payroll-run' | 'recurring-entry',
  resourceId: string | null,
  fetchFn: () => void | Promise<void>,
  options: { enabled?: boolean; pollingInterval?: number } = {}
) {
  const { enabled = true, pollingInterval } = options
  const { isConnected } = useWebSocket()
  const fetchFnRef = useRef(fetchFn)
  useEffect(() => { fetchFnRef.current = fetchFn })

  const [isRealtime, setIsRealtime] = useState(false)
  const [otherUsers] = useState<
    Array<{ userId: string; userName: string; isEditing: boolean }>
  >([])

  // Initial fetch
  useEffect(() => {
    if (enabled && resourceId) {
      fetchFnRef.current()
    }
  }, [enabled, resourceId])

  // Update realtime status
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsRealtime(enabled && isConnected && !!resourceId)
  }, [enabled, isConnected, resourceId])

  // Map resource type to WebSocket entity type for subscription
  const entityType = resourceType as EntityType

  // Debounce timer for coalescing rapid-fire events
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Subscribe to data changes using useEffect
  useEffect(() => {
    if (!enabled || !isConnected || !resourceId || !wsClient) return

    const handleDataChange = (event: DataChangeEvent) => {
      if (event.type === entityType && event.id === resourceId) {
        // Debounce: coalesce rapid-fire events into a single refresh
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null
          fetchFnRef.current()
        }, 300)
      }
    }

    const unsubscribe = wsClient.onDataChange(entityType, handleDataChange)

    return () => {
      unsubscribe()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [entityType, resourceId, enabled, isConnected])

  // Polling fallback when WebSocket is disconnected
  useEffect(() => {
    if (!enabled || isConnected || !resourceId) return

    const interval = pollingInterval ?? 15000
    if (interval <= 0) return

    const initialDelay = Math.random() * 3000
    let timer: ReturnType<typeof setTimeout> | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null
    let visible = !document.hidden

    const poll = () => {
      if (visible) fetchFnRef.current()
    }

    const handleVisibility = () => {
      visible = !document.hidden
      if (visible) poll()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    timer = setTimeout(() => {
      timer = null
      poll()
      intervalId = setInterval(poll, interval)
    }, initialDelay)

    return () => {
      if (timer) clearTimeout(timer)
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enabled, isConnected, resourceId, pollingInterval])

  const refresh = useCallback(() => {
    fetchFnRef.current()
  }, [])

  return {
    refresh,
    otherUsers,
    isRealtime,
    isConnected,
  }
}
