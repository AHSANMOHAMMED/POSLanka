import { sql } from 'drizzle-orm'
import type { DbTx } from './db-types'

/**
 * D1 — batch (lot) allocation for sales, returns and voids.
 *
 * item_batches.current_quantity is the remaining quantity of a batch in its warehouse.
 * Warehouse stock (warehouse_stock, via applyStockChange) stays the authority for "how many";
 * batches say "which ones". Callers apply the warehouse stock change FIRST (it locks the
 * warehouse_stock row of the item), then allocate / restore batches, so batch writers of one
 * item + warehouse are serialised by that row lock as well as by the batch row locks.
 *
 *  - allocateBatchesFEFO: earliest expiry first (NULL expiry last, then oldest batch), skipping
 *    expired batches unless the tenant allows selling them; an explicitly chosen batch is used
 *    first. Short batch quantity throws INSUFFICIENT_BATCH_STOCK unless `allowShortfall`
 *    (offline sales: allocate what exists, the caller records the shortfall).
 *  - restoreSaleLineBatches: returns / voids put quantity back into the batches the sale line
 *    drew from, last allocation first (LIFO), either into the same batch or — when the stock
 *    goes to another warehouse (e.g. the quarantine warehouse) — into a batch with the same
 *    number in that warehouse.
 */

export interface BatchAllocation {
  batchId: string
  batchNumber: string
  expiryDate: string | null
  quantity: number
}

export interface AllocateBatchesInput {
  tenantId: string
  warehouseId: string
  itemId: string
  qty: number
  /** Batch picked by the cashier (used first). */
  preferredBatchId?: string | null
  /** Batch number (e.g. GS1 AI 10 from a scan) resolved to a batch of this item. */
  preferredBatchNumber?: string | null
  /** Tenant setting batches.allowExpiredSale. */
  allowExpired?: boolean
  /** Offline sale: allocate what exists instead of throwing. */
  allowShortfall?: boolean
  itemName?: string
}

export interface AllocateBatchesResult {
  allocations: BatchAllocation[]
  allocated: number
  shortfall: number
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

interface LockedBatch {
  id: string
  batch_number: string
  expiry_date: string | null
  current_quantity: string
  status: string
  warehouse_id: string | null
  created_at: string
  expired: boolean
}

/** Resolve a batch number to a batch id of the item (prefers the given warehouse). */
export async function resolveBatchNumber(tx: DbTx, tenantId: string, itemId: string, batchNumber: string, warehouseId?: string | null): Promise<string | null> {
  const [row] = rows<{ id: string }>(await tx.execute(sql`
    SELECT id FROM item_batches
    WHERE tenant_id = ${tenantId} AND item_id = ${itemId} AND upper(batch_number) = upper(${batchNumber.trim()})
    ORDER BY (warehouse_id IS NOT DISTINCT FROM ${warehouseId || null}::uuid) DESC, current_quantity DESC, created_at
    LIMIT 1
  `))
  return row?.id || null
}

export async function allocateBatchesFEFO(tx: DbTx, input: AllocateBatchesInput): Promise<AllocateBatchesResult> {
  const qty = round3(Number(input.qty))
  if (!(qty > 0)) return { allocations: [], allocated: 0, shortfall: 0 }
  const { tenantId, warehouseId, itemId } = input
  const label = input.itemName || 'item'

  let preferredId = input.preferredBatchId || null
  if (!preferredId && input.preferredBatchNumber) {
    preferredId = await resolveBatchNumber(tx, tenantId, itemId, input.preferredBatchNumber, warehouseId)
    if (!preferredId) throw new Error(`BATCH_NOT_FOUND:Batch ${input.preferredBatchNumber} not found for ${label}`)
  }

  // Lock every candidate (and the preferred batch) in id order → no lock-order deadlocks.
  const locked = rows<LockedBatch>(await tx.execute(sql`
    SELECT id, batch_number, expiry_date::text AS expiry_date, current_quantity, status::text AS status,
           warehouse_id, created_at::text AS created_at,
           (expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) AS expired
    FROM item_batches
    WHERE tenant_id = ${tenantId} AND item_id = ${itemId}
      AND (
        ((warehouse_id = ${warehouseId} OR warehouse_id IS NULL) AND status IN ('active', 'expired') AND current_quantity > 0)
        OR id = ${preferredId}::uuid
      )
    ORDER BY id
    FOR UPDATE
  `))

  const allocations: BatchAllocation[] = []
  const take = new Map<string, number>()
  let left = qty

  if (preferredId) {
    const p = locked.find((b) => b.id === preferredId)
    if (!p) throw new Error(`BATCH_NOT_FOUND:Selected batch not found for ${label}`)
    if (p.warehouse_id && p.warehouse_id !== warehouseId) throw new Error(`BATCH_NOT_AVAILABLE:Batch ${p.batch_number} is in another warehouse`)
    if (p.status !== 'active' && p.status !== 'expired' && p.status !== 'consumed') {
      throw new Error(`BATCH_NOT_AVAILABLE:Batch ${p.batch_number} is ${p.status}`)
    }
    if ((p.expired || p.status === 'expired') && !input.allowExpired) {
      throw new Error(`BATCH_EXPIRED:Batch ${p.batch_number} of ${label} expired on ${p.expiry_date}`)
    }
    const q = round3(Math.min(left, Math.max(0, parseFloat(p.current_quantity))))
    if (q > 0) { take.set(p.id, q); left = round3(left - q) }
  }

  if (left > 0) {
    const fefo = locked
      .filter((b) => b.id !== preferredId && (b.status === 'active' || b.status === 'expired'))
      .filter((b) => input.allowExpired || !(b.expired || b.status === 'expired'))
      .sort((a, b) => {
        if (a.expiry_date !== b.expiry_date) {
          if (a.expiry_date === null) return 1
          if (b.expiry_date === null) return -1
          return a.expiry_date < b.expiry_date ? -1 : 1
        }
        if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
        return a.id < b.id ? -1 : 1
      })
    for (const b of fefo) {
      if (left <= 0) break
      const q = round3(Math.min(left, parseFloat(b.current_quantity)))
      if (!(q > 0)) continue
      take.set(b.id, q)
      left = round3(left - q)
    }
  }

  if (left > 0 && !input.allowShortfall) {
    throw new Error(`INSUFFICIENT_BATCH_STOCK:${label} (need: ${qty}, in batches: ${round3(qty - left)})`)
  }

  // Apply in the order chosen (preferred first, then FEFO)
  for (const [id, q] of take) {
    const b = locked.find((x) => x.id === id)!
    await tx.execute(sql`
      UPDATE item_batches
      SET current_quantity = current_quantity - ${q.toFixed(3)}::numeric,
          status = CASE WHEN current_quantity - ${q.toFixed(3)}::numeric <= 0 AND status = 'active' THEN 'consumed'::batch_status ELSE status END,
          updated_at = now()
      WHERE id = ${id}
    `)
    allocations.push({ batchId: id, batchNumber: b.batch_number, expiryDate: b.expiry_date, quantity: q })
  }

  return { allocations, allocated: round3(qty - left), shortfall: round3(left) }
}

/** Allocate and record the allocations of one sale line (sale_item_batches). */
export async function allocateSaleLineBatches(
  tx: DbTx,
  input: AllocateBatchesInput & { saleItemId: string },
): Promise<AllocateBatchesResult> {
  const result = await allocateBatchesFEFO(tx, input)
  let order = 0
  for (const a of result.allocations) {
    await tx.execute(sql`
      INSERT INTO sale_item_batches (tenant_id, sale_item_id, batch_id, quantity, alloc_order)
      VALUES (${input.tenantId}, ${input.saleItemId}, ${a.batchId}, ${a.quantity.toFixed(3)}::numeric, ${order++})
    `)
  }
  return result
}

export interface RestoreBatchesInput {
  tenantId: string
  /** The original sale line. */
  saleItemId: string
  qty: number
  /** Warehouse the stock goes back into (the sale's, or the quarantine warehouse). */
  toWarehouseId: string
  /** Quarantine: batches restored with status 'quarantine' (not sellable, no expiry alerts). */
  quarantine?: boolean
  /** Return line: record where the quantity went (sale_item_batches row on the return line). */
  returnSaleItemId?: string | null
}

export interface RestoredBatch {
  fromBatchId: string
  toBatchId: string
  batchNumber: string
  expiryDate: string | null
  quantity: number
}

export interface RestoreBatchesResult {
  restored: RestoredBatch[]
  /** Quantity that had no outstanding batch allocation (legacy / offline shortfall). */
  unallocated: number
}

/**
 * Put `qty` of a sale line back into batches, last allocation first. Quantity beyond the
 * outstanding allocations is reported as `unallocated` (not an error: legacy sales and offline
 * shortfalls have no batch allocation for it).
 */
export async function restoreSaleLineBatches(tx: DbTx, input: RestoreBatchesInput): Promise<RestoreBatchesResult> {
  let left = round3(Math.abs(Number(input.qty)))
  const restored: RestoredBatch[] = []
  if (!(left > 0)) return { restored, unallocated: 0 }

  const allocs = rows<{ id: string; batch_id: string; quantity: string; returned_quantity: string }>(await tx.execute(sql`
    SELECT id, batch_id, quantity, returned_quantity FROM sale_item_batches
    WHERE tenant_id = ${input.tenantId} AND sale_item_id = ${input.saleItemId}
    ORDER BY alloc_order DESC, created_at DESC, id DESC
    FOR UPDATE
  `))

  let order = 0
  for (const a of allocs) {
    if (left <= 0) break
    const outstanding = round3(parseFloat(a.quantity) - parseFloat(a.returned_quantity))
    const q = round3(Math.min(left, outstanding))
    if (!(q > 0)) continue
    left = round3(left - q)

    await tx.execute(sql`
      UPDATE sale_item_batches SET returned_quantity = returned_quantity + ${q.toFixed(3)}::numeric WHERE id = ${a.id}
    `)

    const put = await putIntoBatch(tx, {
      tenantId: input.tenantId,
      srcBatchId: a.batch_id,
      toWarehouseId: input.toWarehouseId,
      qty: q,
      quarantine: input.quarantine,
      notes: input.quarantine ? 'Returned goods (quarantine)' : 'Returned goods',
    })
    if (!put) continue
    const { src, toBatchId } = put

    if (input.returnSaleItemId) {
      await tx.execute(sql`
        INSERT INTO sale_item_batches (tenant_id, sale_item_id, batch_id, quantity, alloc_order)
        VALUES (${input.tenantId}, ${input.returnSaleItemId}, ${toBatchId}, ${q.toFixed(3)}::numeric, ${order++})
      `)
    }
    restored.push({ fromBatchId: src.id, toBatchId, batchNumber: src.batch_number, expiryDate: src.expiry_date, quantity: q })
  }

  return { restored, unallocated: left }
}

export interface PutIntoBatchInput {
  tenantId: string
  /** Batch the quantity originally came from (its number / expiry are kept). */
  srcBatchId: string
  toWarehouseId: string
  qty: number
  /** Restore with status 'quarantine' (not sellable). */
  quarantine?: boolean
  /** Notes on a batch created in the destination warehouse. */
  notes?: string
}

/**
 * Put `qty` back into a batch: into the source batch itself when it lives in (or is not bound to)
 * `toWarehouseId`, otherwise into the batch with the same number + expiry in that warehouse
 * (created on demand). Returns null when the source batch no longer exists.
 */
export async function putIntoBatch(tx: DbTx, input: PutIntoBatchInput): Promise<{
  src: { id: string; batch_number: string; expiry_date: string | null }
  toBatchId: string
} | null> {
  const q = round3(Number(input.qty))
  const [src] = rows<{
    id: string; batch_number: string; expiry_date: string | null; manufacturing_date: string | null; warehouse_id: string | null
    item_id: string; supplier_id: string | null; supplier_batch_number: string | null; purchase_receipt_id: string | null; status: string
  }>(await tx.execute(sql`
    SELECT id, batch_number, expiry_date::text AS expiry_date, manufacturing_date::text AS manufacturing_date, warehouse_id,
           item_id, supplier_id, supplier_batch_number, purchase_receipt_id, status::text AS status
    FROM item_batches WHERE id = ${input.srcBatchId}
    FOR UPDATE
  `))
  if (!src) return null
  if (!(q > 0)) return { src, toBatchId: src.id }

  const sameWarehouse = !src.warehouse_id || src.warehouse_id === input.toWarehouseId
  if (sameWarehouse && !input.quarantine) {
    await tx.execute(sql`
      UPDATE item_batches
      SET current_quantity = current_quantity + ${q.toFixed(3)}::numeric,
          status = CASE WHEN status = 'consumed' THEN 'active'::batch_status ELSE status END,
          updated_at = now()
      WHERE id = ${src.id}
    `)
    return { src, toBatchId: src.id }
  }

  // same batch number in the destination warehouse (created on demand)
  const targetStatus = input.quarantine ? 'quarantine' : 'active'
  const [existing] = rows<{ id: string }>(await tx.execute(sql`
    SELECT id FROM item_batches
    WHERE tenant_id = ${input.tenantId} AND item_id = ${src.item_id} AND warehouse_id = ${input.toWarehouseId}
      AND batch_number = ${src.batch_number}
      AND expiry_date IS NOT DISTINCT FROM ${src.expiry_date}::date
      AND (status = ${targetStatus}::batch_status OR (${targetStatus}::text = 'active' AND status = 'consumed'))
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE
  `))
  if (existing) {
    await tx.execute(sql`
      UPDATE item_batches
      SET current_quantity = current_quantity + ${q.toFixed(3)}::numeric,
          status = CASE WHEN status = 'consumed' THEN 'active'::batch_status ELSE status END,
          updated_at = now()
      WHERE id = ${existing.id}
    `)
    return { src, toBatchId: existing.id }
  }
  const [created] = rows<{ id: string }>(await tx.execute(sql`
    INSERT INTO item_batches (
      tenant_id, item_id, batch_number, warehouse_id, manufacturing_date, expiry_date,
      initial_quantity, current_quantity, supplier_batch_number, purchase_receipt_id, supplier_id, status, notes
    ) VALUES (
      ${input.tenantId}, ${src.item_id}, ${src.batch_number}, ${input.toWarehouseId},
      ${src.manufacturing_date}::date, ${src.expiry_date}::date,
      ${q.toFixed(3)}::numeric, ${q.toFixed(3)}::numeric, ${src.supplier_batch_number}, ${src.purchase_receipt_id},
      ${src.supplier_id}, ${targetStatus}::batch_status,
      ${input.notes ?? null}::text
    )
    RETURNING id
  `))
  return { src, toBatchId: created.id }
}

export interface SaleLineBatchInfo {
  batchId: string
  batchNumber: string
  expiryDate: string | null
  quantity: number
  returnedQuantity: number
}

/** Batch allocations per sale line (for GET /api/sales/[id] and the receipt lookup). */
export async function getSaleLineBatches(tx: DbTx, saleItemIds: string[]): Promise<Map<string, SaleLineBatchInfo[]>> {
  const map = new Map<string, SaleLineBatchInfo[]>()
  if (saleItemIds.length === 0) return map
  const list = rows<{ sale_item_id: string; batch_id: string; batch_number: string; expiry_date: string | null; quantity: string; returned_quantity: string }>(
    await tx.execute(sql`
      SELECT sib.sale_item_id, sib.batch_id, b.batch_number, b.expiry_date::text AS expiry_date, sib.quantity, sib.returned_quantity
      FROM sale_item_batches sib
      JOIN item_batches b ON b.id = sib.batch_id
      WHERE sib.sale_item_id IN (${sql.join(saleItemIds.map((id) => sql`${id}::uuid`), sql`, `)})
      ORDER BY sib.sale_item_id, sib.alloc_order
    `),
  )
  for (const r of list) {
    const arr = map.get(r.sale_item_id) || []
    arr.push({
      batchId: r.batch_id,
      batchNumber: r.batch_number,
      expiryDate: r.expiry_date,
      quantity: parseFloat(r.quantity),
      returnedQuantity: parseFloat(r.returned_quantity),
    })
    map.set(r.sale_item_id, arr)
  }
  return map
}

/** Error prefixes thrown by this module (mapped to 400 by the sale routes). */
export const BATCH_ERROR_PREFIXES = ['INSUFFICIENT_BATCH_STOCK:', 'BATCH_NOT_FOUND:', 'BATCH_NOT_AVAILABLE:', 'BATCH_EXPIRED:'] as const

export function batchErrorInfo(err: unknown): { code: string; message: string } | null {
  const message = err instanceof Error ? err.message : ''
  for (const p of BATCH_ERROR_PREFIXES) {
    if (message.startsWith(p)) {
      const code = p.slice(0, -1)
      const detail = message.slice(p.length)
      return { code, message: code === 'INSUFFICIENT_BATCH_STOCK' ? `Insufficient batch stock: ${detail}` : detail }
    }
  }
  return null
}
