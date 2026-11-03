import { NextResponse } from 'next/server'
import { checkReadiness } from '@/lib/health/checks'
import { checkTenantIsolation, shouldEnforceTenantIsolation } from '@/lib/db/tenant-context'
import { createLogger } from '@/lib/logger'

const log = createLogger('health')

// Readiness: 200 when this instance should receive traffic, 503 while it is draining after
// SIGTERM or when the database does not answer within 2 s.
// Live-safe: missing DATABASE_APP_ROLE only fails readiness when ENFORCE_TENANT_ISOLATION=true.
export async function GET() {
  const r = await checkReadiness()
  let tenantIsolation: string = 'unknown'
  try {
    if (r.database.ok) tenantIsolation = await checkTenantIsolation()
  } catch {
    // leave unknown
  }
  const unsafeBlocked = tenantIsolation === 'UNSAFE_SUPERUSER_NO_ROLE' && shouldEnforceTenantIsolation()
  const ready = r.ready && !unsafeBlocked
  // The error text stays in the logs: this endpoint is public
  if (!r.database.ok && !r.shuttingDown) log.warn('readiness: database check failed', { err: r.database.error })
  if (unsafeBlocked) log.error('readiness: refusing traffic — DATABASE_APP_ROLE missing on superuser connection (ENFORCE_TENANT_ISOLATION=true)')
  return NextResponse.json({
    status: ready ? 'ready' : 'not_ready',
    shuttingDown: r.shuttingDown,
    database: r.database.ok ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
  }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}

export const dynamic = 'force-dynamic'
