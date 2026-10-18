'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, AlertTriangle, Sparkles, AlertCircle, Lightbulb, X, ExternalLink } from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import Link from 'next/link'

interface AIAlert {
  id: string
  type: 'anomaly' | 'insight' | 'error' | 'suggestion'
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  message: string
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown> | null
  readAt: string | null
  dismissedAt: string | null
  createdAt: string
}

const typeConfig = {
  anomaly: { icon: AlertTriangle, color: 'text-amber-500' },
  insight: { icon: Sparkles, color: 'text-purple-500' },
  error: { icon: AlertCircle, color: 'text-red-500' },
  suggestion: { icon: Lightbulb, color: 'text-blue-500' },
}

const severityColors = {
  low: 'border-l-gray-300',
  medium: 'border-l-amber-400',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
}

export function AlertBell() {
  const { tenantSlug } = useCompany()
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<AIAlert[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/alerts?all=true&unread=false')
      if (res.ok) {
        const data = await res.json()
        const alertList = (Array.isArray(data) ? data : data.data || [])
          // Filter out system audit findings from the bell
          .filter((a: AIAlert) => !a.metadata || !a.metadata.auditId)
        setAlerts(alertList.slice(0, 10))
        // Count unread
        const unread = alertList.filter((a: AIAlert) => !a.readAt).length
        setUnreadCount(typeof data.unreadCount === 'number' ? Math.min(data.unreadCount, alertList.length) : unread)
      }
    } catch {
      // Silently fail
    }
  }, [])

  useRealtimeData(fetchAlerts, { entityType: 'ai-alert' })

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAsRead = useCallback(async (id: string) => {
    try {
      await fetch('/api/ai/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'read' }),
      })
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, readAt: new Date().toISOString() } : a))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {
      // Silently fail
    }
  }, [])

  const dismissAlert = useCallback(async (id: string) => {
    try {
      await fetch('/api/ai/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismiss' }),
      })
      setAlerts(prev => prev.filter(a => a.id !== id))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {
      // Silently fail
    }
  }, [])

  function formatRelative(dateStr: string): string {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  function getEntityLink(alert: AIAlert): string | null {
    if (!alert.entityType || !alert.entityId) return null
    const base = `/c/${tenantSlug}`
    switch (alert.entityType) {
      case 'sale': return `${base}/sales/${alert.entityId}`
      case 'work_order': return `${base}/work-orders/${alert.entityId}`
      case 'item': return `${base}/items`
      case 'stock_movement': return `${base}/stock-movements`
      case 'refund': return `${base}/sales/${alert.entityId}`
      case 'purchase': return `${base}/purchases/${alert.entityId}`
      case 'price_change': return `${base}/items`
      default: return null
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open)
          // Mark all as read when opening
          if (!open && unreadCount > 0) {
            alerts.filter(a => !a.readAt).forEach(a => markAsRead(a.id))
          }
        }}
        className="p-1.5 rounded-md transition-colors relative"
        style={{ color: 'var(--sidebar-text-muted)' }}
        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--sidebar-hover-bg)'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        title="AI Alerts"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 sm:w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 max-h-[480px] flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-purple-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">AI Alerts</span>
            </div>
            <Link
              href={`/c/${tenantSlug}/settings/ai-logs`}
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all logs
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                No alerts yet
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {alerts.map(alert => {
                  const config = typeConfig[alert.type]
                  const TypeIcon = config.icon
                  const link = getEntityLink(alert)

                  return (
                    <div
                      key={alert.id}
                      className={`px-3 py-2.5 border-l-2 ${severityColors[alert.severity]} ${!alert.readAt ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <TypeIcon size={15} className={`mt-0.5 flex-shrink-0 ${config.color}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">
                            {alert.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-400">{formatRelative(alert.createdAt)}</span>
                            {link && (
                              <Link
                                href={link}
                                onClick={() => setOpen(false)}
                                className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
                              >
                                View <ExternalLink size={10} />
                              </Link>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissAlert(alert.id)}
                          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
