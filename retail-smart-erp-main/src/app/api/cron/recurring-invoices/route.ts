import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runRecurringInvoices } from '@/lib/recurring-invoices/generate'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron:recurring-invoices')

// POST /api/cron/recurring-invoices — run HOURLY (Authorization: Bearer CRON_SECRET).
// Raises every recurring invoice due on or before today (Asia/Colombo). Idempotent per profile per
// scheduled date (recurring_invoice_runs unique key + the sale's clientSaleId), so overlapping or
// repeated calls never invoice twice; failed runs are retried up to 3 times.
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runRecurringInvoices()
    log.info('recurring invoices run complete', { today: summary.today, profiles: summary.profiles, generated: summary.generated, drafts: summary.drafts, failed: summary.failed })
    return NextResponse.json({ success: true, ...summary, ranAt: new Date().toISOString() })
  } catch (error) {
    logError('api/cron/recurring-invoices', error)
    return NextResponse.json({ error: 'Failed to run recurring invoices' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
