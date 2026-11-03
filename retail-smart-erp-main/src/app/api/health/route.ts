import { NextRequest, NextResponse } from 'next/server'
import { checkTenantIsolation, shouldEnforceTenantIsolation } from '@/lib/db/tenant-context'
import { pingDatabase } from '@/lib/health/checks'
import { isShuttingDown } from '@/lib/observability/metrics'
import { storageMode } from '@/lib/files/r2'

function wantsDetail(request: NextRequest): boolean {
  // Docker HEALTHCHECK and operators curl 127.0.0.1 — keep full diagnostics there.
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip') || ''
  const host = request.headers.get('host') || ''
  if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) return true
  if (forwarded === '127.0.0.1' || forwarded === '::1' || realIp === '127.0.0.1' || realIp === '::1') return true
  const secret = process.env.HEALTH_DETAIL_TOKEN
  if (secret && request.headers.get('x-health-token') === secret) return true
  if (secret && request.nextUrl.searchParams.get('token') === secret) return true
  return false
}

// Backward-compatible health endpoint (Dockerfile HEALTHCHECK, docker-compose, uptime monitors).
// Public responses are redacted (no tenantIsolation / storage mode) so scanners cannot confirm
// UNSAFE_SUPERUSER_NO_ROLE. Loopback + HEALTH_DETAIL_TOKEN still get the full payload.
// Live-safe: do not 503 solely for missing DATABASE_APP_ROLE unless ENFORCE_TENANT_ISOLATION=true.
export async function GET(request: NextRequest) {
  const db = await pingDatabase()
  let database: 'ok' | 'error' = db.ok ? 'ok' : 'error'
  let tenantIsolation: string = 'unknown'
  if (db.ok) {
    try {
      tenantIsolation = await checkTenantIsolation()
    } catch {
      database = 'error'
    }
  }
  const unsafe = tenantIsolation === 'UNSAFE_SUPERUSER_NO_ROLE'
  const enforceUnsafe = unsafe && shouldEnforceTenantIsolation()
  const ok = database === 'ok' && !isShuttingDown() && !enforceUnsafe
  const detail = wantsDetail(request)

  if (!detail) {
    return NextResponse.json({
      status: ok ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.7',
    }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
  }

  return NextResponse.json({
    status: ok ? 'ok' : 'degraded',
    database,
    databaseLatencyMs: db.latencyMs,
    tenantIsolation,
    storage: storageMode(),
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.7',
  }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}

export const dynamic = 'force-dynamic'
