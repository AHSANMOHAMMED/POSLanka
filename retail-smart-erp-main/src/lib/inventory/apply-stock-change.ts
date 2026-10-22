import { sql } from 'drizzle-orm'
import type { DbTx } from './db-types'
import { stockAlertListener } from '@/lib/notifications/stock-alerts'

/**
 * The single writer for warehouse stock. Every stock change:
 *  1. upserts the warehouse_stock row (so a missing row never silently drops a change),
 *  2. locks it FOR UPDATE (lock_timeout 5s → 55P03, mapped to 409 CONFLICT_RETRY),
 *  3. replays idempotently when `idempotencyKey` was already applied,
 *  4. applies the delta / target, enforcing the negative-stock policy,
 *  5. records a signed ledger row (qty_change, stock_before, stock_after).
 */

export type StockChangeMode = 'delta' | 'set'
export type StockMovementKind = 'in' | 'out' | 'adjustment'

export interface StockChangeInput {
  tenantId: string
  warehouseId: string
  itemId: string
  /** 'delta' adds qty (signed); 'set' makes the stock exactly qty. */
  mode: StockChangeMode
  qty: number
  /** Override the movement type (default: in/out by sign, adjustment for 'set'). */
  type?: StockMovementKind
  referenceType: string
  referenceId?: string | null
  notes?: string | null
  userId?: string | null
  /** Where the change came from: pos | manual | import | intake | stock_take | system | api … */
  source: string
  costCenterId?: string | null
  /** Unique per tenant; a replay returns the original movement with skipped=true. */
  idempotencyKey?: string | null
  /** Allow the result to go below zero (stock takes, corrections). Default false. */
  allowNegative?: boolean
  /** H3: adjustment reason code (src/lib/inventory/adjustment-reasons.ts), stored on the movement. */
  reasonCode?: string | null
}

export interface StockChangeResult {
  movementId: string | null
  before: number
  after: number
  delta: number
  /** true when the idempotency key had already been applied (nothing changed). */
  skipped: boolean
  minStock: number
  /** true when this change moved stock from above minStock to at/below it. */
  crossedMin: boolean
  itemName: string
  warehouseStockId: string
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

type StockDecreasedListener = (result: StockChangeResult, input: StockChangeInput) => void

const decreaseListeners = new Set<StockDecreasedListener>([stockAlertListener]) // W5 low/out-of-stock alerts

/**
 * Register a listener for stock decreases (e.g. low-stock alerts). Listeners are
 * not called automatically inside the transaction; callers invoke
 * `notifyStockDecreased(results)` after commit.
 */
export function onStockDecreased(cb: StockDecreasedListener): () => void {
  decreaseListeners.add(cb)
  return () => decreaseListeners.delete(cb)
}

/** Fire registered listeners for results that decreased stock (call after commit). */
export function notifyStockDecreased(results: Array<{ result: StockChangeResult; input: StockChangeInput }>): void {
  for (const { result, input } of results) {
    if (result.skipped || result.delta >= 0) continue
    for (const cb of decreaseListeners) {
      try { cb(result, input) } catch { /* listeners must never break the caller */ }
    }
  }
}

export async function applyStockChange(tx: DbTx, input: StockChangeInput): Promise<StockChangeResult> {
  const {
    tenantId, warehouseId, itemId, mode, referenceType, source,
  } = input
  const qty = Number(input.qty)
  if (!Number.isFinite(qty)) throw new Error('INVALID_QUANTITY')
  if (mode === 'set' && qty < 0 && !input.allowNegative) throw new Error('INVALID_QUANTITY')

  await tx.execute(sql`SELECT set_config('lock_timeout', '5s', true)`)

  // 1. make sure the stock row exists (concurrent creators are fine: DO NOTHING)
  await tx.execute(sql`
    INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock)
    VALUES (${tenantId}, ${warehouseId}, ${itemId}, 0)
    ON CONFLICT (warehouse_id, item_id, tenant_id) DO NOTHING
  `)

  // 2. lock it
  const [locked] = rows<{
    id: string; current_stock: string; min_stock: string; track_stock: boolean; item_name: string
  }>(await tx.execute(sql`
    SELECT ws.id, ws.current_stock, ws.min_stock, i.track_stock, i.name AS item_name
    FROM warehouse_stock ws
    JOIN items i ON i.id = ws.item_id
    WHERE ws.tenant_id = ${tenantId} AND ws.warehouse_id = ${warehouseId} AND ws.item_id = ${itemId}
    FOR UPDATE OF ws
  `))
  if (!locked) throw new Error('ITEM_NOT_FOUND')

  const before = round3(parseFloat(locked.current_stock || '0'))
  const minStock = round3(parseFloat(locked.min_stock || '0'))

  // 3. idempotent replay — checked after the row lock so a concurrent duplicate
  //    waits for the first writer and then sees its movement.
  if (input.idempotencyKey) {
    const [existing] = rows<{ id: string; qty_change: string; stock_before: string | null; stock_after: string | null }>(
      await tx.execute(sql`
        SELECT id, qty_change, stock_before, stock_after FROM stock_movements
        WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `),
    )
    if (existing) {
      return {
        movementId: existing.id,
        before: existing.stock_before !== null ? parseFloat(existing.stock_before) : before,
        after: existing.stock_after !== null ? parseFloat(existing.stock_after) : before,
        delta: parseFloat(existing.qty_change),
        skipped: true,
        minStock,
        crossedMin: false,
        itemName: locked.item_name,
        warehouseStockId: locked.id,
      }
    }
  }

  // 4. compute + policy
  const delta = round3(mode === 'set' ? qty - before : qty)
  const after = round3(before + delta)
  if (!input.allowNegative && delta < 0 && after < 0 && locked.track_stock) {
    throw new Error(`INSUFFICIENT_STOCK:${locked.item_name} (need: ${Math.abs(delta)}, have: ${before})`)
  }

  const crossedMin = minStock > 0 && before > minStock && after <= minStock

  if (delta === 0) {
    return {
      movementId: null, before, after, delta: 0, skipped: false, minStock, crossedMin: false,
      itemName: locked.item_name, warehouseStockId: locked.id,
    }
  }

  await tx.execute(sql`
    UPDATE warehouse_stock
    SET current_stock = ${after.toFixed(3)}::numeric, updated_at = now()
    WHERE id = ${locked.id}
  `)

  // 5. ledger row
  const type: StockMovementKind = input.type
    ?? (mode === 'set' ? 'adjustment' : delta > 0 ? 'in' : 'out')
  const [movement] = rows<{ id: string }>(await tx.execute(sql`
    INSERT INTO stock_movements (
      tenant_id, warehouse_id, item_id, type, quantity, qty_change, stock_before, stock_after,
      reference_type, reference_id, notes, created_by, cost_center_id, source, sign_source, idempotency_key
    ) VALUES (
      ${tenantId}, ${warehouseId}, ${itemId}, ${type}, ${Math.abs(delta).toFixed(3)}::numeric,
      ${delta.toFixed(3)}::numeric, ${before.toFixed(3)}::numeric, ${after.toFixed(3)}::numeric,
      ${referenceType}, ${input.referenceId || null}, ${input.notes || null}, ${input.userId || null},
      ${input.costCenterId || null}, ${source}, 'native', ${input.idempotencyKey || null}
    )
    RETURNING id
  `))
  if (input.reasonCode) {
    await tx.execute(sql`UPDATE stock_movements SET reason_code = ${input.reasonCode} WHERE id = ${movement.id}`)
  }

  return {
    movementId: movement.id,
    before,
    after,
    delta,
    skipped: false,
    minStock,
    crossedMin,
    itemName: locked.item_name,
    warehouseStockId: locked.id,
  }
}

/**
 * Apply several changes in a deterministic lock order (warehouseId, itemId) to
 * avoid deadlocks between concurrent multi-line documents. Results are returned
 * in the original input order.
 */
export async function applyStockChanges(tx: DbTx, list: StockChangeInput[]): Promise<StockChangeResult[]> {
  const order = list
    .map((input, index) => ({ input, index }))
    .sort((a, b) =>
      a.input.warehouseId === b.input.warehouseId
        ? (a.input.itemId < b.input.itemId ? -1 : a.input.itemId > b.input.itemId ? 1 : a.index - b.index)
        : (a.input.warehouseId < b.input.warehouseId ? -1 : 1))
  const results: StockChangeResult[] = new Array(list.length)
  for (const { input, index } of order) {
    results[index] = await applyStockChange(tx, input)
  }
  return results
}
