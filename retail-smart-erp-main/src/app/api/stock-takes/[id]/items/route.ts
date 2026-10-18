import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { stockTakes, stockTakeItems, items } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateStockTakeItemsSchema } from '@/lib/validation/schemas/stock'
import { idParamSchema } from '@/lib/validation/schemas/common'

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

      const expectedQty = parseFloat(item.expectedQuantity)
      const countedQty = update.countedQuantity
      const variance = countedQty - expectedQty

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
          variance: variance.toString(),
          varianceValue: String(varianceValue),
          costPrice: costPrice.toString(),
          countedBy: session.user.id,
          countedAt: new Date(),
          notes: update.notes || item.notes,
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

    logAndBroadcast(session.user.tenantId, 'stock-take', 'updated', id)
    return { data: { success: true, itemsCounted: countedCount, varianceCount, totalVarianceValue } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
