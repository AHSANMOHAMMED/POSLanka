import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { roundCurrency } from '@/lib/utils/currency'
import { getPurchasePostingAccounts } from '@/lib/accounting/auto-post'
import { applyCostAdjustment } from './cost-adjustment'
import { getTotalItemStock } from './stock-cost'

/**
 * H3 — Stock Received But Not Billed (SRBNB).
 *
 * A GRN that puts stock into the warehouse (receive with updateStock) posts
 *     Dr Stock  /  Cr SRBNB        at PO price × accepted qty
 * and is marked purchase_receipts.gl_posted = true (each line keeps its unit_cost).
 *
 * The supplier invoice of that PO later takes those goods as its own (it does not receive them
 * again — src/lib/purchasing/grn-coverage.ts). For the quantity covered by a GL-posted GRN the
 * invoice debits SRBNB (at the GRN value) instead of Stock; the difference between the invoice
 * price and the GRN price goes to the price variance account when configured, otherwise into the
 * cost of the stock still on hand (and COGS for what is already sold). purchase_items.srbnb_qty /
 * srbnb_amount record what each line cleared, so cancelling the invoice re-opens exactly that.
 *
 * GRNs made before this (gl_posted = false) never touched the ledger: their invoice keeps the old
 * posting (Dr Stock for everything). An invoice consumes legacy GRN quantity first.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

/** Value posted for a GRN: Σ round(accepted qty × unit cost, 2) over its stock lines. */
export async function grnPostedValue(tx: DbTx, receiptId: string, itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0
  const [row] = rows<{ v: string | null }>(await tx.execute(sql`
    SELECT COALESCE(SUM(ROUND(quantity_accepted * COALESCE(unit_cost, 0), 2)), 0) AS v
    FROM purchase_receipt_items
    WHERE receipt_id = ${receiptId} AND item_id IN (${sql.join(itemIds.map(i => sql`${i}::uuid`), sql`, `)})
  `))
  return roundCurrency(parseFloat(row?.v || '0'))
}

/** Per item: GL-posted GRN quantity / value of the PO not yet cleared by a submitted invoice. */
export async function unbilledSrbnb(
  tx: DbTx,
  tenantId: string,
  purchaseOrderId: string,
  excludePurchaseId?: string | null,
): Promise<Map<string, { qty: number; value: number }>> {
  const exclude = excludePurchaseId || null
  const list = rows<{ item_id: string; pq: string; pv: string; cq: string; cv: string }>(await tx.execute(sql`
    WITH posted AS (
      SELECT ri.item_id, SUM(ri.quantity_accepted * ri.uom_factor) AS q, SUM(ROUND(ri.quantity_accepted * COALESCE(ri.unit_cost, 0), 2)) AS v
      FROM purchase_receipt_items ri
      JOIN purchase_receipts r ON r.id = ri.receipt_id
      WHERE r.tenant_id = ${tenantId}
        AND r.purchase_order_id = ${purchaseOrderId}
        AND r.gl_posted = true
        AND r.status <> 'cancelled'
        AND ri.item_id IS NOT NULL
      GROUP BY ri.item_id
    ),
    cleared AS (
      SELECT pi.item_id, SUM(pi.srbnb_qty) AS q, SUM(pi.srbnb_amount) AS v
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi.purchase_id
      WHERE p.tenant_id = ${tenantId}
        AND p.purchase_order_id = ${purchaseOrderId}
        AND p.is_return = false
        AND p.status NOT IN ('draft', 'cancelled')
        AND (${exclude}::uuid IS NULL OR p.id <> ${exclude}::uuid)
        AND pi.item_id IS NOT NULL
      GROUP BY pi.item_id
    )
    SELECT posted.item_id, posted.q AS pq, posted.v AS pv, COALESCE(cleared.q, 0) AS cq, COALESCE(cleared.v, 0) AS cv
    FROM posted LEFT JOIN cleared ON cleared.item_id = posted.item_id
  `))
  const out = new Map<string, { qty: number; value: number }>()
  for (const r of list) {
    const qty = round3(parseFloat(r.pq) - parseFloat(r.cq))
    const value = roundCurrency(parseFloat(r.pv) - parseFloat(r.cv))
    if (qty > 0) out.set(r.item_id, { qty, value: Math.max(0, value) })
  }
  return out
}

export interface ClearingLine {
  /** purchase_items.id (when the line already exists) */
  lineId?: string
  itemId: string | null
  /** 0184: base units (quantity × uom_factor) */
  qty: number
  /** 0184: price per base unit (line unit price / uom_factor) */
  unitPrice: number
  /** Base quantity of this line taken from the PO's GRN stock (not received again by the invoice). */
  fromGrn: number
}

export interface ClearingPlan {
  /** per input line (same order): what it clears from SRBNB */
  lines: { srbnbQty: number; srbnbAmount: number }[]
  srbnbAmount: number
  priceVariance: number
  cogsAdjustment: number
}

/**
 * Work out, for an invoice of a PO, how much of each line clears SRBNB and the price difference.
 * `netFactor` = invoice net cost (total − tax) / Σ qty × unitPrice — scales line values to the
 * net amount actually posted (tax-inclusive templates). With no price variance account the
 * difference is applied to the item cost here (applyCostAdjustment, source 'price_variance').
 */
export async function planGrnClearing(
  tx: DbTx,
  opts: {
    tenantId: string
    purchaseOrderId: string
    excludePurchaseId?: string | null
    /** remaining GRN stock per item from unbilledGrnStock (legacy + GL-posted) */
    grnRemaining: Map<string, number>
    lines: ClearingLine[]
    netFactor: number
    purchaseId: string
    purchaseNo: string
    supplierId?: string | null
    userId?: string | null
  },
): Promise<ClearingPlan> {
  const empty: ClearingPlan = { lines: opts.lines.map(() => ({ srbnbQty: 0, srbnbAmount: 0 })), srbnbAmount: 0, priceVariance: 0, cogsAdjustment: 0 }
  if (!opts.lines.some(l => l.fromGrn > 0)) return empty
  const srbnb = await unbilledSrbnb(tx, opts.tenantId, opts.purchaseOrderId, opts.excludePurchaseId)
  if (srbnb.size === 0) return empty

  // legacy (not GL-posted) GRN quantity is consumed first
  const legacy = new Map<string, number>()
  for (const [itemId, total] of opts.grnRemaining) {
    legacy.set(itemId, Math.max(0, round3(total - (srbnb.get(itemId)?.qty || 0))))
  }

  const plan: ClearingPlan = { lines: [], srbnbAmount: 0, priceVariance: 0, cogsAdjustment: 0 }
  const diffByItem = new Map<string, { diff: number; qty: number }>()
  for (const line of opts.lines) {
    if (!line.itemId || !(line.fromGrn > 0)) { plan.lines.push({ srbnbQty: 0, srbnbAmount: 0 }); continue }
    const fromLegacy = Math.min(line.fromGrn, legacy.get(line.itemId) || 0)
    legacy.set(line.itemId, round3((legacy.get(line.itemId) || 0) - fromLegacy))
    const avail = srbnb.get(line.itemId)
    const want = round3(line.fromGrn - fromLegacy)
    const q = avail ? Math.min(want, avail.qty) : 0
    if (!(q > 0) || !avail) { plan.lines.push({ srbnbQty: 0, srbnbAmount: 0 }); continue }
    const amount = q >= avail.qty ? avail.value : roundCurrency(avail.value * q / avail.qty)
    avail.qty = round3(avail.qty - q)
    avail.value = roundCurrency(avail.value - amount)
    plan.lines.push({ srbnbQty: q, srbnbAmount: amount })
    plan.srbnbAmount = roundCurrency(plan.srbnbAmount + amount)
    const invoiceValue = roundCurrency(q * line.unitPrice * opts.netFactor)
    const d = diffByItem.get(line.itemId) || { diff: 0, qty: 0 }
    d.diff = roundCurrency(d.diff + invoiceValue - amount)
    d.qty = round3(d.qty + q)
    diffByItem.set(line.itemId, d)
  }

  const totalDiff = roundCurrency([...diffByItem.values()].reduce((s, d) => s + d.diff, 0))
  if (totalDiff === 0 && [...diffByItem.values()].every(d => d.diff === 0)) return plan

  const accounts = await getPurchasePostingAccounts(tx, opts.tenantId)
  if (accounts.priceVarianceAccountId) {
    plan.priceVariance = totalDiff
    return plan
  }
  // No variance account: the difference is part of the goods' cost. Units still on hand get it
  // in their weighted-average cost (Dr/Cr Stock); units already sold → COGS.
  for (const [itemId, d] of diffByItem) {
    if (d.diff === 0) continue
    const res = await applyCostAdjustment(tx, {
      tenantId: opts.tenantId, itemId, amount: d.diff, basisQty: d.qty, source: 'price_variance',
      supplierId: opts.supplierId, referenceId: opts.purchaseId, referenceNo: opts.purchaseNo, userId: opts.userId,
      notes: `Invoice ${opts.purchaseNo} vs GRN price: ${d.diff.toFixed(2)} over ${d.qty} units`,
    })
    plan.cogsAdjustment = roundCurrency(plan.cogsAdjustment + res.expensed)
  }
  return plan
}

/**
 * Cancelling / deleting an invoice whose GRN price difference went into the item cost (no price
 * variance account): take the absorbed amount back out of the stock on hand. The GL side is
 * reversed with the invoice voucher.
 */
export async function reversePriceVariance(
  tx: DbTx,
  opts: { tenantId: string; purchaseId: string; purchaseNo: string; userId?: string | null },
): Promise<void> {
  const list = rows<{ item_id: string; absorbed: string }>(await tx.execute(sql`
    SELECT item_id, SUM(ROUND((new_cost_price - previous_cost_price) * stock_before, 2)) AS absorbed
    FROM item_cost_history
    WHERE tenant_id = ${opts.tenantId} AND source = 'price_variance' AND reference_id = ${opts.purchaseId}
    GROUP BY item_id
    ORDER BY item_id
  `))
  for (const r of list) {
    const absorbed = roundCurrency(parseFloat(r.absorbed || '0'))
    if (absorbed === 0) continue
    const onHand = Math.max(0, await getTotalItemStock(tx, opts.tenantId, r.item_id))
    await applyCostAdjustment(tx, {
      tenantId: opts.tenantId, itemId: r.item_id, amount: -absorbed, basisQty: onHand, source: 'price_variance',
      referenceId: opts.purchaseId, referenceNo: opts.purchaseNo, userId: opts.userId,
      notes: `Reversal: invoice ${opts.purchaseNo} cancelled — price difference ${(-absorbed).toFixed(2)} taken back`,
    })
  }
}
