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
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { logError } from '@/lib/ai/error-logger'

// POST - Apply bulk stock adjustments (each line: set stock to newQuantity)
// H3: all-or-nothing — one failing line (unknown item, GL posting failure, …) rolls the whole
// batch back, so stock and the ledger never disagree. Lines of items without a cost price are
// applied but cannot be valued in the GL: they are returned as warnings (unvalued: true).
class BulkLineError extends Error {
  constructor(public readonly itemId: string, public readonly reason: string, public readonly status = 400) {
    super(reason)
    this.name = 'BulkLineError'
  }
}

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

      // Configuration problems fail before anything is written
      const acctError = await requireAccountingConfig(tx, tenantId, 'stock_adjustment')
      if (acctError) return { error: acctError }

      let adjusted = 0
      const warnings: string[] = []
      const results: Array<{ itemId: string; before: number; after: number; delta: number; movementId: string | null; unvalued: boolean }> = []
      const broadcastIds: string[] = []

      // Deterministic lock order (itemId) to avoid deadlocks with concurrent batches
      const ordered = [...body.adjustments].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))

      for (const adj of ordered) {
        const [item] = await tx.select({ name: items.name, costPrice: items.costPrice })
          .from(items).where(eq(items.id, adj.itemId)).limit(1)
        if (!item) throw new BulkLineError(adj.itemId, 'item not found', 404)
        const reasonCode = adj.reasonCode || body.reasonCode || 'count_correction'

        const change = await applyStockChange(tx, {
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
          reasonCode,
        })
        let unvalued = false
        if (change.delta !== 0 && change.movementId) {
          const costPrice = parseFloat(item.costPrice || '0')
          if (costPrice > 0) {
            try {
              await postStockAdjustmentToGL(tx, tenantId, {
                adjustmentId: change.movementId,
                tenantId,
                itemName: item.name,
                quantityChange: change.delta,
                costPrice,
                reasonCode,
                notes: adj.reason || `Bulk adjustment: ${change.delta > 0 ? '+' : ''}${change.delta} units`,
              })
            } catch (glErr) {
              throw new BulkLineError(adj.itemId, `GL posting failed: ${glErr instanceof Error ? glErr.message.replace(/^GL_ACCOUNTS_MISSING:\s*/, '') : String(glErr)}`)
            }
          } else {
            unvalued = true
            warnings.push(`${item.name}: no cost price — ${change.delta > 0 ? '+' : ''}${change.delta} units adjusted but not valued in the GL`)
          }
          adjusted++
          broadcastIds.push(change.warehouseStockId)
        }
        results.push({ itemId: adj.itemId, before: change.before, after: change.after, delta: change.delta, movementId: change.movementId, unvalued })
      }

      for (const id of broadcastIds) logAndBroadcast(tenantId, 'warehouse-stock', 'updated', id, { userId })
      logAndBroadcast(tenantId, 'stock-movement', 'created', 'bulk', { userId })

      return { data: { adjusted, total: body.adjustments.length, errors: [] as string[], warnings, results } }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (error) {
    if (error instanceof BulkLineError) {
      return NextResponse.json({
        error: `No adjustments applied: item ${error.itemId}: ${error.reason}`,
        code: 'BULK_ADJUSTMENT_FAILED',
        errors: [`Item ${error.itemId}: ${error.reason}`],
      }, { status: error.status })
    }
    const stockErr = stockErrorResponse(error, 'No adjustments applied')
    if (stockErr) return stockErr
    logError('api/stock-adjustments/bulk', error)
    return NextResponse.json({ error: 'Failed to apply stock adjustments' }, { status: 500 })
  }
}
