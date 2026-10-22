'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  enqueuePendingSale,
  mergeCatalogSnapshot,
  loadCatalogSnapshot,
  refreshQueueState,
  startOfflineSync,
  subscribeQueue,
  getQueueState,
  syncNow,
  retryPendingSale,
  discardPendingSale,
  type OfflineQueueState,
  type PendingSale,
} from '@/lib/offline/pos-queue'
import { generateClientSaleId, isUuid } from '@/lib/offline/sync-policy'
import { nextOfflineRef } from '@/lib/offline/offline-ref'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'

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
  const company = useCompanyOptional()
  const tenantSlug = company?.tenantSlug ?? null
  const [queue, setQueue] = useState<OfflineQueueState>(getQueueState)

  // One shared sync engine per tab: retries on 'online', on a backoff timer and periodically.
  useEffect(() => {
    const stop = startOfflineSync(tenantSlug)
    const unsubscribe = subscribeQueue(setQueue)
    return () => {
      unsubscribe()
      stop()
    }
  }, [tenantSlug])

  const refreshPending = useCallback(async () => {
    await refreshQueueState()
  }, [])

  const queueSale = useCallback(
    async (payload: Record<string, unknown>) => {
      const clientSaleId = isUuid(payload.clientSaleId) ? payload.clientSaleId : generateClientSaleId()
      // Every queued sale carries an offline receipt number: the server then treats the replay as a
      // completed offline sale (closed shift / expired approval token → accepted and flagged for
      // review) instead of re-checking it as a live online sale.
      const offlineRef = typeof payload.offlineRef === 'string' && payload.offlineRef
        ? payload.offlineRef
        : await nextOfflineRef(tenantSlug)
      const sale: PendingSale = {
        clientSaleId,
        payload: { ...payload, clientSaleId, offlineRef },
        createdAt: new Date().toISOString(),
        attempts: 0,
        tenantSlug,
        offlineRef,
      }
      await enqueuePendingSale(sale)
      await refreshQueueState()
      return { clientSaleId, offlineRef }
    },
    [tenantSlug]
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
    pendingCount: queue.pending,
    rejectedCount: queue.rejected,
    queuedSales: queue.entries,
    syncing: queue.syncing,
    lastSyncAt: queue.lastSyncAt,
    lastSyncError: queue.lastError,
    queueSale,
    cacheCatalog,
    loadCachedCatalog,
    refreshPending,
    syncNow: () => syncNow({ force: true }),
    retrySale: retryPendingSale,
    discardSale: discardPendingSale,
    /** Generate the idempotency key BEFORE the first POST so a lost reply cannot duplicate the sale. */
    newClientSaleId: generateClientSaleId,
  }
}
