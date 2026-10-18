import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { warehouseStock, stockMovements, items } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { bulkStockAdjustmentSchema } from '@/lib/validation/schemas/stock'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'

// POST - Apply bulk stock adjustments
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkStockAdjustmentSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    let adjusted = 0
    const errors: string[] = []

    for (const adj of body.adjustments) {
      try {
        // Lock and update warehouse stock
        const [existingStock] = await tx.select()
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.itemId, adj.itemId),
            eq(warehouseStock.warehouseId, body.warehouseId)
          ))
          .for('update')

        if (!existingStock) {
          errors.push(`Item ${adj.itemId}: no stock record in this warehouse`)
          continue
        }

        const currentQty = parseFloat(existingStock.currentStock)
        const variance = adj.newQuantity - currentQty

        if (variance === 0) continue // No change needed

        await tx.update(warehouseStock)
          .set({
            currentStock: adj.newQuantity.toString(),
            updatedAt: new Date(),
          })
          .where(eq(warehouseStock.id, existingStock.id))

        // Create stock movement record
        const [movement] = await tx.insert(stockMovements).values({
          tenantId: session.user.tenantId,
          warehouseId: body.warehouseId,
          itemId: adj.itemId,
          type: 'adjustment',
          quantity: Math.abs(variance).toString(),
          referenceType: 'bulk_adjustment',
          notes: adj.reason || `Bulk adjustment: ${variance > 0 ? '+' : ''}${variance} units`,
          createdBy: session.user.id,
        }).returning()

        // Post stock adjustment to GL (only if item has a cost price)
        const [item] = await tx.select({ name: items.name, costPrice: items.costPrice })
          .from(items).where(eq(items.id, adj.itemId)).limit(1)

        if (item) {
          const costPrice = parseFloat(item.costPrice || '0')
          if (costPrice > 0 && variance !== 0) {
            try {
              await postStockAdjustmentToGL(tx, session.user.tenantId, {
                adjustmentId: movement.id,
                tenantId: session.user.tenantId,
                itemName: item.name,
                quantityChange: variance,
                costPrice,
                notes: adj.reason || `Bulk adjustment: ${variance > 0 ? '+' : ''}${variance} units`,
              })
            } catch (glErr) {
              console.warn(`[GL] Failed to post stock adjustment for item ${adj.itemId}:`, glErr)
            }
          }
        }

        adjusted++
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', existingStock.id)
      } catch {
        errors.push(`Item ${adj.itemId}: adjustment failed`)
      }
    }

    logAndBroadcast(session.user.tenantId, 'stock-movement', 'created', 'bulk')

    return { data: { adjusted, total: body.adjustments.length, errors } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
