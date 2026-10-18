'use client'

import { useOfflinePos } from '@/hooks/useOfflinePos'
import { useI18n } from '@/hooks/useI18n'

export function OfflineStatusBanner() {
  const { online, pendingCount } = useOfflinePos()
  const { t } = useI18n()

  if (online && pendingCount === 0) return null

  return (
    <div
      className={`text-xs px-3 py-2 ${
        online ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-900'
      }`}
    >
      {!online && <span>{t('pos.offline', 'Offline mode')} · </span>}
      {pendingCount > 0 && (
        <span>
          {t('pos.syncPending', 'Sales waiting to sync')}: {pendingCount}
        </span>
      )}
    </div>
  )
}
