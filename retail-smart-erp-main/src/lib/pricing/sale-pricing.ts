/**
 * H5: server-side pricing of a POS sale (POST /api/sales, POST /api/sales/exchange).
 * The server is the authority: catalog base prices, units and price lists come from the DB, and
 * promotions are recomputed — client "promotion" amounts are only compared, never trusted.
 *
 * Per cart line the client price is classified:
 *  - equal to the engine's resolved price           → priced by the engine (list price + promotions)
 *  - client said priceLocked (scale label, barcode price override) → kept, promotions still apply
 *  - equal to the plain catalog price while a price list gives a different price → STALE: the
 *    client did not know the list price (online: 409 PRICE_CHANGED; offline: accepted + flagged)
 *  - anything else                                   → a manual price change: kept as a locked
 *    price (promotions computed on it); the rate-change control judges it against the resolved price
 * See docs/INTEGRATION_PRICING.md.
 */
import { sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db/tenant-context'
import { priceCart, round2, type AppliedPromotion, type PricingLineInput, type PricingResult } from './engine'
import { loadPricingContext, resolvePricingLines } from './load-context'

export interface SalePricingLine {
  /** price the line is sold at (resolved, or the client's locked / manual price) */
  unitPrice: number
  /** what the price list / catalog says for this customer, unit and quantity (rate-change control) */
  resolvedPrice: number
  /** catalog price of the unit sold (sale_items.list_price) */
  basePrice: number
  priceListId: string | null
  promotionDiscount: number
  promotions: AppliedPromotion[]
  cartDiscountShare: number
  uom: string | null
  uomFactor: number
  stale: boolean
}

export interface SalePricing {
  lines: SalePricingLine[]
  /** cart-level promotion discount (part of sales.discount_amount) */
  cartPromotionDiscount: number
  cartPromotions: AppliedPromotion[]
  appliedPromotions: AppliedPromotion[]
  /** true when price lists or promotions changed anything */
  active: boolean
  /** indices of lines sent at the plain catalog price although a price list applies */
  staleLines: number[]
  /** engine result to send back with PRICE_CHANGED (stale lines priced by the engine) */
  quote: PricingResult
}

export interface SalePricingInput {
  cartItems: Array<{ itemId?: string; quantity: number; unitPrice: number; uom?: string; priceLocked?: boolean; barcode?: string }>
  customerId?: string | null
  posProfileId?: string | null
  couponCodes?: string[]
  at?: Date
  /** false: units only (work orders / restaurant orders keep their own prices) */
  applyRules: boolean
}

const same = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.005

export async function priceSaleCart(db: TenantDb, tenantId: string, input: SalePricingInput): Promise<SalePricing> {
  // catalog lines (base price of the unit sold, factor, category) — client prices not used yet
  const catalog = await resolvePricingLines(db, tenantId, input.cartItems.map((c, i) => ({
    key: String(i), itemId: c.itemId || '', quantity: c.quantity, uom: c.uom,
  })))
  const ctx = input.applyRules
    ? await loadPricingContext(db, tenantId, {
        customerId: input.customerId, posProfileId: input.posProfileId, couponCodes: input.couponCodes, at: input.at,
        itemIds: [...new Set(catalog.map((l) => l.itemId))],
      })
    : { now: { date: '1970-01-01', minutes: 0, dow: 4 }, priceLists: [], promotions: [] }

  // A barcode with a price override (item_barcodes, master data) fixes the price of what it
  // scans: that price IS the resolved price, so it never counts as a cashier's price change.
  const codes = [...new Set(input.cartItems.map((c) => c.barcode).filter((b): b is string => !!b))]
  const overrides = new Map<string, { itemId: string; uom: string | null; price: number }>()
  if (codes.length) {
    const rows = ((await db.execute(sql`
      SELECT barcode, item_id, lower(uom) AS uom, price_override::text AS price FROM item_barcodes
      WHERE tenant_id = ${tenantId}::uuid AND price_override IS NOT NULL
        AND barcode IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
    `)) as unknown as { rows: Array<{ barcode: string; item_id: string; uom: string | null; price: string }> }).rows
    for (const r of rows) overrides.set(r.barcode, { itemId: r.item_id, uom: r.uom, price: Number(r.price) })
  }
  const overridePrice: Array<number | null> = catalog.map((l, i) => {
    const o = input.cartItems[i].barcode ? overrides.get(input.cartItems[i].barcode!) : undefined
    return o && o.itemId === l.itemId && (o.uom || null) === (l.uom || null) ? round2(o.price) : null
  })

  // what this customer / counter / unit / quantity should pay (rate-change control, stale check)
  const resolved = priceCart(ctx, catalog.map((l, i) => (overridePrice[i] !== null ? { ...l, basePrice: overridePrice[i]!, priceLocked: true } : l)))
  const staleLines: number[] = []
  const locked: PricingLineInput[] = catalog.map((l, i) => {
    const c = input.cartItems[i]
    const client = round2(Number(c.unitPrice) || 0)
    if (overridePrice[i] !== null && same(client, overridePrice[i]!)) return { ...l, basePrice: client, priceLocked: true }
    if (c.priceLocked) return { ...l, basePrice: client, priceLocked: true }
    const r = resolved.lines[i]
    if (same(client, r.unitPrice)) return l
    if (same(client, l.basePrice) && r.priceListId) staleLines.push(i)
    // manual price change (or stale catalog price): the line is charged at the client's price
    return { ...l, basePrice: client, priceLocked: true }
  })
  // promotions on the prices actually charged
  const final = locked.some((l, i) => l !== catalog[i]) ? priceCart(ctx, locked) : resolved
  // quote for the client: stale lines priced by the engine, manual / locked prices kept
  const quote = staleLines.length
    ? priceCart(ctx, locked.map((l, i) => (staleLines.includes(i) ? catalog[i] : l)))
    : final

  const lines: SalePricingLine[] = final.lines.map((p, i) => ({
    unitPrice: p.unitPrice,
    resolvedPrice: resolved.lines[i].unitPrice,
    basePrice: catalog[i].basePrice,
    priceListId: locked[i].priceLocked ? null : p.priceListId,
    promotionDiscount: p.promotionDiscount,
    promotions: p.promotions,
    cartDiscountShare: p.cartDiscountShare,
    uom: p.uom,
    uomFactor: p.uomFactor,
    stale: staleLines.includes(i),
  }))
  const active = resolved.lines.some((l) => l.priceListId) || final.lines.some((l) => l.promotions.length > 0)
    || final.cartPromotions.length > 0
  return {
    lines,
    cartPromotionDiscount: final.totals.cartDiscount,
    cartPromotions: final.cartPromotions,
    appliedPromotions: final.appliedPromotions,
    active,
    staleLines,
    quote,
  }
}

export class PromotionExhaustedError extends Error {
  constructor(public readonly promotionId: string) {
    super('PROMOTION_EXHAUSTED')
    this.name = 'PromotionExhaustedError'
  }
}

/**
 * One promotion_redemptions row per promotion granted on the sale + usage_count + 1. The UPDATE
 * only matches while the usage limit is not reached (race-safe); `strict` (online sales) turns a
 * concurrently exhausted promotion into PromotionExhaustedError, offline sales count anyway.
 */
export async function recordPromotionRedemptions(tx: TenantDb, input: {
  tenantId: string; saleId: string; customerId: string | null; applied: AppliedPromotion[]; strict: boolean
}): Promise<void> {
  for (const a of input.applied) {
    if (!(a.amount > 0)) continue
    if (input.customerId) {
      // per-customer limits: serialise this customer's redemptions of the promotion
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'promo:' + a.promotionId + ':' + input.customerId}, 0))`)
      const [row] = ((await tx.execute(sql`
        SELECT p.per_customer_limit AS lim,
               (SELECT count(*)::int FROM promotion_redemptions r
                WHERE r.promotion_id = p.id AND r.customer_id = ${input.customerId}::uuid AND r.voided_at IS NULL) AS used
        FROM promotions p WHERE p.id = ${a.promotionId}::uuid
      `)) as unknown as { rows: Array<{ lim: number | null; used: number }> }).rows
      if (row && row.lim !== null && row.used >= row.lim && input.strict) throw new PromotionExhaustedError(a.promotionId)
    }
    const res = (await tx.execute(sql`
      UPDATE promotions SET usage_count = usage_count + 1
      WHERE id = ${a.promotionId}::uuid AND (usage_limit IS NULL OR usage_count < usage_limit ${input.strict ? sql`` : sql`OR true`})
      RETURNING id
    `)) as unknown as { rows: unknown[] }
    if (res.rows.length === 0 && input.strict) throw new PromotionExhaustedError(a.promotionId)
    await tx.execute(sql`
      INSERT INTO promotion_redemptions (tenant_id, promotion_id, sale_id, customer_id, amount)
      VALUES (${input.tenantId}::uuid, ${a.promotionId}::uuid, ${input.saleId}::uuid, ${input.customerId}::uuid, ${String(round2(a.amount))}::numeric)
      ON CONFLICT (sale_id, promotion_id) DO NOTHING
    `)
  }
}

/** Void of a sale: its redemptions stop counting and usage_count goes back down. */
export async function reversePromotionRedemptions(tx: TenantDb, saleId: string): Promise<number> {
  const voided = ((await tx.execute(sql`
    UPDATE promotion_redemptions SET voided_at = now()
    WHERE sale_id = ${saleId}::uuid AND voided_at IS NULL
    RETURNING promotion_id
  `)) as unknown as { rows: Array<{ promotion_id: string }> }).rows
  for (const r of voided) {
    await tx.execute(sql`UPDATE promotions SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = ${r.promotion_id}::uuid`)
  }
  return voided.length
}
