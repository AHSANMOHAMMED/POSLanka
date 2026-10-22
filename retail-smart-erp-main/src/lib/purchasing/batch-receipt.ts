import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { allocateBatchesFEFO, putIntoBatch } from '@/lib/inventory/batches'

/**
 * GC — batches (lots) for purchasing documents.
 *
 * When a purchasing document actually adds stock of a trackBatches item (GRN with update-stock,
 * purchase-invoice submit, create-invoice with update-stock) the quantity goes into a batch in
 * that warehouse: the batch with the same number + expiry is topped up (putIntoBatch), otherwise
 * a new batch is created. Lines without a batch number get the document number (GRN-…, PI-…)
 * so the stock is sellable straight away. purchase_doc_batches (drizzle/0152) records which
 * batches a document touched, so cancellations reverse exactly those.
 *
 * Purchase returns take the quantity from the batches the original invoice created first, then
 * FEFO; GRN / invoice cancellation takes it from the document's own batches first, then FEFO.
 * Warehouse stock (applyStockChange) stays the authority for "how many" and is applied FIRST by
 * the callers; batch shortfalls on the way out are tolerated (legacy stock without batches).
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export interface BatchLineInfo {
  batchNumber?: string | null
  expiryDate?: string | null
  manufacturingDate?: string | null
}

async function tracksBatches(tx: DbTx, tenantId: string, itemId: string): Promise<boolean> {
  const [r] = rows<{ t: boolean }>(await tx.execute(sql`
    SELECT track_batches AS t FROM items WHERE tenant_id = ${tenantId} AND id = ${itemId}
  `))
  return !!r?.t
}

async function record(tx: DbTx, r: { tenantId: string; docType: string; docId: string; lineId?: string | null; batchId: string; itemId: string; qty: number }) {
  await tx.execute(sql`
    INSERT INTO purchase_doc_batches (tenant_id, document_type, document_id, line_id, batch_id, item_id, quantity)
    VALUES (${r.tenantId}, ${r.docType}, ${r.docId}, ${r.lineId || null}::uuid, ${r.batchId}, ${r.itemId}, ${round3(r.qty).toFixed(3)}::numeric)
  `)
}

export interface ReceiveIntoBatchInput extends BatchLineInfo {
  tenantId: string
  itemId: string
  warehouseId: string
  qty: number
  /** Used when the line carries no batch number (the document number). */
  defaultBatchNumber: string
  supplierId?: string | null
  purchaseReceiptId?: string | null
  docType: 'grn' | 'purchase'
  docId: string
  lineId?: string | null
}

/** Put received quantity into a batch (no-op for items that do not track batches). */
export async function receiveIntoBatch(tx: DbTx, input: ReceiveIntoBatchInput): Promise<string | null> {
  const q = round3(Number(input.qty))
  if (!(q > 0)) return null
  if (!(await tracksBatches(tx, input.tenantId, input.itemId))) return null
  const number = (input.batchNumber || '').trim().slice(0, 100) || input.defaultBatchNumber.slice(0, 100)
  const expiry = input.expiryDate || null
  const mfg = input.manufacturingDate || null

  const [existing] = rows<{ id: string }>(await tx.execute(sql`
    SELECT id FROM item_batches
    WHERE tenant_id = ${input.tenantId} AND item_id = ${input.itemId} AND warehouse_id = ${input.warehouseId}
      AND upper(batch_number) = upper(${number})
      AND expiry_date IS NOT DISTINCT FROM ${expiry}::date
      AND status IN ('active', 'consumed')
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE
  `))
  let batchId: string
  if (existing) {
    const put = await putIntoBatch(tx, { tenantId: input.tenantId, srcBatchId: existing.id, toWarehouseId: input.warehouseId, qty: q })
    batchId = put!.toBatchId
  } else {
    const [created] = rows<{ id: string }>(await tx.execute(sql`
      INSERT INTO item_batches (
        tenant_id, item_id, batch_number, warehouse_id, manufacturing_date, expiry_date,
        initial_quantity, current_quantity, supplier_batch_number, purchase_receipt_id, supplier_id, status
      ) VALUES (
        ${input.tenantId}, ${input.itemId}, ${number}, ${input.warehouseId}, ${mfg}::date, ${expiry}::date,
        ${q.toFixed(3)}::numeric, ${q.toFixed(3)}::numeric, ${(input.batchNumber || '').trim() || null},
        ${input.purchaseReceiptId || null}::uuid, ${input.supplierId || null}::uuid, 'active'
      )
      RETURNING id
    `))
    batchId = created.id
  }
  await record(tx, { tenantId: input.tenantId, docType: input.docType, docId: input.docId, lineId: input.lineId, batchId, itemId: input.itemId, qty: q })
  return batchId
}

/** Take quantity out of the given batches (locked, earliest expiry first); returns what is left. */
async function takeFrom(tx: DbTx, batchIds: string[], qty: number, onTake: (batchId: string, q: number) => Promise<void>): Promise<number> {
  let left = round3(qty)
  if (batchIds.length === 0 || !(left > 0)) return left
  const list = rows<{ id: string; current_quantity: string }>(await tx.execute(sql`
    SELECT id, current_quantity FROM item_batches
    WHERE id IN (${sql.join(batchIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND current_quantity > 0
    ORDER BY expiry_date NULLS LAST, created_at, id
    FOR UPDATE
  `))
  for (const b of list) {
    if (!(left > 0)) break
    const q = round3(Math.min(left, parseFloat(b.current_quantity)))
    if (!(q > 0)) continue
    await tx.execute(sql`
      UPDATE item_batches
      SET current_quantity = current_quantity - ${q.toFixed(3)}::numeric,
          status = CASE WHEN current_quantity - ${q.toFixed(3)}::numeric <= 0 AND status = 'active' THEN 'consumed'::batch_status ELSE status END,
          updated_at = now()
      WHERE id = ${b.id}
    `)
    await onTake(b.id, q)
    left = round3(left - q)
  }
  return left
}

async function docBatchIds(tx: DbTx, tenantId: string, docType: string, docId: string, itemId: string): Promise<string[]> {
  return rows<{ batch_id: string }>(await tx.execute(sql`
    SELECT DISTINCT batch_id FROM purchase_doc_batches
    WHERE tenant_id = ${tenantId} AND document_type = ${docType} AND document_id = ${docId}
      AND item_id = ${itemId} AND quantity > 0 AND reversed_at IS NULL
  `)).map((r) => r.batch_id)
}

export interface TakeOutInput {
  tenantId: string
  itemId: string
  warehouseId: string
  qty: number
  /** Document whose batches are used first (the original invoice of a return). */
  preferDocType?: string
  preferDocId?: string
  /** Document recording the take-out (the return). */
  docType: 'grn' | 'purchase'
  docId: string
  lineId?: string | null
  itemName?: string
}

/** Purchase return: take quantity out of batches (no-op for items that do not track batches). */
export async function takeOutOfBatches(tx: DbTx, input: TakeOutInput): Promise<void> {
  const qty = round3(Number(input.qty))
  if (!(qty > 0)) return
  if (!(await tracksBatches(tx, input.tenantId, input.itemId))) return
  const rec = (batchId: string, q: number) => record(tx, {
    tenantId: input.tenantId, docType: input.docType, docId: input.docId, lineId: input.lineId, batchId, itemId: input.itemId, qty: -q,
  })
  const preferred = input.preferDocId
    ? (await docBatchIds(tx, input.tenantId, input.preferDocType || 'purchase', input.preferDocId, input.itemId))
    : []
  let left = await takeFrom(tx, preferred, qty, rec)
  if (left > 0) {
    // the rest FEFO (expired lots may go back to the supplier); stock without batches is tolerated
    const res = await allocateBatchesFEFO(tx, {
      tenantId: input.tenantId, warehouseId: input.warehouseId, itemId: input.itemId, qty: left,
      allowExpired: true, allowShortfall: true, itemName: input.itemName,
    })
    for (const a of res.allocations) await rec(a.batchId, a.quantity)
    left = res.shortfall
  }
}

/**
 * Reverse every batch change a document made (GRN / invoice cancel or delete, return cancel).
 * Quantity put in is taken out of the same batches first (then FEFO, tolerating stock that has
 * no batch any more); quantity taken out (returns) goes back into the batch it came from.
 */
export async function reverseDocBatches(tx: DbTx, tenantId: string, docType: 'grn' | 'purchase', docId: string): Promise<void> {
  const list = rows<{ id: string; batch_id: string; item_id: string; quantity: string; warehouse_id: string | null }>(await tx.execute(sql`
    SELECT d.id, d.batch_id, d.item_id, d.quantity, b.warehouse_id
    FROM purchase_doc_batches d JOIN item_batches b ON b.id = d.batch_id
    WHERE d.tenant_id = ${tenantId} AND d.document_type = ${docType} AND d.document_id = ${docId} AND d.reversed_at IS NULL
    ORDER BY d.item_id, d.created_at, d.id
    FOR UPDATE OF d
  `))
  for (const r of list) {
    const q = round3(parseFloat(r.quantity))
    if (q < 0) {
      await putIntoBatch(tx, { tenantId, srcBatchId: r.batch_id, toWarehouseId: r.warehouse_id || '', qty: -q })
    } else if (q > 0) {
      const left = await takeFrom(tx, [r.batch_id], q, async () => undefined)
      if (left > 0 && r.warehouse_id) {
        await allocateBatchesFEFO(tx, {
          tenantId, warehouseId: r.warehouse_id, itemId: r.item_id, qty: left, allowExpired: true, allowShortfall: true,
        })
      }
    }
  }
  if (list.length > 0) {
    await tx.execute(sql`
      UPDATE purchase_doc_batches SET reversed_at = now()
      WHERE tenant_id = ${tenantId} AND document_type = ${docType} AND document_id = ${docId} AND reversed_at IS NULL
    `)
  }
}
