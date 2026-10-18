import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db as rawDb, withTenant, withTenantTransaction } from '@/lib/db'
import { warehouses, warehouseStock, items, stockMovements } from '@/lib/db/schema'
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
    const { itemId, quantity, type, notes, binLocation, minStock, reorderQty, costCenterId } = parsed.data

    // Issue #62: Use transaction with FOR UPDATE lock for stock adjustments
    return await withTenantTransaction(session!.user.tenantId, async (tx) => {
      // Verify warehouse exists (RLS scopes to tenant)
      const warehouse = await tx.query.warehouses.findFirst({
        where: eq(warehouses.id, warehouseId),
      })

      if (!warehouse) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // Verify item exists (RLS scopes to tenant)
      const item = await tx.query.items.findFirst({
        where: eq(items.id, itemId),
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Get or create stock record with FOR UPDATE lock
      const [existingStock] = await tx
        .select()
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.warehouseId, warehouseId),
          eq(warehouseStock.itemId, itemId)
        ))
        .for('update')

      let stockRecord = existingStock

      if (!stockRecord) {
        // Create new stock record
        const [newStock] = await tx.insert(warehouseStock).values({
          tenantId: session!.user.tenantId,
          warehouseId,
          itemId,
          currentStock: '0',
          minStock: minStock != null ? minStock.toString() : '0',
          reorderQty: reorderQty != null ? reorderQty.toString() : null,
          binLocation: binLocation || null,
        }).returning()

        stockRecord = newStock
      }

      // If just updating settings (no quantity change)
      if (quantity === undefined && (binLocation !== undefined || minStock !== undefined || reorderQty !== undefined)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates: any = { updatedAt: new Date() }
        if (binLocation !== undefined) updates.binLocation = binLocation
        if (minStock !== undefined) updates.minStock = minStock.toString()
        if (reorderQty !== undefined) updates.reorderQty = reorderQty?.toString()

        const [updated] = await tx.update(warehouseStock)
          .set(updates)
          .where(eq(warehouseStock.id, stockRecord.id))
          .returning()

        logAndBroadcast(session!.user.tenantId, 'warehouse-stock', 'updated', warehouseId)
        return NextResponse.json(updated)
      }

      // Calculate new stock based on type
      const currentStockNum = parseFloat(stockRecord.currentStock || '0')
      const quantityNum = quantity ?? 0

      let newStock: number
      let movementType: 'in' | 'out' | 'adjustment'
      let movementQty: number

      switch (type) {
        case 'set':
          // Direct set
          newStock = quantityNum
          movementType = 'adjustment'
          movementQty = quantityNum - currentStockNum
          break
        case 'add':
          // Add to current stock
          newStock = currentStockNum + quantityNum
          movementType = 'in'
          movementQty = quantityNum
          break
        case 'subtract':
          // Subtract from current stock
          newStock = currentStockNum - quantityNum
          movementType = 'out'
          movementQty = -quantityNum
          if (newStock < 0) {
            return NextResponse.json({
              error: `Insufficient stock. Current: ${currentStockNum}, Requested: ${quantityNum}`
            }, { status: 400 })
          }
          break
        default:
          return NextResponse.json({ error: 'Invalid adjustment type' }, { status: 400 })
      }

      // Update stock record
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = {
        currentStock: newStock.toString(),
        updatedAt: new Date(),
      }
      if (binLocation !== undefined) updates.binLocation = binLocation
      if (minStock !== undefined) updates.minStock = minStock.toString()
      if (reorderQty !== undefined) updates.reorderQty = reorderQty?.toString()

      const [updated] = await tx.update(warehouseStock)
        .set(updates)
        .where(eq(warehouseStock.id, stockRecord.id))
        .returning()

      // Record stock movement
      const [movement] = await tx.insert(stockMovements).values({
        tenantId: session!.user.tenantId,
        warehouseId,
        itemId,
        type: movementType,
        quantity: movementQty.toString(),
        referenceType: 'manual_adjustment',
        notes: notes || `Stock ${type}: ${quantity}`,
        createdBy: session!.user.id,
        costCenterId: costCenterId || null,
      }).returning()

      // Post stock adjustment to GL (only if item has a cost price)
      const costPrice = parseFloat(item.costPrice || '0')
      if (costPrice > 0 && movementQty !== 0) {
        await postStockAdjustmentToGL(tx, session!.user.tenantId, {
          adjustmentId: movement.id,
          tenantId: session!.user.tenantId,
          itemName: item.name,
          quantityChange: movementQty,
          costPrice,
          costCenterId: costCenterId || null,
          notes: notes || `Stock ${type}: ${quantity}`,
        })
      }

      // Broadcast changes
      logAndBroadcast(session!.user.tenantId, 'warehouse-stock', 'updated', warehouseId)
      logAndBroadcast(session!.user.tenantId, 'item', 'updated', itemId)

      // AI: Stock anomaly detection (fire-and-forget)
      checkStockAnomalies(session!.user.tenantId, {
        id: updated.id,
        itemId,
        itemName: item.name,
        type: movementType,
        quantity: movementQty,
        previousStock: currentStockNum,
        reason: notes || undefined,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/warehouses/[id]/stock', error)
    return NextResponse.json({ error: 'Failed to adjust warehouse stock' }, { status: 500 })
  }
}
