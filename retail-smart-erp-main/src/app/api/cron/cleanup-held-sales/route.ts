import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { heldSales } from '@/lib/db/schema'
import { sql, lte } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'

// POST /api/cron/cleanup-held-sales
// Deletes expired held sales (runs periodically via cron)
// Expired held sales no longer reserve stock

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide valid CRON_SECRET.' },
        { status: 401 }
      )
    }

    // Get expired held sales grouped by tenant before deleting
    // This allows us to broadcast changes to affected tenants
    const expiredSales = await db
      .select({
        id: heldSales.id,
        tenantId: heldSales.tenantId,
      })
      .from(heldSales)
      .where(lte(heldSales.expiresAt, sql`NOW()`))

    if (expiredSales.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired held sales to clean up',
        deletedCount: 0,
        cleanedAt: new Date().toISOString(),
      })
    }

    // Group by tenant for broadcasting
    const tenantIds = [...new Set(expiredSales.map(s => s.tenantId))]

    // Delete expired held sales
    const deleted = await db
      .delete(heldSales)
      .where(lte(heldSales.expiresAt, sql`NOW()`))
      .returning({ id: heldSales.id })

    // Broadcast bulk expiration to each affected tenant
    for (const tenantId of tenantIds) {
      // Broadcast a bulk-expired event so clients can refresh their held sales list
      // We use 'deleted' action with a special 'bulk-expired' id to indicate bulk cleanup
      logAndBroadcast(tenantId, 'held-sale', 'deleted', 'bulk-expired', undefined, {
        reason: 'expired',
        count: expiredSales.filter(s => s.tenantId === tenantId).length,
      })
    }

    console.log(`[Cron] Cleaned up ${deleted.length} expired held sales across ${tenantIds.length} tenants`)

    return NextResponse.json({
      success: true,
      message: 'Expired held sales cleaned up successfully',
      deletedCount: deleted.length,
      tenantsAffected: tenantIds.length,
      cleanedAt: new Date().toISOString(),
    })
  } catch (error) {
    logError('api/cron/cleanup-held-sales', error)
    return NextResponse.json(
      { error: 'Failed to clean up expired held sales' },
      { status: 500 }
    )
  }
}

// GET - Check expired held sales count (for monitoring)
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret for GET as well (monitoring endpoint)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide valid CRON_SECRET.' },
        { status: 401 }
      )
    }

    // Count expired and pending held sales
    const [stats] = await db
      .select({
        totalCount: sql<number>`COUNT(*)`,
        expiredCount: sql<number>`COUNT(*) FILTER (WHERE ${heldSales.expiresAt} <= NOW())`,
        activeCount: sql<number>`COUNT(*) FILTER (WHERE ${heldSales.expiresAt} > NOW())`,
        oldestExpired: sql<string>`MIN(${heldSales.expiresAt}) FILTER (WHERE ${heldSales.expiresAt} <= NOW())`,
        nextToExpire: sql<string>`MIN(${heldSales.expiresAt}) FILTER (WHERE ${heldSales.expiresAt} > NOW())`,
      })
      .from(heldSales)

    return NextResponse.json({
      stats: {
        total: Number(stats?.totalCount || 0),
        expired: Number(stats?.expiredCount || 0),
        active: Number(stats?.activeCount || 0),
        oldestExpired: stats?.oldestExpired || null,
        nextToExpire: stats?.nextToExpire || null,
      },
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    logError('api/cron/cleanup-held-sales', error)
    return NextResponse.json(
      { error: 'Failed to fetch held sales stats' },
      { status: 500 }
    )
  }
}
