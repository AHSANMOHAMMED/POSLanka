import { NextResponse } from 'next/server'
import { checkTenantIsolation } from '@/lib/db/tenant-context'
import { pingDatabase } from '@/lib/health/checks'
import { isShuttingDown } from '@/lib/observability/metrics'
import { storageMode } from '@/lib/files/r2'

// Backward-compatible health endpoint (Dockerfile HEALTHCHECK, docker-compose, uptime monitors).
// It now really touches the database (SELECT 1, 2 s timeout) on every call; the tenant-isolation
// mode stays cached. Kubernetes/App Platform style probes: /api/health/live and /api/health/ready.
export async function GET() {
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
  const ok = database === 'ok' && !isShuttingDown()
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
