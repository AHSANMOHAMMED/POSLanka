'use client'

import { useState, useEffect } from 'react'
import { X, HardDrive, ArrowRight, AlertTriangle } from 'lucide-react'

interface StorageBannerProps {
  companySlug: string
}

interface StorageQuota {
  dbPercent: number
  filePercent: number
  warningLevel: 'none' | 'warning' | 'critical' | 'blocked'
}

export function StorageBanner({ companySlug }: StorageBannerProps) {
  const [quota, setQuota] = useState<StorageQuota | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const dismissedKey = `storage_banner_dismissed_${companySlug}`
    const dismissedTime = localStorage.getItem(dismissedKey)
    if (dismissedTime) {
      const dismissedAt = new Date(dismissedTime).getTime()
      const now = Date.now()
      // Dismiss for 4 hours (storage is more urgent than plan notices)
      if (now - dismissedAt < 4 * 60 * 60 * 1000) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDismissed(true)
        setLoading(false)
        return
      }
    }

    fetch('/api/company/storage-quota')
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => {
        if (data.warningLevel) {
          setQuota(data)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companySlug])

  if (loading || dismissed || !quota || quota.warningLevel === 'none') {
    return null
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem(`storage_banner_dismissed_${companySlug}`, new Date().toISOString())
  }

  const maxPercent = Math.max(quota.dbPercent, quota.filePercent)
  const storageType = quota.dbPercent >= quota.filePercent ? 'Database' : 'File'

  const bannerConfig = {
    warning: {
      bg: 'bg-blue-600',
      message: `${storageType} storage at ${Math.round(maxPercent)}% — consider upgrading soon.`,
    },
    critical: {
      bg: 'bg-orange-500',
      message: `${storageType} storage at ${Math.round(maxPercent)}% — almost full. Upgrade to avoid disruptions.`,
    },
    blocked: {
      bg: 'bg-red-600',
      message: `${storageType} storage limit reached — new records are blocked. Upgrade now to continue.`,
    },
  }

  const config = bannerConfig[quota.warningLevel as keyof typeof bannerConfig]
  if (!config) return null

  return (
    <div className={`${config.bg} text-white px-4 py-2.5`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {quota.warningLevel === 'blocked' ? (
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <HardDrive className="w-5 h-5 flex-shrink-0" />
          )}
          <p className="text-sm font-medium">{config.message}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={`${process.env.NEXT_PUBLIC_APP_DOMAIN ? `https://${process.env.NEXT_PUBLIC_APP_DOMAIN}` : ''}/account/plans`}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-medium rounded transition-colors"
          >
            Upgrade Plan
            <ArrowRight className="w-4 h-4" />
          </a>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
