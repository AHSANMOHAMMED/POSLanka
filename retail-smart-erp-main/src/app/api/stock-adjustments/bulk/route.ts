import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { items, warehouses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { bulkStockAdjustmentSchema } from '@/lib/validation/schemas/stock'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { withSavepoint } from '@/lib/inventory/db-types'
import { toApiError } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'

// POST - Apply bulk stock adjustments (each line: set stock to newQuantity)
// Each line runs in its own savepoint so one failure does not abort the others.
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkStockAdjustmentSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      const tenantId = session.user.tenantId
      const userId = session.user.id

      const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses)
        .where(eq(warehouses.id, body.warehouseId)).limit(1)
      if (!warehouse) return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }

      let adjusted = 0
      const errors: string[] = []
      const results: Array<{ itemId: string; before: number; after: number; delta: number; movementId: string | null }> = []

      // Deterministic lock order (itemId) to avoid deadlocks with concurrent batches
      const ordered = [...body.adjustments].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))

      for (const adj of ordered) {
        try {
          const res = await withSavepoint(tx, async (sp) => {
            const [item] = await sp.select({ name: items.name, costPrice: items.costPrice })
              .from(items).where(eq(items.id, adj.itemId)).limit(1)
            if (!item) throw new Error('ITEM_NOT_FOUND')

            const change = await applyStockChange(sp, {
              tenantId,
              warehouseId: body.warehouseId,
              itemId: adj.itemId,
              mode: 'set',
              qty: adj.newQuantity,
              type: 'adjustment',
              referenceType: 'bulk_adjustment',
              notes: adj.reason || 'Bulk adjustment',
              userId,
              source: 'manual',
            })
            if (change.delta !== 0 && change.movementId) {
              const costPrice = parseFloat(item.costPrice || '0')
              if (costPrice > 0) {
                try {
                  await withSavepoint(sp, (gl) => postStockAdjustmentToGL(gl, tenantId, {
                    adjustmentId: change.movementId!,
                    tenantId,
                    itemName: item.name,
                    quantityChange: change.delta,
                    costPrice,
                    notes: adj.reason || `Bulk adjustment: ${change.delta > 0 ? '+' : ''}${change.delta} units`,
                  }))
                } catch (glErr) {
                  console.warn(`[GL] Failed to post stock adjustment for item ${adj.itemId}:`, glErr)
                }
              }
            }
            return change
          })
          if (res.delta !== 0) {
            adjusted++
            logAndBroadcast(tenantId, 'warehouse-stock', 'updated', res.warehouseStockId, { userId })
          }
          results.push({ itemId: adj.itemId, before: res.before, after: res.after, delta: res.delta, movementId: res.movementId })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'adjustment failed'
          errors.push(`Item ${adj.itemId}: ${msg === 'ITEM_NOT_FOUND' ? 'item not found' : 'adjustment failed'}`)
        }
      }

      logAndBroadcast(tenantId, 'stock-movement', 'created', 'bulk', { userId })

      return { data: { adjusted, total: body.adjustments.length, errors, results } }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (error) {
    const mapped = toApiError(error)
    if (mapped) return mapped
    logError('api/stock-adjustments/bulk', error)
    return NextResponse.json({ error: 'Failed to apply stock adjustments' }, { status: 500 })
  }
}
