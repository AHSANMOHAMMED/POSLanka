/**
 * G: mobile business-logic audit (pure, no DB, no React Native):
 *   npx tsx scripts/tests/gG-mobile.ts
 *
 * Proves the fixes in apps/mobile:
 *  1. mixed inclusive + exclusive tax carts pay subtotal + exclusive tax (was: exclusive dropped)
 *  2. subtotal = Σ rounded line totals (server's "Cart total mismatch" check)
 *  3. price-embedded scale / GS1 AI 392n labels: the printed amount is the line total
 *  4. held tickets send the catalog uuid for scale lines and resume with unique line ids + tax template
 *  5. counter (POS profile) payment methods gate card / LankaQR tenders
 *  6. return retries reuse one clientSaleId (no double refund after a timeout)
 *  7. shift close sees this shift's unsynced offline sales
 *  8. intake: 5xx / 408 / 429 are transient (batch / line not marked rejected)
 */
import { calculateCartTax, calculateItemTax as mobileItemTax, roundCurrency, type TaxConfig, type TaxTemplate } from '../../apps/mobile/src/lib/taxMath'
import { calculateItemTax as serverItemTax } from '../../src/lib/utils/tax-template'
import { cartFromHeld, cartPayable, cartSubtotal, heldCartItems, lineTotal, scanToLine, unitPriceForAmount } from '../../apps/mobile/src/lib/cartMath'
import { allowedTenders } from '../../apps/mobile/src/lib/tenderRules'
import { IdempotencyKey } from '../../apps/mobile/src/lib/idempotency'
import { unsyncedSalesForShift } from '../../apps/mobile/src/lib/shiftGuard'
import { isTransientStatus } from '../../apps/mobile/src/lib/httpStatus'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ''}`)
}

// ---------------------------------------------------------------- 1. mixed tax
const vatIncl: TaxTemplate = { id: 'incl', name: 'VAT incl', items: [{ taxName: 'VAT', rate: 18, accountId: null, includedInPrice: true }] }
const sscl: TaxTemplate = { id: 'excl', name: 'SSCL', items: [{ taxName: 'SSCL', rate: 2.5, accountId: null, includedInPrice: false }] }
const config: TaxConfig = { templates: new Map([['incl', vatIncl], ['excl', sscl]]), defaultTemplate: null, unavailable: false }
const mixedCart = [
  { id: 'a', name: 'A', sellingPrice: '1180.00', quantity: 1, taxTemplateId: 'incl' },
  { id: 'b', name: 'B', sellingPrice: '1000.00', quantity: 1, taxTemplateId: 'excl' },
]
const mixedTax = calculateCartTax(mixedCart.map((l) => ({ lineTotal: lineTotal(l), taxTemplateId: l.taxTemplateId })), config)
const mixedSubtotal = cartSubtotal(mixedCart)
check('mixed cart: inclusive flag set', mixedTax.hasInclusiveTax === true)
check('mixed cart: exclusive tax = 25.00', mixedTax.exclusiveTax === 25, mixedTax.exclusiveTax)
check('mixed cart: payable = 2180 + 25 = 2205 (old formula gave 2180)', cartPayable(mixedSubtotal, mixedTax) === 2205, cartPayable(mixedSubtotal, mixedTax))
// server convention (src/lib/utils/tax-recalculate.ts): total = subtotal + Σ exclusive breakdown
const serverExclusive = [serverItemTax(1180, vatIncl as never), serverItemTax(1000, sscl as never)]
  .flatMap((r) => r.breakdown).filter((b) => !b.includedInPrice).reduce((s, b) => s + b.amount, 0)
check('mixed cart: payable equals server convention', cartPayable(mixedSubtotal, mixedTax) === roundCurrency(2180 + serverExclusive), { serverExclusive })
const allIncl = calculateCartTax([{ lineTotal: 1180, taxTemplateId: 'incl' }], config)
check('all-inclusive cart: payable = subtotal', cartPayable(1180, allIncl) === 1180)
const allExcl = calculateCartTax([{ lineTotal: 1000, taxTemplateId: 'excl' }], config)
check('all-exclusive cart: payable = subtotal + tax', cartPayable(1000, allExcl) === 1025)
check('mobile item tax == server item tax (incl)', JSON.stringify(mobileItemTax(1180, vatIncl)) === JSON.stringify(serverItemTax(1180, vatIncl as never)))
check('mobile item tax == server item tax (excl)', JSON.stringify(mobileItemTax(999.99, sscl)) === JSON.stringify(serverItemTax(999.99, sscl as never)))

// ---------------------------------------------------------------- 2. subtotal rounding
const weighed = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, name: 'Veg', sellingPrice: '133.33', quantity: 0.335 }))
const serverSubtotal = weighed.reduce((s, l) => s + roundCurrency(roundCurrency(133.33) * l.quantity), 0) // route.ts: Σ item.total
const oldSubtotal = roundCurrency(weighed.reduce((s, l) => s + Number(l.sellingPrice) * l.quantity, 0))
check('subtotal = Σ rounded line totals (server check)', Math.abs(cartSubtotal(weighed) - serverSubtotal) < 0.001, { mobile: cartSubtotal(weighed), serverSubtotal })
check('old round(Σ) formula drifted from server', Math.abs(oldSubtotal - serverSubtotal) > 0.04, { oldSubtotal, serverSubtotal })

// ---------------------------------------------------------------- 3. scale / GS1 labels
const priceLabel = scanToLine({ symbology: 'scale', quantity: 0.646, unitPrice: 380, lineTotal: 245.5 })
check('price label: weight kept as quantity', priceLabel.quantity === 0.646)
check('price label: line total == printed 245.50 (old: 245.48)', lineTotal({ sellingPrice: String(priceLabel.unitPrice), quantity: priceLabel.quantity }) === 245.5, priceLabel)
check('price label: old maths was off', roundCurrency(380 * 0.646) !== 245.5)
check('price label: kept as its own line', priceLabel.fixedAmount === true)
let exact = 0
let tries = 0
let worst = 0
for (let cents = 10000; cents <= 300000; cents += 777) {
  const amt = cents / 100
  for (const q of [0.123, 0.5, 0.646, 0.999, 1]) {
    tries++
    if (roundCurrency(roundCurrency(unitPriceForAmount(amt, q)) * q) === amt) exact++
  }
  // above 1 kg not every cent is reachable with a 2-dp unit price: stay within one cent
  for (const q of [1.234, 2.5, 3.333]) worst = Math.max(worst, Math.abs(roundCurrency(roundCurrency(unitPriceForAmount(amt, q)) * q) - amt) - q * 0.005)
}
check('unitPriceForAmount reproduces the label amount exactly for qty <= 1 kg (sweep)', exact === tries, { exact, tries })
check('unitPriceForAmount above 1 kg: as close as a 2-dp price allows (≤ qty × 0.005)', worst <= 0.005001, worst)
const gs1Old = scanToLine({ symbology: 'gs1', quantity: 1.25, unitPrice: 500 }) // older server: AI 392n sent as unitPrice
check('GS1 1.25 kg, amount payable 500 → line total 500 (old: 625)', lineTotal({ sellingPrice: String(gs1Old.unitPrice), quantity: gs1Old.quantity }) === 500, gs1Old)
const gs1New = scanToLine({ symbology: 'gs1', quantity: 6, lineTotal: 1200 })
check('GS1 count 6 with amount 1200 → 200 each', gs1New.unitPrice === 200 && gs1New.quantity === 6)
const weightOnly = scanToLine({ symbology: 'scale', quantity: 1.2345 })
check('weight label: catalog price, qty rounded to 3 dp', weightOnly.unitPrice === undefined && weightOnly.quantity === 1.235 && weightOnly.weighed)
const amountOnly = scanToLine({ symbology: 'scale', unitPrice: 250, lineTotal: 250 })
check('amount label without weight: 1 unit at amount', amountOnly.quantity === 1 && amountOnly.unitPrice === 250)
check('plain scan: normal add', scanToLine(null).weighed === false && scanToLine({ symbology: 'ean13' }).weighed === false)
check('GS1 price but weight label scale: scale unitPrice is still a unit price', scanToLine({ symbology: 'scale', quantity: 2, unitPrice: 100 }).unitPrice === 100)

// ---------------------------------------------------------------- 4. held tickets
const ITEM = '11111111-1111-4111-8111-111111111111'
const cart = [
  { id: ITEM, itemId: ITEM, name: 'Beef', sellingPrice: '380.03', quantity: 0.646, taxTemplateId: 'excl' },
  { id: `${ITEM}#2`, itemId: ITEM, name: 'Beef', sellingPrice: '381.00', quantity: 1.1, taxTemplateId: 'excl' },
]
const held = heldCartItems(cart)
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
check('held: every itemId is the catalog uuid (server uuidSchema)', held.every((h) => uuidRe.test(h.itemId)), held.map((h) => h.itemId))
check('held: totals are server line totals', held[0].total === 245.5 && held[1].total === 419.1, held)
const resumed = cartFromHeld(held, (id) => (id === ITEM ? { taxTemplateId: 'excl', unit: 'kg', trackStock: true, availableStock: 10 } : null))
check('resume: unique line ids', new Set(resumed.map((l) => l.id)).size === 2, resumed.map((l) => l.id))
check('resume: tax template restored', resumed.every((l) => l.taxTemplateId === 'excl'))
check('resume: same tax as before hold', calculateCartTax(resumed.map((l) => ({ lineTotal: lineTotal(l), taxTemplateId: l.taxTemplateId })), config).tax === calculateCartTax(cart.map((l) => ({ lineTotal: lineTotal(l), taxTemplateId: l.taxTemplateId })), config).tax)
check('resume: bad rows dropped', cartFromHeld([{ itemId: '', name: 'x', quantity: 1, unitPrice: 1 }, { itemId: ITEM, name: 'y', quantity: 0, unitPrice: 1 }]).length === 0)

// ---------------------------------------------------------------- 5. tenders
const cashCard = allowedTenders({ paymentMethods: [{ paymentMethod: 'cash' }, { paymentMethod: 'card' }] })
check('profile cash+card: LankaQR disabled', !cashCard.has('lankaqr') && cashCard.has('card') && cashCard.has('cash'))
const qrOnly = allowedTenders({ paymentMethods: ['bank_transfer'] })
check('profile bank_transfer: LankaQR on, card off, cash always on', qrOnly.has('lankaqr') && !qrOnly.has('card') && qrOnly.has('cash'))
check('profile without a list: all tenders (older profiles)', allowedTenders({ paymentMethods: [] }).size === 4 && allowedTenders(null).size === 4)
check('credit stays governed by allowCreditSale', cashCard.has('credit'))

// ---------------------------------------------------------------- 6. return idempotency
let minted = 0
const key = new IdempotencyKey(() => `k${++minted}`)
const k1 = key.for('sale1|[[line1,-1]]')
const k2 = key.for('sale1|[[line1,-1]]')
check('return retry after timeout reuses the clientSaleId', k1 === k2 && minted === 1)
const k3 = key.for('sale1|[[line1,-2]]')
check('changed quantities → new key', k3 !== k1)
key.reset()
check('after success → new key for the next return', key.for('sale1|[[line1,-2]]') !== k3)

// ---------------------------------------------------------------- 7. shift close guard
const queue = [
  { payload: { posOpeningEntryId: 'S1', total: 1000 }, tenantSlug: 'acme' },
  { payload: { posOpeningEntryId: 'S1', total: 250.5 }, tenantSlug: 'acme', rejected: true },
  { payload: { posOpeningEntryId: 'S2', total: 99 }, tenantSlug: 'acme' },
  { payload: { posOpeningEntryId: 'S1', total: 5 }, tenantSlug: 'other' },
]
const g = unsyncedSalesForShift(queue, 'S1', 'acme')
check('shift guard: counts this shift + tenant only', g.pending === 1 && g.rejected === 1 && g.amount === 1250.5, g)
check('shift guard: clean shift passes', unsyncedSalesForShift(queue, 'S9', 'acme').pending === 0)

// ---------------------------------------------------------------- 8. intake transient statuses
check('5xx / 408 / 429 / offline are transient', [0, 408, 429, 500, 502, 503].every(isTransientStatus))
check('validation / permission errors are not transient', ![400, 403, 404, 409, 422].some(isTransientStatus))

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
