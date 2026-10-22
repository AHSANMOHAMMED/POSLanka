// H5: price lists + promotions for the mobile cart (pure, no React Native imports, so
// scripts/tests can run it with tsx). Online the server quote (POST /api/price-quote) is used;
// offline the same engine (./pricingEngine, a verbatim copy of src/lib/pricing/engine.ts) runs on
// the offline bundle's `pricing` block. POST /api/sales re-prices every sale either way.
import { priceCart, localClock, type PriceListRule, type PromotionRule } from './pricingEngine'
import { roundCurrency } from './taxMath'
import type { CartLineLike } from './cartMath'
import type { OfflinePricingBundle } from './catalogUnits'

export interface QuoteLine {
  key: string
  unitPrice: number
  basePrice: number
  priceListName: string | null
  promotionDiscount: number
  promotions: Array<{ promotionId: string; label: string; amount: number }>
}

export interface CartQuote {
  lines: QuoteLine[]
  cartPromotions: Array<{ promotionId: string; label: string; amount: number }>
  totals: { cartDiscount: number }
}

/** Lines for POST /api/price-quote (key = cart line id). */
export function quoteRequestLines(cart: CartLineLike[]) {
  return cart.map((c) => ({
    key: c.id,
    itemId: c.itemId || c.id,
    quantity: c.quantity,
    uom: c.uom || undefined,
    unitPrice: roundCurrency(Number(c.sellingPrice) || 0),
    priceLocked: !!c.priceLocked,
  }))
}

/** Key that changes only when the quote request would (prices set by a quote do not count). */
export function quoteKey(cart: CartLineLike[], customerId: string | null | undefined, couponCodes: string[] = []): string {
  return JSON.stringify({
    customerId: customerId || null, couponCodes,
    lines: cart.map((c) => [c.id, c.itemId || c.id, c.quantity, c.uom || null, c.priceLocked ? c.sellingPrice : null]),
  })
}

/** Write a quote into the cart; returns the same array when nothing changed. */
export function applyCartQuote<T extends CartLineLike>(cart: T[], quote: CartQuote): T[] {
  const byKey = new Map(quote.lines.map((l) => [l.key, l]))
  let changed = false
  const next = cart.map((c) => {
    const q = byKey.get(c.id)
    if (!q) return c
    const sellingPrice = c.priceLocked ? c.sellingPrice : String(roundCurrency(q.unitPrice))
    const promotionDiscount = roundCurrency(q.promotionDiscount || 0)
    const labels = q.promotions.map((p) => p.label)
    const priceListName = c.priceLocked ? null : q.priceListName
    if (Number(sellingPrice) === Number(c.sellingPrice) && promotionDiscount === (c.promotionDiscount || 0)
      && priceListName === (c.priceListName ?? null) && JSON.stringify(labels) === JSON.stringify(c.promotionLabels || [])) {
      return c
    }
    changed = true
    return { ...c, sellingPrice, promotionDiscount, promotionLabels: labels, priceListName, catalogPrice: q.basePrice }
  })
  return changed ? next : cart
}

export interface OfflinePricingContext {
  customerId?: string | null
  customerType?: string | null
  posProfileId?: string | null
  couponCodes?: string[]
  categoryOf?: (itemId: string) => string | null | undefined
  isGiftCard?: (itemId: string) => boolean
  now?: Date
}

/**
 * Offline quote from the cached bundle. Base prices: the line's unit price for its unit as the
 * device knows it (item_uoms.selling_price or catalog × factor), so the quote matches the server
 * as long as the bundle is current. Per-customer usage limits cannot be checked offline.
 */
export function offlineCartQuote(cart: CartLineLike[], pricing: OfflinePricingBundle | null | undefined, ctx: OfflinePricingContext): CartQuote | null {
  if (!pricing) return null
  const uomPrice = new Map((pricing.itemUoms || []).map((u) => [`${u.itemId}|${u.uom.toLowerCase()}`, u]))
  const result = priceCart({
    now: localClock(ctx.now || new Date(), pricing.timezone || 'Asia/Colombo'),
    customerId: ctx.customerId || null,
    customerType: ctx.customerType || null,
    posProfileId: ctx.posProfileId || null,
    couponCodes: ctx.couponCodes || [],
    priceLists: (pricing.priceLists || []) as PriceListRule[],
    promotions: (pricing.promotions || []) as PromotionRule[],
  }, cart.map((c) => {
    const itemId = c.itemId || c.id
    const u = c.uom ? uomPrice.get(`${itemId}|${c.uom.toLowerCase()}`) : undefined
    const base = c.priceLocked ? Number(c.sellingPrice) : (c.catalogPrice ?? (u?.sellingPrice ?? Number(c.sellingPrice)))
    return {
      key: c.id,
      itemId,
      categoryId: ctx.categoryOf?.(itemId) ?? null,
      quantity: c.quantity,
      uom: c.uom || null,
      uomFactor: c.uomFactor || u?.factor || 1,
      basePrice: Number(base) || 0,
      priceLocked: !!c.priceLocked,
      excludeFromPromotions: ctx.isGiftCard?.(itemId) ?? false,
    }
  }))
  return {
    lines: result.lines.map((l) => ({
      key: l.key, unitPrice: l.unitPrice, basePrice: l.basePrice, priceListName: l.priceListName,
      promotionDiscount: l.promotionDiscount, promotions: l.promotions.map(({ promotionId, label, amount }) => ({ promotionId, label, amount })),
    })),
    cartPromotions: result.cartPromotions.map(({ promotionId, label, amount }) => ({ promotionId, label, amount })),
    totals: { cartDiscount: result.totals.cartDiscount },
  }
}

/** Line totals scaled by the cart promotions (tax is charged on what the customer pays). */
export function taxableLineTotals(lineTotals: number[], cartPromotionDiscount: number): number[] {
  const sub = lineTotals.reduce((s, v) => s + v, 0)
  const ratio = sub > 0 ? Math.max(0, 1 - cartPromotionDiscount / sub) : 1
  return lineTotals.map((v) => roundCurrency(v * ratio))
}
