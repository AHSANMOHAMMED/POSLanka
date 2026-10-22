'use client'

import { useState } from 'react'
import { useOfflinePos } from '@/hooks/useOfflinePos'
import { useI18n } from '@/hooks/useI18n'
import { OfflineFailedSales } from './OfflineFailedSales'

export function OfflineStatusBanner() {
  const { online, pendingCount, rejectedCount, queuedSales, syncing, lastSyncError, syncNow, retrySale, discardSale } = useOfflinePos()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  if (online && pendingCount === 0 && rejectedCount === 0 && !open) return null

  const tone = rejectedCount > 0 ? 'bg-red-50 text-red-900' : online ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-900'

  return (
    <>
      <div className={`text-xs px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 ${tone}`} role="status">
        {!online && <span>{t('pos.offline', 'Offline mode')} ·</span>}
        {pendingCount > 0 && (
          <span>
            {t('pos.syncPending', 'Sales waiting to sync')}: {pendingCount}
            {syncing && ` · ${t('pos.syncing', 'syncing…')}`}
          </span>
        )}
        {rejectedCount > 0 && (
          <span className="font-semibold">
            {t('pos.syncRejected', 'Sales need attention')}: {rejectedCount}
          </span>
        )}
        {online && lastSyncError && pendingCount > 0 && <span className="opacity-75">({lastSyncError})</span>}
        {(pendingCount > 0 || rejectedCount > 0) && (
          <button type="button" onClick={() => setOpen(true)} className="underline font-medium">
            {t('pos.reviewOffline', 'Review')}
          </button>
        )}
      </div>
      <OfflineFailedSales
        isOpen={open}
        onClose={() => setOpen(false)}
        sales={queuedSales}
        syncing={syncing}
        onRetry={retrySale}
        onDiscard={discardSale}
        onSyncAll={syncNow}
      />
    </>
  )
}
