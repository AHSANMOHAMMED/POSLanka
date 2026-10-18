'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  enqueuePendingSale,
  listPendingSales,
  saveCatalogSnapshot,
  syncPendingSales,
  type PendingSale,
} from '@/lib/offline/pos-queue'

export function useOfflinePos() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pendingCount, setPendingCount] = useState(0)

  const refreshPending = useCallback(async () => {
    try {
      const list = await listPendingSales()
      setPendingCount(list.length)
    } catch {
      // IndexedDB unavailable
    }
  }, [])

  useEffect(() => {
    const onOnline = () => {
      setOnline(true)
      syncPendingSales((payload) =>
        fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      ).then(() => refreshPending())
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    refreshPending()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
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
    await saveCatalogSnapshot(items)
  }, [])

  return {
    online,
    pendingCount,
    queueSale,
    cacheCatalog,
    refreshPending,
  }
}
