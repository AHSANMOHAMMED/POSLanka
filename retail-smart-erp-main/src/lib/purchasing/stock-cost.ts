import { batchErrorInfo } from '@/lib/inventory/batches'
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { DbTx } from '@/lib/inventory/db-types'
import {
  applyStockChanges,
  type StockChangeInput,
  type StockChangeResult,
} from '@/lib/inventory/apply-stock-change'
import { toApiError } from '@/lib/db/errors'
import { recordItemChange } from '@/lib/inventory/item-audit'

/**
 * Purchasing helpers built on top of the single stock writer (applyStockChange):
 *  - weighted-average cost over the item's TOTAL stock across all warehouses,
 *  - exact reversal of previously recorded stock movements,
 *  - mapping of stock errors to API responses.
 */

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export type StockChangeRecord = { result: StockChangeResult; input: StockChangeInput }

/** Sum of current stock for an item over every warehouse of the tenant. */
export async function getTotalItemStock(tx: DbTx, tenantId: string, itemId: string): Promise<number> {
  const [row] = rows<{ total: string | null }>(await tx.execute(sql`
    SELECT COALESCE(SUM(current_stock), 0) AS total
    FROM warehouse_stock
    WHERE tenant_id = ${tenantId} AND item_id = ${itemId}
  `))
  return round3(parseFloat(row?.total || '0'))
}

export interface PurchaseCostInput {
  tenantId: string
  itemId: string
  supplierId?: string | null
  /** Unit purchase price of the incoming quantity. */
  unitPrice: number
  /** Incoming quantity (positive). */
  qty: number
  referenceId?: string | null
  referenceNo?: string | null
  userId?: string | null
  notes?: string | null
}

export interface PurchaseCostResult {
  previousCost: number
  newCost: number
  stockBefore: number
  stockAfter: number
}

/**
 * Update items.cost_price with the weighted average of the existing stock
 * (summed across ALL warehouses, read BEFORE the receipt is applied) and the
 * incoming quantity, and log an item_cost_history row (source 'purchase').
 *
 * Must be called before the matching stock increase is applied. The item row
 * is locked FOR UPDATE so concurrent receipts of the same item serialise.
 * Negative total stock is treated as zero (it carries no value to average).
 */
export async function applyPurchaseCost(tx: DbTx, input: PurchaseCostInput): Promise<PurchaseCostResult | null> {
  const qty = Number(input.qty)
  if (!(qty > 0)) return null

  const [item] = rows<{ cost_price: string | null }>(await tx.execute(sql`
    SELECT cost_price FROM items
    WHERE tenant_id = ${input.tenantId} AND id = ${input.itemId}
    FOR UPDATE
  `))
  if (!item) return null

  const previousCost = parseFloat(item.cost_price || '0')
  const stockBefore = await getTotalItemStock(tx, input.tenantId, input.itemId)
  const valuedStock = Math.max(0, stockBefore)
  const price = Number(input.unitPrice) || 0
  const totalQty = valuedStock + qty
  const newCost = totalQty > 0
    ? round2((previousCost * valuedStock + price * qty) / totalQty)
    : round2(price)
  const stockAfter = round3(stockBefore + qty)

  if (newCost !== round2(previousCost)) {
    await tx.execute(sql`
      UPDATE items
      SET cost_price = ${newCost.toFixed(2)}::numeric,
          updated_by = COALESCE(${input.userId || null}::uuid, updated_by),
          version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${input.tenantId} AND id = ${input.itemId}
    `)
    await recordItemChange(tx, {
      tenantId: input.tenantId,
      itemId: input.itemId,
      userId: input.userId || null,
      source: 'purchase',
      action: 'update',
      before: { costPrice: previousCost },
      after: { costPrice: newCost },
      notes: `Weighted-average cost${input.referenceNo ? ` from ${input.referenceNo.slice(0, 50)}` : ''}`,
    })
  }

  await tx.execute(sql`
    INSERT INTO item_cost_history (
      tenant_id, item_id, supplier_id, source, previous_cost_price, new_cost_price,
      purchase_price, quantity, stock_before, stock_after, reference_id, reference_no, notes, created_by
    ) VALUES (
      ${input.tenantId}, ${input.itemId}, ${input.supplierId || null}, 'purchase',
      ${previousCost.toFixed(2)}::numeric, ${newCost.toFixed(2)}::numeric,
      ${price.toFixed(2)}::numeric, ${qty.toFixed(3)}::numeric,
      ${stockBefore.toFixed(3)}::numeric, ${stockAfter.toFixed(3)}::numeric,
      ${input.referenceId || null}, ${input.referenceNo ? input.referenceNo.slice(0, 50) : null},
      ${input.notes || null}, ${input.userId || null}
    )
  `)

  return { previousCost, newCost, stockBefore, stockAfter }
}

export interface RecordedMovement {
  id: string
  warehouseId: string | null
  itemId: string
  qtyChange: number
}

/** Movements written for a reference (type + id), oldest first. */
export async function findMovements(
  tx: DbTx,
  tenantId: string,
  referenceType: string,
  referenceId: string,
): Promise<RecordedMovement[]> {
  const list = rows<{ id: string; warehouse_id: string | null; item_id: string; qty_change: string }>(await tx.execute(sql`
    SELECT id, warehouse_id, item_id, qty_change
    FROM stock_movements
    WHERE tenant_id = ${tenantId} AND reference_type = ${referenceType} AND reference_id = ${referenceId}
    ORDER BY created_at, id
  `))
  return list.map(m => ({ id: m.id, warehouseId: m.warehouse_id, itemId: m.item_id, qtyChange: parseFloat(m.qty_change) }))
}

export interface ReverseOptions {
  tenantId: string
  referenceType: string
  referenceId: string
  /** Idempotency key prefix; each reversal key is `${keyPrefix}:${movementId}`. */
  keyPrefix: string
  notes: string
  userId?: string | null
  source: string
  costCenterId?: string | null
}

/**
 * Reverse exactly the given movements (signed qty_change negated) through
 * applyStockChanges. Reversal keys are derived from the original movement id,
 * so a replay never reverses twice. Going negative throws INSUFFICIENT_STOCK
 * (no clamping), which rolls the whole document back.
 */
export async function reverseMovements(
  tx: DbTx,
  movements: RecordedMovement[],
  opts: ReverseOptions,
): Promise<StockChangeRecord[]> {
  const inputs: StockChangeInput[] = movements
    .filter(m => m.warehouseId && m.qtyChange !== 0)
    .map(m => ({
      tenantId: opts.tenantId,
      warehouseId: m.warehouseId!,
      itemId: m.itemId,
      mode: 'delta' as const,
      qty: -m.qtyChange,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
      notes: opts.notes,
      userId: opts.userId || null,
      source: opts.source,
      costCenterId: opts.costCenterId || null,
      idempotencyKey: `${opts.keyPrefix}:${m.id}`,
    }))
  if (inputs.length === 0) return []
  const results = await applyStockChanges(tx, inputs)
  return results.map((result, i) => ({ result, input: inputs[i] }))
}

/** Map stock-writer errors (and retryable DB errors) to an API response, or null. */
export function stockErrorResponse(err: unknown, context?: string): NextResponse | null {
  const message = err instanceof Error ? err.message : ''
  if (message.startsWith('INSUFFICIENT_STOCK:')) {
    const detail = message.slice('INSUFFICIENT_STOCK:'.length)
    return NextResponse.json({
      error: context ? `${context}: insufficient stock for ${detail}` : `Insufficient stock for ${detail}`,
      code: 'INSUFFICIENT_STOCK',
    }, { status: 400 })
  }
  // E1: batch allocation errors (INSUFFICIENT_BATCH_STOCK / BATCH_EXPIRED / ...) are user errors
  const batchError = batchErrorInfo(err)
  if (batchError) {
    return NextResponse.json({ error: context ? `${context}: ${batchError.message}` : batchError.message, code: batchError.code }, { status: 400 })
  }
  if (message === 'ITEM_NOT_FOUND' || message === 'INVALID_QUANTITY') {
    return NextResponse.json({ error: message === 'ITEM_NOT_FOUND' ? 'Item not found' : 'Invalid quantity', code: message }, { status: 400 })
  }
  return toApiError(err)
}
