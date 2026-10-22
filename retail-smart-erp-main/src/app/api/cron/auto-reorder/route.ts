import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runAutoReorder } from '@/lib/purchasing/reorder'
import { createLogger } from '@/lib/logger'

// POST /api/cron/auto-reorder — run DAILY.
// Tenants with Purchasing settings → auto reorder get draft purchase requisitions for every
// item at or below its minimum stock (open POs / requisitions count as on order, so re-runs
// never duplicate).
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runAutoReorder()
    createLogger('cron:auto-reorder').info('run complete', { ...summary })
    return NextResponse.json({ success: true, ...summary, ranAt: new Date().toISOString() })
  } catch (error) {
    logError('api/cron/auto-reorder', error)
    return NextResponse.json({ error: 'Failed to run auto reorder' }, { status: 500 })
  }
}
