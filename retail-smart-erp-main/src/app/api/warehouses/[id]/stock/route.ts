import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db as rawDb, withTenant, withTenantTransaction } from '@/lib/db'
import { warehouses, warehouseStock, items } from '@/lib/db/schema'
import { eq, and, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { checkStockAnomalies } from '@/lib/ai/anomaly-detector'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { warehouseStockListSchema, adjustWarehouseStockSchema } from '@/lib/validation/schemas/stock'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import type { DbTx } from '@/lib/inventory/db-types'
import { toApiError } from '@/lib/db/errors'
import { assertBranchAccess } from '@/lib/auth/branch-access'

async function currentStockOf(tx: DbTx, warehouseId: string, itemId: string): Promise<number> {
  const [row] = await tx.select({ currentStock: warehouseStock.currentStock }).from(warehouseStock)
    .where(and(eq(warehouseStock.warehouseId, warehouseId), eq(warehouseStock.itemId, itemId)))
  return row ? parseFloat(row.currentStock) : 0
}

// GET warehouse stock (with pagination)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: warehouseId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify warehouse exists (RLS scopes to tenant)
      const warehouse = await db.query.warehouses.findFirst({
        where: eq(warehouses.id, warehouseId),
      })

      if (!warehouse) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // K4: only the user's own branches
      const branchDenied = await assertBranchAccess(session, warehouseId, db)
      if (branchDenied) return branchDenied

      const qsParsed = validateSearchParams(request, warehouseStockListSchema)
      if (!qsParsed.success) return qsParsed.response
      const { page, pageSize, search, all, lowStockOnly } = qsParsed.data

      // Build base query
      const conditions = [eq(warehouseStock.warehouseId, warehouseId)]

      if (lowStockOnly) {
        conditions.push(sql`${warehouseStock.currentStock} <= ${warehouseStock.minStock}`)
      }

      const whereClause = and(...conditions)

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(warehouseStock)
        .innerJoin(items, eq(warehouseStock.itemId, items.id))
        .where(and(
          whereClause,
          search ? ilike(items.name, `%${escapeLikePattern(search)}%`) : sql`1=1`
        ))

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)

      // Get results with item details
      const results = await db
        .select({
          id: warehouseStock.id,
          warehouseId: warehouseStock.warehouseId,
          itemId: warehouseStock.itemId,
          currentStock: warehouseStock.currentStock,
          minStock: warehouseStock.minStock,
          reorderQty: warehouseStock.reorderQty,
          maxStock: warehouseStock.maxStock,
          binLocation: warehouseStock.binLocation,
          updatedAt: warehouseStock.updatedAt,
          item: {
            id: items.id,
            name: items.name,
            sku: items.sku,
            barcode: items.barcode,
            unit: items.unit,
            sellingPrice: items.sellingPrice,
            costPrice: items.costPrice,
            trackStock: items.trackStock,
            isActive: items.isActive,
          }
        })
        .from(warehouseStock)
        .innerJoin(items, eq(warehouseStock.itemId, items.id))
        .where(and(
          whereClause,
          search ? ilike(items.name, `%${escapeLikePattern(search)}%`) : sql`1=1`
        ))
        .orderBy(items.name)
        .limit(all ? 1000 : pageSize)
        .offset(all ? 0 : (page - 1) * pageSize)

      if (all) {
        return NextResponse.json(results)
      }

      return NextResponse.json({
        data: results,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/warehouses/[id]/stock', error)
    return NextResponse.json({ error: 'Failed to fetch warehouse stock' }, { status: 500 })
  }
}

// POST adjust warehouse stock
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError
    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    // Pre-validate accounting config before starting transaction
    const acctError = await requireAccountingConfig(rawDb, session!.user.tenantId, 'stock_adjustment')
    if (acctError) return acctError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: warehouseId } = paramsParsed.data

    const parsed = await validateBody(request, adjustWarehouseStockSchema)
    if (!parsed.success) return parsed.response
    const { itemId, quantity, type, notes, binLocation, minStock, reorderQty, maxStock, costCenterId, reasonCode } = parsed.data

    // Issue #62: Use transaction with FOR UPDATE lock for stock adjustments
    return await withTenantTransaction(session!.user.tenantId, async (tx) => {
      // Verify warehouse exists (RLS scopes to tenant)
      const warehouse = await tx.query.warehouses.findFirst({
        where: eq(warehouses.id, warehouseId),
      })

      if (!warehouse) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // K4: only the user's own branches
      const branchDenied = await assertBranchAccess(session, warehouseId, tx)
      if (branchDenied) return branchDenied

      // Verify item exists (RLS scopes to tenant)
      const item = await tx.query.items.findFirst({
        where: eq(items.id, itemId),
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      const tenantId = session!.user.tenantId
      const userId = session!.user.id

      // If just updating settings (no quantity change)
      if (quantity === undefined) {
        if (binLocation === undefined && minStock === undefined && reorderQty === undefined && maxStock === undefined) {
          return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
        }
        await tx.insert(warehouseStock).values({
          tenantId,
          warehouseId,
          itemId,
          currentStock: '0',
        }).onConflictDoNothing()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates: any = { updatedAt: new Date() }
        if (binLocation !== undefined) updates.binLocation = binLocation
        if (minStock !== undefined) updates.minStock = minStock.toString()
        if (reorderQty !== undefined) updates.reorderQty = reorderQty?.toString()
        if (maxStock !== undefined) updates.maxStock = maxStock === null ? null : maxStock.toString()

        const [updated] = await tx.update(warehouseStock)
          .set(updates)
          .where(and(
            eq(warehouseStock.warehouseId, warehouseId),
            eq(warehouseStock.itemId, itemId)
          ))
          .returning()

        logAndBroadcast(tenantId, 'warehouse-stock', 'updated', warehouseId, { userId })
        return NextResponse.json(updated)
      }

      const quantityNum = quantity
      if (type !== 'set' && type !== 'add' && type !== 'subtract') {
        return NextResponse.json({ error: 'Invalid adjustment type' }, { status: 400 })
      }
      if ((type === 'add' || type === 'subtract') && quantityNum < 0) {
        return NextResponse.json({ error: 'Quantity must not be negative' }, { status: 400 })
      }
      if (type === 'set' && quantityNum < 0) {
        return NextResponse.json({ error: 'Stock cannot be set below zero' }, { status: 400 })
      }

      // Single ledger writer: locks the row, records signed qty_change + before/after
      let change
      try {
        change = await applyStockChange(tx, {
          tenantId,
          warehouseId,
          itemId,
          mode: type === 'set' ? 'set' : 'delta',
          qty: type === 'subtract' ? -quantityNum : quantityNum,
          type: type === 'set' ? 'adjustment' : type === 'add' ? 'in' : 'out',
          referenceType: 'manual_adjustment',
          notes: notes || `Stock ${type}: ${quantity}`,
          userId,
          source: 'manual',
          costCenterId: costCenterId || null,
          reasonCode: reasonCode || (type === 'set' ? 'count_correction' : 'other'),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        if (message.startsWith('INSUFFICIENT_STOCK:')) {
          return NextResponse.json({
            error: `Insufficient stock. Current: ${await currentStockOf(tx, warehouseId, itemId)}, Requested: ${quantityNum}`,
            code: 'INSUFFICIENT_STOCK',
          }, { status: 400 })
        }
        throw err
      }

      // Optional settings in the same request
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settingUpdates: any = {}
      if (binLocation !== undefined) settingUpdates.binLocation = binLocation
      if (minStock !== undefined) settingUpdates.minStock = minStock.toString()
      if (reorderQty !== undefined) settingUpdates.reorderQty = reorderQty?.toString()
      if (maxStock !== undefined) settingUpdates.maxStock = maxStock === null ? null : maxStock.toString()
      if (Object.keys(settingUpdates).length > 0) {
        await tx.update(warehouseStock)
          .set({ ...settingUpdates, updatedAt: new Date() })
          .where(eq(warehouseStock.id, change.warehouseStockId))
      }
      const [updated] = await tx.select().from(warehouseStock)
        .where(eq(warehouseStock.id, change.warehouseStockId))

      // Post stock adjustment to GL (only if item has a cost price)
      const costPrice = parseFloat(item.costPrice || '0')
      if (costPrice > 0 && change.delta !== 0 && change.movementId) {
        await postStockAdjustmentToGL(tx, tenantId, {
          adjustmentId: change.movementId,
          tenantId,
          itemName: item.name,
          quantityChange: change.delta,
          costPrice,
          costCenterId: costCenterId || null,
          notes: notes || `Stock ${type}: ${quantity}`,
          reasonCode: reasonCode || (type === 'set' ? 'count_correction' : 'other'),
        })
      }
      // H3: an item without a cost price cannot be valued: the change is not in the GL — say so
      const unvalued = costPrice <= 0 && change.delta !== 0

      // Broadcast changes
      logAndBroadcast(tenantId, 'warehouse-stock', 'updated', warehouseId, { userId })
      logAndBroadcast(tenantId, 'item', 'updated', itemId, { userId })

      // AI: Stock anomaly detection (fire-and-forget)
      if (change.delta !== 0) {
        checkStockAnomalies(tenantId, {
          id: updated.id,
          itemId,
          itemName: item.name,
          type: type === 'set' ? 'adjustment' : type === 'add' ? 'in' : 'out',
          quantity: change.delta,
          previousStock: change.before,
          reason: notes || undefined,
        })
      }

      return NextResponse.json(unvalued
        ? { ...updated, unvalued: true, warning: `${item.name} has no cost price: this adjustment is not valued in the GL` }
        : updated)
    })
  } catch (error) {
    const mapped = toApiError(error)
    if (mapped) return mapped
    logError('api/warehouses/[id]/stock', error)
    return NextResponse.json({ error: 'Failed to adjust warehouse stock' }, { status: 500 })
  }
}
