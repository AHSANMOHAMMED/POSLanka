import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runChequeReminders } from '@/lib/notifications/scheduled'
import { createLogger } from '@/lib/logger'

// POST /api/cron/cheque-reminders — run HOURLY.
// Sends owners / managers / accounts (in-app + push) the cheques to bank or that will be presented
// today and tomorrow, and received cheques not banked after their date, at their local digest hour.
// Low stock is covered by /api/cron/stock-alerts (daily stock digest).
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runChequeReminders()
    createLogger('cron:cheque-reminders').info('run complete', { tenants: summary.tenants, dueUsers: summary.dueUsers, sent: summary.sent })
    return NextResponse.json({ success: true, tenants: summary.tenants, dueUsers: summary.dueUsers, sent: summary.sent, ranAt: new Date().toISOString() })
  } catch (error) {
    logError('api/cron/cheque-reminders', error)
    return NextResponse.json({ error: 'Failed to run cheque reminders' }, { status: 500 })
  }
}
