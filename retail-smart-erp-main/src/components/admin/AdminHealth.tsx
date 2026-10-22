'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/** Shape returned by GET /api/sys-control/health */
export interface PlatformHealth {
  status: 'ok' | 'degraded'
  checkedAt: string
  appVersion: string
  environment: string
  uptimeSeconds: number
  memoryMb: number
  database: { ok: boolean; latencyMs: number | null }
  vendors: { total: number; active: number; activeNow: number; windowMinutes: number }
  openShifts: number
  errors24h: number
  realtime: { connections: number; tenants: number } | null
}

interface HealthContextValue {
  health: PlatformHealth | null
  error: boolean
  refresh: () => Promise<void>
}

const HealthContext = createContext<HealthContextValue>({ health: null, error: false, refresh: async () => {} })

const POLL_MS = 30_000

/** Polls the platform health endpoint once for the whole console (shell + pages share it). */
export function AdminHealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<PlatformHealth | null>(null)
  const [error, setError] = useState(false)
  const inflight = useRef(false)

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const res = await fetch('/api/sys-control/health', { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login?session=expired'
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      setHealth(await res.json())
      setError(false)
    } catch {
      setError(true)
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(() => {
      if (!document.hidden) refresh()
    }, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return <HealthContext.Provider value={{ health, error, refresh }}>{children}</HealthContext.Provider>
}

export function useAdminHealth() {
  return useContext(HealthContext)
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
