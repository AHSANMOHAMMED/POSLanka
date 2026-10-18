'use client'

import { useState, useEffect, useCallback } from 'react'
import { Monitor, Smartphone, Laptop, Tablet, Loader2, X, LogOut, RefreshCw } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface SessionInfo {
  id: string
  scope: string
  tenantSlug: string | null
  ipAddress: string | null
  deviceName: string | null
  lastActivityAt: string
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

function getDeviceIcon(deviceName: string | null) {
  if (!deviceName) return Laptop
  const lower = deviceName.toLowerCase()
  if (lower.includes('iphone') || lower.includes('android')) return Smartphone
  if (lower.includes('ipad') || lower.includes('tablet')) return Tablet
  return Laptop
}

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function SessionsTab() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/account/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch {
      console.error('Failed to fetch sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId)
    try {
      const res = await fetch(`/api/account/sessions/${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        toast.success('Session revoked')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to revoke session')
      }
    } catch {
      toast.error('Failed to revoke session')
    } finally {
      setRevokingId(null)
    }
  }

  const handleRevokeAllOthers = async () => {
    if (!confirm('Sign out from all other devices? This cannot be undone.')) return
    setRevokingAll(true)
    try {
      const res = await fetch('/api/account/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptCurrent: true }),
      })
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.isCurrent))
        toast.success('All other sessions revoked')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to revoke sessions')
      }
    } catch {
      toast.error('Failed to revoke sessions')
    } finally {
      setRevokingAll(false)
    }
  }

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
            <Monitor className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Active Sessions</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage your active login sessions across devices</p>
          </div>
        </div>
        <button
          onClick={fetchSessions}
          disabled={loading}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="Refresh sessions"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-6 space-y-4">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="font-medium">No active sessions</p>
            <p className="text-sm mt-1">Sessions will appear here after you log in</p>
          </div>
        ) : (
          <>
            {sessions
              .sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : 0))
              .map((s) => {
                const DeviceIcon = getDeviceIcon(s.deviceName)
                return (
                  <div
                    key={s.id}
                    className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 p-4 rounded-md border ${
                      s.isCurrent
                        ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
                        s.isCurrent
                          ? 'bg-green-100 dark:bg-green-900/40'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}>
                        <DeviceIcon className={`w-5 h-5 ${
                          s.isCurrent
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {s.deviceName || 'Unknown Device'}
                          </p>
                          {s.isCurrent && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400">
                              Current
                            </span>
                          )}
                          {s.scope === 'company' && s.tenantSlug && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400">
                              {s.tenantSlug}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {s.ipAddress && <span>{s.ipAddress}</span>}
                          <span>Active {formatRelative(s.lastActivityAt)}</span>
                        </div>
                      </div>
                    </div>

                    {!s.isCurrent && (
                      <button
                        onClick={() => handleRevoke(s.id)}
                        disabled={revokingId === s.id}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
                      >
                        {revokingId === s.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                        Revoke
                      </button>
                    )}
                  </div>
                )
              })}

            {sessions.filter((s) => !s.isCurrent).length > 0 && (
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleRevokeAllOthers}
                  disabled={revokingAll}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                >
                  {revokingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4" />
                  )}
                  Sign out all other devices
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
