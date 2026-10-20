import { and, eq, isNull } from 'drizzle-orm'
import { stockTakes, stockTakeItems } from '@/lib/db/schema'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'
import { withSavepoint, type DbTx } from './db-types'
import { applyStockChange } from './apply-stock-change'

export class StockTakeCompletionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly lines: Array<{ lineId: string; itemId: string; itemName: string; error: string }> = [],
  ) {
    super(message)
    this.name = 'StockTakeCompletionError'
  }
}

export interface CompleteStockTakeInput {
  tenantId: string
  stockTakeId: string
  userId: string
  /** Statuses from which completion is allowed (default in_progress, pending_review). */
  allowedStatuses?: string[]
}

export interface CompleteStockTakeResult {
  stockTakeId: string
  warehouseId: string
  countNo: string
  adjustmentCount: number
  applied: Array<{ lineId: string; itemId: string; delta: number; before: number; after: number; movementId: string | null }>
}

/**
 * Complete a stock take by applying, per counted line, the RELATIVE change
 * counted − system_qty_at_count (falls back to expected_quantity). Sales or
 * receipts that happened after the line was counted are therefore preserved.
 * Each line is applied once (applied_movement_id / idempotency key
 * 'stocktake:<lineId>'). All-or-nothing: any failing line aborts the whole
 * completion with a 422 listing the failing lines.
 */
export async function completeStockTake(tx: DbTx, input: CompleteStockTakeInput): Promise<CompleteStockTakeResult> {
  const { tenantId, stockTakeId, userId } = input
  const allowed = input.allowedStatuses ?? ['in_progress', 'pending_review']

  const [stockTake] = await tx.select().from(stockTakes)
    .where(eq(stockTakes.id, stockTakeId))
    .for('update')
  if (!stockTake) throw new StockTakeCompletionError('Stock take not found', 404)
  if (!allowed.includes(stockTake.status)) {
    throw new StockTakeCompletionError(
      `Cannot complete a stock take in status "${stockTake.status}" (allowed: ${allowed.join(', ')})`, 400,
    )
  }

  const lines = await tx.select().from(stockTakeItems)
    .where(eq(stockTakeItems.stockTakeId, stockTakeId))

  const uncounted = lines.filter((l) => l.countedQuantity === null)
  if (uncounted.length > 0) {
    throw new StockTakeCompletionError(`${uncounted.length} item(s) have not been counted yet`, 400)
  }

  const failures: StockTakeCompletionError['lines'] = []
  const applied: CompleteStockTakeResult['applied'] = []

  for (const line of lines) {
    if (line.appliedMovementId || line.appliedAt || line.countedQuantity === null) continue
    const counted = parseFloat(line.countedQuantity)
    const base = parseFloat(line.systemQtyAtCount ?? line.expectedQuantity)
    const delta = Math.round((counted - base) * 1000) / 1000
    try {
      await withSavepoint(tx, async (sp) => {
        let movementId: string | null = null
        let before = base
        let after = base
        if (delta !== 0) {
          const label = delta > 0 ? 'surplus' : 'shortage'
          const res = await applyStockChange(sp, {
            tenantId,
            warehouseId: stockTake.warehouseId,
            itemId: line.itemId,
            mode: 'delta',
            qty: delta,
            type: 'adjustment',
            referenceType: 'stock_take',
            referenceId: stockTakeId,
            notes: `Stock take ${stockTake.countNo}: ${label} of ${Math.abs(delta)} units`,
            userId,
            source: 'stock_take',
            idempotencyKey: `stocktake:${line.id}`,
            allowNegative: true,
          })
          movementId = res.movementId
          before = res.before
          after = res.after

          const costPrice = parseFloat(line.costPrice || '0')
          if (costPrice > 0 && movementId && !res.skipped) {
            await postStockAdjustmentToGL(sp, tenantId, {
              adjustmentId: movementId,
              tenantId,
              itemName: line.itemName,
              quantityChange: delta,
              costPrice,
              notes: `Stock take ${stockTake.countNo}: ${label}`,
            })
          }
        }
        await sp.update(stockTakeItems)
          .set({ appliedMovementId: movementId, appliedAt: new Date() })
          .where(and(eq(stockTakeItems.id, line.id), isNull(stockTakeItems.appliedAt)))
        applied.push({ lineId: line.id, itemId: line.itemId, delta, before, after, movementId })
      })
    } catch (err) {
      failures.push({
        lineId: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (failures.length > 0) {
    throw new StockTakeCompletionError(
      `${failures.length} line(s) could not be applied; stock take not completed`, 422, failures,
    )
  }

  const now = new Date()
  await tx.update(stockTakes).set({
    status: 'completed',
    completedAt: now,
    approvedBy: userId,
    approvedAt: now,
    updatedAt: now,
  }).where(eq(stockTakes.id, stockTakeId))

  return {
    stockTakeId,
    warehouseId: stockTake.warehouseId,
    countNo: stockTake.countNo,
    adjustmentCount: applied.filter((a) => a.delta !== 0).length,
    applied,
  }
}
