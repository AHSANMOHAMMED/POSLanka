import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { getPurchasingSettings, type PurchasingSettings } from './settings'

/**
 * H3 — 3-way match of a purchase invoice against its purchase order and goods receipts.
 *
 * Per item of the invoice (lines aggregated by item):
 *   price  — invoice unit price vs the PO line price (weighted over the item's PO lines):
 *            |invoice − PO| / PO > matchPriceTolerancePct  → 'price'
 *   qty    — quantity billed on this PO (other submitted invoices + this one) vs
 *            the quantity received on the PO's goods receipts, or — when the PO has no GRN
 *            (the invoice receives the goods itself) — the ordered quantity:
 *            billed > basis × (1 + matchQtyTolerancePct / 100)   → 'qty_over_received' / 'qty_over_ordered'
 *   item not on the PO                                          → 'not_on_po'
 * Invoices without a PO are 'not_applicable'. The tenant decides (settings.matchAction) whether a
 * mismatch only flags the invoice ('warn') or blocks submitting it ('block').
 */

export type MatchStatus = 'matched' | 'mismatch' | 'not_applicable'

export interface MatchIssue {
  itemId: string | null
  itemName: string
  type: 'price' | 'qty_over_received' | 'qty_over_ordered' | 'not_on_po'
  invoiceQty: number
  invoicePrice: number
  poQty: number | null
  poPrice: number | null
  receivedQty: number | null
  billedQty: number | null
  variancePct: number | null
  message: string
}

export interface MatchResult {
  status: MatchStatus
  action: PurchasingSettings['matchAction']
  tolerance: { pricePct: number; qtyPct: number }
  issues: MatchIssue[]
  checkedAt: string
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
const round2 = (n: number) => Math.round(n * 100) / 100

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export async function evaluateThreeWayMatch(
  tx: DbTx,
  opts: {
    tenantId: string
    purchaseOrderId: string | null
    /** the invoice itself, excluded from "previously billed" */
    purchaseId?: string | null
    /** quantity / unitPrice in the line's unit; uomFactor = base units per unit (0184, default 1) */
    lines: { itemId: string | null; itemName: string; quantity: number; unitPrice: number; uomFactor?: number | string | null }[]
    settings?: PurchasingSettings
  },
): Promise<MatchResult> {
  const settings = opts.settings || await getPurchasingSettings(tx, opts.tenantId)
  const base: MatchResult = {
    status: 'not_applicable', action: settings.matchAction,
    tolerance: { pricePct: settings.matchPriceTolerancePct, qtyPct: settings.matchQtyTolerancePct },
    issues: [], checkedAt: new Date().toISOString(),
  }
  if (!opts.purchaseOrderId) return base

  const po = rows<{ item_id: string | null; item_name: string; qty: string; value: string }>(await tx.execute(sql`
    SELECT item_id, MIN(item_name) AS item_name, SUM(quantity * uom_factor) AS qty, SUM(quantity * unit_price) AS value
    FROM purchase_order_items WHERE purchase_order_id = ${opts.purchaseOrderId}
    GROUP BY item_id
  `))
  const received = rows<{ item_id: string; qty: string }>(await tx.execute(sql`
    SELECT ri.item_id, SUM(ri.quantity_accepted * ri.uom_factor) AS qty
    FROM purchase_receipt_items ri JOIN purchase_receipts r ON r.id = ri.receipt_id
    WHERE r.tenant_id = ${opts.tenantId} AND r.purchase_order_id = ${opts.purchaseOrderId}
      AND r.status <> 'cancelled' AND ri.item_id IS NOT NULL
    GROUP BY ri.item_id
  `))
  const exclude = opts.purchaseId || null
  const billed = rows<{ item_id: string; qty: string }>(await tx.execute(sql`
    SELECT pi.item_id, SUM(pi.quantity * pi.uom_factor) AS qty
    FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    WHERE p.tenant_id = ${opts.tenantId} AND p.purchase_order_id = ${opts.purchaseOrderId}
      AND p.is_return = false AND p.status NOT IN ('draft', 'cancelled')
      AND (${exclude}::uuid IS NULL OR p.id <> ${exclude}::uuid)
      AND pi.item_id IS NOT NULL
    GROUP BY pi.item_id
  `))
  const poBy = new Map(po.filter(p => p.item_id).map(p => [p.item_id!, { qty: parseFloat(p.qty), price: parseFloat(p.qty) > 0 ? parseFloat(p.value) / parseFloat(p.qty) : 0 }]))
  const recBy = new Map(received.map(r => [r.item_id, parseFloat(r.qty)]))
  const billedBy = new Map(billed.map(b => [b.item_id, parseFloat(b.qty)]))
  const hasGrn = received.length > 0

  const inv = new Map<string, { itemId: string | null; itemName: string; qty: number; value: number }>()
  for (const l of opts.lines) {
    if (!(l.quantity > 0)) continue
    const key = l.itemId || `name:${l.itemName}`
    const agg = inv.get(key) || { itemId: l.itemId, itemName: l.itemName, qty: 0, value: 0 }
    // 0184: compared in base units (PO / GRN / invoice lines may be in different units)
    agg.qty = round3(agg.qty + l.quantity * (Number(l.uomFactor) || 1))
    agg.value += l.quantity * l.unitPrice
    inv.set(key, agg)
  }

  const issues: MatchIssue[] = []
  for (const l of inv.values()) {
    const price = l.qty > 0 ? round2(l.value / l.qty) : 0
    const p = l.itemId ? poBy.get(l.itemId) : undefined
    const common = { itemId: l.itemId, itemName: l.itemName, invoiceQty: l.qty, invoicePrice: price }
    if (!p) {
      issues.push({ ...common, type: 'not_on_po', poQty: null, poPrice: null, receivedQty: null, billedQty: null, variancePct: null,
        message: `${l.itemName} is not on the purchase order` })
      continue
    }
    const poPrice = round2(p.price)
    const priceVar = poPrice > 0 ? round2(((price - poPrice) / poPrice) * 100) : (price > 0 ? 100 : 0)
    const recQty = l.itemId ? (recBy.get(l.itemId) || 0) : 0
    const prevBilled = l.itemId ? (billedBy.get(l.itemId) || 0) : 0
    const totalBilled = round3(prevBilled + l.qty)
    if (Math.abs(priceVar) > settings.matchPriceTolerancePct + 1e-9) {
      issues.push({ ...common, type: 'price', poQty: p.qty, poPrice, receivedQty: recQty, billedQty: totalBilled, variancePct: priceVar,
        message: `${l.itemName}: invoice price ${price.toFixed(2)} vs PO price ${poPrice.toFixed(2)} (${priceVar > 0 ? '+' : ''}${priceVar}%)` })
    }
    const basis = hasGrn ? recQty : p.qty
    const limit = round3(basis * (1 + settings.matchQtyTolerancePct / 100))
    if (totalBilled > limit + 0.0005) {
      const qtyVar = basis > 0 ? round2(((totalBilled - basis) / basis) * 100) : null
      issues.push({ ...common, type: hasGrn ? 'qty_over_received' : 'qty_over_ordered', poQty: p.qty, poPrice, receivedQty: recQty, billedQty: totalBilled, variancePct: qtyVar,
        message: hasGrn
          ? `${l.itemName}: billed ${totalBilled} but only ${recQty} received on the GRNs`
          : `${l.itemName}: billed ${totalBilled} but only ${p.qty} ordered` })
    }
  }

  return { ...base, status: issues.length > 0 ? 'mismatch' : 'matched', issues }
}

/** Error message for a blocked submit (mapped to 400 THREE_WAY_MATCH_BLOCKED by stockErrorResponse). */
export function matchBlockedMessage(result: MatchResult): string {
  return `MATCH_BLOCKED: 3-way match failed (${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}): ${result.issues.map(i => i.message).join('; ')}`
}
