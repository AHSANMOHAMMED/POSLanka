'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  enqueuePendingSale,
  listPendingSales,
  mergeCatalogSnapshot,
  loadCatalogSnapshot,
  syncPendingSales,
  type PendingSale,
} from '@/lib/offline/pos-queue'

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function getOnlineSnapshot() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

function getOnlineServerSnapshot() {
  return true
}

export function useOfflinePos() {
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot)
  const [pendingCount, setPendingCount] = useState(0)
  const mounted = useRef(false)

  const refreshPending = useCallback(async () => {
    try {
      const list = await listPendingSales()
      setPendingCount(list.length)
    } catch {
      // IndexedDB unavailable
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const id = window.setTimeout(() => {
      if (mounted.current) void refreshPending()
    }, 0)

    const onOnline = () => {
      void syncPendingSales((payload) =>
        fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      ).then(() => {
        if (mounted.current) void refreshPending()
      })
    }

    window.addEventListener('online', onOnline)
    return () => {
      mounted.current = false
      window.clearTimeout(id)
      window.removeEventListener('online', onOnline)
    }
  }, [refreshPending])

  const queueSale = useCallback(
    async (payload: Record<string, unknown>) => {
      const clientSaleId =
        (payload.clientSaleId as string) ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `offline-${Date.now()}`)
      const sale: PendingSale = {
        clientSaleId,
        payload: { ...payload, clientSaleId },
        createdAt: new Date().toISOString(),
        attempts: 0,
      }
      await enqueuePendingSale(sale)
      await refreshPending()
      return clientSaleId
    },
    [refreshPending]
  )

  const cacheCatalog = useCallback(async (items: unknown[]) => {
    await mergeCatalogSnapshot(items)
  }, [])

  const loadCachedCatalog = useCallback(async () => {
    const snap = await loadCatalogSnapshot()
    return snap?.items || []
  }, [])

  return {
    online,
    pendingCount,
    queueSale,
    cacheCatalog,
    loadCachedCatalog,
    refreshPending,
  }
}
