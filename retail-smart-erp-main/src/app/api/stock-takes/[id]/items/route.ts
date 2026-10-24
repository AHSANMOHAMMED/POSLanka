import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { stockTakes, stockTakeItems, items, warehouseStock } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateStockTakeItemsSchema } from '@/lib/validation/schemas/stock'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { assertRecordBranch } from '@/lib/auth/branch-access'

// PUT - Bulk update counted quantities
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateStockTakeItemsSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return { error: permError }

    // K4: only counts of the user's own branches
    const branchDenied = await assertRecordBranch(session, tx, stockTakes, id)
    if (branchDenied) return { error: branchDenied }

    const [stockTake] = await tx.select()
      .from(stockTakes)
      .where(eq(stockTakes.id, id))
      .for('update')

    if (!stockTake) return { error: NextResponse.json({ error: 'Stock take not found' }, { status: 404 }) }

    if (!['draft', 'in_progress'].includes(stockTake.status)) {
      return { error: NextResponse.json({ error: 'Can only update counts on draft or in-progress stock takes' }, { status: 400 }) }
    }

    let countedCount = 0
    let varianceCount = 0
    let totalVarianceValue = 0

    for (const update of body.items) {
      const [item] = await tx.select()
        .from(stockTakeItems)
        .where(eq(stockTakeItems.id, update.itemId))

      if (!item || item.stockTakeId !== id) continue
      if (item.appliedAt) continue // already applied to stock; immutable

      // Capture the live system quantity at the moment the count is entered.
      // Completion applies (counted - systemQtyAtCount), so sales/receipts that
      // happen between counting and completion are preserved.
      const [live] = await tx.select({ currentStock: warehouseStock.currentStock })
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.warehouseId, stockTake.warehouseId),
          eq(warehouseStock.itemId, item.itemId),
        ))
      const systemQty = live ? parseFloat(live.currentStock) : 0
      const countedQty = update.countedQuantity
      const variance = Math.round((countedQty - systemQty) * 1000) / 1000

      // Use stored costPrice; if 0, look up current cost from items table
      let costPrice = parseFloat(item.costPrice || '0')
      if (costPrice === 0) {
        const [source] = await tx.select({
          cost: sql<string>`CASE WHEN COALESCE(${items.costPrice}, 0) > 0 THEN ${items.costPrice} ELSE COALESCE(${items.valuationRate}, 0) END`,
        }).from(items).where(eq(items.id, item.itemId))
        if (source) costPrice = parseFloat(source.cost || '0')
      }

      const varianceValue = Math.round(variance * costPrice * 100) / 100

      await tx.update(stockTakeItems)
        .set({
          countedQuantity: countedQty.toString(),
          systemQtyAtCount: systemQty.toString(),
          variance: variance.toString(),
          varianceValue: String(varianceValue),
          costPrice: costPrice.toString(),
          countedBy: session.user.id,
          countedAt: new Date(),
          notes: update.notes || item.notes,
          ...(update.reasonCode ? { reasonCode: update.reasonCode } : {}),
        })
        .where(eq(stockTakeItems.id, update.itemId))
    }

    // Recalculate summary from all items
    const allItems = await tx.select()
      .from(stockTakeItems)
      .where(eq(stockTakeItems.stockTakeId, id))

    for (const item of allItems) {
      if (item.countedQuantity !== null) {
        countedCount++
        const v = parseFloat(item.variance || '0')
        if (v !== 0) varianceCount++
        totalVarianceValue += parseFloat(item.varianceValue || '0')
      }
    }

    await tx.update(stockTakes)
      .set({
        itemsCounted: countedCount,
        varianceCount,
        totalVarianceValue: totalVarianceValue.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(stockTakes.id, id))

    logAndBroadcast(session.user.tenantId, 'stock-take', 'updated', id, { userId: session.user.id })
    return { data: { success: true, itemsCounted: countedCount, varianceCount, totalVarianceValue } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
