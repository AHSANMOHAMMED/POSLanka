import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runEinvoiceSync } from '@/lib/einvoice/outbox'

// POST /api/cron/einvoice-sync — run every 5–15 MINUTES.
// Queues an e-invoice outbox row for every new sale / return / credit note / debit note of tenants
// with e-invoicing enabled, then transmits due rows (EINVOICE_TRANSMITTER; default disabled = queue only).
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runEinvoiceSync()
    console.log(`[Cron] einvoice-sync (${summary.transmitter}): ${summary.tenants} tenants, ${summary.queued} queued, ${summary.sent + summary.acknowledged} sent, ${summary.retried} retry, ${summary.failed} failed, ${summary.errors} errors`)
    return NextResponse.json({ success: true, ...summary, ranAt: new Date().toISOString() })
  } catch (error) {
    logError('api/cron/einvoice-sync', error)
    return NextResponse.json({ error: 'Failed to run e-invoice sync' }, { status: 500 })
  }
}
