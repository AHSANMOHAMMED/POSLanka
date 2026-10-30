// Pure cart maths shared by the POS screen, cart drawer and tender screen (no React Native
// imports, so scripts/tests/gG-mobile.ts can run it with tsx).
//
// Mirrors how POST /api/sales validates a sale:
//   line total  = round2(round4(unitPrice) × quantity − discount)   (discount = promotions, H5)
//   subtotal    = Σ line totals (rejected with "Cart total mismatch" when off by > 0.05)
//   total       = subtotal + exclusive tax (inclusive tax is already inside the prices)
import { roundCurrency, type CartTaxResult } from './taxMath'
import { roundUnitPrice } from './measureUnits'

export interface CartLineLike {
  id: string
  itemId?: string
  name: string
  sellingPrice: string
  quantity: number
  unit?: string | null
  taxTemplateId?: string | null
  trackStock?: boolean
  availableStock?: number | null
  /** H5: unit sold (null / undefined = base unit) and base units per 1 of it */
  uom?: string | null
  uomFactor?: number
  /** H5: price fixed by a label / barcode override — price lists do not change it */
  priceLocked?: boolean
  /** H5: from /api/price-quote (or the offline engine): promotion discount, labels, price list */
  promotionDiscount?: number
  promotionLabels?: string[]
  priceListName?: string | null
  catalogPrice?: number
}

/**
 * One line's value before promotions: round2(unitPrice × quantity), the unit price kept to 4 dp
 * like sale_items.unit_price (0.345 / g of a 345 / kg item: 250 g = 86.25). A price in cents is
 * unchanged by the 4 dp rounding.
 */
export function lineGross(line: Pick<CartLineLike, 'sellingPrice' | 'quantity'>): number {
  return roundCurrency(roundUnitPrice(Number(line.sellingPrice) || 0) * line.quantity)
}

/** One line's total exactly as the server computes it (net of the line's promotions). */
export function lineTotal(line: Pick<CartLineLike, 'sellingPrice' | 'quantity'> & { promotionDiscount?: number }): number {
  return roundCurrency(lineGross(line) - (line.promotionDiscount || 0))
}

/** Σ of rounded line totals (the server's subtotal), not round(Σ unrounded). */
export function cartSubtotal(cart: Array<Pick<CartLineLike, 'sellingPrice' | 'quantity'> & { promotionDiscount?: number }>): number {
  return roundCurrency(cart.reduce((s, l) => s + lineTotal(l), 0))
}

/** Amount payable before loyalty: subtotal + tax charged on top of the prices. */
export function cartPayable(subtotal: number, tax: Pick<CartTaxResult, 'exclusiveTax'>): number {
  return roundCurrency(subtotal + (tax.exclusiveTax || 0))
}

/**
 * Unit price (2 dp, as the server stores it) for a scale / GS1 label whose amount payable is
 * `amount` for `quantity` (kg or count), chosen so round2(unitPrice × quantity) equals the
 * label amount whenever such a price exists — the customer pays what the label says.
 */
export function unitPriceForAmount(amount: number, quantity: number): number {
  if (!(quantity > 0)) return roundCurrency(amount)
  const base = roundCurrency(amount / quantity)
  const target = roundCurrency(amount)
  // Above 1 kg not every cent is reachable with a 2-dp unit price: take the closest one.
  let best = base
  let bestErr = Math.abs(roundCurrency(base * quantity) - target)
  for (let step = 1; step <= 100 && bestErr > 0.000001; step++) {
    for (const cand of [roundCurrency(base + step / 100), roundCurrency(base - step / 100)]) {
      if (cand < 0) continue
      const err = Math.abs(roundCurrency(cand * quantity) - target)
      if (err < bestErr - 0.000001) {
        best = cand
        bestErr = err
      }
    }
  }
  return best
}

/** Scan-derived info (server `scan` block or local findByCode match). */
export interface ScanValues {
  symbology?: string | null
  quantity?: number | string | null
  unitPrice?: number | string | null
  /** amount payable printed on a price-embedded label */
  lineTotal?: number | string | null
}

export interface ScanLine {
  quantity: number
  unitPrice?: number
  weighed: boolean
  /** the label printed the amount payable: keep it as its own line (merging could drift a cent) */
  fixedAmount?: boolean
}

function n(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN
  const x = Number(v)
  return Number.isFinite(x) ? x : NaN
}

/**
 * How a scanned label becomes a cart line.
 *  - weight label: quantity = weight, catalog price;
 *  - price-embedded scale label / GS1 AI 392n ("amount payable"): the printed amount is the LINE
 *    total, so the unit price is derived from it (never amount × weight);
 *  - GS1 count (AI 30/37) with an amount: amount is for the whole count.
 */
export function scanToLine(scan: ScanValues | null | undefined): ScanLine {
  const qty = n(scan?.quantity)
  let amount = n(scan?.lineTotal)
  let price = n(scan?.unitPrice)
  // GS1 AI 392n is the amount payable for the trade item (older servers send it as unitPrice).
  if (!(amount > 0) && scan?.symbology === 'gs1' && price > 0) {
    amount = price
    price = NaN
  }
  if (qty > 0) {
    const quantity = Math.round(qty * 1000) / 1000
    if (amount > 0) return { quantity, unitPrice: unitPriceForAmount(amount, quantity), weighed: true, fixedAmount: true }
    return { quantity, unitPrice: price > 0 ? price : undefined, weighed: true }
  }
  if (amount > 0) return { quantity: 1, unitPrice: roundCurrency(amount), weighed: true, fixedAmount: true }
  if (price > 0) return { quantity: 1, unitPrice: price, weighed: true }
  return { quantity: 1, weighed: false }
}

// ---------------------------------------------------------------------------
// Held sales (POST /api/held-sales → itemId must be the catalog uuid)
// ---------------------------------------------------------------------------
export interface HeldItemWire {
  itemId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
  /** H5: unit of the line (held stock is reserved as quantity × uomFactor base units) */
  uom?: string
  uomFactor?: number
}

export function heldCartItems(cart: CartLineLike[]): HeldItemWire[] {
  return cart.map((c) => ({
    itemId: c.itemId || c.id,
    name: c.name,
    quantity: c.quantity,
    unitPrice: roundCurrency(Number(c.sellingPrice) || 0),
    total: lineTotal(c),
    ...(c.uom ? { uom: c.uom, uomFactor: c.uomFactor || 1 } : {}),
  }))
}

export interface CatalogInfo {
  taxTemplateId?: string | null
  unit?: string | null
  trackStock?: boolean
  availableStock?: number | null
  sku?: string | null
  barcode?: string | null
}

/**
 * Rebuild cart lines from a held ticket. Lines of the same item (scale labels at different
 * prices) keep distinct line ids, and catalog details (tax template, stock, unit) are restored
 * so the resumed sale is taxed like the original cart.
 */
export function cartFromHeld(
  items: Array<{ itemId: string; name: string; quantity: number | string; unitPrice: number | string; uom?: string | null; uomFactor?: number | string | null }>,
  catalog: (itemId: string) => CatalogInfo | null | undefined = () => null
): CartLineLike[] {
  const seen = new Map<string, number>()
  const out: CartLineLike[] = []
  for (const c of items || []) {
    const qty = Number(c.quantity)
    if (!c.itemId || !(qty > 0)) continue
    const count = (seen.get(c.itemId) || 0) + 1
    seen.set(c.itemId, count)
    const info = catalog(c.itemId) || {}
    out.push({
      id: count === 1 ? c.itemId : `${c.itemId}#${count}`,
      itemId: c.itemId,
      name: c.name,
      sellingPrice: String(c.unitPrice),
      quantity: qty,
      unit: info.unit ?? undefined,
      taxTemplateId: info.taxTemplateId ?? null,
      trackStock: info.trackStock,
      availableStock: info.availableStock ?? null,
      ...(c.uom ? { uom: c.uom, uomFactor: Number(c.uomFactor) || 1 } : {}),
    })
  }
  return out
}
