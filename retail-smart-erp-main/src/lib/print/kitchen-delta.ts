/**
 * Kitchen send planner (pure; shared by the web POS and mirrored in apps/mobile/src/lib/kitchenTicket.ts).
 *
 * The POS remembers, per cart line, the quantity that has already been sent to the kitchen.
 * Each "Send to kitchen" compares the cart with that state and produces only the changes:
 *   - lines never sent        → normal ticket line        ("2 x Burger")
 *   - quantity increased      → delta line                ("+3 x Burger")
 *   - quantity reduced/removed→ void line                 ("VOID 1 x Burger")
 * After a successful send `applyKitchenPlan` returns the new sent state, so re-sending an
 * unchanged cart prints nothing (idempotent).
 */
import type { KitchenTicketItem } from './escpos/kitchen-ticket'

const EPS = 1e-6

/** Cart line as the kitchen sees it (quantity = kitchen quantity: count, or weight for weighed lines). */
export interface KitchenCartLine {
  cartLineId: string
  itemId?: string | null
  name: string
  quantity: number
  modifiers?: string[]
  notes?: string | null
}

/** A restaurant order item backing (part of) a sent cart line. */
export interface KitchenOrderItemRef {
  id: string
  /** Kitchen quantity this order item stands for. */
  quantity: number
}

export interface KitchenSentEntry {
  name: string
  itemId?: string | null
  /** Kitchen quantity already on a ticket. */
  quantity: number
  modifiers?: string[]
  notes?: string | null
  orderItems?: KitchenOrderItemRef[]
}

export type KitchenSentMap = Record<string, KitchenSentEntry>

export interface KitchenPlan {
  added: KitchenCartLine[]
  increased: Array<{ line: KitchenCartLine; delta: number }>
  decreased: Array<{ cartLineId: string; entry: KitchenSentEntry; delta: number; removed: boolean }>
}

/** Rounds float noise (0.1 + 0.2) to 3 decimals, the precision quantities are printed with. */
export function roundKitchenQty(q: number): number {
  return Math.round((Number.isFinite(q) ? q : 0) * 1000) / 1000
}

export function planKitchenSend(lines: KitchenCartLine[], sent: KitchenSentMap): KitchenPlan {
  const plan: KitchenPlan = { added: [], increased: [], decreased: [] }
  const seen = new Set<string>()
  for (const line of lines) {
    seen.add(line.cartLineId)
    const q = roundKitchenQty(line.quantity)
    const prev = sent[line.cartLineId]
    if (!prev) {
      if (q > EPS) plan.added.push({ ...line, quantity: q })
      continue
    }
    const delta = roundKitchenQty(q - prev.quantity)
    if (delta > EPS) plan.increased.push({ line: { ...line, quantity: q }, delta })
    else if (delta < -EPS) plan.decreased.push({ cartLineId: line.cartLineId, entry: prev, delta: -delta, removed: q <= EPS })
  }
  for (const [id, entry] of Object.entries(sent)) {
    if (seen.has(id) || entry.quantity <= EPS) continue
    plan.decreased.push({ cartLineId: id, entry, delta: roundKitchenQty(entry.quantity), removed: true })
  }
  return plan
}

export function isEmptyKitchenPlan(plan: KitchenPlan): boolean {
  return plan.added.length === 0 && plan.increased.length === 0 && plan.decreased.length === 0
}

/** Ticket lines for a plan: new lines, then "+n" deltas, then VOIDs. */
export function kitchenPlanTicketItems(plan: KitchenPlan): KitchenTicketItem[] {
  return [
    ...plan.added.map((l) => ({ name: l.name, quantity: l.quantity, modifiers: l.modifiers, notes: l.notes ?? null })),
    ...plan.increased.map(({ line, delta }) => ({ name: line.name, quantity: delta, modifiers: line.modifiers, notes: line.notes ?? null, mark: 'add' as const })),
    ...plan.decreased.map(({ entry, delta }) => ({ name: entry.name, quantity: delta, modifiers: entry.modifiers, mark: 'void' as const })),
  ]
}

/**
 * New sent state after a plan was sent. `orderItems` (optional) maps cart line ids to the order
 * item refs the caller ended up with for that line (after POST / PUT / DELETE).
 */
export function applyKitchenPlan(sent: KitchenSentMap, plan: KitchenPlan, orderItems?: Record<string, KitchenOrderItemRef[]>): KitchenSentMap {
  const next: KitchenSentMap = { ...sent }
  for (const l of plan.added) {
    next[l.cartLineId] = { name: l.name, itemId: l.itemId ?? null, quantity: l.quantity, modifiers: l.modifiers, notes: l.notes ?? null, orderItems: orderItems?.[l.cartLineId] }
  }
  for (const { line } of plan.increased) {
    const prev = next[line.cartLineId]
    next[line.cartLineId] = { ...prev, name: line.name, quantity: line.quantity, orderItems: orderItems?.[line.cartLineId] ?? prev?.orderItems }
  }
  for (const d of plan.decreased) {
    if (d.removed) {
      delete next[d.cartLineId]
      continue
    }
    const prev = next[d.cartLineId]
    next[d.cartLineId] = { ...prev, quantity: roundKitchenQty(prev.quantity - d.delta), orderItems: orderItems?.[d.cartLineId] ?? prev.orderItems }
  }
  return next
}

/**
 * Restaurant order items store an integer quantity (restaurant_order_items.quantity is INTEGER and
 * no migration slot was available). A decimal kitchen quantity (weighed / 1.5 portions) is posted
 * as quantity 1 priced at the full amount, with the real quantity in the item notes ("Qty 0.25"),
 * so totals stay right and the KDS shows what to prepare.
 */
export function kitchenOrderItemPayload(
  quantity: number,
  pricePerUnit: number,
  notes?: string | null
): { quantity: number; unitPrice: number; notes?: string } {
  const q = roundKitchenQty(quantity)
  const n = (notes || '').trim()
  if (Number.isInteger(q) && q > 0) return { quantity: q, unitPrice: roundMoney(pricePerUnit), notes: n || undefined }
  const qtyNote = `Qty ${formatKitchenQty(q)}`
  return { quantity: 1, unitPrice: roundMoney(pricePerUnit * q), notes: (n ? `${qtyNote} · ${n}` : qtyNote).slice(0, 500) }
}

export function formatKitchenQty(q: number): string {
  const r = roundKitchenQty(q)
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}
