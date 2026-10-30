/**
 * H5: server-side loaders for the pricing engine (./engine.ts).
 *
 *  - loadPricingContext(db, tenantId, opts) → PricingContext with only the price lists / promotions
 *    that can apply now (active, date-valid, scope pre-filtered in SQL, coupon matched) and the
 *    current customer's redemption counts.
 *  - resolvePricingLines(db, lines)          → engine input with base prices taken from the catalog
 *    (items.selling_price, item_uoms factor / selling price) — never from the client.
 *  - quoteCart(db, tenantId, input)          → both, then priceCart (POST /api/price-quote).
 *  - loadPricingBundle(db, tenantId)         → everything an offline POS needs to run the engine
 *    and resolve extra barcodes / units on the device.
 *
 * All queries run on a tenant-scoped (RLS) connection and also filter tenant_id explicitly.
 */
import { sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db/tenant-context'
import { normalizeUnit, roundUnitPrice, storedStandardFactor } from '@/lib/units/conversions'
import {
  priceCart, localClock,
  type PricingContext, type PriceListRule, type PromotionRule, type PricingLineInput, type PricingResult, type PromotionType,
} from './engine'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || (Array.isArray(res) ? (res as T[]) : [])
}
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOrNull = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null)

interface PriceListRow {
  id: string; name: string; currency: string; priority: number; valid_from: string | null; valid_to: string | null
  applies_to: PriceListRule['appliesTo']; customer_types: string[] | null; customer_ids: string[] | null; pos_profile_ids: string[] | null
}
interface PriceListItemRow {
  price_list_id: string; item_id: string; uom: string | null; min_qty: string; price: string | null; discount_percent: string | null
}
interface PromotionRow {
  id: string; name: string; type: PromotionType; apply_to: PromotionRule['applyTo']; discount_type: 'percent' | 'fixed'; value: string
  item_ids: string[] | null; category_ids: string[] | null; buy_qty: string | null; get_qty: string | null; get_item_ids: string[] | null
  get_discount_percent: string | null; bundle_items: Array<{ itemId: string; qty: number }> | null; bundle_price: string | null
  min_spend: string | null; starts_on: string | null; ends_on: string | null; days_of_week: number[] | null
  time_from: string | null; time_to: string | null; pos_profile_ids: string[] | null; customer_types: string[] | null
  priority: number; stackable: boolean; coupon_code: string | null; usage_limit: number | null; per_customer_limit: number | null
  usage_count: number
}

export function toPromotionRule(r: PromotionRow): PromotionRule {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    applyTo: r.apply_to,
    discountType: r.discount_type,
    value: Number(r.value) || 0,
    itemIds: r.item_ids || [],
    categoryIds: r.category_ids || [],
    buyQty: n(r.buy_qty),
    getQty: n(r.get_qty),
    getItemIds: r.get_item_ids || [],
    getDiscountPercent: n(r.get_discount_percent) ?? 100,
    bundleItems: (r.bundle_items || []).map((b) => ({ itemId: b.itemId, qty: Number(b.qty) || 0 })),
    bundlePrice: n(r.bundle_price),
    minSpend: n(r.min_spend),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    daysOfWeek: (r.days_of_week || []).map(Number),
    timeFrom: r.time_from,
    timeTo: r.time_to,
    posProfileIds: r.pos_profile_ids || [],
    customerTypes: r.customer_types || [],
    priority: r.priority,
    stackable: r.stackable,
    couponCode: r.coupon_code,
    usageLimit: r.usage_limit,
    perCustomerLimit: r.per_customer_limit,
    usageCount: r.usage_count,
  }
}

function toPriceLists(lists: PriceListRow[], items: PriceListItemRow[]): PriceListRule[] {
  const byList = new Map<string, PriceListRule['items']>()
  for (const i of items) {
    const arr = byList.get(i.price_list_id) || []
    arr.push({ itemId: i.item_id, uom: i.uom, minQty: Number(i.min_qty) || 0, price: n(i.price), discountPercent: n(i.discount_percent) })
    byList.set(i.price_list_id, arr)
  }
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    currency: l.currency,
    priority: l.priority,
    validFrom: l.valid_from,
    validTo: l.valid_to,
    appliesTo: l.applies_to,
    customerTypes: l.customer_types || [],
    customerIds: l.customer_ids || [],
    posProfileIds: l.pos_profile_ids || [],
    items: byList.get(l.id) || [],
  }))
}

const PROMO_COLUMNS = sql`id, name, type, apply_to, discount_type, value::text AS value, item_ids, category_ids,
  buy_qty::text AS buy_qty, get_qty::text AS get_qty, get_item_ids, get_discount_percent::text AS get_discount_percent,
  bundle_items, bundle_price::text AS bundle_price, min_spend::text AS min_spend,
  to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, days_of_week,
  to_char(time_from, 'HH24:MI') AS time_from, to_char(time_to, 'HH24:MI') AS time_to,
  pos_profile_ids, customer_types, priority, stackable, coupon_code, usage_limit, per_customer_limit, usage_count`

const LIST_COLUMNS = sql`id, name, currency, priority, to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
  to_char(valid_to, 'YYYY-MM-DD') AS valid_to, applies_to, customer_types, customer_ids, pos_profile_ids`

export interface LoadPricingOptions {
  customerId?: string | null
  posProfileId?: string | null
  /** instant being priced (default: now) */
  at?: Date
  couponCodes?: string[]
  /** restrict price-list rules to these items (the cart) */
  itemIds?: string[]
}

export interface LoadedPricingContext extends PricingContext {
  timezone: string
  currency: string
}

export async function loadPricingContext(db: TenantDb, tenantId: string, opts: LoadPricingOptions = {}): Promise<LoadedPricingContext> {
  const [tenant] = rowsOf<{ timezone: string | null; currency: string | null }>(await db.execute(sql`
    SELECT timezone, currency FROM tenants WHERE id = ${tenantId}::uuid
  `))
  const timezone = tenant?.timezone || 'Asia/Colombo'
  const now = localClock(opts.at ?? new Date(), timezone)

  const customerId = uuidOrNull(opts.customerId)
  const posProfileId = uuidOrNull(opts.posProfileId)
  let customerType: string | null = null
  if (customerId) {
    const [c] = rowsOf<{ customer_type: string | null }>(await db.execute(sql`
      SELECT customer_type::text AS customer_type FROM customers WHERE id = ${customerId}::uuid AND tenant_id = ${tenantId}::uuid
    `))
    customerType = c?.customer_type ?? null
  }

  const lists = rowsOf<PriceListRow>(await db.execute(sql`
    SELECT ${LIST_COLUMNS} FROM price_lists
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true
      AND (valid_from IS NULL OR valid_from <= ${now.date}::date)
      AND (valid_to IS NULL OR valid_to >= ${now.date}::date)
      AND (applies_to = 'all'
        OR (applies_to = 'customer_group' AND ${customerType}::text IS NOT NULL AND ${customerType}::text = ANY(customer_types))
        OR (applies_to = 'customers' AND ${customerId}::uuid IS NOT NULL AND ${customerId}::uuid = ANY(customer_ids))
        OR (applies_to = 'pos_profiles' AND ${posProfileId}::uuid IS NOT NULL AND ${posProfileId}::uuid = ANY(pos_profile_ids)))
  `))
  const itemIds = (opts.itemIds || []).filter((i) => UUID_RE.test(i))
  const listItems = lists.length === 0 || (opts.itemIds && itemIds.length === 0) ? [] : rowsOf<PriceListItemRow>(await db.execute(sql`
    SELECT price_list_id, item_id, uom, min_qty::text AS min_qty, price::text AS price, discount_percent::text AS discount_percent
    FROM price_list_items
    WHERE tenant_id = ${tenantId}::uuid
      AND price_list_id IN (${sql.join(lists.map((l) => sql`${l.id}::uuid`), sql`, `)})
      ${opts.itemIds ? sql`AND item_id IN (${sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``}
  `))

  const coupons = (opts.couponCodes || []).map((c) => c.trim().toUpperCase()).filter(Boolean)
  // ends_on may be yesterday: an overnight window that started yesterday is still open
  const promoRows = rowsOf<PromotionRow>(await db.execute(sql`
    SELECT ${PROMO_COLUMNS} FROM promotions
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true
      AND (starts_on IS NULL OR starts_on <= ${now.date}::date)
      AND (ends_on IS NULL OR ends_on >= ${now.date}::date - 1)
      AND (usage_limit IS NULL OR usage_count < usage_limit)
      AND (coupon_code IS NULL ${coupons.length ? sql`OR upper(coupon_code) IN (${sql.join(coupons.map((c) => sql`${c}`), sql`, `)})` : sql``})
  `))
  const promos = promoRows.map(toPromotionRule)

  const limited = promos.filter((p) => p.perCustomerLimit != null).map((p) => p.id)
  if (customerId && limited.length > 0) {
    const counts = rowsOf<{ promotion_id: string; c: number }>(await db.execute(sql`
      SELECT promotion_id, count(*)::int AS c FROM promotion_redemptions
      WHERE tenant_id = ${tenantId}::uuid AND customer_id = ${customerId}::uuid AND voided_at IS NULL
        AND promotion_id IN (${sql.join(limited.map((i) => sql`${i}::uuid`), sql`, `)})
      GROUP BY promotion_id
    `))
    const m = new Map(counts.map((r) => [r.promotion_id, r.c]))
    for (const p of promos) if (p.perCustomerLimit != null) p.customerUsageCount = m.get(p.id) || 0
  }

  return {
    now,
    timezone,
    currency: tenant?.currency || 'LKR',
    customerId,
    customerType,
    posProfileId,
    couponCodes: coupons,
    priceLists: toPriceLists(lists, listItems),
    promotions: promos,
  }
}

export interface CartLineRequest {
  key?: string
  itemId: string
  quantity: number
  /** unit sold (item_uoms.uom); blank = base unit */
  uom?: string | null
  /** caller-fixed unit price (scale label / barcode override / approved manual price): engine keeps it */
  unitPrice?: number | null
  priceLocked?: boolean
}

export class PricingLineError extends Error {
  constructor(public readonly code: 'ITEM_NOT_FOUND' | 'UOM_NOT_FOUND', public readonly itemId: string, public readonly uom?: string | null) {
    super(code)
    this.name = 'PricingLineError'
  }
}

/** Engine input from catalog prices. Throws PricingLineError for unknown items / units. */
export async function resolvePricingLines(db: TenantDb, tenantId: string, lines: CartLineRequest[]): Promise<PricingLineInput[]> {
  const ids = [...new Set(lines.map((l) => l.itemId).filter((i) => UUID_RE.test(i)))]
  const itemRows = ids.length === 0 ? [] : rowsOf<{
    id: string; selling_price: string; category_id: string | null; is_gift_card: boolean; unit: string | null
  }>(await db.execute(sql`
    SELECT id, selling_price::text AS selling_price, category_id, is_gift_card, unit FROM items
    WHERE tenant_id = ${tenantId}::uuid AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
  `))
  const uomRows = ids.length === 0 ? [] : rowsOf<{ item_id: string; uom: string; factor: string; selling_price: string | null }>(await db.execute(sql`
    SELECT item_id, uom, factor::text AS factor, selling_price::text AS selling_price FROM item_uoms
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true AND item_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
  `))
  const items = new Map(itemRows.map((r) => [r.id, r]))
  const uoms = new Map(uomRows.map((r) => [`${r.item_id}|${r.uom.toLowerCase()}`, r]))

  return lines.map((l, idx) => {
    const item = items.get(l.itemId)
    if (!item) throw new PricingLineError('ITEM_NOT_FOUND', l.itemId)
    const base = Number(item.selling_price) || 0
    const uom = (l.uom || '').trim().toLowerCase()
    let factor = 1
    let basePrice = base
    let lineUom: string | null = null
    if (uom && uom !== (item.unit || '').trim().toLowerCase()) {
      const u = uoms.get(`${l.itemId}|${uom}`)
      if (u) {
        factor = Number(u.factor) || 1
        // base × factor keeps 4 dp (0.345 / g of a 345 / kg item); sale_items.unit_price is numeric(14,4)
        basePrice = u.selling_price != null ? Number(u.selling_price) : roundUnitPrice(base * factor)
        lineUom = u.uom.toLowerCase()
      } else {
        // A standard unit of the same measure (g for a kg item, yard for a metre item). The
        // factor is rounded as sale_items.uom_factor stores it, so voids / returns move the same
        // base quantity as the sale.
        const std = storedStandardFactor(uom, item.unit || '')
        if (std == null) throw new PricingLineError('UOM_NOT_FOUND', l.itemId, l.uom)
        factor = std
        basePrice = roundUnitPrice(base * factor)
        lineUom = normalizeUnit(uom)
      }
    }
    const locked = !!l.priceLocked && l.unitPrice != null && Number.isFinite(Number(l.unitPrice))
    return {
      key: l.key ?? String(idx),
      itemId: l.itemId,
      categoryId: item.category_id,
      quantity: Number(l.quantity) || 0,
      uom: lineUom,
      uomFactor: factor,
      basePrice: locked ? Number(l.unitPrice) : basePrice,
      priceLocked: locked,
      excludeFromPromotions: item.is_gift_card,
    }
  })
}

export interface QuoteInput extends LoadPricingOptions {
  lines: CartLineRequest[]
}

export async function quoteCart(db: TenantDb, tenantId: string, input: QuoteInput): Promise<PricingResult & { context: { date: string; minutes: number; timezone: string; customerType: string | null } }> {
  const lines = await resolvePricingLines(db, tenantId, input.lines)
  const ctx = await loadPricingContext(db, tenantId, { ...input, itemIds: [...new Set(lines.map((l) => l.itemId))] })
  const result = priceCart(ctx, lines)
  return { ...result, context: { date: ctx.now.date, minutes: ctx.now.minutes, timezone: ctx.timezone, customerType: ctx.customerType ?? null } }
}

// ---------------------------------------------------------------------------
// Offline bundle part (GET /api/pos/offline-bundle → `pricing`, GET /api/price-quote/bundle)
// ---------------------------------------------------------------------------

export interface OfflinePricingBundle {
  timezone: string
  priceLists: PriceListRule[]
  /** coupon promotions included: the device asks the cashier for the code */
  promotions: PromotionRule[]
  units: Array<{ code: string; name: string; allowFraction: boolean }>
  itemUoms: Array<{ itemId: string; uom: string; factor: number; barcode: string | null; sellingPrice: number | null }>
  itemBarcodes: Array<{ itemId: string; barcode: string; uom: string | null; packQty: number; priceOverride: number | null }>
}

export async function loadPricingBundle(db: TenantDb, tenantId: string): Promise<OfflinePricingBundle> {
  const [tenant] = rowsOf<{ timezone: string | null }>(await db.execute(sql`SELECT timezone FROM tenants WHERE id = ${tenantId}::uuid`))
  const timezone = tenant?.timezone || 'Asia/Colombo'
  const today = localClock(new Date(), timezone).date

  const lists = rowsOf<PriceListRow>(await db.execute(sql`
    SELECT ${LIST_COLUMNS} FROM price_lists
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true AND (valid_to IS NULL OR valid_to >= ${today}::date)
  `))
  const listItems = lists.length === 0 ? [] : rowsOf<PriceListItemRow>(await db.execute(sql`
    SELECT pli.price_list_id, pli.item_id, pli.uom, pli.min_qty::text AS min_qty, pli.price::text AS price,
           pli.discount_percent::text AS discount_percent
    FROM price_list_items pli
    JOIN price_lists pl ON pl.id = pli.price_list_id
    WHERE pli.tenant_id = ${tenantId}::uuid AND pl.is_active = true AND (pl.valid_to IS NULL OR pl.valid_to >= ${today}::date)
  `))
  const promos = rowsOf<PromotionRow>(await db.execute(sql`
    SELECT ${PROMO_COLUMNS} FROM promotions
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true
      AND (ends_on IS NULL OR ends_on >= ${today}::date - 1)
      AND (usage_limit IS NULL OR usage_count < usage_limit)
  `)).map(toPromotionRule)
  const unitRows = rowsOf<{ code: string; name: string; allow_fraction: boolean }>(await db.execute(sql`
    SELECT code, name, allow_fraction FROM units WHERE tenant_id = ${tenantId}::uuid AND is_active = true ORDER BY code
  `))
  const uomRows = rowsOf<{ item_id: string; uom: string; factor: string; barcode: string | null; selling_price: string | null }>(await db.execute(sql`
    SELECT u.item_id, u.uom, u.factor::text AS factor, u.barcode, u.selling_price::text AS selling_price
    FROM item_uoms u JOIN items i ON i.id = u.item_id
    WHERE u.tenant_id = ${tenantId}::uuid AND u.is_active = true AND i.is_active = true
  `))
  const barcodeRows = rowsOf<{ item_id: string; barcode: string; uom: string | null; pack_qty: string; price_override: string | null }>(await db.execute(sql`
    SELECT b.item_id, b.barcode, b.uom, b.pack_qty::text AS pack_qty, b.price_override::text AS price_override
    FROM item_barcodes b JOIN items i ON i.id = b.item_id
    WHERE b.tenant_id = ${tenantId}::uuid AND i.is_active = true
  `))
  return {
    timezone,
    priceLists: toPriceLists(lists, listItems),
    promotions: promos,
    units: unitRows.map((u) => ({ code: u.code, name: u.name, allowFraction: u.allow_fraction })),
    itemUoms: uomRows.map((u) => ({ itemId: u.item_id, uom: u.uom, factor: Number(u.factor), barcode: u.barcode, sellingPrice: n(u.selling_price) })),
    itemBarcodes: barcodeRows.map((b) => ({ itemId: b.item_id, barcode: b.barcode, uom: b.uom, packQty: Number(b.pack_qty) || 1, priceOverride: n(b.price_override) })),
  }
}
