import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runRetention } from '@/lib/maintenance/retention'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron:retention')

// POST /api/cron/retention — run DAILY (Authorization: Bearer CRON_SECRET).
// Deletes old operational logs in batches according to RETENTION_POLICY
// (src/lib/maintenance/retention.ts) and folds usage-counter deltas.
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runRetention()
    const deleted = summary.results.reduce((s, r) => s + r.deleted, 0)
    log.info('retention run complete', { deleted, durationMs: summary.durationMs, results: summary.results })
    const failed = summary.results.some((r) => r.error)
    return NextResponse.json({ success: !failed, deleted, ...summary, ranAt: new Date().toISOString() }, { status: failed ? 500 : 200 })
  } catch (error) {
    logError('api/cron/retention', error)
    return NextResponse.json({ error: 'Failed to run retention' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
