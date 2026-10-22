/**
 * H5 pricing engine — pure, deterministic cart pricing: price lists (incl. quantity tiers and
 * units of measure) and promotions (percent / fixed off items, categories or the cart, buy X get Y,
 * bundle price, min-spend cart discount).
 *
 * NO imports on purpose: the mobile app keeps a byte-identical copy at
 * apps/mobile/src/lib/pricingEngine.ts (scripts/tests/h5-pricing-catalog.ts fails when they differ),
 * the same way it shares cart/tax maths (apps/mobile/src/lib/cartMath.ts, taxMath.ts).
 * The DB loader lives in ./load-context.ts (server only).
 *
 * Rules (documented in docs/INTEGRATION_PRICING.md):
 *  1. List price per line: applicable price lists (active, date-valid, scope matches the customer /
 *     customer group / POS profile) sorted by priority desc, then name, then id. The first list
 *     with a rule for the item wins. A rule matches the line's unit (rule.uom = line uom) or, when
 *     the rule has no uom, the base unit (its price × the line's uom factor). Among matching rules
 *     the highest minQty ≤ quantity wins; quantity for tiers is the sum over every cart line of the
 *     same item and unit (base-unit rules count base quantity). A rule gives a fixed unit price or
 *     a % off the line's base price. No rule → base price. Lines with priceLocked keep basePrice.
 *  2. Promotions eligible now (schedule in tenant local time, scope, coupon, usage limits) are
 *     applied by priority desc, then id. Line promotions first (percent/fixed off items or
 *     categories, buy X get Y, bundle), then cart promotions (percent/fixed off cart, min spend)
 *     on what is left.
 *  3. Stacking: a non-stackable promotion only touches lines no promotion has touched yet and,
 *     once applied, locks those lines against every later promotion. Stackable promotions stack
 *     with each other on lines not locked by a non-stackable one. A non-stackable cart promotion
 *     needs a cart with no promotion at all on its eligible lines and ends cart promotions.
 *  4. Discounts never take a line below zero. Money is rounded to cents per line; cart discounts
 *     are allocated to lines proportionally (remainder on the largest line) so taxes and
 *     sale_items.promotion_discount add up exactly.
 */

export type PromotionType = 'percent_off' | 'fixed_off' | 'buy_x_get_y' | 'bundle_price' | 'min_spend'

export interface PriceListItemRule {
  itemId: string
  /** null = base unit */
  uom: string | null
  minQty: number
  /** fixed unit price, or … */
  price: number | null
  /** … % off the line's base price */
  discountPercent: number | null
}

export interface PriceListRule {
  id: string
  name: string
  priority: number
  currency?: string
  isActive?: boolean
  /** YYYY-MM-DD, inclusive */
  validFrom?: string | null
  validTo?: string | null
  appliesTo: 'all' | 'customer_group' | 'customers' | 'pos_profiles'
  customerTypes?: string[]
  customerIds?: string[]
  posProfileIds?: string[]
  items: PriceListItemRule[]
}

export interface PromotionRule {
  id: string
  name: string
  type: PromotionType
  /** percent_off / fixed_off target */
  applyTo?: 'items' | 'categories' | 'cart'
  /** min_spend: discount kind */
  discountType?: 'percent' | 'fixed'
  /** percent, or amount (fixed_off on items: per unit; on the cart / min_spend: once) */
  value?: number
  itemIds?: string[]
  categoryIds?: string[]
  buyQty?: number | null
  getQty?: number | null
  /** empty = same items as the buy side */
  getItemIds?: string[]
  /** 100 = free */
  getDiscountPercent?: number | null
  bundleItems?: Array<{ itemId: string; qty: number }>
  bundlePrice?: number | null
  /** cart subtotal (after line promotions) the cart must reach */
  minSpend?: number | null
  /** YYYY-MM-DD inclusive, tenant local date */
  startsOn?: string | null
  endsOn?: string | null
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  daysOfWeek?: number[]
  /** 'HH:MM' (or HH:MM:SS); timeTo < timeFrom → window runs past midnight */
  timeFrom?: string | null
  timeTo?: string | null
  posProfileIds?: string[]
  customerTypes?: string[]
  priority?: number
  stackable?: boolean
  couponCode?: string | null
  usageLimit?: number | null
  perCustomerLimit?: number | null
  usageCount?: number
  /** redemptions by the current customer (filled by the loader) */
  customerUsageCount?: number
  isActive?: boolean
}

export interface LocalClock {
  /** YYYY-MM-DD in the tenant's timezone */
  date: string
  /** minutes since local midnight */
  minutes: number
  /** 0 = Sunday */
  dow: number
}

export interface PricingContext {
  /** tenant local time at which the cart is priced (see localClock) */
  now: LocalClock
  customerId?: string | null
  customerType?: string | null
  posProfileId?: string | null
  couponCodes?: string[]
  priceLists: PriceListRule[]
  promotions: PromotionRule[]
}

export interface PricingLineInput {
  /** caller's line id; defaults to the array index */
  key?: string
  itemId: string
  categoryId?: string | null
  quantity: number
  /** unit sold; null/undefined = base unit */
  uom?: string | null
  /** base units per 1 uom (1 for the base unit) */
  uomFactor?: number
  /** unit price before price lists (items.selling_price, item_uoms.selling_price or base × factor) */
  basePrice: number
  /** price fixed by the caller (scale label, barcode price override, manual override): no price list */
  priceLocked?: boolean
  /** gift cards and similar lines take no promotions */
  excludeFromPromotions?: boolean
}

export interface AppliedPromotion {
  promotionId: string
  name: string
  label: string
  amount: number
}

export interface PricedLine {
  key: string
  itemId: string
  quantity: number
  uom: string | null
  uomFactor: number
  basePrice: number
  /** resolved list price per unit */
  unitPrice: number
  priceListId: string | null
  priceListName: string | null
  /** round2(unitPrice × quantity) */
  grossTotal: number
  /** line-level promotions */
  promotions: AppliedPromotion[]
  promotionDiscount: number
  /** this line's share of cart-level promotions */
  cartDiscountShare: number
  /** grossTotal − promotionDiscount − cartDiscountShare */
  netTotal: number
}

export interface PricingResult {
  lines: PricedLine[]
  cartPromotions: AppliedPromotion[]
  /** every promotion granted (line + cart), with the total amount each gave */
  appliedPromotions: AppliedPromotion[]
  totals: {
    /** Σ base price × qty */
    baseTotal: number
    /** Σ grossTotal (after price lists) */
    grossTotal: number
    lineDiscount: number
    cartDiscount: number
    totalDiscount: number
    netTotal: number
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function num(v: unknown, dflt = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : dflt
}

function normUom(u: string | null | undefined): string | null {
  const s = (u ?? '').trim().toLowerCase()
  return s ? s : null
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 'HH:MM[:SS]' → minutes since midnight (null when blank / invalid) */
export function parseTimeOfDay(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59) return null
  return h * 60 + min
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Tenant-local clock for an instant. Uses Intl (Node and Hermes both ship it); falls back to UTC
 * when the zone is unknown.
 */
export function localClock(instant: Date | string | number, timeZone = 'Asia/Colombo'): LocalClock {
  const d = instant instanceof Date ? instant : new Date(instant)
  let parts: Record<string, string> = {}
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    for (const p of fmt.formatToParts(d)) parts[p.type] = p.value
  } catch {
    parts = {}
  }
  if (!parts.year) {
    // runtimes without Intl time zones: Sri Lanka is a fixed UTC+05:30 (no DST)
    const shifted = new Date(d.getTime() + (timeZone === 'Asia/Colombo' ? 330 : 0) * 60000)
    const iso = shifted.toISOString()
    return { date: iso.slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), dow: shifted.getUTCDay() }
  }
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const hour = Number(parts.hour) % 24
  return { date, minutes: hour * 60 + Number(parts.minute), dow: new Date(`${date}T00:00:00Z`).getUTCDay() }
}

function inDateRange(date: string, from?: string | null, to?: string | null): boolean {
  if (from && date < from.slice(0, 10)) return false
  if (to && date > to.slice(0, 10)) return false
  return true
}

/**
 * Is the promotion's schedule open at `now`? A window past midnight (22:00–02:00) belongs to the
 * day it starts: Saturday 01:00 is inside a "Friday 22:00–02:00" promotion and its date range is
 * checked against Friday.
 */
export function scheduleOpen(p: Pick<PromotionRule, 'startsOn' | 'endsOn' | 'daysOfWeek' | 'timeFrom' | 'timeTo'>, now: LocalClock): boolean {
  const from = parseTimeOfDay(p.timeFrom)
  const to = parseTimeOfDay(p.timeTo)
  let day = now.date
  let dow = now.dow
  if (from !== null || to !== null) {
    const f = from ?? 0
    const t = to ?? 24 * 60
    if (f <= t) {
      if (now.minutes < f || now.minutes >= t) return false
    } else if (now.minutes >= f) {
      // evening part of an overnight window: today's window
    } else if (now.minutes < t) {
      day = addDays(now.date, -1)
      dow = (now.dow + 6) % 7
    } else {
      return false
    }
  }
  if (p.daysOfWeek && p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(dow)) return false
  return inDateRange(day, p.startsOn, p.endsOn)
}

function listApplies(l: PriceListRule, ctx: PricingContext): boolean {
  if (l.isActive === false) return false
  if (!inDateRange(ctx.now.date, l.validFrom, l.validTo)) return false
  switch (l.appliesTo) {
    case 'all': return true
    case 'customer_group': return !!ctx.customerType && (l.customerTypes || []).includes(ctx.customerType)
    case 'customers': return !!ctx.customerId && (l.customerIds || []).includes(ctx.customerId)
    case 'pos_profiles': return !!ctx.posProfileId && (l.posProfileIds || []).includes(ctx.posProfileId)
    default: return false
  }
}

/** Eligible promotions in application order (priority desc, then id). */
export function eligiblePromotions(ctx: PricingContext): PromotionRule[] {
  const coupons = new Set((ctx.couponCodes || []).map((c) => c.trim().toUpperCase()).filter(Boolean))
  return ctx.promotions
    .filter((p) => {
      if (p.isActive === false) return false
      if (p.couponCode && !coupons.has(p.couponCode.trim().toUpperCase())) return false
      if (p.posProfileIds && p.posProfileIds.length > 0 && (!ctx.posProfileId || !p.posProfileIds.includes(ctx.posProfileId))) return false
      if (p.customerTypes && p.customerTypes.length > 0 && (!ctx.customerType || !p.customerTypes.includes(ctx.customerType))) return false
      if (p.usageLimit != null && num(p.usageCount) >= p.usageLimit) return false
      if (p.perCustomerLimit != null && ctx.customerId && num(p.customerUsageCount) >= p.perCustomerLimit) return false
      // per-customer limits need a known customer
      if (p.perCustomerLimit != null && !ctx.customerId) return false
      return scheduleOpen(p, ctx.now)
    })
    .slice()
    .sort((a, b) => num(b.priority) - num(a.priority) || cmpStr(a.id, b.id))
}

function fmtMoney(n: number): string {
  const fixed = round2(n).toFixed(2)
  const [i, d] = fixed.split('.')
  return `Rs ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d === '00' ? '' : '.' + d}`
}

function fmtQty(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

/** Human-readable description of what a promotion gives (receipts, POS badges). */
export function promotionLabel(p: PromotionRule): string {
  const v = num(p.value)
  switch (p.type) {
    case 'percent_off': return p.applyTo === 'cart' ? `${fmtQty(v)}% off the bill` : `${fmtQty(v)}% off`
    case 'fixed_off': return p.applyTo === 'cart' ? `${fmtMoney(v)} off the bill` : `${fmtMoney(v)} off each`
    case 'buy_x_get_y': {
      const pct = num(p.getDiscountPercent, 100)
      const reward = pct >= 100 ? 'free' : `${fmtQty(pct)}% off`
      return `Buy ${fmtQty(num(p.buyQty))} get ${fmtQty(num(p.getQty))} ${reward}`
    }
    case 'bundle_price': return `Bundle for ${fmtMoney(num(p.bundlePrice))}`
    case 'min_spend': return `Spend ${fmtMoney(num(p.minSpend))}, get ${p.discountType === 'fixed' ? fmtMoney(v) : `${fmtQty(v)}%`} off`
    default: return p.name
  }
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

interface WorkLine {
  idx: number
  key: string
  itemId: string
  categoryId: string | null
  quantity: number
  uom: string | null
  uomFactor: number
  basePrice: number
  unitPrice: number
  priceListId: string | null
  priceListName: string | null
  gross: number
  /** value left for further discounts */
  remaining: number
  promos: AppliedPromotion[]
  touched: boolean
  locked: boolean
  excluded: boolean
  cartShare: number
}

function resolveListPrice(line: WorkLine, lists: PriceListRule[], qtyByItemUom: Map<string, number>, baseQtyByItem: Map<string, number>) {
  for (const list of lists) {
    let best: PriceListItemRule | null = null
    let bestIsUom = false
    for (const r of list.items) {
      if (r.itemId !== line.itemId) continue
      const ruleUom = normUom(r.uom)
      const isUomRule = ruleUom !== null
      if (isUomRule && ruleUom !== line.uom) continue
      // base-unit rules count base quantity across every unit of the item
      const tierQty = isUomRule
        ? (qtyByItemUom.get(`${line.itemId}|${line.uom ?? ''}`) ?? line.quantity)
        : (baseQtyByItem.get(line.itemId) ?? line.quantity * line.uomFactor)
      if (num(r.minQty) > tierQty + 1e-9) continue
      // a rule for the exact unit beats a base-unit rule; then the highest tier wins
      if (!best || (isUomRule && !bestIsUom) || (isUomRule === bestIsUom && num(r.minQty) > num(best.minQty))) {
        best = r
        bestIsUom = isUomRule
      }
    }
    if (!best) continue
    let price: number
    if (best.price != null) {
      price = bestIsUom || line.uom === null ? num(best.price) : num(best.price) * line.uomFactor
    } else {
      price = line.basePrice * (1 - Math.min(100, Math.max(0, num(best.discountPercent))) / 100)
    }
    line.unitPrice = round2(Math.max(0, price))
    line.priceListId = list.id
    line.priceListName = list.name
    return
  }
}

function lineMatches(p: PromotionRule, l: WorkLine, ids?: string[], cats?: string[]): boolean {
  const itemIds = ids ?? p.itemIds ?? []
  const categoryIds = cats ?? p.categoryIds ?? []
  if (itemIds.length === 0 && categoryIds.length === 0) return false
  return itemIds.includes(l.itemId) || (!!l.categoryId && categoryIds.includes(l.categoryId))
}

function canTake(p: PromotionRule, l: WorkLine): boolean {
  if (l.excluded || l.locked || l.remaining <= 0) return false
  if (!p.stackable && l.touched) return false
  return true
}

function grant(p: PromotionRule, label: string, l: WorkLine, amount: number): number {
  const a = round2(Math.min(l.remaining, Math.max(0, amount)))
  if (a <= 0) return 0
  l.remaining = round2(l.remaining - a)
  l.promos.push({ promotionId: p.id, name: p.name, label, amount: a })
  l.touched = true
  if (!p.stackable) l.locked = true
  return a
}

/** Split `amount` across lines in proportion to `weights`; remainder to the largest weight. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0 || amount <= 0) return weights.map(() => 0)
  const out = weights.map((w) => round2((amount * w) / total))
  let diff = round2(amount - out.reduce((s, v) => s + v, 0))
  if (diff !== 0) {
    let maxI = 0
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[maxI]) maxI = i
    out[maxI] = round2(out[maxI] + diff)
    diff = 0
  }
  return out
}

interface Unit { line: WorkLine; price: number; qty: number }

/** Units of the given lines, cheapest first (ties: cart order). Fractional quantities count whole units only. */
function unitsOf(lines: WorkLine[]): Unit[] {
  return lines
    .map((l) => ({ line: l, price: l.quantity > 0 ? l.remaining / l.quantity : 0, qty: Math.floor(l.quantity + 1e-9) }))
    .filter((u) => u.qty > 0)
    .sort((a, b) => a.price - b.price || a.line.idx - b.line.idx)
}

function applyBuyXGetY(p: PromotionRule, label: string, lines: WorkLine[]): number {
  const buy = Math.floor(num(p.buyQty))
  const get = Math.floor(num(p.getQty))
  const pct = Math.min(100, Math.max(0, num(p.getDiscountPercent, 100)))
  if (buy <= 0 || get <= 0 || pct <= 0) return 0
  const buyLines = lines.filter((l) => canTake(p, l) && lineMatches(p, l))
  const sameSet = !p.getItemIds || p.getItemIds.length === 0
  const getLines = sameSet ? buyLines : lines.filter((l) => canTake(p, l) && lineMatches(p, l, p.getItemIds, []))
  if (buyLines.length === 0 || getLines.length === 0) return 0

  let rewardUnits: number
  let pool: Unit[]
  if (sameSet) {
    const totalQty = unitsOf(buyLines).reduce((s, u) => s + u.qty, 0)
    rewardUnits = Math.floor(totalQty / (buy + get)) * get
    pool = unitsOf(buyLines)
  } else {
    // a line on both sides counts towards the buy side first
    const getOnly = getLines.filter((l) => !buyLines.includes(l))
    const buyQty = unitsOf(buyLines).reduce((s, u) => s + u.qty, 0)
    const times = Math.floor(buyQty / buy)
    pool = unitsOf(getOnly)
    rewardUnits = Math.min(times * get, pool.reduce((s, u) => s + u.qty, 0))
  }
  if (rewardUnits <= 0) return 0

  const perLine = new Map<WorkLine, number>()
  let left = rewardUnits
  for (const u of pool) {
    if (left <= 0) break
    const take = Math.min(u.qty, left)
    perLine.set(u.line, (perLine.get(u.line) || 0) + take * u.price * (pct / 100))
    left -= take
  }
  // the buy-side lines that qualified are part of the deal too (locked when not stackable)
  let total = 0
  const involved = sameSet ? buyLines : [...buyLines, ...pool.map((u) => u.line)]
  for (const l of involved) {
    const amt = perLine.get(l) || 0
    if (amt > 0) total += grant(p, label, l, amt)
    else if (!p.stackable && perLine.size > 0) { l.touched = true; l.locked = true }
  }
  return round2(total)
}

function applyBundle(p: PromotionRule, label: string, lines: WorkLine[]): number {
  const comps = (p.bundleItems || []).filter((c) => c && c.itemId && num(c.qty) > 0)
  const bundlePrice = num(p.bundlePrice, NaN)
  if (comps.length === 0 || !Number.isFinite(bundlePrice)) return 0
  // times the bundle fits, by component
  let times = Infinity
  const byComp = comps.map((c) => {
    const ls = lines.filter((l) => l.itemId === c.itemId && canTake(p, l))
    const qty = ls.reduce((s, l) => s + Math.floor(l.quantity + 1e-9), 0)
    times = Math.min(times, Math.floor(qty / num(c.qty)))
    return { comp: c, lines: ls }
  })
  if (!Number.isFinite(times) || times <= 0) return 0
  // normal value of `times` bundles, taken from the cheapest units of each component
  const take = new Map<WorkLine, number>()
  let normal = 0
  for (const { comp, lines: ls } of byComp) {
    let need = times * num(comp.qty)
    for (const u of unitsOf(ls)) {
      if (need <= 0) break
      const n = Math.min(u.qty, need)
      take.set(u.line, (take.get(u.line) || 0) + n * u.price)
      normal += n * u.price
      need -= n
    }
  }
  const discount = round2(normal - bundlePrice * times)
  if (discount <= 0) return 0
  const involved = [...take.keys()]
  const shares = allocate(discount, involved.map((l) => take.get(l) || 0))
  let total = 0
  involved.forEach((l, i) => { total += grant(p, label, l, shares[i]) })
  return round2(total)
}

/**
 * Price a cart. Deterministic: same context + lines → same result, independent of promotion /
 * price-list array order.
 */
export function priceCart(ctx: PricingContext, input: PricingLineInput[]): PricingResult {
  const lines: WorkLine[] = input.map((l, idx) => {
    const qty = num(l.quantity)
    const base = round2(Math.max(0, num(l.basePrice)))
    return {
      idx,
      key: l.key ?? String(idx),
      itemId: l.itemId,
      categoryId: l.categoryId ?? null,
      quantity: qty,
      uom: normUom(l.uom),
      uomFactor: num(l.uomFactor, 1) > 0 ? num(l.uomFactor, 1) : 1,
      basePrice: base,
      unitPrice: base,
      priceListId: null,
      priceListName: null,
      gross: 0,
      remaining: 0,
      promos: [],
      touched: false,
      locked: false,
      excluded: !!l.excludeFromPromotions || qty <= 0,
      cartShare: 0,
    }
  })

  // 1. price lists
  const lists = ctx.priceLists
    .filter((l) => listApplies(l, ctx))
    .slice()
    .sort((a, b) => num(b.priority) - num(a.priority) || cmpStr(a.name, b.name) || cmpStr(a.id, b.id))
  const qtyByItemUom = new Map<string, number>()
  const baseQtyByItem = new Map<string, number>()
  for (const l of lines) {
    if (l.quantity <= 0) continue
    const k = `${l.itemId}|${l.uom ?? ''}`
    qtyByItemUom.set(k, (qtyByItemUom.get(k) || 0) + l.quantity)
    baseQtyByItem.set(l.itemId, (baseQtyByItem.get(l.itemId) || 0) + l.quantity * l.uomFactor)
  }
  for (const l of lines) {
    if (input[l.idx].priceLocked || lists.length === 0 || l.quantity <= 0) continue
    resolveListPrice(l, lists, qtyByItemUom, baseQtyByItem)
  }
  for (const l of lines) {
    l.gross = round2(l.unitPrice * l.quantity)
    l.remaining = l.excluded ? 0 : Math.max(0, l.gross)
  }

  // 2. promotions
  const promos = eligiblePromotions(ctx)
  const linePromos = promos.filter((p) => !(p.type === 'min_spend' || ((p.type === 'percent_off' || p.type === 'fixed_off') && p.applyTo === 'cart')))
  const cartPromos = promos.filter((p) => !linePromos.includes(p))
  const cartGross = round2(lines.reduce((s, l) => s + (l.quantity > 0 ? l.gross : 0), 0))

  for (const p of linePromos) {
    if (p.minSpend != null && cartGross < num(p.minSpend)) continue
    const label = promotionLabel(p)
    if (p.type === 'percent_off') {
      const pct = Math.min(100, Math.max(0, num(p.value)))
      for (const l of lines) {
        if (!canTake(p, l) || !lineMatches(p, l, p.applyTo === 'categories' ? [] : p.itemIds, p.applyTo === 'items' ? [] : p.categoryIds)) continue
        grant(p, label, l, l.remaining * pct / 100)
      }
    } else if (p.type === 'fixed_off') {
      for (const l of lines) {
        if (!canTake(p, l) || !lineMatches(p, l, p.applyTo === 'categories' ? [] : p.itemIds, p.applyTo === 'items' ? [] : p.categoryIds)) continue
        grant(p, label, l, num(p.value) * l.quantity)
      }
    } else if (p.type === 'buy_x_get_y') {
      applyBuyXGetY(p, label, lines)
    } else if (p.type === 'bundle_price') {
      applyBundle(p, label, lines)
    }
  }

  // 3. cart promotions
  const cartApplied: AppliedPromotion[] = []
  for (const p of cartPromos) {
    const eligible = lines.filter((l) => canTake(p, l))
    if (eligible.length === 0) continue
    // a non-stackable cart promotion needs a cart untouched by any promotion
    if (!p.stackable && (cartApplied.length > 0 || lines.some((l) => l.touched && !l.excluded))) continue
    const base = round2(eligible.reduce((s, l) => s + l.remaining, 0))
    const threshold = p.minSpend != null ? num(p.minSpend) : 0
    if (base <= 0 || base < threshold) continue
    const isPercent = p.type === 'percent_off' || (p.type === 'min_spend' && p.discountType !== 'fixed')
    const amount = round2(Math.min(base, isPercent ? base * Math.min(100, Math.max(0, num(p.value))) / 100 : num(p.value)))
    if (amount <= 0) continue
    const shares = allocate(amount, eligible.map((l) => l.remaining))
    eligible.forEach((l, i) => {
      const a = round2(Math.min(l.remaining, shares[i]))
      l.remaining = round2(l.remaining - a)
      l.cartShare = round2(l.cartShare + a)
      l.touched = true
      if (!p.stackable) l.locked = true
    })
    cartApplied.push({ promotionId: p.id, name: p.name, label: promotionLabel(p), amount })
    if (!p.stackable) break
  }

  // 4. result
  const out: PricedLine[] = lines.map((l) => {
    const promotionDiscount = round2(l.promos.reduce((s, a) => s + a.amount, 0))
    return {
      key: l.key,
      itemId: l.itemId,
      quantity: l.quantity,
      uom: l.uom,
      uomFactor: l.uomFactor,
      basePrice: l.basePrice,
      unitPrice: l.unitPrice,
      priceListId: l.priceListId,
      priceListName: l.priceListName,
      grossTotal: l.gross,
      promotions: l.promos,
      promotionDiscount,
      cartDiscountShare: l.cartShare,
      netTotal: round2(l.gross - promotionDiscount - l.cartShare),
    }
  })
  const totalsByPromo = new Map<string, AppliedPromotion>()
  for (const a of [...out.flatMap((l) => l.promotions), ...cartApplied]) {
    const t = totalsByPromo.get(a.promotionId)
    if (t) t.amount = round2(t.amount + a.amount)
    else totalsByPromo.set(a.promotionId, { ...a })
  }
  const lineDiscount = round2(out.reduce((s, l) => s + l.promotionDiscount, 0))
  const cartDiscount = round2(cartApplied.reduce((s, a) => s + a.amount, 0))
  const grossTotal = round2(out.reduce((s, l) => s + l.grossTotal, 0))
  return {
    lines: out,
    cartPromotions: cartApplied,
    appliedPromotions: [...totalsByPromo.values()],
    totals: {
      baseTotal: round2(lines.reduce((s, l) => s + l.basePrice * l.quantity, 0)),
      grossTotal,
      lineDiscount,
      cartDiscount,
      totalDiscount: round2(lineDiscount + cartDiscount),
      netTotal: round2(grossTotal - lineDiscount - cartDiscount),
    },
  }
}
