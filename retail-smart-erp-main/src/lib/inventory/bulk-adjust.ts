import { eq } from 'drizzle-orm'
import { items } from '@/lib/db/schema'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'
import { applyStockChange } from './apply-stock-change'
import type { DbTx } from './db-types'

/**
 * Set stock counts for many items in one warehouse (each line: stock becomes newQuantity).
 * Shared by the vendor's own bulk adjustment and the platform console's vendor Stock tab.
 * All-or-nothing: a failing line (unknown item, GL posting failure, …) throws BulkLineError and the
 * caller's transaction rolls back, so stock and the ledger never disagree. Lines of items without a
 * cost price are applied but cannot be valued in the GL: they come back as warnings (unvalued: true).
 */
export class BulkLineError extends Error {
  constructor(public readonly itemId: string, public readonly reason: string, public readonly status = 400) {
    super(reason)
    this.name = 'BulkLineError'
  }
}

export interface BulkAdjustmentLine { itemId: string; newQuantity: number; reason?: string; reasonCode?: string }

export interface BulkAdjustmentInput {
  tenantId: string
  warehouseId: string
  /** null when the change is not made by a vendor user (platform console) */
  userId: string | null
  /** default reason code for lines without their own */
  reasonCode?: string
  /** default note for lines without their own reason */
  defaultNote: string
  /** stock_movements.reference_type */
  referenceType: string
  adjustments: BulkAdjustmentLine[]
}

export interface BulkAdjustmentResult {
  adjusted: number
  warnings: string[]
  results: Array<{ itemId: string; itemName: string; before: number; after: number; delta: number; movementId: string | null; unvalued: boolean }>
  /** warehouse_stock rows that changed (for broadcasts) */
  changedStockIds: string[]
}

export async function applyBulkAdjustment(tx: DbTx, input: BulkAdjustmentInput): Promise<BulkAdjustmentResult> {
  const { tenantId, warehouseId, userId } = input
  let adjusted = 0
  const warnings: string[] = []
  const results: BulkAdjustmentResult['results'] = []
  const changedStockIds: string[] = []

  // Deterministic lock order (itemId) to avoid deadlocks with concurrent batches
  const ordered = [...input.adjustments].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))

  for (const adj of ordered) {
    const [item] = await tx.select({ name: items.name, costPrice: items.costPrice })
      .from(items).where(eq(items.id, adj.itemId)).limit(1)
    if (!item) throw new BulkLineError(adj.itemId, 'item not found', 404)
    const reasonCode = adj.reasonCode || input.reasonCode || 'count_correction'
    const note = adj.reason || input.defaultNote

    const change = await applyStockChange(tx, {
      tenantId,
      warehouseId,
      itemId: adj.itemId,
      mode: 'set',
      qty: adj.newQuantity,
      type: 'adjustment',
      referenceType: input.referenceType,
      notes: note,
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
            notes: adj.reason || `${input.defaultNote}: ${change.delta > 0 ? '+' : ''}${change.delta} units`,
          })
        } catch (glErr) {
          throw new BulkLineError(adj.itemId, `GL posting failed: ${glErr instanceof Error ? glErr.message.replace(/^GL_ACCOUNTS_MISSING:\s*/, '') : String(glErr)}`)
        }
      } else {
        unvalued = true
        warnings.push(`${item.name}: no cost price — ${change.delta > 0 ? '+' : ''}${change.delta} units adjusted but not valued in the GL`)
      }
      adjusted++
      changedStockIds.push(change.warehouseStockId)
    }
    results.push({ itemId: adj.itemId, itemName: item.name, before: change.before, after: change.after, delta: change.delta, movementId: change.movementId, unvalued })
  }

  return { adjusted, warnings, results, changedStockIds }
}
