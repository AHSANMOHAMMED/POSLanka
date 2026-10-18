import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { stockTakes, stockTakeItems, warehouseStock, stockMovements } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'
import { logError } from '@/lib/ai/error-logger'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST - Complete stock take: apply variance adjustments to stock
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [stockTake] = await tx.select()
      .from(stockTakes)
      .where(eq(stockTakes.id, id))
      .for('update')

    if (!stockTake) return { error: NextResponse.json({ error: 'Stock take not found' }, { status: 404 }) }

    if (!['in_progress', 'pending_review'].includes(stockTake.status)) {
      return { error: NextResponse.json({
        error: 'Stock take must be in progress or pending review to complete'
      }, { status: 400 }) }
    }

    // Get all items
    const allItems = await tx.select()
      .from(stockTakeItems)
      .where(eq(stockTakeItems.stockTakeId, id))

    // Verify all items are counted
    const uncounted = allItems.filter(i => i.countedQuantity === null)
    if (uncounted.length > 0) {
      return { error: NextResponse.json({
        error: `${uncounted.length} item(s) have not been counted yet`
      }, { status: 400 }) }
    }

    // Pre-validate accounting config before processing adjustments
    const acctError = await requireAccountingConfig(tx, session.user.tenantId, 'stock_adjustment')
    if (acctError) return { error: acctError }

    // Apply adjustments for items with variance
    let adjustmentCount = 0

    for (const item of allItems) {
      const variance = parseFloat(item.variance || '0')
      if (variance === 0) continue

      adjustmentCount++
      const countedQty = parseFloat(item.countedQuantity!)

      // Lock and update warehouse stock
      const [existingStock] = await tx.select()
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.warehouseId, stockTake.warehouseId),
          eq(warehouseStock.itemId, item.itemId)
        ))
        .for('update')

      if (existingStock) {
        await tx.update(warehouseStock)
          .set({
            currentStock: countedQty.toString(),
            updatedAt: new Date(),
          })
          .where(eq(warehouseStock.id, existingStock.id))
      }

      // Create stock movement record
      const [movement] = await tx.insert(stockMovements).values({
        tenantId: session.user.tenantId,
        warehouseId: stockTake.warehouseId,
        itemId: item.itemId,
        type: 'adjustment',
        quantity: Math.abs(variance).toString(),
        referenceType: 'stock_take',
        referenceId: id,
        notes: `Stock take ${stockTake.countNo}: ${variance > 0 ? 'surplus' : 'shortage'} of ${Math.abs(variance)} units`,
        createdBy: session.user.id,
      }).returning()

      // Post stock adjustment to GL (if item has cost price)
      const costPrice = parseFloat(item.costPrice || '0')
      if (costPrice > 0) {
        await postStockAdjustmentToGL(tx, session.user.tenantId, {
          adjustmentId: movement.id,
          tenantId: session.user.tenantId,
          itemName: item.itemName,
          quantityChange: variance, // positive = surplus, negative = shortage
          costPrice,
          notes: `Stock take ${stockTake.countNo}: ${variance > 0 ? 'surplus' : 'shortage'}`,
        })
      }
    }

    // Update stock take to completed
    await tx.update(stockTakes)
      .set({
        status: 'completed',
        completedAt: new Date(),
        approvedBy: session.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stockTakes.id, id))

    // Broadcast changes
    logAndBroadcast(session.user.tenantId, 'stock-take', 'updated', id)
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', stockTake.warehouseId)
    logAndBroadcast(session.user.tenantId, 'stock-movement', 'created', 'bulk')

    return {
      data: {
        success: true,
        message: `Stock take completed. ${adjustmentCount} adjustment(s) applied.`,
        adjustmentCount,
      }
    }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
