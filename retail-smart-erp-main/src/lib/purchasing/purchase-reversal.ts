import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { recordItemChange } from '@/lib/inventory/item-audit'
import { getTotalItemStock } from './stock-cost'

/**
 * D1 — undo the effects of a purchase invoice that is cancelled or deleted.
 *
 * COST RULE (per item, call BEFORE the stock movements are reversed):
 *  1. Exact restore — when the purchase's own item_cost_history row (source 'purchase',
 *     reference_id = purchase) is the item's LAST cost-history row (no later purchase, intake,
 *     import, return or manual adjustment — even one that left the cost unchanged) and the item
 *     still has the cost that row set, the previous cost recorded in that row is restored.
 *     Sales do not change the average, so this is exact (and immune to rounding drift).
 *  2. Weighted-average removal — otherwise (a later purchase / adjustment changed the cost, or
 *     the purchase predates cost history) the purchase is taken out of the current average:
 *        newCost = (currentCost × totalStock − purchasePrice × qty) / (totalStock − qty)
 *     using the item's total stock across all warehouses before the reversal. When no stock
 *     would remain (or the result is negative) the current cost is kept — there is nothing left
 *     to value, and zeroing it would corrupt later averages / COGS.
 *  Every reversal writes an item_cost_history row (source 'purchase_cancellation') naming the rule.
 *
 * PO RULE: purchase_items.po_received_qty records exactly how much an invoice line added to
 * purchase_order_items.received_quantity (create-invoice with received quantities). Only that
 * amount is taken back; invoices created after a GRN receipt added nothing and change nothing.
 * Legacy lines (po_received_qty NULL) keep the old behaviour: invoice quantity per item.
 */

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export interface ReversePurchaseCostInput {
  tenantId: string
  purchaseId: string
  purchaseNo: string
  supplierId: string | null
  userId: string | null
  /** 'cancel' | 'delete' — only used in notes */
  action: 'cancel' | 'delete'
}

export interface CostReversal {
  itemId: string
  rule: 'restore' | 'weighted_average' | 'kept'
  previousCost: number
  newCost: number
}

export async function reversePurchaseCost(tx: DbTx, input: ReversePurchaseCostInput): Promise<CostReversal[]> {
  const { tenantId, purchaseId } = input
  const lines = rows<{ item_id: string; quantity: string; unit_price: string }>(await tx.execute(sql`
    SELECT item_id, quantity, unit_price FROM purchase_items
    WHERE purchase_id = ${purchaseId} AND item_id IS NOT NULL AND quantity > 0
    ORDER BY item_id
  `))
  // aggregate lines of the same item
  const byItem = new Map<string, { qty: number; value: number }>()
  for (const l of lines) {
    const agg = byItem.get(l.item_id) || { qty: 0, value: 0 }
    const q = parseFloat(l.quantity)
    agg.qty = round3(agg.qty + q)
    agg.value += q * parseFloat(l.unit_price)
    byItem.set(l.item_id, agg)
  }

  const out: CostReversal[] = []
  for (const [itemId, agg] of [...byItem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [item] = rows<{ cost_price: string | null }>(await tx.execute(sql`
      SELECT cost_price FROM items WHERE tenant_id = ${tenantId} AND id = ${itemId} FOR UPDATE
    `))
    if (!item) continue
    const currentCost = round2(parseFloat(item.cost_price || '0'))
    const stockBefore = await getTotalItemStock(tx, tenantId, itemId)
    const stockAfter = round3(stockBefore - agg.qty)
    const avgPrice = agg.qty > 0 ? agg.value / agg.qty : 0

    const [own] = rows<{ id: string; previous_cost_price: string; new_cost_price: string; created_at: string }>(await tx.execute(sql`
      SELECT id, previous_cost_price, new_cost_price, created_at::text AS created_at
      FROM item_cost_history
      WHERE tenant_id = ${tenantId} AND item_id = ${itemId} AND reference_id = ${purchaseId} AND source = 'purchase'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `))
    let isLast = false
    if (own) {
      const [later] = rows<{ id: string }>(await tx.execute(sql`
        SELECT id FROM item_cost_history
        WHERE tenant_id = ${tenantId} AND item_id = ${itemId} AND id <> ${own.id}
          AND created_at > ${own.created_at}::timestamp
        LIMIT 1
      `))
      isLast = !later && round2(parseFloat(own.new_cost_price)) === currentCost
    }

    let rule: CostReversal['rule']
    let newCost: number
    if (own && isLast) {
      rule = 'restore'
      newCost = round2(parseFloat(own.previous_cost_price))
    } else if (stockAfter > 0) {
      const v = round2((currentCost * stockBefore - avgPrice * agg.qty) / stockAfter)
      if (v >= 0) { rule = 'weighted_average'; newCost = v } else { rule = 'kept'; newCost = currentCost }
    } else {
      rule = 'kept'
      newCost = currentCost
    }

    if (newCost !== currentCost) {
      await tx.execute(sql`
        UPDATE items
        SET cost_price = ${newCost.toFixed(2)}::numeric,
            updated_by = COALESCE(${input.userId || null}::uuid, updated_by),
            version = version + 1,
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${itemId}
      `)
      await recordItemChange(tx, {
        tenantId,
        itemId,
        userId: input.userId || null,
        source: 'purchase_cancel', // item_change_log.source is varchar(20)
        action: 'update',
        before: { costPrice: currentCost },
        after: { costPrice: newCost },
        notes: `Cost reversed on ${input.action === 'delete' ? 'deleting' : 'cancelling'} ${input.purchaseNo.slice(0, 50)}`,
      })
    }

    const ruleText = rule === 'restore' ? 'restored previous cost'
      : rule === 'weighted_average' ? 'removed from weighted average' : 'cost kept (no stock left to value)'
    await tx.execute(sql`
      INSERT INTO item_cost_history (
        tenant_id, item_id, supplier_id, source, previous_cost_price, new_cost_price,
        purchase_price, quantity, stock_before, stock_after, reference_id, reference_no, notes, created_by
      ) VALUES (
        ${tenantId}, ${itemId}, ${input.supplierId || null}, 'purchase_cancellation',
        ${currentCost.toFixed(2)}::numeric, ${newCost.toFixed(2)}::numeric,
        ${round2(avgPrice).toFixed(2)}::numeric, ${agg.qty.toFixed(3)}::numeric,
        ${stockBefore.toFixed(3)}::numeric, ${stockAfter.toFixed(3)}::numeric,
        ${purchaseId}, ${input.purchaseNo.slice(0, 50)},
        ${`Purchase ${input.action === 'delete' ? 'deleted' : 'cancelled'}: ${ruleText}`}, ${input.userId || null}
      )
    `)

    if (input.supplierId) {
      await tx.execute(sql`
        UPDATE item_supplier_costs
        SET total_purchased_qty = GREATEST(0, total_purchased_qty - ${agg.qty.toFixed(3)}::numeric), updated_at = now()
        WHERE tenant_id = ${tenantId} AND item_id = ${itemId} AND supplier_id = ${input.supplierId}
      `)
    }
    out.push({ itemId, rule, previousCost: currentCost, newCost })
  }
  return out
}

/**
 * Take back what this purchase added to its purchase order's received quantities and
 * recompute the PO status. Returns the PO id (or null when the purchase has no PO).
 */
export async function reversePurchaseOrderReceipt(
  tx: DbTx,
  purchase: { id: string; purchaseOrderId: string | null },
): Promise<string | null> {
  if (!purchase.purchaseOrderId) return null
  const poId = purchase.purchaseOrderId

  await tx.execute(sql`SELECT id FROM purchase_orders WHERE id = ${poId} FOR UPDATE`)
  const lines = rows<{ item_id: string | null; quantity: string; purchase_order_item_id: string | null; po_received_qty: string | null }>(await tx.execute(sql`
    SELECT item_id, quantity, purchase_order_item_id, po_received_qty FROM purchase_items WHERE purchase_id = ${purchase.id}
  `))
  const poItems = rows<{ id: string; item_id: string | null; quantity: string; received_quantity: string }>(await tx.execute(sql`
    SELECT id, item_id, quantity, received_quantity FROM purchase_order_items
    WHERE purchase_order_id = ${poId}
    ORDER BY id
    FOR UPDATE
  `))
  const received = new Map(poItems.map((p) => [p.id, parseFloat(p.received_quantity || '0')]))

  const exact = lines.some((l) => l.po_received_qty !== null)
  if (exact) {
    for (const l of lines) {
      const q = parseFloat(l.po_received_qty || '0')
      if (!(q > 0) || !l.purchase_order_item_id || !received.has(l.purchase_order_item_id)) continue
      received.set(l.purchase_order_item_id, Math.max(0, round3(received.get(l.purchase_order_item_id)! - q)))
    }
  } else {
    // legacy: invoice quantity per item, spread over the PO lines of that item
    const reverse = new Map<string, number>()
    for (const l of lines) if (l.item_id) reverse.set(l.item_id, round3((reverse.get(l.item_id) || 0) + parseFloat(l.quantity)))
    for (const p of poItems) {
      if (!p.item_id) continue
      const want = reverse.get(p.item_id) || 0
      if (!(want > 0)) continue
      const cur = received.get(p.id) || 0
      const take = Math.min(cur, want)
      received.set(p.id, round3(cur - take))
      reverse.set(p.item_id, round3(want - take))
    }
  }

  let totalOrdered = 0
  let totalReceived = 0
  for (const p of poItems) {
    const next = received.get(p.id) || 0
    if (next !== parseFloat(p.received_quantity || '0')) {
      await tx.execute(sql`UPDATE purchase_order_items SET received_quantity = ${next.toFixed(3)}::numeric WHERE id = ${p.id}`)
    }
    totalOrdered += parseFloat(p.quantity)
    totalReceived += next
  }
  const status = totalReceived >= totalOrdered && totalOrdered > 0 ? 'fully_received'
    : totalReceived > 0 ? 'partially_received' : 'confirmed'
  await tx.execute(sql`
    UPDATE purchase_orders SET status = ${status}::purchase_order_status, updated_at = now() WHERE id = ${poId}
  `)
  return poId
}
