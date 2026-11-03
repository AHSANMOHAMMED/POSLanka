'use client'

import { useState, useEffect } from 'react'
import { X, Info, AlertTriangle, AlertCircle, Wrench } from 'lucide-react'
import { sharedJson, whenIdle } from '@/lib/client/shared-fetch'
import { useI18n } from '@/hooks/useI18n'
import { BrandWordmark } from '@/components/ui/logo'

interface Announcement {
  enabled: boolean
  message: string
  type: 'info' | 'warning' | 'error' | 'maintenance'
}

const typeStyles = {
  info: {
    bg: 'bg-[#0050c0]',
    icon: Info,
  },
  warning: {
    bg: 'bg-amber-500',
    icon: AlertTriangle,
  },
  error: {
    bg: 'bg-red-600',
    icon: AlertCircle,
  },
  maintenance: {
    bg: 'bg-slate-800',
    icon: Wrench,
  },
}

/**
 * Platform banner. Maintenance / error use a full-viewport gate so staff never see a blank app.
 * Soft info/warning stay as a dismissible top strip.
 */
export function SystemAnnouncement() {
  const { locale } = useI18n()
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const dismissedKey = sessionStorage.getItem('announcement_dismissed')
    if (dismissedKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(true)
      return
    }

    whenIdle()
      .then(() => sharedJson<Announcement>(`/api/system/announcement?locale=${locale}`, { maxAgeMs: 300_000 }))
      .then((data) => {
        if (data.enabled && data.message) {
          setAnnouncement(data)
        } else {
          setAnnouncement(null)
        }
      })
      .catch(console.error)
  }, [locale])

  if (!announcement || !announcement.enabled || dismissed) {
    return null
  }

  const handleDismiss = () => {
    // Maintenance / error cannot be dismissed away to a blank screen
    if (announcement.type === 'maintenance' || announcement.type === 'error') return
    setDismissed(true)
    sessionStorage.setItem('announcement_dismissed', 'true')
  }

  const style = typeStyles[announcement.type] || typeStyles.info
  const Icon = style.icon
  const blocking = announcement.type === 'maintenance' || announcement.type === 'error'

  if (blocking) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-6" role="alertdialog" aria-modal="true" aria-labelledby="sys-ann-title">
        <div className="max-w-md w-full rounded-2xl bg-white p-8 shadow-2xl text-center">
          <div className="mb-5 flex justify-center"><BrandWordmark height={40} /></div>
          <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${announcement.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
            <Icon className="h-7 w-7" aria-hidden />
          </div>
          <h2 id="sys-ann-title" className="text-xl font-bold text-slate-900 mb-2">
            {announcement.type === 'maintenance' ? 'Scheduled maintenance' : 'Service notice'}
          </h2>
          <p className="text-slate-600 leading-relaxed mb-6 whitespace-pre-wrap">{announcement.message}</p>
          <p className="text-sm text-slate-500">Sales and sign-in may be limited until this notice is cleared by skyERPOS.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${style.bg} text-white px-4 py-2`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Icon className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{announcement.message}</p>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
