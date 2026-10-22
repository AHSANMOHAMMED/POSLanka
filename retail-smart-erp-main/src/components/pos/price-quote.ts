'use client'

// H5: web POS pricing — asks POST /api/price-quote for price lists + promotions and writes the
// result into the cart (docs/INTEGRATION_PRICING.md). The server re-prices every sale; this only
// keeps what the cashier sees equal to what POST /api/sales will accept.
import { useEffect, useRef, useState } from 'react'
import type { CartItem } from './types'
import { priceCart, localClock } from '@/lib/pricing/engine'
import type { OfflinePricingBundle } from '@/lib/pricing/load-context'
import { loadPricingBundleCache, refreshPricingBundle } from '@/lib/offline/pricing-cache'

export interface QuoteLine {
  key: string
  unitPrice: number
  basePrice: number
  priceListName: string | null
  promotionDiscount: number
  promotions: Array<{ promotionId: string; label: string; amount: number }>
}
export interface QuoteResult {
  lines: QuoteLine[]
  cartPromotions: Array<{ promotionId: string; label: string; amount: number }>
  totals: { cartDiscount: number }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Price-locked lines keep their price: manual price, scale label, modifiers, core charge. */
export function isPriceLocked(c: CartItem): boolean {
  return !!c.priceLocked || (!!c.isWeighable && !!c.weight) || !!(c.modifiers && c.modifiers.length) || !!c.coreCharge
}

/** Net line value after its promotions (what the sale's subtotal adds up). */
export function lineNet(c: CartItem): number {
  return round2(c.total - (c.promotionDiscount || 0))
}

/** Write a quote into the cart; returns the same array when nothing changed (no re-render loop). */
export function applyQuoteToCart(cart: CartItem[], quote: QuoteResult): CartItem[] {
  const byKey = new Map(quote.lines.map((l) => [l.key, l]))
  let changed = false
  const next = cart.map((c) => {
    const q = byKey.get(c.cartLineId)
    if (!q) return c
    const locked = isPriceLocked(c)
    const unitPrice = locked ? c.unitPrice : q.unitPrice
    const total = locked ? c.total : round2(unitPrice * c.quantity)
    const labels = q.promotions.map((p) => p.label)
    const promotionDiscount = round2(q.promotionDiscount)
    if (unitPrice === c.unitPrice && total === c.total && promotionDiscount === (c.promotionDiscount || 0)
      && (c.priceListName ?? null) === (locked ? null : q.priceListName) && JSON.stringify(labels) === JSON.stringify(c.promotionLabels || [])) {
      return c
    }
    changed = true
    return {
      ...c, unitPrice, total, promotionDiscount, promotionLabels: labels,
      priceListName: locked ? null : q.priceListName, catalogPrice: q.basePrice,
    }
  })
  return changed ? next : cart
}

/**
 * Offline quote with the shared engine on the cached bundle (same rules as the server; the server
 * re-prices the queued sale on sync and flags any difference).
 */
export function offlineQuote(
  cart: CartItem[],
  bundle: OfflinePricingBundle | null,
  ctx: { customerId?: string | null; customerType?: string | null; posProfileId?: string | null; couponCodes?: string[]; categoryOf?: (itemId: string) => string | null | undefined },
  toSaleLine: (c: CartItem) => CartItem & { discount?: number },
): QuoteResult | null {
  if (!bundle) return null
  const conv = new Map((bundle.itemUoms || []).map((u) => [`${u.itemId}|${u.uom.toLowerCase()}`, u]))
  const r = priceCart({
    now: localClock(new Date(), bundle.timezone || 'Asia/Colombo'),
    customerId: ctx.customerId || null,
    customerType: ctx.customerType || null,
    posProfileId: ctx.posProfileId || null,
    couponCodes: ctx.couponCodes || [],
    priceLists: bundle.priceLists,
    promotions: bundle.promotions,
  }, cart.map((c) => {
    const s = toSaleLine(c)
    const u = c.uom ? conv.get(`${c.itemId}|${c.uom.toLowerCase()}`) : undefined
    const locked = isPriceLocked(c)
    return {
      key: c.cartLineId,
      itemId: c.itemId,
      categoryId: ctx.categoryOf?.(c.itemId) ?? null,
      quantity: s.quantity,
      uom: c.uom || null,
      uomFactor: c.uomFactor || u?.factor || 1,
      basePrice: locked ? s.unitPrice : (c.catalogPrice ?? s.unitPrice),
      priceLocked: locked,
    }
  }))
  return {
    lines: r.lines.map((l) => ({ key: l.key, unitPrice: l.unitPrice, basePrice: l.basePrice, priceListName: l.priceListName, promotionDiscount: l.promotionDiscount, promotions: l.promotions })),
    cartPromotions: r.cartPromotions,
    totals: { cartDiscount: r.totals.cartDiscount },
  }
}

/** Strip pricing results (return / exchange carts are priced from the original invoice). */
export function clearCartPricing(cart: CartItem[]): CartItem[] {
  return cart.some((c) => c.promotionDiscount || c.promotionLabels?.length)
    ? cart.map((c) => ({ ...c, promotionDiscount: 0, promotionLabels: [], priceListName: null }))
    : cart
}

interface Options {
  cart: CartItem[]
  setCart: (fn: (prev: CartItem[]) => CartItem[]) => void
  enabled: boolean
  /** false: price with the cached bundle (offline) */
  online: boolean
  tenantSlug?: string | null
  customerType?: string | null
  categoryOf?: (itemId: string) => string | null | undefined
  customerId?: string | null
  posProfileId?: string | null
  couponCodes: string[]
  /** sale line as POST /api/sales will receive it (weighed lines: quantity = weight) */
  toSaleLine: (c: CartItem) => CartItem & { discount?: number }
}

/** Debounced quote on every cart / customer / coupon change. */
export function usePriceQuote({ cart, setCart, enabled, online, tenantSlug, customerType, categoryOf, customerId, posProfileId, couponCodes, toSaleLine }: Options) {
  const [cartPromotions, setCartPromotions] = useState<QuoteResult['cartPromotions']>([])
  const [cartPromotionDiscount, setCartPromotionDiscount] = useState(0)
  const seq = useRef(0)
  // the request depends on items / quantities / locked prices, not on prices the quote set
  // keep the offline copy of price lists / promotions fresh while online
  useEffect(() => {
    if (enabled && online) void refreshPricingBundle(tenantSlug)
  }, [enabled, online, tenantSlug])

  const key = enabled && cart.length > 0 ? JSON.stringify({
    customerId, posProfileId, couponCodes, online,
    lines: cart.map((c) => [c.cartLineId, c.itemId, c.quantity, c.weight ?? null, c.uom ?? null, isPriceLocked(c) ? c.unitPrice : null]),
  }) : ''

  useEffect(() => {
    if (!key) {
      setCartPromotions([])
      setCartPromotionDiscount(0)
      if (!enabled) setCart((prev) => clearCartPricing(prev))
      return
    }
    const my = ++seq.current
    const local = () => {
      const q = offlineQuote(cart, loadPricingBundleCache(tenantSlug), { customerId, customerType, posProfileId, couponCodes, categoryOf }, toSaleLine)
      if (q && my === seq.current) applyQuote(q)
    }
    const t = setTimeout(async () => {
      if (!online) { local(); return }
      try {
        const lines = cart.map((c) => {
          const s = toSaleLine(c)
          return { key: c.cartLineId, itemId: c.itemId, quantity: s.quantity, uom: c.uom || undefined, unitPrice: s.unitPrice, priceLocked: isPriceLocked(c) }
        })
        const res = await fetch('/api/price-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: customerId || undefined, posProfileId: posProfileId || undefined, couponCodes, lines }),
        })
        if (my !== seq.current) return
        if (!res.ok) { if (res.status >= 500) local(); return }
        const quote = await res.json() as QuoteResult
        applyQuote(quote)
      } catch {
        // network gone: price with the cached bundle (the server re-prices the sale on sync)
        local()
      }
    }, 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function applyQuote(quote: QuoteResult) {
    setCart((prev) => applyQuoteToCart(prev, quote))
    setCartPromotions(quote.cartPromotions || [])
    setCartPromotionDiscount(round2(quote.totals?.cartDiscount || 0))
  }

  return { cartPromotions, cartPromotionDiscount: enabled ? cartPromotionDiscount : 0, applyQuote }
}
