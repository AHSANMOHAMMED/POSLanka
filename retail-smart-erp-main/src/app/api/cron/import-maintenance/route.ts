import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/ai/error-logger'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { runImportMaintenance } from '@/lib/notifications/scheduled'
import { foldTenantUsage } from '@/lib/db/storage-quota'

// POST /api/cron/import-maintenance — run EVERY 15 MINUTES.
// Resumes interrupted bulk import jobs (stale heartbeat) and deletes jobs finished > 30 days ago.
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied
  try {
    const summary = await runImportMaintenance()
    // Fold usage-counter deltas for every vendor (keeps tenant_usage within ~15 minutes)
    const usageDeltasFolded = await foldTenantUsage()
    return NextResponse.json({ success: true, ...summary, usageDeltasFolded, ranAt: new Date().toISOString() })
  } catch (error) {
    logError('api/cron/import-maintenance', error)
    return NextResponse.json({ error: 'Failed to run import maintenance' }, { status: 500 })
  }
}
