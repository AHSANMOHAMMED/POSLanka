import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { items, warehouseStock } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { bulkStockAdjustmentPreviewSchema } from '@/lib/validation/schemas/stock'

// POST - Preview bulk stock adjustments
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkStockAdjustmentPreviewSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return { error: permError }

    const preview = []
    for (const adj of body.adjustments) {
      const [item] = await db.select({ id: items.id, name: items.name, sku: items.sku })
        .from(items)
        .where(eq(items.id, adj.itemId))

      if (!item) {
        preview.push({ itemId: adj.itemId, error: 'Item not found' })
        continue
      }

      const [stock] = await db.select({
        currentStock: warehouseStock.currentStock,
      })
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.itemId, adj.itemId),
          eq(warehouseStock.warehouseId, body.warehouseId)
        ))

      const currentQty = stock ? parseFloat(stock.currentStock) : 0
      const variance = adj.newQuantity - currentQty

      preview.push({
        itemId: adj.itemId,
        name: item.name,
        sku: item.sku,
        currentQuantity: currentQty,
        newQuantity: adj.newQuantity,
        variance,
        reason: adj.reason || '',
      })
    }

    return { data: preview }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
