import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { invalidateAllStorageCache } from '@/lib/db/storage-quota'

// POST /api/cron/calculate-storage
// Recalculates storage from scratch for all tenants (corrects any drift).
// With real-time triggers (migration 0076), this is now a consistency check
// rather than the primary source of truth.

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret or admin auth
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    // Allow if valid cron secret provided
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      // Authorized via cron secret
    } else {
      // Check for super admin (optional - for manual trigger)
      // For now, just require the cron secret
      return NextResponse.json(
        { error: 'Unauthorized. Provide valid CRON_SECRET.' },
        { status: 401 }
      )
    }

    // Run the storage calculation for all tenants
    const result = await db.execute(sql`SELECT * FROM update_all_tenant_storage()`)
    const resultRows = result.rows as unknown[]

    // Get summary
    const summary = await db.execute(sql`
      SELECT
        COUNT(*) as tenant_count,
        SUM(storage_bytes) as total_bytes,
        AVG(storage_bytes) as avg_bytes,
        MAX(storage_bytes) as max_bytes
      FROM tenant_usage
    `)
    const summaryRows = summary.rows as Record<string, unknown>[]

    // Clear all in-memory storage caches so next quota check reads fresh data
    invalidateAllStorageCache()

    return NextResponse.json({
      success: true,
      message: 'Storage calculation completed',
      tenantsUpdated: resultRows.length,
      summary: summaryRows[0] || null,
      calculatedAt: new Date().toISOString(),
    })
  } catch (error) {
    logError('api/cron/calculate-storage', error)
    return NextResponse.json(
      { error: 'Failed to calculate storage' },
      { status: 500 }
    )
  }
}

// GET - Check last calculation time (requires CRON_SECRET)
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide valid CRON_SECRET.' },
        { status: 401 }
      )
    }

    const result = await db.execute(sql`
      SELECT
        COUNT(*) as tenant_count,
        SUM(storage_bytes) as total_bytes,
        MIN(updated_at) as oldest_update,
        MAX(updated_at) as newest_update
      FROM tenant_usage
    `)
    const rows = result.rows as Record<string, unknown>[]

    return NextResponse.json({
      summary: rows[0] || null,
    })
  } catch (error) {
    logError('api/cron/calculate-storage', error)
    return NextResponse.json(
      { error: 'Failed to fetch storage stats' },
      { status: 500 }
    )
  }
}
