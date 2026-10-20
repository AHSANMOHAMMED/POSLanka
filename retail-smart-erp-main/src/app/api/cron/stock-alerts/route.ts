import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runStockAlerts } from '@/lib/notifications/scheduled'

// POST /api/cron/stock-alerts — run HOURLY.
// Sends each stock manager the low-stock digest and expiring-stock alert at their local digest hour.
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runStockAlerts()
    console.log(`[Cron] stock-alerts: ${summary.tenants} tenants, ${summary.dueUsers} due users, ${summary.digests} digests, ${summary.expiring} expiry alerts`)
    return NextResponse.json({
      success: true,
      tenants: summary.tenants,
      dueUsers: summary.dueUsers,
      digests: summary.digests,
      expiring: summary.expiring,
      ranAt: new Date().toISOString(),
    })
  } catch (error) {
    logError('api/cron/stock-alerts', error)
    return NextResponse.json({ error: 'Failed to run stock alerts' }, { status: 500 })
  }
}
