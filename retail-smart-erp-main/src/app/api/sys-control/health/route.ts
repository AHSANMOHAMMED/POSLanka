import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

/**
 * GET /api/sys-control/health — live platform health for the super-admin console.
 * Every number is measured now (no placeholders):
 *  - database round-trip latency (SELECT 1)
 *  - app version (APP_VERSION) and process uptime / memory
 *  - vendor counts, vendors active in the last 15 minutes (staff heartbeat or a sale)
 *  - open POS shifts, unresolved errors in the last 24h
 *  - realtime connections when the custom server registered its WebSocket manager
 * Cached in-process for a few seconds so several open consoles don't multiply DB load.
 */

const ACTIVE_WINDOW_MIN = 15
const CACHE_MS = 5_000

declare global {
  var __wsStats: (() => { connections: number; tenants: number }) | undefined
}

interface HealthPayload {
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

let cache: { at: number; data: HealthPayload } | null = null

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10)
  return Number.isFinite(n) ? n : 0
}

async function measure(): Promise<HealthPayload> {
  const appVersion = process.env.APP_VERSION || process.env.npm_package_version || 'unknown'
  const base = {
    checkedAt: new Date().toISOString(),
    appVersion,
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    realtime: typeof globalThis.__wsStats === 'function' ? safeWs() : null,
  }

  let latencyMs: number | null = null
  try {
    const t0 = performance.now()
    await db.execute(sql`SELECT 1`)
    latencyMs = Math.round((performance.now() - t0) * 10) / 10
  } catch (err) {
    logError('api/sys-control/health:db', err)
    return {
      ...base,
      status: 'degraded',
      database: { ok: false, latencyMs: null },
      vendors: { total: 0, active: 0, activeNow: 0, windowMinutes: ACTIVE_WINDOW_MIN },
      openShifts: 0,
      errors24h: 0,
    }
  }

  // One round trip for all counters.
  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM tenants)::int AS total_vendors,
      (SELECT COUNT(*) FROM tenants WHERE status = 'active')::int AS active_vendors,
      (SELECT COUNT(DISTINCT tenant_id) FROM (
          SELECT tenant_id FROM users WHERE last_active_at >= NOW() - (${ACTIVE_WINDOW_MIN} * INTERVAL '1 minute')
          UNION
          SELECT tenant_id FROM sales WHERE created_at >= NOW() - (${ACTIVE_WINDOW_MIN} * INTERVAL '1 minute')
        ) a)::int AS active_now,
      (SELECT COUNT(*) FROM pos_opening_entries WHERE status = 'open')::int AS open_shifts,
      (SELECT COUNT(*) FROM ai_error_logs
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND COALESCE(resolution_status, 'open') NOT IN ('resolved', 'wont_fix'))::int AS errors_24h
  `)
  const row = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? (result as unknown as Record<string, unknown>[]))[0] ?? {}

  return {
    ...base,
    status: 'ok',
    database: { ok: true, latencyMs },
    vendors: {
      total: num(row.total_vendors),
      active: num(row.active_vendors),
      activeNow: num(row.active_now),
      windowMinutes: ACTIVE_WINDOW_MIN,
    },
    openShifts: num(row.open_shifts),
    errors24h: num(row.errors_24h),
  }
}

function safeWs() {
  try {
    return globalThis.__wsStats!()
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const now = Date.now()
    if (!cache || now - cache.at > CACHE_MS) {
      cache = { at: now, data: await measure() }
    }
    return NextResponse.json(cache.data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logError('api/sys-control/health', error)
    return NextResponse.json({ error: 'Failed to read platform health' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
