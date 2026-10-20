import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  sales,
  tenants,
  warehouses,
  users,
  posOpeningEntries,
  posProfiles,
  posClosingEntries,
  posClosingReconciliation,
} from '@/lib/db/schema'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { rangeSince, salesAgg, toInt, toNumber } from '../../_shared'

/**
 * GET /api/sys-control/analytics/vendors/[id]
 * Per-vendor sales breakdown for the super-admin vendor dossier.
 * Breakdowns (branch / counter / cashier) cover the last 30 days.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: tenantId } = paramsParsed.data

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { id: true, name: true, slug: true, currency: true },
    })
    if (!tenant) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const now = new Date()
    const sinceToday = rangeSince('today', now)
    const since7d = rangeSince('7d', now)
    const since30d = rangeSince('30d', now)

    const tenantSales = and(eq(sales.tenantId, tenantId), ne(sales.status, 'void'))
    const tenantSales30d = and(tenantSales, gte(sales.createdAt, since30d))

    const rangeTotals = (since: Date) => ({
      netSales: sql<string>`COALESCE(SUM(CASE WHEN ${sales.createdAt} >= ${since} THEN (CASE WHEN ${sales.isReturn} THEN -ABS(${sales.total}) ELSE ${sales.total} END) ELSE 0 END), 0)`,
      grossSales: sql<string>`COALESCE(SUM(CASE WHEN ${sales.createdAt} >= ${since} AND NOT ${sales.isReturn} THEN ${sales.total} ELSE 0 END), 0)`,
      returns: sql<string>`COALESCE(SUM(CASE WHEN ${sales.createdAt} >= ${since} AND ${sales.isReturn} THEN ABS(${sales.total}) ELSE 0 END), 0)`,
      receipts: sql<number>`COUNT(*) FILTER (WHERE ${sales.createdAt} >= ${since} AND NOT ${sales.isReturn})::int`,
    })

    const [totalsRow, byBranchRows, byCounterRows, byCashierRows, varianceRows, openShiftRows] = await Promise.all([
      db
        .select({
          todayNet: rangeTotals(sinceToday).netSales,
          todayGross: rangeTotals(sinceToday).grossSales,
          todayReturns: rangeTotals(sinceToday).returns,
          todayReceipts: rangeTotals(sinceToday).receipts,
          d7Net: rangeTotals(since7d).netSales,
          d7Gross: rangeTotals(since7d).grossSales,
          d7Returns: rangeTotals(since7d).returns,
          d7Receipts: rangeTotals(since7d).receipts,
          d30Net: rangeTotals(since30d).netSales,
          d30Gross: rangeTotals(since30d).grossSales,
          d30Returns: rangeTotals(since30d).returns,
          d30Receipts: rangeTotals(since30d).receipts,
        })
        .from(sales)
        .where(tenantSales30d)
        .then((r) => r[0]),

      db
        .select({
          warehouseId: warehouses.id,
          name: warehouses.name,
          netSales: salesAgg.netSales(),
          receipts: salesAgg.receipts(),
        })
        .from(sales)
        .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
        .where(tenantSales30d)
        .groupBy(warehouses.id, warehouses.name)
        .orderBy(desc(salesAgg.netSales())),

      db
        .select({
          posProfileId: posProfiles.id,
          name: posProfiles.name,
          netSales: salesAgg.netSales(),
          receipts: salesAgg.receipts(),
        })
        .from(sales)
        .leftJoin(posOpeningEntries, eq(sales.posOpeningEntryId, posOpeningEntries.id))
        .leftJoin(posProfiles, eq(posOpeningEntries.posProfileId, posProfiles.id))
        .where(tenantSales30d)
        .groupBy(posProfiles.id, posProfiles.name)
        .orderBy(desc(salesAgg.netSales())),

      db
        .select({
          userId: users.id,
          name: users.fullName,
          netSales: salesAgg.netSales(),
          receipts: salesAgg.receipts(),
        })
        .from(sales)
        .leftJoin(users, eq(sales.createdBy, users.id))
        .where(tenantSales30d)
        .groupBy(users.id, users.fullName)
        .orderBy(desc(salesAgg.netSales())),

      // Cash variance per cashier from closing reconciliations (last 30 days)
      db
        .select({
          userId: posClosingEntries.userId,
          variance: sql<string>`COALESCE(SUM(${posClosingReconciliation.actualAmount} - ${posClosingReconciliation.expectedAmount}), 0)`,
        })
        .from(posClosingReconciliation)
        .innerJoin(posClosingEntries, eq(posClosingReconciliation.closingEntryId, posClosingEntries.id))
        .where(
          and(
            eq(posClosingEntries.tenantId, tenantId),
            ne(posClosingEntries.status, 'cancelled'),
            gte(posClosingEntries.closingTime, since30d)
          )
        )
        .groupBy(posClosingEntries.userId),

      db
        .select({
          id: posOpeningEntries.id,
          entryNumber: posOpeningEntries.entryNumber,
          cashierName: users.fullName,
          counterName: posProfiles.name,
          warehouseName: warehouses.name,
          openingTime: posOpeningEntries.openingTime,
        })
        .from(posOpeningEntries)
        .leftJoin(users, eq(posOpeningEntries.userId, users.id))
        .leftJoin(posProfiles, eq(posOpeningEntries.posProfileId, posProfiles.id))
        .leftJoin(warehouses, eq(posOpeningEntries.warehouseId, warehouses.id))
        .where(and(eq(posOpeningEntries.tenantId, tenantId), eq(posOpeningEntries.status, 'open')))
        .orderBy(desc(posOpeningEntries.openingTime))
        .limit(50),
    ])

    const varianceByUser = new Map<string, number>()
    for (const row of varianceRows) {
      varianceByUser.set(row.userId, toNumber(row.variance))
    }

    const buildTotals = (net: unknown, gross: unknown, returns: unknown, receipts: unknown) => {
      const n = toNumber(net)
      const r = toInt(receipts)
      return {
        netSales: n,
        grossSales: toNumber(gross),
        returns: toNumber(returns),
        receipts: r,
        avgBasket: r > 0 ? Math.round((n / r) * 100) / 100 : 0,
      }
    }

    return NextResponse.json({
      vendor: tenant,
      totals: {
        today: buildTotals(totalsRow?.todayNet, totalsRow?.todayGross, totalsRow?.todayReturns, totalsRow?.todayReceipts),
        '7d': buildTotals(totalsRow?.d7Net, totalsRow?.d7Gross, totalsRow?.d7Returns, totalsRow?.d7Receipts),
        '30d': buildTotals(totalsRow?.d30Net, totalsRow?.d30Gross, totalsRow?.d30Returns, totalsRow?.d30Receipts),
      },
      byBranch: byBranchRows.map((r) => ({
        warehouseId: r.warehouseId,
        name: r.name || 'Unassigned',
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
      byCounter: byCounterRows.map((r) => ({
        posProfileId: r.posProfileId,
        name: r.name || 'No shift / counter',
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
      })),
      byCashier: byCashierRows.map((r) => ({
        userId: r.userId,
        name: r.name || 'Unknown',
        netSales: toNumber(r.netSales),
        receipts: toInt(r.receipts),
        variance: r.userId ? (varianceByUser.get(r.userId) ?? 0) : 0,
      })),
      openShifts: openShiftRows.map((r) => ({
        id: r.id,
        entryNumber: r.entryNumber,
        cashierName: r.cashierName || 'Unknown',
        counterName: r.counterName || 'Unknown',
        warehouseName: r.warehouseName || 'Unknown',
        openingTime: r.openingTime,
      })),
    })
  } catch (error) {
    logError('api/sys-control/analytics/vendors/[id]', error)
    return NextResponse.json({ error: 'Failed to load vendor analytics' }, { status: 500 })
  }
}
