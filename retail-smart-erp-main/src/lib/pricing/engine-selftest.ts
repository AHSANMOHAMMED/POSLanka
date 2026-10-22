/**
 * Pure self-test for the pricing engine (no DB). Run alone:
 *   npx tsx src/lib/pricing/engine-selftest.ts
 * and as part of scripts/tests/h5-pricing-catalog.ts. Exercises the same file the mobile app copies.
 */
import {
  priceCart, localClock, scheduleOpen, promotionLabel,
  type PricingContext, type PricingLineInput, type PriceListRule, type PromotionRule, type LocalClock,
} from './engine'

export interface SelfTestResult { name: string; ok: boolean; detail?: string }

const A = 'item-a', B = 'item-b', C = 'item-c', GC = 'item-gift'
const CAT = 'cat-soap'
// Thursday 2026-10-22 10:30
const THU: LocalClock = { date: '2026-10-22', minutes: 10 * 60 + 30, dow: 4 }

function ctx(over: Partial<PricingContext> = {}): PricingContext {
  return { now: THU, priceLists: [], promotions: [], ...over }
}
function line(itemId: string, quantity: number, basePrice: number, over: Partial<PricingLineInput> = {}): PricingLineInput {
  return { itemId, quantity, basePrice, ...over }
}
function list(id: string, items: PriceListRule['items'], over: Partial<PriceListRule> = {}): PriceListRule {
  return { id, name: id, priority: 0, appliesTo: 'all', items, ...over }
}
function promo(id: string, over: Partial<PromotionRule>): PromotionRule {
  return { id, name: id, type: 'percent_off', applyTo: 'items', priority: 0, stackable: false, ...over }
}

export function runPricingSelfTest(): SelfTestResult[] {
  const out: SelfTestResult[] = []
  const eq = (name: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    out.push({ name, ok, detail: ok ? undefined : `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}` })
  }

  // ---------- price lists
  {
    const r = priceCart(ctx(), [line(A, 2, 100)])
    eq('no lists / promos → base price', [r.lines[0].unitPrice, r.totals.netTotal, r.lines[0].priceListId], [100, 200, null])
  }
  {
    const r = priceCart(ctx({ priceLists: [list('pl', [{ itemId: A, uom: null, minQty: 0, price: 90, discountPercent: null }])] }), [line(A, 1, 100), line(B, 1, 50)])
    eq('list "all": fixed price for listed item, base for others', [r.lines[0].unitPrice, r.lines[0].priceListId, r.lines[1].unitPrice], [90, 'pl', 50])
  }
  {
    const wholesale = list('wh', [{ itemId: A, uom: null, minQty: 0, price: 80, discountPercent: null }], { appliesTo: 'customer_group', customerTypes: ['wholesale'] })
    eq('customer group list: wholesale customer', priceCart(ctx({ priceLists: [wholesale], customerType: 'wholesale' }), [line(A, 1, 100)]).lines[0].unitPrice, 80)
    eq('customer group list: retail customer ignored', priceCart(ctx({ priceLists: [wholesale], customerType: 'retail' }), [line(A, 1, 100)]).lines[0].unitPrice, 100)
    eq('customer group list: walk-in ignored', priceCart(ctx({ priceLists: [wholesale] }), [line(A, 1, 100)]).lines[0].unitPrice, 100)
  }
  {
    const lo = list('lo', [{ itemId: A, uom: null, minQty: 0, price: 70, discountPercent: null }], { priority: 1 })
    const hi = list('hi', [{ itemId: A, uom: null, minQty: 0, price: 95, discountPercent: null }], { priority: 5 })
    eq('higher priority list wins even when dearer', priceCart(ctx({ priceLists: [lo, hi] }), [line(A, 1, 100)]).lines[0].priceListId, 'hi')
    const x = list('b-list', [{ itemId: A, uom: null, minQty: 0, price: 60, discountPercent: null }], { priority: 5 })
    eq('equal priority → name order', priceCart(ctx({ priceLists: [x, hi] }), [line(A, 1, 100)]).lines[0].priceListId, 'b-list')
    const noRule = list('top', [{ itemId: B, uom: null, minQty: 0, price: 1, discountPercent: null }], { priority: 9 })
    eq('list without a rule for the item falls through', priceCart(ctx({ priceLists: [noRule, lo] }), [line(A, 1, 100)]).lines[0].priceListId, 'lo')
  }
  {
    const tiers = list('tiers', [
      { itemId: A, uom: null, minQty: 0, price: 100, discountPercent: null },
      { itemId: A, uom: null, minQty: 10, price: 90, discountPercent: null },
      { itemId: A, uom: null, minQty: 50, price: 80, discountPercent: null },
    ])
    eq('tier: qty 9 → 100', priceCart(ctx({ priceLists: [tiers] }), [line(A, 9, 120)]).lines[0].unitPrice, 100)
    eq('tier: qty 12 → 90', priceCart(ctx({ priceLists: [tiers] }), [line(A, 12, 120)]).lines[0].unitPrice, 90)
    eq('tier: qty 50 → 80', priceCart(ctx({ priceLists: [tiers] }), [line(A, 50, 120)]).lines[0].unitPrice, 80)
    const split = priceCart(ctx({ priceLists: [tiers] }), [line(A, 6, 120), line(A, 6, 120)])
    eq('tier: quantity summed over lines of the same item', [split.lines[0].unitPrice, split.lines[1].unitPrice], [90, 90])
    const mixed = priceCart(ctx({ priceLists: [tiers] }), [line(A, 1, 1440, { uom: 'box', uomFactor: 12 })])
    eq('tier: base-unit rule counts base quantity of a box (12) and scales price', mixed.lines[0].unitPrice, 1080)
  }
  {
    const pct = list('pct', [{ itemId: A, uom: null, minQty: 0, price: null, discountPercent: 15 }])
    eq('list % off base price', priceCart(ctx({ priceLists: [pct] }), [line(A, 1, 200)]).lines[0].unitPrice, 170)
  }
  {
    const uoms = list('uom', [
      { itemId: A, uom: null, minQty: 0, price: 95, discountPercent: null },
      { itemId: A, uom: 'BOX', minQty: 0, price: 1100, discountPercent: null },
    ])
    eq('uom-specific rule beats base rule (case-insensitive uom)', priceCart(ctx({ priceLists: [uoms] }), [line(A, 1, 1200, { uom: 'box', uomFactor: 12 })]).lines[0].unitPrice, 1100)
    eq('base rule × factor for a unit without its own rule', priceCart(ctx({ priceLists: [uoms] }), [line(A, 1, 600, { uom: 'pack', uomFactor: 6 })]).lines[0].unitPrice, 570)
    eq('uom rule does not apply to base unit line', priceCart(ctx({ priceLists: [uoms] }), [line(A, 1, 100)]).lines[0].unitPrice, 95)
  }
  {
    const expired = list('old', [{ itemId: A, uom: null, minQty: 0, price: 1, discountPercent: null }], { validTo: '2026-10-21' })
    const future = list('new', [{ itemId: A, uom: null, minQty: 0, price: 2, discountPercent: null }], { validFrom: '2026-10-23' })
    const today = list('today', [{ itemId: A, uom: null, minQty: 0, price: 3, discountPercent: null }], { validFrom: '2026-10-22', validTo: '2026-10-22' })
    eq('list validity dates (inclusive)', priceCart(ctx({ priceLists: [expired, future, today] }), [line(A, 1, 100)]).lines[0].unitPrice, 3)
    const inactive = list('off', [{ itemId: A, uom: null, minQty: 0, price: 1, discountPercent: null }], { isActive: false })
    eq('inactive list ignored', priceCart(ctx({ priceLists: [inactive] }), [line(A, 1, 100)]).lines[0].unitPrice, 100)
  }
  {
    const counter = list('counter', [{ itemId: A, uom: null, minQty: 0, price: 85, discountPercent: null }], { appliesTo: 'pos_profiles', posProfileIds: ['pp1'] })
    eq('POS profile list: matching counter', priceCart(ctx({ priceLists: [counter], posProfileId: 'pp1' }), [line(A, 1, 100)]).lines[0].unitPrice, 85)
    eq('POS profile list: other counter', priceCart(ctx({ priceLists: [counter], posProfileId: 'pp2' }), [line(A, 1, 100)]).lines[0].unitPrice, 100)
    const vip = list('vip', [{ itemId: A, uom: null, minQty: 0, price: 75, discountPercent: null }], { appliesTo: 'customers', customerIds: ['cust1'] })
    eq('specific customer list', [
      priceCart(ctx({ priceLists: [vip], customerId: 'cust1' }), [line(A, 1, 100)]).lines[0].unitPrice,
      priceCart(ctx({ priceLists: [vip], customerId: 'cust2' }), [line(A, 1, 100)]).lines[0].unitPrice,
    ], [75, 100])
    eq('priceLocked line keeps its price', priceCart(ctx({ priceLists: [vip], customerId: 'cust1' }), [line(A, 1, 100, { priceLocked: true })]).lines[0].unitPrice, 100)
  }

  // ---------- item promotions
  {
    const r = priceCart(ctx({ promotions: [promo('p10', { value: 10, itemIds: [A] })] }), [line(A, 3, 100), line(B, 1, 50)])
    eq('10% off item', [r.lines[0].promotionDiscount, r.lines[1].promotionDiscount, r.totals.netTotal], [30, 0, 320])
    eq('label for % off', r.lines[0].promotions[0].label, '10% off')
  }
  {
    const r = priceCart(ctx({ promotions: [promo('f20', { type: 'fixed_off', applyTo: 'categories', value: 20, categoryIds: [CAT] })] }),
      [line(A, 2, 100, { categoryId: CAT }), line(B, 1, 50)])
    eq('Rs 20 off each in category', [r.lines[0].promotionDiscount, r.lines[1].promotionDiscount], [40, 0])
    eq('label for fixed off', r.lines[0].promotions[0].label, 'Rs 20 off each')
  }
  {
    const r = priceCart(ctx({ promotions: [promo('big', { type: 'fixed_off', value: 500, itemIds: [A] })] }), [line(A, 1, 100)])
    eq('discount never takes a line below zero', [r.lines[0].promotionDiscount, r.lines[0].netTotal], [100, 0])
  }
  {
    const pl = list('pl', [{ itemId: A, uom: null, minQty: 0, price: 80, discountPercent: null }])
    const r = priceCart(ctx({ priceLists: [pl], promotions: [promo('p10', { value: 10, itemIds: [A] })] }), [line(A, 1, 100)])
    eq('promotion applies on the list price', [r.lines[0].unitPrice, r.lines[0].promotionDiscount, r.totals.netTotal], [80, 8, 72])
  }

  // ---------- buy X get Y
  {
    const bogo = promo('bogo', { type: 'buy_x_get_y', buyQty: 1, getQty: 1, itemIds: [A] })
    eq('BOGO qty 1 → nothing free', priceCart(ctx({ promotions: [bogo] }), [line(A, 1, 100)]).totals.lineDiscount, 0)
    eq('BOGO qty 2 → 1 free', priceCart(ctx({ promotions: [bogo] }), [line(A, 2, 100)]).totals.lineDiscount, 100)
    eq('BOGO qty 3 → 1 free', priceCart(ctx({ promotions: [bogo] }), [line(A, 3, 100)]).totals.lineDiscount, 100)
    eq('BOGO qty 4 → 2 free', priceCart(ctx({ promotions: [bogo] }), [line(A, 4, 100)]).totals.lineDiscount, 200)
    eq('BOGO label', promotionLabel(bogo), 'Buy 1 get 1 free')
    eq('BOGO across two lines of the same item', priceCart(ctx({ promotions: [bogo] }), [line(A, 1, 100), line(A, 1, 100)]).totals.lineDiscount, 100)
    eq('BOGO ignores fractional (weighed) quantity', priceCart(ctx({ promotions: [bogo] }), [line(A, 1.75, 100)]).totals.lineDiscount, 0)
  }
  {
    const b2g1 = promo('b2g1', { type: 'buy_x_get_y', buyQty: 2, getQty: 1, categoryIds: [CAT] })
    const r = priceCart(ctx({ promotions: [b2g1] }), [line(A, 2, 120, { categoryId: CAT }), line(B, 1, 90, { categoryId: CAT })])
    eq('buy 2 get 1 across category: cheapest unit free', [r.lines[0].promotionDiscount, r.lines[1].promotionDiscount], [0, 90])
  }
  {
    const cross = promo('cross', { type: 'buy_x_get_y', buyQty: 2, getQty: 1, itemIds: [A], getItemIds: [B], getDiscountPercent: 50 })
    const r = priceCart(ctx({ promotions: [cross] }), [line(A, 4, 300), line(B, 3, 200)])
    eq('buy 2 A get 1 B 50% off (×2)', [r.lines[0].promotionDiscount, r.lines[1].promotionDiscount], [0, 200])
    eq('different-item reward capped by get-side quantity', priceCart(ctx({ promotions: [cross] }), [line(A, 6, 300), line(B, 1, 200)]).lines[1].promotionDiscount, 100)
    eq('no buy side → nothing', priceCart(ctx({ promotions: [cross] }), [line(B, 3, 200)]).totals.lineDiscount, 0)
    eq('cross label', promotionLabel(cross), 'Buy 2 get 1 50% off')
  }

  // ---------- bundle
  {
    const bundle = promo('bundle', { type: 'bundle_price', bundleItems: [{ itemId: A, qty: 1 }, { itemId: B, qty: 1 }], bundlePrice: 140 })
    const r = priceCart(ctx({ promotions: [bundle] }), [line(A, 1, 100), line(B, 1, 60)])
    eq('bundle A+B for 140: discount 20 split by value', [r.lines[0].promotionDiscount, r.lines[1].promotionDiscount, r.totals.netTotal], [12.5, 7.5, 140])
    const two = priceCart(ctx({ promotions: [bundle] }), [line(A, 2, 100), line(B, 3, 60)])
    eq('bundle fits twice', two.totals.lineDiscount, 40)
    eq('bundle incomplete → nothing', priceCart(ctx({ promotions: [bundle] }), [line(A, 2, 100)]).totals.lineDiscount, 0)
    const dear = promo('dear', { type: 'bundle_price', bundleItems: [{ itemId: A, qty: 1 }, { itemId: B, qty: 1 }], bundlePrice: 500 })
    eq('bundle price above normal → nothing', priceCart(ctx({ promotions: [dear] }), [line(A, 1, 100), line(B, 1, 60)]).totals.lineDiscount, 0)
  }

  // ---------- overlap / priority / stacking
  {
    const p20 = promo('p20', { value: 20, itemIds: [A], priority: 10 })
    const p10 = promo('p10', { value: 10, itemIds: [A], priority: 5 })
    const r = priceCart(ctx({ promotions: [p10, p20] }), [line(A, 1, 100)])
    eq('overlap non-stackable: higher priority only', [r.lines[0].promotions.map((p) => p.promotionId), r.lines[0].promotionDiscount], [['p20'], 20])
    const s20 = { ...p20, stackable: true }, s10 = { ...p10, stackable: true }
    const s = priceCart(ctx({ promotions: [s10, s20] }), [line(A, 1, 100)])
    eq('stackable promos compound in priority order', [s.lines[0].promotions.map((p) => p.amount), s.lines[0].netTotal], [[20, 8], 72])
    const mix = priceCart(ctx({ promotions: [s20, p10] }), [line(A, 1, 100)])
    eq('non-stackable skips a line a stackable promo already touched', mix.lines[0].promotions.map((p) => p.promotionId), ['p20'])
    const lock = priceCart(ctx({ promotions: [p20, s10] }), [line(A, 1, 100)])
    eq('stackable cannot join a non-stackable line', lock.lines[0].promotions.map((p) => p.promotionId), ['p20'])
    const tie1 = priceCart(ctx({ promotions: [promo('zz', { value: 5, itemIds: [A] }), promo('aa', { value: 7, itemIds: [A] })] }), [line(A, 1, 100)])
    eq('equal priority → id order', tie1.lines[0].promotions[0].promotionId, 'aa')
    const bogo = promo('bogo', { type: 'buy_x_get_y', buyQty: 1, getQty: 1, itemIds: [A], priority: 1 })
    const pct = promo('pct', { value: 50, itemIds: [A], priority: 9 })
    eq('higher-priority % off pre-empts BOGO on the same line', priceCart(ctx({ promotions: [bogo, pct] }), [line(A, 2, 100)]).lines[0].promotions.map((p) => p.promotionId), ['pct'])
  }
  {
    const lists = [list('l1', [{ itemId: A, uom: null, minQty: 0, price: 90, discountPercent: null }], { priority: 2 }), list('l2', [{ itemId: A, uom: null, minQty: 5, price: 70, discountPercent: null }], { priority: 2 })]
    const promos = [promo('x', { value: 10, itemIds: [A], priority: 3, stackable: true }), promo('y', { type: 'min_spend', minSpend: 100, value: 5 }), promo('z', { type: 'buy_x_get_y', buyQty: 2, getQty: 1, itemIds: [B] })]
    const cart = [line(A, 6, 100), line(B, 3, 40), line(C, 1, 10)]
    const r1 = priceCart(ctx({ priceLists: lists, promotions: promos }), cart)
    const r2 = priceCart(ctx({ priceLists: [...lists].reverse(), promotions: [...promos].reverse() }), cart)
    eq('deterministic regardless of input order', JSON.stringify(r1) === JSON.stringify(r2), true)
  }

  // ---------- cart promotions
  {
    const cart5 = promo('cart5', { applyTo: 'cart', value: 5 })
    const clean = priceCart(ctx({ promotions: [cart5] }), [line(A, 1, 100), line(B, 2, 50)])
    eq('5% off cart', [clean.totals.cartDiscount, clean.cartPromotions[0].label, clean.lines.map((l) => l.cartDiscountShare)], [10, '5% off the bill', [5, 5]])
    const withLine = priceCart(ctx({ promotions: [cart5, promo('p10', { value: 10, itemIds: [A] })] }), [line(A, 1, 100), line(B, 2, 50)])
    eq('non-stackable cart promo skipped when a line promo applied', withLine.totals.cartDiscount, 0)
    const stackCart = priceCart(ctx({ promotions: [{ ...cart5, stackable: true }, promo('p10', { value: 10, itemIds: [A], stackable: true })] }), [line(A, 1, 100), line(B, 2, 50)])
    eq('stackable cart promo on what is left', stackCart.totals.cartDiscount, 9.5)
    const three = priceCart(ctx({ promotions: [promo('f', { type: 'fixed_off', applyTo: 'cart', value: 10 })] }), [line(A, 1, 33.33), line(B, 1, 33.33), line(C, 1, 33.34)])
    eq('cart allocation adds up exactly', [three.lines.reduce((s, l) => s + l.cartDiscountShare, 0).toFixed(2), three.totals.netTotal], ['10.00', 90])
  }
  {
    const ms = promo('ms', { type: 'min_spend', minSpend: 5000, discountType: 'fixed', value: 500 })
    eq('min spend reached', priceCart(ctx({ promotions: [ms] }), [line(A, 10, 500)]).totals.cartDiscount, 500)
    eq('min spend not reached', priceCart(ctx({ promotions: [ms] }), [line(A, 9, 500)]).totals.cartDiscount, 0)
    eq('min spend label', promotionLabel(ms), 'Spend Rs 5,000, get Rs 500 off')
    const msPct = promo('msp', { type: 'min_spend', minSpend: 1000, value: 10, stackable: true })
    const after = priceCart(ctx({ promotions: [msPct, promo('p50', { value: 50, itemIds: [A], stackable: true })] }), [line(A, 10, 150)])
    eq('min spend measured after line promotions', after.totals.cartDiscount, 0)
    const gated = promo('gated', { value: 10, itemIds: [A], minSpend: 1000 })
    eq('line promo with minimum cart value', [
      priceCart(ctx({ promotions: [gated] }), [line(A, 1, 999)]).totals.lineDiscount,
      priceCart(ctx({ promotions: [gated] }), [line(A, 1, 1000)]).totals.lineDiscount,
    ], [0, 100])
  }

  // ---------- schedule
  {
    const morning = { timeFrom: '09:00', timeTo: '12:00' }
    eq('time window inside', scheduleOpen(morning, { ...THU, minutes: 11 * 60 + 59 }), true)
    eq('time window end is exclusive', scheduleOpen(morning, { ...THU, minutes: 12 * 60 }), false)
    eq('time window before start', scheduleOpen(morning, { ...THU, minutes: 8 * 60 + 59 }), false)
    const night = { timeFrom: '22:00', timeTo: '02:00', daysOfWeek: [5] } // Friday night
    const fri = (minutes: number): LocalClock => ({ date: '2026-10-23', minutes, dow: 5 })
    const sat = (minutes: number): LocalClock => ({ date: '2026-10-24', minutes, dow: 6 })
    eq('overnight: Friday 23:00 open', scheduleOpen(night, fri(23 * 60)), true)
    eq('overnight: Saturday 01:00 belongs to Friday', scheduleOpen(night, sat(60)), true)
    eq('overnight: Saturday 02:00 closed', scheduleOpen(night, sat(120)), false)
    eq('overnight: Saturday 23:00 closed', scheduleOpen(night, sat(23 * 60)), false)
    eq('overnight: Friday 01:00 is Thursday\'s window', scheduleOpen(night, fri(60)), false)
    eq('overnight: date range uses the start day', scheduleOpen({ ...night, endsOn: '2026-10-23' }, sat(30)), true)
    eq('date range end inclusive / after', [scheduleOpen({ endsOn: '2026-10-22' }, THU), scheduleOpen({ endsOn: '2026-10-21' }, THU)], [true, false])
    eq('days of week', [scheduleOpen({ daysOfWeek: [4] }, THU), scheduleOpen({ daysOfWeek: [0, 6] }, THU)], [true, false])
    const happy = promo('happy', { value: 50, itemIds: [A], timeFrom: '17:00', timeTo: '19:00' })
    eq('scheduled promo outside window not applied', priceCart(ctx({ promotions: [happy] }), [line(A, 1, 100)]).totals.lineDiscount, 0)
    eq('scheduled promo inside window applied', priceCart(ctx({ now: { ...THU, minutes: 18 * 60 }, promotions: [happy] }), [line(A, 1, 100)]).totals.lineDiscount, 50)
  }
  {
    // 2026-10-22T18:45Z = 2026-10-23 00:15 in Colombo (UTC+05:30)
    const c = localClock(new Date('2026-10-22T18:45:00Z'), 'Asia/Colombo')
    eq('localClock Asia/Colombo crosses midnight', c, { date: '2026-10-23', minutes: 15, dow: new Date('2026-10-23T00:00:00Z').getUTCDay() })
  }

  // ---------- eligibility
  {
    const coupon = promo('cpn', { value: 10, itemIds: [A], couponCode: 'DEEPAVALI10' })
    eq('coupon promo needs its code', priceCart(ctx({ promotions: [coupon] }), [line(A, 1, 100)]).totals.lineDiscount, 0)
    eq('coupon code is case-insensitive', priceCart(ctx({ promotions: [coupon], couponCodes: [' deepavali10 '] }), [line(A, 1, 100)]).totals.lineDiscount, 10)
    const used = promo('used', { value: 10, itemIds: [A], usageLimit: 5, usageCount: 5 })
    eq('usage limit exhausted', priceCart(ctx({ promotions: [used] }), [line(A, 1, 100)]).totals.lineDiscount, 0)
    const perCust = promo('pc', { value: 10, itemIds: [A], perCustomerLimit: 1, customerUsageCount: 0 })
    eq('per-customer limit needs a customer', [
      priceCart(ctx({ promotions: [perCust] }), [line(A, 1, 100)]).totals.lineDiscount,
      priceCart(ctx({ promotions: [perCust], customerId: 'c1' }), [line(A, 1, 100)]).totals.lineDiscount,
      priceCart(ctx({ promotions: [{ ...perCust, customerUsageCount: 1 }], customerId: 'c1' }), [line(A, 1, 100)]).totals.lineDiscount,
    ], [0, 10, 0])
    const vipOnly = promo('vip', { value: 10, itemIds: [A], customerTypes: ['vip'] })
    eq('customer group promo', [
      priceCart(ctx({ promotions: [vipOnly], customerType: 'vip' }), [line(A, 1, 100)]).totals.lineDiscount,
      priceCart(ctx({ promotions: [vipOnly], customerType: 'retail' }), [line(A, 1, 100)]).totals.lineDiscount,
    ], [10, 0])
    const counter = promo('ctr', { value: 10, itemIds: [A], posProfileIds: ['pp1'] })
    eq('POS profile promo', [
      priceCart(ctx({ promotions: [counter], posProfileId: 'pp1' }), [line(A, 1, 100)]).totals.lineDiscount,
      priceCart(ctx({ promotions: [counter], posProfileId: 'pp2' }), [line(A, 1, 100)]).totals.lineDiscount,
    ], [10, 0])
    const gift = priceCart(ctx({ promotions: [promo('all', { applyTo: 'cart', value: 10 })] }), [line(A, 1, 100), line(GC, 1, 1000, { excludeFromPromotions: true })])
    eq('gift card line excluded from promotions', [gift.totals.cartDiscount, gift.lines[1].netTotal], [10, 1000])
    const ret = priceCart(ctx({ promotions: [promo('p', { value: 10, itemIds: [A] })] }), [line(A, -1, 100)])
    eq('negative (return) line takes no promotion', ret.totals.lineDiscount, 0)
    const inactive = promo('off', { value: 10, itemIds: [A], isActive: false })
    eq('inactive promo ignored', priceCart(ctx({ promotions: [inactive] }), [line(A, 1, 100)]).totals.lineDiscount, 0)
  }
  {
    const r = priceCart(ctx({ promotions: [promo('p', { value: 10, itemIds: [A] }), promo('q', { value: 10, itemIds: [B] })] }), [line(A, 1, 100), line(A, 1, 100), line(B, 1, 50)])
    eq('appliedPromotions totals per promotion', r.appliedPromotions.map((a) => [a.promotionId, a.amount]), [['p', 20], ['q', 5]])
  }
  return out
}

// Standalone: npx tsx src/lib/pricing/engine-selftest.ts
const isMain = typeof process !== 'undefined' && Array.isArray(process.argv) && /engine-selftest\.ts$/.test(process.argv[1] || '')
if (isMain) {
  const res = runPricingSelfTest()
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
  const failed = res.filter((r) => !r.ok).length
  console.log(`\n${res.length - failed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}
