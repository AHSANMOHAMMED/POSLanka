import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runSubscriptionReminders } from '@/lib/notifications/scheduled'

// POST /api/cron/subscription-reminders — run DAILY.
// Trials / billing periods ending in 7 and 1 days → company owners (push + in-app inbox).
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runSubscriptionReminders()
    return NextResponse.json({
      success: true,
      checked: summary.checked,
      reminders: summary.sent.filter((s) => !s.outcome.skipped).length,
      ranAt: new Date().toISOString(),
    })
  } catch (error) {
    logError('api/cron/subscription-reminders', error)
    return NextResponse.json({ error: 'Failed to send subscription reminders' }, { status: 500 })
  }
}
