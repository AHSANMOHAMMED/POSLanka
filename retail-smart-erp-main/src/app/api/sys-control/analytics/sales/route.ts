import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sales, tenants, warehouses, posOpeningEntries, businessTypeEnum } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { analyticsRangeSchema, rangeSince, salesAgg, toInt, toNumber } from '../_shared'

const querySchema = z.object({
  range: analyticsRangeSchema.default('today'),
  businessType: z.enum(businessTypeEnum.enumValues).optional(),
  tenantId: z.string().uuid().optional(),
})

/**
 * GET /api/sys-control/analytics/sales?range=today|7d|30d&businessType=&tenantId=
 * Cross-tenant sales analytics for the super-admin console.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const parsed = validateSearchParams(request, querySchema)
    if (!parsed.success) return parsed.response
    const { range, businessType, tenantId } = parsed.data

    const since = rangeSince(range)

    // Base filter (non-void sales in range, optional tenant / business type)
    const baseConditions = [ne(sales.status, 'void'), gte(sales.createdAt, since)]
    if (tenantId) baseConditions.push(eq(sales.tenantId, tenantId))
    if (businessType) baseConditions.push(eq(tenants.businessType, businessType))
    const whereBase = and(...baseConditions)

    const [totalsRow, voidsRow, byDayRows, byTypeRows, topVendorRows, topBranchRows, openShiftTotal, openShiftRows] =
      await Promise.all([
        db
          .select({
            netSales: salesAgg.netSales(),
            grossSales: salesAgg.grossSales(),
            returns: salesAgg.returns(),
            receipts: salesAgg.receipts(),
          })
          .from(sales)
          .innerJoin(tenants, eq(sales.tenantId, tenants.id))
          .where(whereBase)
          .then((r) => r[0]),

        db
          .select({ voids: sql<number>`COUNT(*)::int` })
          .from(sales)
          .innerJoin(tenants, eq(sales.tenantId, tenants.id))
          .where(
            and(
              eq(sales.status, 'void'),
              gte(sales.createdAt, since),
              tenantId ? eq(sales.tenantId, tenantId) : undefined,
              businessType ? eq(tenants.businessType, businessType) : undefined
            )
          )
          .then((r) => r[0]),

        db
          .select({
            date: sql<string>`TO_CHAR(DATE(${sales.createdAt}), 'YYYY-MM-DD')`,
            netSales: salesAgg.netSales(),
            receipts: salesAgg.receipts(),
          })
          .from(sales)
          .innerJoin(tenants, eq(sales.tenantId, tenants.id))
          .where(whereBase)
          .groupBy(sql`DATE(${sales.createdAt})`)
          .orderBy(sql`DATE(${sales.createdAt})`),

        db
          .select({
            businessType: tenants.businessType,
            netSales: salesAgg.netSales(),
            receipts: salesAgg.receipts(),
          })
          .from(sales)
          .innerJoin(tenants, eq(sales.tenantId, tenants.id))
          .where(whereBase)
          .groupBy(tenants.businessType)
          .orderBy(desc(salesAgg.netSales())),

        db
          .select({
            tenantId: tenants.id,
            name: tenants.name,
            slug: tenants.slug,
            netSales: salesAgg.netSales(),
            receipts: salesAgg.receipts(),
          })
          .from(sales)
          .innerJoin(tenants, eq(sales.tenantId, tenants.id))
          .where(whereBase)
          .groupBy(tenants.id, tenants.name, tenants.slug)
          .orderBy(desc(salesAgg.netSales()))
          .limit(10),

        db
          .select({
            tenantId: tenants.id,
            tenantName: tenants.name,
            warehouseId: warehouses.id,
            warehouseName: warehouses.name,
            netSales: salesAgg.netSales(),
            receipts: salesAgg.receipts(),
          })
          .from(sales)
          .innerJoin(tenants, eq(sales.tenantId, tenants.id))
          .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
          .where(whereBase)
          .groupBy(tenants.id, tenants.name, warehouses.id, warehouses.name)
          .orderBy(desc(salesAgg.netSales()))
          .limit(10),

        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(posOpeningEntries)
          .innerJoin(tenants, eq(posOpeningEntries.tenantId, tenants.id))
          .where(
            and(
              eq(posOpeningEntries.status, 'open'),
              tenantId ? eq(posOpeningEntries.tenantId, tenantId) : undefined,
              businessType ? eq(tenants.businessType, businessType) : undefined
            )
          )
          .then((r) => r[0]),

        db
          .select({
            tenantId: tenants.id,
            name: tenants.name,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(posOpeningEntries)
          .innerJoin(tenants, eq(posOpeningEntries.tenantId, tenants.id))
          .where(
            and(
              eq(posOpeningEntries.status, 'open'),
              tenantId ? eq(posOpeningEntries.tenantId, tenantId) : undefined,
              businessType ? eq(tenants.businessType, businessType) : undefined
            )
          )
          .groupBy(tenants.id, tenants.name)
          .orderBy(desc(sql`COUNT(*)`))
          .limit(20),
      ])

    const netSales = toNumber(totalsRow?.netSales)
    const receipts = toInt(totalsRow?.receipts)

    return NextResponse.json({
      range,
      since: since.toISOString(),
      totals: {
        netSales,
        grossSales: toNumber(totalsRow?.grossSales),
        returns: toNumber(totalsRow?.returns),
        receipts,
        avgBasket: receipts > 0 ? Math.round((netSales / receipts) * 100) / 100 : 0,
        voids: toInt(voidsRow?.voids),
      },
      byDay: byDayRows.map((r) => ({
        date: r.date,
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
      byBusinessType: byTypeRows.map((r) => ({
        businessType: r.businessType,
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
      topVendors: topVendorRows.map((r) => ({
        tenantId: r.tenantId,
        name: r.name,
        slug: r.slug,
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
      topBranches: topBranchRows.map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName || 'Unassigned',
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
      openShifts: {
        count: toInt(openShiftTotal?.count),
        byVendor: openShiftRows.map((r) => ({
          tenantId: r.tenantId,
          name: r.name,
          count: toInt(r.count),
        })),
      },
    })
  } catch (error) {
    logError('api/sys-control/analytics/sales', error)
    return NextResponse.json({ error: 'Failed to load sales analytics' }, { status: 500 })
  }
}
