/**
 * L15 — selling a measured item in a related unit, exactly.
 *
 *   Pure: standard conversions (yd / ft / in / cm / mm ↔ m, g / lb / oz ↔ kg, ml ↔ L), unit
 *   spellings, 4 dp stock rounding, prices, the mobile copy (apps/mobile/src/lib/measureUnits.ts)
 *   agreeing with the web module (src/lib/units/conversions.ts), mobile cart-line helpers.
 *   DB: POST /api/sales on a throw-away tenant —
 *     fabric stocked 60 m at 1000 / m, sold 1.5 yd → 1371.60, stock 58.6284 m (migration 0189)
 *     sugar stocked in kg, sold 250 g → stock −0.25 kg; oil in L, sold 500 ml → −0.5 L
 *     a return of 0.5 yd and a void of 2 ft put back exactly what they took; kg on a metre item → 400
 *
 *   npx tsx scripts/tests/l15-measure-units.ts                      (pure part only, no DATABASE_URL)
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_l15 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l15-measure-units.ts
 *
 * The database must be migrated (node scripts/migrate.mjs). KEEP_TEST_DATA=1 keeps the tenant.
 */
import { randomUUID } from 'crypto'
import * as web from '../../src/lib/units/conversions'
import * as mob from '../../apps/mobile/src/lib/measureUnits'
import { lineGross } from '../../apps/mobile/src/lib/cartMath'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void> | void) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 500)

function pure() {
  const { standardFactor, storedStandardFactor, baseQtyFor, roundStockQty, normalizeUnit, unitOptionsFor, unitPriceFor, conversionText, unitShortName, unitAllowsFraction } = web

  // exact factors
  check('1 yd = 0.9144 m', storedStandardFactor('yd', 'm') === 0.9144, standardFactor('yd', 'm'))
  check('1 ft = 0.3048 m, 1 in = 0.0254 m', storedStandardFactor('ft', 'm') === 0.3048 && storedStandardFactor('inch', 'm') === 0.0254)
  check('1 cm = 0.01 m, 1 mm = 0.001 m', storedStandardFactor('cm', 'm') === 0.01 && storedStandardFactor('mm', 'metre') === 0.001)
  check('1 m = 1.093613 yd (metre sold from a yard item)', storedStandardFactor('m', 'yard') === 1.093613, storedStandardFactor('m', 'yard'))
  check('1 g = 0.001 kg, 1 kg = 1000 g', storedStandardFactor('g', 'kg') === 0.001 && storedStandardFactor('kg', 'g') === 1000)
  check('1 lb = 0.453592 kg (0.45359237 stored at 6 dp)', storedStandardFactor('lb', 'kg') === 0.453592 && standardFactor('lb', 'kg') === 0.45359237)
  check('1 ml = 0.001 L, 1 L = 1000 ml', storedStandardFactor('ml', 'l') === 0.001 && storedStandardFactor('ltr', 'ml') === 1000)
  check('incompatible units → null (kg on a metre item, ml on a kg item, pcs)', standardFactor('kg', 'm') === null && standardFactor('ml', 'kg') === null && standardFactor('pcs', 'm') === null)

  // spellings
  const spell: Array<[string, string]> = [
    ['Metre', 'm'], ['METER', 'm'], ['mtr', 'm'], ['mtrs', 'm'], ['yd', 'yard'], ['Yards', 'yard'], ['yds.', 'yard'], ['feet', 'ft'], ['in', 'inch'],
    ['cms', 'cm'], ['millimetre', 'mm'], ['Kg', 'kg'], ['kilo', 'kg'], ['grams', 'g'], ['gm', 'g'], ['Ltr', 'l'], ['litres', 'l'], ['ML', 'ml'], ['lbs', 'lb'], ['ounce', 'oz'],
  ]
  const bad = spell.filter(([a, b]) => normalizeUnit(a) !== b)
  check('common spellings recognised', bad.length === 0, bad.map(([a]) => `${a}→${normalizeUnit(a)}`))
  check('short names: yd, in, L', unitShortName('yard') === 'yd' && unitShortName('inch') === 'in' && unitShortName('litre') === 'L' && unitShortName('Box') === 'Box')
  check('measures take decimals, pcs does not', unitAllowsFraction('yd') && unitAllowsFraction('g') && unitAllowsFraction('ml') && !unitAllowsFraction('pcs'))

  // stock quantities: 4 dp, no float noise
  check('1.5 yd = 1.3716 m', baseQtyFor(1.5, 0.9144) === 1.3716, baseQtyFor(1.5, 0.9144))
  check('60 − 1.3716 = 58.6284', roundStockQty(60 - baseQtyFor(1.5, 0.9144)) === 58.6284, 60 - 1.3716)
  check('250 g = 0.25 kg, 500 ml = 0.5 L', baseQtyFor(250, 0.001) === 0.25 && baseQtyFor(500, 0.001) === 0.5)
  check('0.5 in = 0.0127 m, 2 ft = 0.6096 m, 1.25 in = 0.0318 m (4 dp)', baseQtyFor(0.5, 0.0254) === 0.0127 && baseQtyFor(2, 0.3048) === 0.6096 && baseQtyFor(1.25, 0.0254) === 0.0318)
  check('float noise rounded away (0.1 + 0.2 → 0.3, 1.005 → 1.005)', roundStockQty(0.1 + 0.2) === 0.3 && roundStockQty(1.005) === 1.005 && roundStockQty(-1.3716) === -1.3716)

  // options + prices
  const m = unitOptionsFor('m')
  check('metre item offers m, cm, mm, yd, ft, in', m.map((o) => o.uom).join(',') === 'm,cm,mm,yard,ft,inch' && m[0].isBase, m.map((o) => o.uom))
  const yd = m.find((o) => o.uom === 'yard')!
  check('1 yd at 1000 / m = 914.40; 1.5 yd = 1371.60', unitPriceFor(yd, 1000) === 914.4 && Math.round(unitPriceFor(yd, 1000) * 1.5 * 100) / 100 === 1371.6)
  const kg = unitOptionsFor('kg')
  check('kg item offers kg, g, mg, lb, oz', kg.map((o) => o.uom).join(',') === 'kg,g,mg,lb,oz', kg.map((o) => o.uom))
  const g = kg.find((o) => o.uom === 'g')!
  check('250 g at 800 / kg = 200.00', Math.round(unitPriceFor(g, 800) * 250 * 100) / 100 === 200)
  check('345 / kg by the gram = 0.345 / g (4 dp), 250 g = 86.25 (not 87.50)', unitPriceFor(g, 345) === 0.345 && Math.round(unitPriceFor(g, 345) * 250 * 100) / 100 === 86.25, unitPriceFor(g, 345))
  check('333 / m by the yard = 304.4952 / yd; 1.5 yd = 456.74', unitPriceFor(yd, 333) === 304.4952 && Math.round(unitPriceFor(yd, 333) * 1.5 * 100) / 100 === 456.74, unitPriceFor(yd, 333))
  const own = unitOptionsFor('m', [{ uom: 'yard', factor: 0.9, sellingPrice: 850 }, { uom: 'roll', factor: 50 }])
  const ownYd = own.find((o) => o.uom === 'yard')!
  check('owner-defined unit wins over the standard one (yard = 0.9 m at 850)', ownYd.factor === 0.9 && unitPriceFor(ownYd, 1000) === 850 && own.filter((o) => normalizeUnit(o.uom) === 'yard').length === 1, own)
  check('owner unit (roll = 50 m) listed with the standard ones', own.some((o) => o.uom === 'roll' && o.factor === 50) && own.some((o) => o.uom === 'ft'))
  check('pcs item has no other unit', unitOptionsFor('pcs').length === 1)
  check('conversion text "1.5 yd = 1.3716 m"', conversionText(1.5, 'yard', 0.9144, 'm') === '1.5 yd = 1.3716 m', conversionText(1.5, 'yard', 0.9144, 'm'))
  check('conversion text "250 g = 0.25 kg", none for the base unit', conversionText(250, 'g', 0.001, 'kg') === '250 g = 0.25 kg' && conversionText(2, 'm', 1, 'm') === null)

  // mobile copy agrees with the web module
  const units = ['m', 'cm', 'mm', 'yd', 'ft', 'in', 'kg', 'g', 'mg', 'lb', 'oz', 'l', 'ml', 'pcs', 'box']
  const diff: string[] = []
  for (const a of units) {
    if (web.normalizeUnit(a) !== mob.normalizeUnit(a) || web.unitShortName(a) !== mob.unitShortName(a) || web.unitAllowsFraction(a) !== mob.unitAllowsFraction(a)) diff.push(a)
    for (const b of units) if (web.storedStandardFactor(a, b) !== mob.storedStandardFactor(a, b)) diff.push(`${a}->${b}`)
    if (JSON.stringify(web.unitOptionsFor(a)) !== JSON.stringify(mob.unitOptionsFor(a))) diff.push(`options ${a}`)
  }
  for (const [q, f] of [[1.5, 0.9144], [250, 0.001], [3.333, 0.3048], [7, 0.453592]]) if (web.baseQtyFor(q, f) !== mob.baseQtyFor(q, f)) diff.push(`base ${q}x${f}`)
  check('mobile measureUnits = web conversions (factors, options, rounding)', diff.length === 0, diff)

  // mobile cart line helpers
  const line: mob.MeasureCartLine = { id: 'L1', name: 'Fabric', sellingPrice: '1000.00', quantity: 1.5, unit: 'm', trackStock: true, availableStock: 60 }
  const ydOpt = mob.unitOptionsFor('m').find((o) => o.uom === 'yard')!
  const c = mob.changeLineUnit(line, ydOpt)
  check('mobile: 1.5 m line → yd keeps 1.5, price 914.40 / yd', c.ok && c.line.quantity === 1.5 && c.line.sellingPrice === '914.40' && c.line.uom === 'yard' && c.line.uomFactor === 0.9144, c)
  if (c.ok) {
    check('mobile: line moves 1.3716 m', mob.lineBaseQty(c.line) === 1.3716)
    const back = mob.changeLineUnit(c.line, mob.unitOptionsFor('m')[0])
    check('mobile: back to m → 1000.00 / m, no uom', back.ok && back.line.sellingPrice === '1000.00' && !back.line.uom && !back.line.uomFactor, back)
    const big = mob.setLineQuantity(c.line, 70)
    check('mobile: 70 yd (64.008 m) > 60 m → refused', !big.ok, big)
    const ok = mob.setLineQuantity(c.line, 65)
    check('mobile: 65 yd (59.436 m) ≤ 60 m → allowed', ok.ok, ok)
  }
  const gl = mob.changeLineUnit({ id: 'S', name: 'Sugar', sellingPrice: '345.00', quantity: 250, unit: 'kg', trackStock: true, availableStock: 10 }, mob.unitOptionsFor('kg').find((o) => o.uom === 'g')!)
  check('mobile: kg line → g: 0.345 / g, 250 g line = 86.25', gl.ok && gl.line.sellingPrice === '0.345' && lineGross(gl.line) === 86.25, gl)
  check('mobile: typed "1,5" → 1.5; "1.5" on pcs → refused; "0" refused',
    mob.parseLineQuantity('1,5', true) === 1.5 && mob.parseLineQuantity('1.5', false) === null && mob.parseLineQuantity('0', true) === null && mob.parseLineQuantity('abc', true) === null)
}

async function dbPart(url: string) {
  const { Client } = await import('pg')
  const { NextRequest } = await import('next/server')
  const { setTestSession } = await import('./w8-harness/auth-mock')
  const { closeAllPools, withTenantTransaction } = await import('@/lib/db')
  const { applyStockChange } = await import('@/lib/inventory/apply-stock-change')
  const { POST: postSale } = await import('@/app/api/sales/route')
  const { PUT: voidSale } = await import('@/app/api/sales/[id]/route')

  const req = (method: string, path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  async function json(resP: Response | undefined | Promise<Response | undefined>): Promise<{ status: number; body: J }> {
    const res = await resP
    if (!res) return { status: 0, body: { error: 'no response' } }
    const text = await res.text()
    let body: J = {}
    try { body = JSON.parse(text) } catch { body = { raw: text } }
    return { status: res.status, body }
  }

  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenantId = randomUUID()
  const slug = `l15-${tenantId.slice(0, 8)}`
  const wh = randomUUID()
  const userId = randomUUID()
  try {
    await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'L15 measures', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
    await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [wh, tenantId])
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
      [userId, tenantId, `owner-${slug}@example.test`])
    setTestSession({
      user: {
        id: userId, accountId: null, email: `owner-${slug}@example.test`, name: 'Owner', role: 'owner',
        tenantId, tenantSlug: slug, tenantName: 'L15 measures', businessType: 'retail',
        aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
      },
    } as unknown as Parameters<typeof setTestSession>[0])

    const newItem = async (name: string, unit: string, price: number, stock: number) => {
      const id = randomUUID()
      await admin.query(
        `INSERT INTO items (id, tenant_id, item_code, name, unit, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [id, tenantId, `L15-${id.slice(0, 8)}`, name, unit, Math.round(price * 0.6), price])
      await withTenantTransaction(tenantId, (tx) => applyStockChange(tx, {
        tenantId, warehouseId: wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId,
      }))
      return id
    }
    const stockOf = async (itemId: string) => {
      const r = await admin.query(`SELECT current_stock::text s FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
      return r.rows[0] ? Number(r.rows[0].s) : NaN
    }
    const sell = (lines: Array<{ itemId: string; name: string; quantity: number; unitPrice: number; uom?: string }>) => {
      const subtotal = Math.round(lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100) / 100, 0) * 100) / 100
      return json(postSale(req('POST', '/api/sales', {
        cartItems: lines.map((l) => ({ ...l, discount: 0 })),
        paymentMethod: 'cash', subtotal, discount: 0, tax: 0, total: subtotal, amountPaid: subtotal, creditAmount: 0, warehouseId: wh,
      })))
    }

    const fabric = await newItem('Cotton fabric', 'm', 1000, 60)
    const sugar = await newItem('Sugar', 'kg', 800, 10)
    const dhal = await newItem('Red dhal', 'kg', 345, 20)
    const oil = await newItem('Coconut oil', 'L', 400, 5)
    let fabricSale = ''
    let fabricLine = ''

    await step('1.5 yd from a 60 m roll', async () => {
      const s = await sell([{ itemId: fabric, name: 'Cotton fabric', quantity: 1.5, unitPrice: 914.4, uom: 'yd' }])
      check('sale of 1.5 yd → 200', s.status === 200, short(s.body))
      fabricSale = s.body.id
      check('sale total 1371.60', Number(s.body.total) === 1371.6, s.body.total)
      const li = (await admin.query(`SELECT id, quantity::text q, uom, uom_factor::text f, unit_price::text p, total::text t FROM sale_items WHERE sale_id=$1`, [fabricSale])).rows[0]
      fabricLine = li?.id
      check('line: 1.5 yard × 914.40 = 1371.60, factor 0.9144', Number(li?.q) === 1.5 && li?.uom === 'yard' && Number(li?.f) === 0.9144 && Number(li?.p) === 914.4 && Number(li?.t) === 1371.6, li)
      const st = await stockOf(fabric)
      check('stock 60 m → 58.6284 m', st === 58.6284, st)
      const mv = (await admin.query(`SELECT qty_change::text c, stock_after::text a FROM stock_movements WHERE item_id=$1 AND reference_type <> 'test_seed'`, [fabric])).rows
      check('ledger: −1.3716, after 58.6284', mv.length === 1 && Number(mv[0].c) === -1.3716 && Number(mv[0].a) === 58.6284, mv)
    })

    await step('250 g of a kg item, 500 ml of a litre item', async () => {
      const s = await sell([
        { itemId: sugar, name: 'Sugar', quantity: 250, unitPrice: 0.8, uom: 'g' },
        { itemId: oil, name: 'Coconut oil', quantity: 500, unitPrice: 0.4, uom: 'ml' },
      ])
      check('sale of 250 g + 500 ml → 200, total 400.00', s.status === 200 && Number(s.body.total) === 400, short(s.body))
      check('sugar 10 kg → 9.75 kg', (await stockOf(sugar)) === 9.75, await stockOf(sugar))
      check('oil 5 L → 4.5 L', (await stockOf(oil)) === 4.5, await stockOf(oil))
    })

    await step('250 g at 345 / kg', async () => {
      const s = await sell([{ itemId: dhal, name: 'Red dhal', quantity: 250, unitPrice: 0.345, uom: 'gram' }])
      check('sale of 250 g at 0.345 / g → 200, total 86.25', s.status === 200 && Number(s.body.total) === 86.25, short(s.body))
      const li = (await admin.query(`SELECT unit_price::text p, total::text t, uom FROM sale_items WHERE sale_id=$1`, [s.body.id])).rows[0]
      check('line keeps 0.345 / g, total 86.25, uom g', Number(li?.p) === 0.345 && Number(li?.t) === 86.25 && li?.uom === 'g', li)
      check('dhal 20 kg → 19.75 kg', (await stockOf(dhal)) === 19.75, await stockOf(dhal))
      const old = await sell([{ itemId: dhal, name: 'Red dhal', quantity: 100, unitPrice: 0.35, uom: 'g' }])
      // a client that rounds the gram price to cents is charged the price it showed (a price above
      // the catalog price needs no approval); no "cart total mismatch"
      check('older client with a cent-rounded 0.35 / g → accepted at the price it showed (35.00)', old.status === 200 && Number(old.body.total) === 35, short(old.body))
    })

    await step('incompatible unit', async () => {
      const k = await sell([{ itemId: fabric, name: 'Cotton fabric', quantity: 1, unitPrice: 1000, uom: 'kg' }])
      check('kg on a metre item → 400 UOM_NOT_FOUND, stock untouched', k.status === 400 && k.body.code === 'UOM_NOT_FOUND' && (await stockOf(fabric)) === 58.6284, short(k.body))
    })

    await step('return 0.5 yd', async () => {
      const r = await json(postSale(req('POST', '/api/sales', {
        isReturn: true, returnAgainst: fabricSale,
        cartItems: [{ originalSaleItemId: fabricLine, itemId: fabric, name: 'Cotton fabric', quantity: -0.5, unitPrice: 914.4 }],
        subtotal: 0, tax: 0, total: 0, refundMethod: 'cash', warehouseId: wh,
      })))
      check('return of 0.5 yd → 200', r.status === 200, short(r.body))
      const st = await stockOf(fabric)
      check('stock back +0.4572 m → 59.0856', st === 59.0856, st)
      const rl = (await admin.query(`SELECT uom, uom_factor::text f, total::text t FROM sale_items WHERE sale_id=$1`, [r.body.id || r.body.returnSaleId])).rows[0]
      check('return line in yd (factor 0.9144), refund 457.20', rl?.uom === 'yard' && Number(rl?.f) === 0.9144 && Math.abs(Number(rl?.t)) === 457.2, rl)
    })

    await step('void 2 ft', async () => {
      const before = await stockOf(fabric)
      const s = await sell([{ itemId: fabric, name: 'Cotton fabric', quantity: 2, unitPrice: 304.8, uom: 'feet' }])
      check('sale of 2 ft = 609.60 → 200', s.status === 200 && Number(s.body.total) === 609.6, short(s.body))
      check('stock −0.6096', (await stockOf(fabric)) === Math.round((before - 0.6096) * 1e4) / 1e4, await stockOf(fabric))
      const v = await json(voidSale(req('PUT', `/api/sales/${s.body.id}`, { voidReason: 'Wrong length cut' }), ctx(s.body.id)))
      check('void → 200', v.status === 200, short(v.body))
      check('void restores exactly (59.0856)', (await stockOf(fabric)) === before, await stockOf(fabric))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) {
      await new Promise((r) => setTimeout(r, 300))
      await admin.query(`SET session_replication_role = replica`)
      const tables = await admin.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='tenant_id'
           AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)
      for (const t of tables.rows) await admin.query(`DELETE FROM "${t.table_name}" WHERE tenant_id=$1`, [tenantId]).catch(() => undefined)
      await admin.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => undefined)
      await admin.query(`SET session_replication_role = origin`)
    }
    await admin.end()
    await closeAllPools().catch(() => undefined)
  }
}

async function main() {
  await step('pure conversions', pure)
  const url = process.env.DATABASE_URL || ''
  if (url) {
    if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
    await dbPart(url)
  } else {
    console.log('(no DATABASE_URL: database checks skipped)')
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
