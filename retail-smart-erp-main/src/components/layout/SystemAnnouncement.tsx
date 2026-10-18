'use client'

import { useState, useEffect } from 'react'
import { X, Info, AlertTriangle, AlertCircle } from 'lucide-react'

interface Announcement {
  enabled: boolean
  message: string
  type: 'info' | 'warning' | 'error'
}

const typeStyles = {
  info: {
    bg: 'bg-blue-600',
    icon: Info,
  },
  warning: {
    bg: 'bg-yellow-500',
    icon: AlertTriangle,
  },
  error: {
    bg: 'bg-red-600',
    icon: AlertCircle,
  },
}

export function SystemAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check if already dismissed in this session
    const dismissedKey = sessionStorage.getItem('announcement_dismissed')
    if (dismissedKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(true)
      return
    }

    // Fetch announcement
    fetch('/api/system/announcement')
      .then((res) => res.json())
      .then((data) => {
        if (data.enabled && data.message) {
          setAnnouncement(data)
        }
      })
      .catch(console.error)
  }, [])

  if (!announcement || !announcement.enabled || dismissed) {
    return null
  }

  const handleDismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('announcement_dismissed', 'true')
  }

  const style = typeStyles[announcement.type] || typeStyles.info
  const Icon = style.icon

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
