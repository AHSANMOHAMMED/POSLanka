import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sales, tenants, warehouses, users } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { salesAgg, toInt, toNumber } from '../_shared'

const LIVE_WINDOW_MS = 60 * 60 * 1000
const MAX_ROWS = 200
const HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000

const querySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
})

/**
 * GET /api/sys-control/analytics/live?since=<ISO>
 * Receipts across all tenants from the last 60 minutes (newest first, max 200),
 * plus an hourly net-sales series for the last 24 hours.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const parsed = validateSearchParams(request, querySchema)
    if (!parsed.success) return parsed.response

    const now = Date.now()
    const windowStart = new Date(now - LIVE_WINDOW_MS)
    const requested = parsed.data.since ? new Date(parsed.data.since) : null
    // Never look back further than the live window
    const since = requested && requested.getTime() > windowStart.getTime() ? requested : windowStart
    const hourlySince = new Date(now - HOURLY_WINDOW_MS)

    const [receiptRows, hourlyRows] = await Promise.all([
      db
        .select({
          id: sales.id,
          invoiceNo: sales.invoiceNo,
          tenantId: sales.tenantId,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          businessType: tenants.businessType,
          warehouseName: warehouses.name,
          cashierName: users.fullName,
          total: sales.total,
          isReturn: sales.isReturn,
          paymentMethod: sales.paymentMethod,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .innerJoin(tenants, eq(sales.tenantId, tenants.id))
        .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
        .leftJoin(users, eq(sales.createdBy, users.id))
        .where(and(ne(sales.status, 'void'), gte(sales.createdAt, since)))
        .orderBy(desc(sales.createdAt))
        .limit(MAX_ROWS),

      db
        .select({
          hour: sql<string>`TO_CHAR(DATE_TRUNC('hour', ${sales.createdAt}), 'YYYY-MM-DD"T"HH24:00:00')`,
          netSales: salesAgg.netSales(),
          receipts: salesAgg.receipts(),
        })
        .from(sales)
        .where(and(ne(sales.status, 'void'), gte(sales.createdAt, hourlySince)))
        .groupBy(sql`DATE_TRUNC('hour', ${sales.createdAt})`)
        .orderBy(sql`DATE_TRUNC('hour', ${sales.createdAt})`),
    ])

    return NextResponse.json({
      since: since.toISOString(),
      serverTime: new Date(now).toISOString(),
      receipts: receiptRows.map((r) => ({
        id: r.id,
        invoiceNo: r.invoiceNo,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        businessType: r.businessType,
        warehouseName: r.warehouseName || null,
        cashierName: r.cashierName || null,
        total: r.isReturn ? -Math.abs(toNumber(r.total)) : toNumber(r.total),
        isReturn: r.isReturn,
        paymentMethod: r.paymentMethod || null,
        createdAt: r.createdAt,
      })),
      hourly: hourlyRows.map((r) => ({
        hour: r.hour,
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
    })
  } catch (error) {
    logError('api/sys-control/analytics/live', error)
    return NextResponse.json({ error: 'Failed to load live feed' }, { status: 500 })
  }
}
