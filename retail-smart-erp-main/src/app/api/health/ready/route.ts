import { NextResponse } from 'next/server'
import { checkReadiness } from '@/lib/health/checks'
import { createLogger } from '@/lib/logger'

const log = createLogger('health')

// Readiness: 200 when this instance should receive traffic, 503 while it is draining after
// SIGTERM or when the database does not answer within 2 s.
export async function GET() {
  const r = await checkReadiness()
  // The error text stays in the logs: this endpoint is public
  if (!r.database.ok && !r.shuttingDown) log.warn('readiness: database check failed', { err: r.database.error })
  return NextResponse.json({
    status: r.ready ? 'ready' : 'not_ready',
    shuttingDown: r.shuttingDown,
    database: r.database.ok ? 'ok' : 'error',
    databaseLatencyMs: r.database.latencyMs,
    storage: r.storage,
    realtimeFanout: r.realtimeFanout,
    timestamp: new Date().toISOString(),
  }, { status: r.ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}

export const dynamic = 'force-dynamic'
