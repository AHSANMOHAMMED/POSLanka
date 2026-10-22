import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'

/**
 * GRN stock coverage for purchase invoices linked to a purchase order.
 *
 * A goods receipt (GRN, /purchase-orders/[id]/receive with updateStock) puts stock into the
 * warehouse before the supplier's bill arrives. The invoice for those goods must then NOT add
 * the same quantity again when it is submitted. Per item:
 *
 *   unbilled GRN stock = stock added by the PO's active (not cancelled) receipts
 *                        − quantity of the PO's submitted invoices that did not add stock themselves
 *
 * ("submitted" = not draft / cancelled / return). An invoice line consumes unbilled GRN stock
 * first and only the remainder is received into stock by the invoice itself.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export async function unbilledGrnStock(
  tx: DbTx,
  tenantId: string,
  purchaseOrderId: string,
  excludePurchaseId?: string | null,
): Promise<Map<string, number>> {
  const exclude = excludePurchaseId || null
  const list = rows<{ item_id: string; grn: string; billed: string; self_stock: string }>(await tx.execute(sql`
    WITH grn AS (
      SELECT m.item_id, SUM(m.qty_change) AS q
      FROM stock_movements m
      WHERE m.tenant_id = ${tenantId}
        AND m.reference_type = 'purchase_order_receive'
        AND m.reference_id = ${purchaseOrderId}
        AND m.qty_change > 0
        AND NOT EXISTS (
          SELECT 1 FROM stock_movements r
          WHERE r.tenant_id = m.tenant_id AND r.idempotency_key = 'po-receive-cancel:' || m.id::text
        )
      GROUP BY m.item_id
    ),
    inv AS (
      SELECT p.id FROM purchases p
      WHERE p.tenant_id = ${tenantId}
        AND p.purchase_order_id = ${purchaseOrderId}
        AND p.is_return = false
        AND p.status NOT IN ('draft', 'cancelled')
        AND (${exclude}::uuid IS NULL OR p.id <> ${exclude}::uuid)
    ),
    billed AS (
      SELECT pi.item_id, SUM(pi.quantity) AS q
      FROM purchase_items pi
      WHERE pi.purchase_id IN (SELECT id FROM inv) AND pi.item_id IS NOT NULL AND pi.quantity > 0
      GROUP BY pi.item_id
    ),
    self_stock AS (
      SELECT m.item_id, SUM(m.qty_change) AS q
      FROM stock_movements m
      WHERE m.tenant_id = ${tenantId}
        AND m.reference_type = 'purchase'
        AND m.reference_id IN (SELECT id FROM inv)
      GROUP BY m.item_id
    )
    SELECT grn.item_id, grn.q AS grn, COALESCE(billed.q, 0) AS billed, COALESCE(self_stock.q, 0) AS self_stock
    FROM grn
    LEFT JOIN billed ON billed.item_id = grn.item_id
    LEFT JOIN self_stock ON self_stock.item_id = grn.item_id
  `))
  const out = new Map<string, number>()
  for (const r of list) {
    const consumed = Math.max(0, parseFloat(r.billed) - parseFloat(r.self_stock))
    out.set(r.item_id, round3(parseFloat(r.grn) - consumed))
  }
  return out
}
