import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, gt, isNotNull, lte, sql, type SQL } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { itemBatches, items, warehouses } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { getBranchScope, canAccessBranch, branchDeniedResponse, branchFilter } from '@/lib/auth/branch-access'

/**
 * GET /api/pharmacy/expiry?days=90&warehouseId= — batches in stock that are expired or expire within
 * `days` (default 90), soonest first, with the stock value at cost. For returns to suppliers and
 * moving short-dated stock; the POS already sells first-expiring stock first and blocks expired.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError
    const sp = request.nextUrl.searchParams
    const days = Math.min(730, Math.max(0, Number(sp.get('days') ?? 90) || 0))
    const warehouseId = sp.get('warehouseId')
    const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)

    const where: SQL[] = [
      eq(itemBatches.tenantId, session.user.tenantId),
      isNotNull(itemBatches.expiryDate),
      lte(itemBatches.expiryDate, until),
      gt(itemBatches.currentQuantity, '0'),
    ]
    if (warehouseId && /^[0-9a-f-]{36}$/i.test(warehouseId)) where.push(eq(itemBatches.warehouseId, warehouseId))

    return await withTenant(session.user.tenantId, async (db) => {
      // K4: branch-restricted users see their own branches' batches only
      const scope = await getBranchScope(session, db)
      if (warehouseId && !canAccessBranch(scope, warehouseId)) return branchDeniedResponse(scope, db)
      const branchCond = branchFilter(scope, itemBatches.warehouseId, { includeUnassigned: true })
      if (branchCond) where.push(branchCond)
      const rows = await db.select({
        batchId: itemBatches.id, batchNumber: itemBatches.batchNumber, expiryDate: itemBatches.expiryDate,
        quantity: itemBatches.currentQuantity, status: itemBatches.status,
        itemId: items.id, itemName: items.name, genericName: items.genericName, strength: items.strength,
        drugSchedule: items.drugSchedule, costPrice: items.costPrice, unit: items.unit,
        warehouseName: warehouses.name,
        daysLeft: sql<number>`(${itemBatches.expiryDate} - CURRENT_DATE)::int`,
      })
        .from(itemBatches)
        .innerJoin(items, eq(items.id, itemBatches.itemId))
        .leftJoin(warehouses, eq(warehouses.id, itemBatches.warehouseId))
        .where(and(...where))
        .orderBy(asc(itemBatches.expiryDate), asc(items.name))
        .limit(1000)
      const value = (r: typeof rows[number]) => Number(r.quantity) * Number(r.costPrice || 0)
      const expired = rows.filter((r) => (r.expiryDate ?? '') < today)
      return NextResponse.json({
        days,
        data: rows.map((r) => ({ ...r, stockValue: Math.round(value(r) * 100) / 100 })),
        summary: {
          batches: rows.length,
          expiredBatches: expired.length,
          expiredValue: Math.round(expired.reduce((s, r) => s + value(r), 0) * 100) / 100,
          expiringValue: Math.round(rows.filter((r) => !expired.includes(r)).reduce((s, r) => s + value(r), 0) * 100) / 100,
        },
      })
    })
  } catch (error) {
    logError('api/pharmacy/expiry', error)
    return NextResponse.json({ error: 'Failed to load the expiry report' }, { status: 500 })
  }
}
