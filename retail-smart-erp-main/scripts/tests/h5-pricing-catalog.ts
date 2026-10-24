/**
 * H5 — price lists, promotions, extra barcodes, units of measure, product type.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_r8 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/h5-pricing-catalog.ts
 *
 * Runs the pure engine self-test, checks the mobile copy of the engine is identical, then calls
 * the real route handlers (auth mocked via the w8 harness) on throw-away tenants. PASS/FAIL per
 * check, non-zero exit on failure. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { runPricingSelfTest } from '@/lib/pricing/engine-selftest'
import { buildExtraBarcodeIndex, extraBarcodeScan } from '../../apps/mobile/src/lib/catalogUnits'
import { applyCartQuote, offlineCartQuote, taxableLineTotals } from '../../apps/mobile/src/lib/cartPricing'
import { cartSubtotal as mobileSubtotal, lineTotal as mobileLineTotal, type CartLineLike } from '../../apps/mobile/src/lib/cartMath'
import { POST as postItem, GET as listItems } from '@/app/api/items/route'
import { PUT as putItem } from '@/app/api/items/[id]/route'
import { GET as barcodeLookup } from '@/app/api/items/barcode-lookup/route'
import { GET as getBarcodes, PUT as putBarcodes } from '@/app/api/items/[id]/barcodes/route'
import { GET as getUoms, PUT as putUoms } from '@/app/api/items/[id]/uoms/route'
import { GET as getUnits, POST as postUnit } from '@/app/api/units/route'
import { DELETE as deleteUnit } from '@/app/api/units/[id]/route'
import { GET as listPriceLists, POST as postPriceList } from '@/app/api/price-lists/route'
import { GET as getPriceList, PUT as putPriceList } from '@/app/api/price-lists/[id]/route'
import { PUT as putPriceListItems } from '@/app/api/price-lists/[id]/items/route'
import { GET as listPromotions, POST as postPromotion } from '@/app/api/promotions/route'
import { DELETE as deletePromotion } from '@/app/api/promotions/[id]/route'
import { POST as priceQuote } from '@/app/api/price-quote/route'
import { GET as pricingBundle } from '@/app/api/price-quote/bundle/route'
import { GET as offlineBundle } from '@/app/api/pos/offline-bundle/route'
import { POST as postSale } from '@/app/api/sales/route'
import { PUT as voidSale } from '@/app/api/sales/[id]/route'
import { POST as postExchange } from '@/app/api/sales/exchange/route'
import { GET as promotionReport } from '@/app/api/reports/promotions/route'
import { offlineQuote } from '@/components/pos/price-quote'
import { withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; retailId: string; wholesaleId: string; role: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const ROOT = join(__dirname, '..', '..')

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx, role = f.role) {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'H5', businessType: 'supermarket',
      aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 400)

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `h5-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), retailId: randomUUID(), wholesaleId: randomUUID(), role: 'owner' }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'H5 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name, customer_type) VALUES ($1, $2, 'Walk Retail', 'retail'), ($3, $2, 'Perera Wholesale', 'wholesale')`,
    [f.retailId, tenantId, f.wholesaleId])
  return f
}

async function cleanup(admin: Client, tenantId: string) {
  await admin.query(`SET session_replication_role = replica`)
  const tables = await admin.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='tenant_id'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)
  for (const t of tables.rows) {
    await admin.query(`DELETE FROM "${t.table_name}" WHERE tenant_id=$1`, [tenantId]).catch(() => undefined)
  }
  await admin.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch((e) => console.warn('cleanup tenant:', e.message))
  await admin.query(`SET session_replication_role = origin`)
}

async function newItem(body: Record<string, unknown>) {
  const r = await json(await postItem(req('POST', '/api/items', { trackStock: true, ...body })))
  if (r.status !== 200) throw new Error(`item create failed: ${short(r.body)}`)
  return r.body as J
}

async function main() {
  // ---------- 0. pure engine
  const self = runPricingSelfTest()
  const failed = self.filter((r) => !r.ok)
  check(`engine self-test: ${self.length - failed.length}/${self.length} cases`, failed.length === 0, failed.map((f) => `${f.name}: ${f.detail}`).join('; '))
  const srv = readFileSync(join(ROOT, 'src/lib/pricing/engine.ts'), 'utf8')
  const mob = readFileSync(join(ROOT, 'apps/mobile/src/lib/pricingEngine.ts'), 'utf8')
  check('mobile pricingEngine.ts is a verbatim copy of src/lib/pricing/engine.ts', srv === mob)
  check('engine has no imports (shareable with the mobile app)', !/^\s*import\s/m.test(srv))

  // mobile cart pricing (offline engine on the bundle + cart maths)
  {
    const pricing = {
      timezone: 'Asia/Colombo', units: [], itemUoms: [], itemBarcodes: [],
      priceLists: [{ id: 'pl', name: 'Wholesale', priority: 0, appliesTo: 'customer_group', customerTypes: ['wholesale'], items: [{ itemId: 'A', uom: null, minQty: 0, price: 88, discountPercent: null }] }],
      promotions: [{ id: 'bogo', name: 'BOGO', type: 'buy_x_get_y', buyQty: 1, getQty: 1, itemIds: ['B'], priority: 0, stackable: false }],
    }
    const cart: CartLineLike[] = [{ id: 'A', name: 'Soap', sellingPrice: '100', quantity: 2 }, { id: 'B', name: 'Rice', sellingPrice: '300', quantity: 2 }]
    const q = offlineCartQuote(cart, pricing as never, { customerType: 'wholesale' })!
    const priced = applyCartQuote(cart, q)
    check('mobile offline quote: list price + BOGO', priced[0].sellingPrice === '88' && priced[1].promotionDiscount === 300, JSON.stringify(priced))
    check('mobile subtotal = Σ line totals net of promotions (what POST /api/sales checks)', mobileSubtotal(priced) === 476 && mobileLineTotal(priced[1]) === 300, String(mobileSubtotal(priced)))
    check('applyCartQuote returns the same array when nothing changed', applyCartQuote(priced, q) === priced)
    check('taxable line totals carry the cart promotion share', JSON.stringify(taxableLineTotals([100, 300], 40)) === JSON.stringify([90, 270]))
    const webCart = [
      { cartLineId: 'l1', itemId: 'A', name: 'Soap', quantity: 2, unitPrice: 100, total: 200 },
      { cartLineId: 'l2', itemId: 'B', name: 'Rice', quantity: 2, unitPrice: 300, total: 600 },
      { cartLineId: 'l3', itemId: 'A', name: 'Soap (edited)', quantity: 1, unitPrice: 70, total: 70, priceLocked: true },
    ]
    const wq = offlineQuote(webCart, pricing as never, { customerType: 'wholesale' }, (c) => c)!
    check('web offline quote (shared engine on the cached bundle): list price, BOGO, locked price kept',
      wq.lines[0].unitPrice === 88 && wq.lines[1].promotionDiscount === 300 && wq.lines[2].unitPrice === 70, JSON.stringify(wq.lines))
  }

  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin, 'main')
    tenants.push(f.tenantId)
    setTestSession(session(f))

    // ---------- 1. product type
    let soap: J = {}, rice: J = {}
    await step('product type', async () => {
      soap = await newItem({ name: 'Sunlight soap', sellingPrice: 100, barcode: `H5S${Date.now()}`, unit: 'pcs' })
      rice = await newItem({ name: 'Samba rice 1kg', sellingPrice: 300, unit: 'pcs' })
      check('new item defaults to stockable', soap.productType === 'stockable' && soap.trackStock === true, short(soap))
      const svc = await newItem({ name: 'Delivery', sellingPrice: 250, productType: 'service' })
      check('productType service → trackStock false', svc.productType === 'service' && svc.trackStock === false, short(svc))
      const legacy = await newItem({ name: 'Old style non-stock', sellingPrice: 10, trackStock: false })
      check('legacy trackStock=false → service', legacy.productType === 'service', short(legacy))
      const gc = await newItem({ name: 'Gift card', sellingPrice: 1000, trackStock: false, isGiftCard: true })
      check('untracked gift card → consumable', gc.productType === 'consumable', short(gc))
      const up = await json(await putItem(req('PUT', `/api/items/${svc.id}`, { name: 'Delivery', sellingPrice: 250, productType: 'consumable' }), ctx(svc.id)))
      check('PUT productType consumable keeps trackStock false', up.status === 200 && up.body.productType === 'consumable' && up.body.trackStock === false, short(up.body))
      const keep = await json(await putItem(req('PUT', `/api/items/${svc.id}`, { name: 'Delivery', sellingPrice: 260 }), ctx(svc.id)))
      check('PUT without trackStock/productType keeps the item non-stock', keep.status === 200 && keep.body.trackStock === false && keep.body.productType === 'consumable', short(keep.body))
      await admin.query(`UPDATE items SET track_stock = true WHERE id = $1`, [svc.id])
      const t = (await admin.query(`SELECT product_type FROM items WHERE id=$1`, [svc.id])).rows[0]
      check('DB trigger: track_stock on → stockable', t.product_type === 'stockable', t.product_type)
      await admin.query(`UPDATE items SET product_type = 'service' WHERE id = $1`, [svc.id])
      const t2 = (await admin.query(`SELECT track_stock FROM items WHERE id=$1`, [svc.id])).rows[0]
      check('DB trigger: product_type service → track_stock off', t2.track_stock === false, String(t2.track_stock))
    })

    // ---------- 2. units
    await step('units', async () => {
      const u = await json(await getUnits())
      const codes = (u.body as unknown as Array<{ code: string }>).map((x) => x.code).sort()
      check('default units seeded for a new company', u.status === 200 && ['box', 'dozen', 'g', 'kg', 'l', 'ml', 'pack', 'pcs'].every((c) => codes.includes(c)), codes.join(','))
      const add = await json(await postUnit(req('POST', '/api/units', { code: 'Crate', name: 'Crate' })))
      check('add unit (code lower-cased)', add.status === 201 && add.body.code === 'crate', short(add.body))
      const dup = await json(await postUnit(req('POST', '/api/units', { code: 'CRATE', name: 'Crate again' })))
      check('duplicate unit code (case-insensitive) → 409', dup.status === 409, short(dup.body))
      const pcs = (u.body as unknown as Array<{ id: string; code: string }>).find((x) => x.code === 'pcs')!
      const del = await json(await deleteUnit(req('DELETE', `/api/units/${pcs.id}`), ctx(pcs.id)))
      check('unit used as an item base unit → archived (items keep their unit)', del.status === 200 && del.body.archived === true, short(del.body))
    })

    // ---------- 3. unit conversions + extra barcodes
    const BOX = `H5BOX${Date.now()}`
    const ALT = `H5ALT${Date.now()}`
    const SIX = `H5SIX${Date.now()}`
    await step('uoms and barcodes', async () => {
      const bad = await json(await putUoms(req('PUT', `/api/items/${soap.id}/uoms`, { uoms: [{ uom: 'parsec', factor: 2 }] }), ctx(soap.id)))
      check('unknown unit → 400', bad.status === 400, short(bad.body))
      const baseU = await json(await putUoms(req('PUT', `/api/items/${soap.id}/uoms`, { uoms: [{ uom: 'pcs', factor: 1 }] }), ctx(soap.id)))
      check('base unit as conversion → 400', baseU.status === 400, short(baseU.body))
      const noConv = await json(await putBarcodes(req('PUT', `/api/items/${soap.id}/barcodes`, { barcodes: [{ barcode: SIX, uom: 'pack' }] }), ctx(soap.id)))
      check('barcode for a unit the item has no conversion for → 400', noConv.status === 400, short(noConv.body))
      const ok = await json(await putUoms(req('PUT', `/api/items/${soap.id}/uoms`, {
        uoms: [{ uom: 'box', factor: 12, barcode: BOX, sellingPrice: 1100 }, { uom: 'pack', factor: 6 }],
        barcodes: [{ barcode: ALT, label: 'Old pack' }, { barcode: SIX, uom: 'pack', priceOverride: 560 }],
      }), ctx(soap.id)))
      check('save conversions + barcodes atomically', ok.status === 200 && (ok.body as unknown as unknown[]).length === 2, short(ok.body))
      const bc = await json(await getBarcodes(req('GET', `/api/items/${soap.id}/barcodes`), ctx(soap.id)))
      check('two additional barcodes stored', bc.status === 200 && (bc.body as unknown as unknown[]).length === 2, short(bc.body))
      const u = await json(await getUoms(req('GET', `/api/items/${soap.id}/uoms`), ctx(soap.id)))
      check('two conversions stored', u.status === 200 && (u.body as unknown as unknown[]).length === 2, short(u.body))
      const dropPack = await json(await putUoms(req('PUT', `/api/items/${soap.id}/uoms`, { uoms: [{ uom: 'box', factor: 12, barcode: BOX, sellingPrice: 1100 }] }), ctx(soap.id)))
      check('removing a unit that a barcode uses → 400', dropPack.status === 400, short(dropPack.body))

      // uniqueness across items.barcode / item_barcodes / item_uoms
      const c1 = await json(await putBarcodes(req('PUT', `/api/items/${rice.id}/barcodes`, { barcodes: [{ barcode: soap.barcode }] }), ctx(rice.id)))
      check('another item\'s primary barcode → 409 DUPLICATE barcode', c1.status === 409 && c1.body.field === 'barcode', short(c1.body))
      const c2 = await json(await putBarcodes(req('PUT', `/api/items/${rice.id}/barcodes`, { barcodes: [{ barcode: ALT }] }), ctx(rice.id)))
      check('another item\'s additional barcode → 409', c2.status === 409, short(c2.body))
      const c3 = await json(await putBarcodes(req('PUT', `/api/items/${rice.id}/barcodes`, { barcodes: [{ barcode: BOX }] }), ctx(rice.id)))
      check('another item\'s unit barcode → 409', c3.status === 409, short(c3.body))
      const c4 = await json(await postItem(req('POST', '/api/items', { name: 'Clash', sellingPrice: 1, barcode: ALT })))
      check('new item whose primary barcode is someone\'s additional barcode → 409', c4.status === 409 && c4.body.field === 'barcode', short(c4.body))
      const c5 = await json(await putBarcodes(req('PUT', `/api/items/${soap.id}/barcodes`, { barcodes: [{ barcode: soap.barcode }] }), ctx(soap.id)))
      check('own primary barcode as additional → 409', c5.status === 409, short(c5.body))
      // rice gets its own extra code
      const r1 = await json(await putBarcodes(req('PUT', `/api/items/${rice.id}/barcodes`, { barcodes: [{ barcode: `H5R${Date.now()}`, packQty: 5 }] }), ctx(rice.id)))
      check('rice additional barcode with pack qty 5', r1.status === 200, short(r1.body))
    })

    // ---------- 4. barcode lookup / search
    await step('barcode lookup', async () => {
      const a = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=${ALT}&warehouseId=${f.wh}`)))
      check('additional barcode resolves the item', a.status === 200 && a.body.id === soap.id && a.body.scan.matchedBy === 'item_barcode' && a.body.uom === null, short(a.body))
      check('plain additional barcode: no quantity override', a.body.scan?.quantity === undefined && a.body.uomFactor === 1, short(a.body))
      const b = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=${BOX}`)))
      check('unit barcode → uom box, factor 12, uom price 1100', b.status === 200 && b.body.uom === 'box' && b.body.uomFactor === 12 && b.body.uomPrice === 1100 && b.body.scan.matchedBy === 'uom_barcode', short(b.body))
      check('unit barcode in base units for old carts: qty 12, line total 1100', b.body.scan?.quantity === 12 && b.body.scan?.lineTotal === 1100, short(b.body.scan))
      const c = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=${SIX}`)))
      check('pack barcode with price override: 6 base units for 560', c.body.uom === 'pack' && c.body.uomPrice === 560 && c.body.scan?.quantity === 6 && c.body.scan?.lineTotal === 560, short(c.body))
      const p = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=${soap.barcode}`)))
      check('primary barcode unchanged (matchedBy barcode, base unit)', p.body.id === soap.id && p.body.scan.matchedBy === 'barcode' && p.body.uomFactor === 1, short(p.body))
      const s = await json(await listItems(req('GET', `/api/items?search=${ALT}`)))
      check('item search finds an additional barcode (list + count)', s.status === 200 && s.body.data.some((i: J) => i.id === soap.id) && s.body.pagination.total === 1, short(s.body.pagination))
    })

    // ---------- 5. price lists
    let wholesaleList = ''
    await step('price lists', async () => {
      const bad = await json(await postPriceList(req('POST', '/api/price-lists', { name: 'Bad', appliesTo: 'customer_group' })))
      check('customer group list without groups → 400', bad.status === 400, short(bad.body))
      const w = await json(await postPriceList(req('POST', '/api/price-lists', { name: 'Wholesale', appliesTo: 'customer_group', customerTypes: ['wholesale'], priority: 10 })))
      check('create wholesale list', w.status === 201, short(w.body))
      wholesaleList = w.body.id
      const dup = await json(await postPriceList(req('POST', '/api/price-lists', { name: 'wholesale' })))
      check('duplicate list name → 409', dup.status === 409, short(dup.body))
      const rows = await json(await putPriceListItems(req('PUT', `/api/price-lists/${wholesaleList}/items`, {
        items: [
          { itemCode: soap.itemCode, price: 90 },
          { itemCode: soap.itemCode, minQty: 24, price: 80 },
          { itemCode: BOX, uom: 'box', price: 1000 },
          { itemId: rice.id, discountPercent: 10 },
        ],
      }), ctx(wholesaleList)))
      check('save rules by item code / unit barcode / id', rows.status === 200 && rows.body.itemCount === 4, short(rows.body))
      const err = await json(await putPriceListItems(req('PUT', `/api/price-lists/${wholesaleList}/items`, {
        items: [{ itemCode: 'NOPE-404', price: 1 }, { itemId: rice.id, uom: 'crate', price: 1 }],
      }), ctx(wholesaleList)))
      check('unknown item / missing conversion → 400 with row errors, nothing written', err.status === 400 && err.body.errors.length === 2
        && (await admin.query(`SELECT count(*)::int c FROM price_list_items WHERE price_list_id=$1`, [wholesaleList])).rows[0].c === 4, short(err.body))
      const both = await json(await putPriceListItems(req('PUT', `/api/price-lists/${wholesaleList}/items`, { items: [{ itemId: rice.id, price: 1, discountPercent: 5 }] }), ctx(wholesaleList)))
      check('price and % on one row → 400', both.status === 400, short(both.body))
      const merge = await json(await putPriceListItems(req('PUT', `/api/price-lists/${wholesaleList}/items`, { mode: 'merge', items: [{ itemCode: soap.itemCode, price: 88 }] }), ctx(wholesaleList)))
      check('merge mode updates one tier, keeps the rest', merge.status === 200 && merge.body.itemCount === 4, short(merge.body))
      const g = await json(await getPriceList(req('GET', `/api/price-lists/${wholesaleList}`), ctx(wholesaleList)))
      check('GET list returns rules with item names', g.status === 200 && g.body.items.length === 4 && g.body.items.some((i: J) => i.itemName === 'Sunlight soap' && Number(i.price) === 88), short(g.body))
      const l = await json(await listPriceLists(req('GET', '/api/price-lists')))
      check('list price lists with item count', l.status === 200 && l.body.data[0]?.itemCount === 4, short(l.body))
      const counter = await json(await postPriceList(req('POST', '/api/price-lists', { name: 'Expired promo list', validTo: '2020-01-01', priority: 99 })))
      await putPriceListItems(req('PUT', `/api/price-lists/${counter.body.id}/items`, { items: [{ itemId: soap.id, price: 1 }] }), ctx(counter.body.id))
      const upd = await json(await putPriceList(req('PUT', `/api/price-lists/${counter.body.id}`, { name: 'Expired promo list', validFrom: '2020-02-01', validTo: '2020-01-01' }), ctx(counter.body.id)))
      check('valid to before valid from → 400', upd.status === 400, short(upd.body))
    })

    // ---------- 6. promotions
    let bogoId = ''
    await step('promotions', async () => {
      const bad = await json(await postPromotion(req('POST', '/api/promotions', { name: 'x', type: 'percent_off', value: 150, itemIds: [soap.id] })))
      check('% over 100 → 400', bad.status === 400, short(bad.body))
      const bad2 = await json(await postPromotion(req('POST', '/api/promotions', { name: 'x', type: 'bundle_price', bundleItems: [{ itemId: soap.id, qty: 1 }], bundlePrice: 10 })))
      check('bundle with one item → 400', bad2.status === 400, short(bad2.body))
      const bogo = await json(await postPromotion(req('POST', '/api/promotions', { name: 'Rice BOGO', type: 'buy_x_get_y', buyQty: 1, getQty: 1, itemIds: [rice.id], priority: 5 })))
      check('create BOGO', bogo.status === 201, short(bogo.body))
      bogoId = bogo.body.id
      const cpn = await json(await postPromotion(req('POST', '/api/promotions', { name: 'Deepavali', type: 'min_spend', minSpend: 1000, discountType: 'fixed', value: 100, couponCode: 'deepavali', stackable: true })))
      check('create coupon spend-and-save (code upper-cased)', cpn.status === 201 && cpn.body.couponCode === 'DEEPAVALI' && cpn.body.applyTo === 'cart', short(cpn.body))
      const dup = await json(await postPromotion(req('POST', '/api/promotions', { name: 'dup', type: 'percent_off', value: 5, applyTo: 'cart', couponCode: 'Deepavali' })))
      check('duplicate coupon code → 409', dup.status === 409, short(dup.body))
      const night = await json(await postPromotion(req('POST', '/api/promotions', { name: 'Never now', type: 'percent_off', value: 50, itemIds: [soap.id], timeFrom: '03:00', timeTo: '03:01', daysOfWeek: [] })))
      check('create time-window promo', night.status === 201, short(night.body))
      const list = await json(await listPromotions(req('GET', '/api/promotions')))
      check('list promotions with labels', list.status === 200 && list.body.data.some((p: J) => p.label === 'Buy 1 get 1 free'), short(list.body))
    })

    // ---------- 7. price quote
    await step('price quote', async () => {
      const q = async (body: Record<string, unknown>) => json(await priceQuote(req('POST', '/api/price-quote', body)))
      const walk = await q({ lines: [{ itemId: soap.id, quantity: 2 }, { itemId: rice.id, quantity: 2 }] })
      check('walk-in: base prices, rice BOGO', walk.status === 200 && walk.body.lines[0].unitPrice === 100 && walk.body.lines[1].promotionDiscount === 300 && walk.body.totals.netTotal === 500, short(walk.body))
      check('promotion id + label returned', walk.body.lines[1].promotions[0]?.promotionId === bogoId && walk.body.lines[1].promotions[0]?.label === 'Buy 1 get 1 free', short(walk.body.lines[1]))
      const ws = await q({ customerId: f.wholesaleId, lines: [{ itemId: soap.id, quantity: 2 }, { itemId: rice.id, quantity: 1 }] })
      check('wholesale customer: list price 88, rice 10% off base', ws.status === 200 && ws.body.lines[0].unitPrice === 88 && ws.body.lines[1].unitPrice === 270 && ws.body.lines[0].priceListId === wholesaleList, short(ws.body))
      const tier = await q({ customerId: f.wholesaleId, lines: [{ itemId: soap.id, quantity: 24 }] })
      check('wholesale tier at 24 pcs → 80', tier.body.lines?.[0]?.unitPrice === 80, short(tier.body))
      const box = await q({ customerId: f.wholesaleId, lines: [{ itemId: soap.id, quantity: 1, uom: 'box' }] })
      check('box line: list price 1000, factor 12', box.body.lines?.[0]?.unitPrice === 1000 && box.body.lines[0].uomFactor === 12, short(box.body))
      const boxRetail = await q({ customerId: f.retailId, lines: [{ itemId: soap.id, quantity: 1, uom: 'box' }] })
      check('retail box line: unit selling price 1100', boxRetail.body.lines?.[0]?.unitPrice === 1100 && boxRetail.body.lines[0].priceListId === null, short(boxRetail.body))
      const noCoupon = await q({ lines: [{ itemId: soap.id, quantity: 11 }] })
      const withCoupon = await q({ couponCodes: ['deepavali'], lines: [{ itemId: soap.id, quantity: 11 }] })
      check('coupon spend-and-save only with its code', noCoupon.body.totals?.cartDiscount === 0 && withCoupon.body.totals?.cartDiscount === 100 && withCoupon.body.totals.netTotal === 1000, short([noCoupon.body.totals, withCoupon.body.totals]))
      const locked = await q({ customerId: f.wholesaleId, lines: [{ itemId: soap.id, quantity: 1, unitPrice: 95, priceLocked: true }] })
      check('price-locked line keeps the caller price', locked.body.lines?.[0]?.unitPrice === 95, short(locked.body))
      const unsigned = await q({ lines: [{ itemId: soap.id, quantity: 1, unitPrice: 1 }] })
      check('client unit price without priceLocked is ignored (server authority)', unsigned.body.lines?.[0]?.unitPrice === 100, short(unsigned.body))
      const badUom = await q({ lines: [{ itemId: soap.id, quantity: 1, uom: 'crate' }] })
      check('unknown unit on a line → 400 UOM_NOT_FOUND', badUom.status === 400 && badUom.body.code === 'UOM_NOT_FOUND', short(badUom.body))
      const past = await q({ at: '2020-01-01T10:00:00Z', lines: [{ itemId: soap.id, quantity: 1 }] })
      check('owner may price another date (expired list applies then)', past.status === 200 && past.body.lines[0].unitPrice === 1, short(past.body))
      setTestSession(session(f, 'cashier'))
      const cashierPast = await q({ at: '2020-01-01T10:00:00Z', lines: [{ itemId: soap.id, quantity: 1 }] })
      const cashier = await q({ lines: [{ itemId: soap.id, quantity: 1 }] })
      check('cashier can quote but not price another date', cashier.status === 200 && cashierPast.status === 403, `${cashier.status} ${cashierPast.status}`)
      const pl = await json(await listPriceLists(req('GET', '/api/price-lists')))
      check('cashier cannot manage price lists', pl.status === 403, String(pl.status))
      setTestSession(session(f))

      // usage limit + redemption counting
      await admin.query(`UPDATE promotions SET usage_limit = 1, usage_count = 1 WHERE id = $1`, [bogoId])
      const used = await q({ lines: [{ itemId: rice.id, quantity: 2 }] })
      check('exhausted usage limit → promotion not offered', used.body.totals?.lineDiscount === 0, short(used.body.totals))
      await admin.query(`UPDATE promotions SET usage_limit = NULL, per_customer_limit = 1 WHERE id = $1`, [bogoId])
      const saleId = randomUUID()
      await admin.query(`INSERT INTO sales (id, tenant_id, invoice_no) VALUES ($1, $2, 'H5-INV-1')`, [saleId, f.tenantId])
      await admin.query(`INSERT INTO promotion_redemptions (tenant_id, promotion_id, sale_id, customer_id, amount) VALUES ($1,$2,$3,$4,300)`, [f.tenantId, bogoId, saleId, f.retailId])
      const again = await q({ customerId: f.retailId, lines: [{ itemId: rice.id, quantity: 2 }] })
      const other = await q({ customerId: f.wholesaleId, lines: [{ itemId: rice.id, quantity: 2 }] })
      check('per-customer limit counts that customer\'s redemptions', again.body.totals?.lineDiscount === 0 && other.body.totals?.lineDiscount > 0, short([again.body.totals, other.body.totals]))
    })

    // ---------- 8. offline bundle
    await step('offline bundle', async () => {
      const b = await json(await pricingBundle())
      check('pricing bundle: lists, promotions, units, conversions, barcodes', b.status === 200 && b.body.priceLists.length >= 1 && b.body.promotions.length >= 3
        && b.body.units.length >= 8 && b.body.itemUoms.length === 2 && b.body.itemBarcodes.length === 3, short(b.body))
      check('expired price list left out of the bundle', !b.body.priceLists.some((l: J) => l.name === 'Expired promo list'), short(b.body.priceLists))
      const ob = await json(await offlineBundle())
      check('GET /api/pos/offline-bundle carries `pricing`', ob.status === 200 && Array.isArray(ob.body.pricing?.itemBarcodes) && Array.isArray(ob.body.taxTemplates), short(ob.body).slice(0, 200))
      const index = buildExtraBarcodeIndex(b.body as never)
      const m = index.get(BOX)
      const x = m ? extraBarcodeScan(m, 100) : null
      check('mobile offline index resolves the unit barcode like the server', !!x && x.uom === 'box' && x.quantity === 12 && x.lineTotal === 1100, short(x))
      const six = index.get(SIX)
      const y = six ? extraBarcodeScan(six, 100) : null
      check('mobile offline index: pack barcode with price override', !!y && y.quantity === 6 && y.lineTotal === 560 && y.uomPrice === 560, short(y))
    })

    // ---------- 9. delete promotion that was used → deactivated
    await step('promotion delete', async () => {
      await admin.query(`UPDATE promotions SET usage_count = 3 WHERE id = $1`, [bogoId])
      const d = await json(await deletePromotion(req('DELETE', `/api/promotions/${bogoId}`), ctx(bogoId)))
      const row = (await admin.query(`SELECT is_active FROM promotions WHERE id=$1`, [bogoId])).rows[0]
      check('used promotion is deactivated (recycle bin), not deleted', d.status === 200 && d.body.archived === true && row?.is_active === false, short(d.body))
    })

    // ---------- 10. checkout (POST /api/sales prices with the engine)
    await step('checkout', async () => {
      const c = await makeTenant(admin, 'co')
      tenants.push(c.tenantId)
      setTestSession(session(c))
      const stockOf = async (id: string) => Number((await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [c.wh, id])).rows[0]?.current_stock || 0)
      const seed = (id: string, qty: number) => withTenantTransaction(c.tenantId, (tx) => applyStockChange(tx, {
        tenantId: c.tenantId, warehouseId: c.wh, itemId: id, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: c.userId,
      }))
      const S = await newItem({ name: 'Soap', sellingPrice: 100, unit: 'pcs' })
      const R = await newItem({ name: 'Rice', sellingPrice: 300, unit: 'pcs' })
      await seed(S.id, 100); await seed(R.id, 100)
      await putUoms(req('PUT', `/api/items/${S.id}/uoms`, { uoms: [{ uom: 'box', factor: 12, sellingPrice: 1100 }] }), ctx(S.id))
      const pl = await json(await postPriceList(req('POST', '/api/price-lists', { name: 'Wholesale', appliesTo: 'customer_group', customerTypes: ['wholesale'] })))
      await putPriceListItems(req('PUT', `/api/price-lists/${pl.body.id}/items`, { items: [{ itemId: S.id, price: 88 }] }), ctx(pl.body.id))
      const bogo = await json(await postPromotion(req('POST', '/api/promotions', { name: 'Rice BOGO', type: 'buy_x_get_y', buyQty: 1, getQty: 1, itemIds: [R.id] })))
      const cpn = await json(await postPromotion(req('POST', '/api/promotions', { name: 'Spend 1000', type: 'min_spend', minSpend: 1000, discountType: 'fixed', value: 100, couponCode: 'SAVE100' })))
      const sale = async (body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { warehouseId: c.wh, discount: 0, tax: 0, creditAmount: 0, paymentMethod: 'cash', ...body })))
      const line = async (saleId: string) => (await admin.query(`SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY id`, [saleId])).rows

      const w = await sale({ customerId: c.wholesaleId, cartItems: [{ itemId: S.id, name: 'Soap', quantity: 2, unitPrice: 88 }], subtotal: 176, total: 176, amountPaid: 176 })
      const wl = w.status === 200 ? (await line(w.body.id))[0] : null
      check('checkout: wholesale list price accepted and recorded (price_list_id, list_price = catalog)', w.status === 200 && Number(wl?.unit_price) === 88 && wl?.price_list_id === pl.body.id && Number(wl?.list_price) === 100, short(w.body))
      const stale = await sale({ customerId: c.wholesaleId, cartItems: [{ itemId: S.id, name: 'Soap', quantity: 2, unitPrice: 100 }], subtotal: 200, total: 200, amountPaid: 200 })
      check('checkout: catalog price where the list applies → 409 PRICE_CHANGED with quote', stale.status === 409 && stale.body.code === 'PRICE_CHANGED' && stale.body.quote?.lines?.[0]?.unitPrice === 88, short(stale.body))
      const walkIn = await sale({ cartItems: [{ itemId: S.id, name: 'Soap', quantity: 1, unitPrice: 100 }], subtotal: 100, total: 100, amountPaid: 100 })
      check('checkout: walk-in pays catalog price', walkIn.status === 200, short(walkIn.body))

      const b = await sale({ cartItems: [{ itemId: R.id, name: 'Rice', quantity: 2, unitPrice: 300 }], subtotal: 300, total: 300, amountPaid: 300 })
      const bl = b.status === 200 ? (await line(b.body.id))[0] : null
      const usage = async () => (await admin.query(`SELECT usage_count FROM promotions WHERE id=$1`, [bogo.body.id])).rows[0].usage_count
      check('checkout: BOGO applied server-side (promotion_discount 300, promotion_id, label)', b.status === 200 && Number(bl?.promotion_discount) === 300 && Number(bl?.discount) === 300
        && bl?.promotion_id === bogo.body.id && bl?.promotions?.[0]?.label === 'Buy 1 get 1 free', short(b.body))
      check('checkout: BOGO usage counted + redemption row', (await usage()) === 1
        && (await admin.query(`SELECT count(*)::int c FROM promotion_redemptions WHERE sale_id=$1`, [b.body.id])).rows[0].c === 1, String(await usage()))
      const unaware = await sale({ cartItems: [{ itemId: R.id, name: 'Rice', quantity: 2, unitPrice: 300 }], subtotal: 600, total: 600, amountPaid: 600 })
      check('checkout: client without the promotion → 409 PRICE_CHANGED', unaware.status === 409 && unaware.body.code === 'PRICE_CHANGED' && unaware.body.quote?.totals?.lineDiscount === 300, short(unaware.body))
      const fake = await sale({ cartItems: [{ itemId: S.id, name: 'Soap', quantity: 1, unitPrice: 100 }], subtotal: 100, promotionDiscount: 50, total: 50, amountPaid: 50 })
      check('checkout: client-claimed promotion the server does not grant → 409', fake.status === 409 && fake.body.code === 'PRICE_CHANGED', short(fake.body))
      const off = await sale({ offlineRef: `OFF-H5-${Date.now()}`, clientSaleId: randomUUID(), cartItems: [{ itemId: R.id, name: 'Rice', quantity: 2, unitPrice: 300 }], subtotal: 600, total: 600, amountPaid: 600 })
      const ol = off.status === 200 ? (await line(off.body.id))[0] : null
      check('checkout: offline sale priced without the promotion is accepted and flagged', off.status === 200 && !!off.body.flags?.promotionDifference && Number(ol?.promotion_discount) === 0 && Number(off.body.total) === 600, short(off.body))

      const cp = await sale({ couponCodes: ['save100'], cartItems: [{ itemId: S.id, name: 'Soap', quantity: 11, unitPrice: 100 }], subtotal: 1100, promotionDiscount: 100, total: 1000, amountPaid: 1000 })
      check('checkout: coupon cart promotion → sales.promotion_discount / discount_amount / coupon_code', cp.status === 200 && Number(cp.body.promotionDiscount) === 100
        && Number(cp.body.discountAmount) === 100 && cp.body.couponCode === 'SAVE100', short(cp.body))
      const cl = cp.status === 200 ? (await line(cp.body.id))[0] : null
      check('checkout: cart promotion share stored on the line', cl?.promotions?.some((x: J) => x.promotionId === cpn.body.id && Number(x.amount) === 100), short(cl?.promotions))

      const before = await stockOf(S.id)
      const bx = await sale({ cartItems: [{ itemId: S.id, name: 'Soap box', quantity: 1, uom: 'box', unitPrice: 1100 }], subtotal: 1100, total: 1100, amountPaid: 1100 })
      const bxl = bx.status === 200 ? (await line(bx.body.id))[0] : null
      check('checkout: 1 box sale deducts 12 pcs, stores uom / factor', bx.status === 200 && (await stockOf(S.id)) === before - 12 && bxl?.uom === 'box' && Number(bxl?.uom_factor) === 12, `${bx.status} ${before}→${await stockOf(S.id)} ${short(bx.body)}`)
      const bad = await sale({ cartItems: [{ itemId: S.id, name: 'Soap', quantity: 1, uom: 'crate', unitPrice: 1 }], subtotal: 1, total: 1, amountPaid: 1 })
      check('checkout: unknown unit → 400 UOM_NOT_FOUND', bad.status === 400 && bad.body.code === 'UOM_NOT_FOUND', short(bad.body))
      if (bxl) {
        const mid = await stockOf(S.id)
        const ret = await sale({ isReturn: true, returnAgainst: bx.body.id, refundMethod: 'cash', subtotal: 0, total: 0,
          cartItems: [{ originalSaleItemId: bxl.id, itemId: S.id, name: 'Soap box', quantity: -1, unitPrice: 0 }] })
        check('checkout: return of the box line restores 12 pcs', ret.status === 200 && (await stockOf(S.id)) === mid + 12, `${ret.status} ${mid}→${await stockOf(S.id)} ${short(ret.body)}`)
      }

      const v = await json(await voidSale(req('PUT', `/api/sales/${b.body.id}`, { voidReason: 'h5 test' }), ctx(b.body.id)))
      const red = (await admin.query(`SELECT voided_at FROM promotion_redemptions WHERE sale_id=$1`, [b.body.id])).rows[0]
      check('checkout: void reverses promotion usage', v.status === 200 && (await usage()) === 0 && !!red?.voided_at, `${v.status} usage=${await usage()} ${short(v.body)}`)

      // rate-change control compares with the resolved (list) price
      const prof = randomUUID(), open = randomUUID()
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id, allow_rate_change) VALUES ($1,$2,'Counter',$3,false)`, [prof, c.tenantId, c.wh])
      await admin.query(`INSERT INTO pos_opening_entries (id, tenant_id, entry_number, pos_profile_id, user_id, warehouse_id, status) VALUES ($1,$2,'POS-H5-1',$3,$4,$5,'open')`, [open, c.tenantId, prof, c.userId, c.wh])
      // barcode price override (master data) = resolved price on a no-rate-change counter
      const OV = `H5OV${Date.now()}`
      await putBarcodes(req('PUT', `/api/items/${R.id}/barcodes`, { barcodes: [{ barcode: OV, priceOverride: 250 }] }), ctx(R.id))
      setTestSession(session(c, 'cashier'))
      const ov = await sale({ posOpeningEntryId: open, cartItems: [{ itemId: R.id, name: 'Rice', quantity: 1, unitPrice: 250, priceLocked: true, barcode: OV }], subtotal: 250, total: 250, amountPaid: 250 })
      check('rate control: barcode price override needs no approval', ov.status === 200, short(ov.body))
      const ovNo = await sale({ posOpeningEntryId: open, cartItems: [{ itemId: R.id, name: 'Rice', quantity: 1, unitPrice: 250, priceLocked: true }], subtotal: 250, total: 250, amountPaid: 250 })
      check('rate control: the same price without the barcode → APPROVAL_REQUIRED', ovNo.status === 403 && ovNo.body.code === 'APPROVAL_REQUIRED', short(ovNo.body))
      const ok = await sale({ posOpeningEntryId: open, customerId: c.wholesaleId, cartItems: [{ itemId: S.id, name: 'Soap', quantity: 1, unitPrice: 88 }], subtotal: 88, total: 88, amountPaid: 88 })
      check('rate control: list price below catalog needs no approval', ok.status === 200, short(ok.body))
      const promo = await sale({ posOpeningEntryId: open, cartItems: [{ itemId: R.id, name: 'Rice', quantity: 2, unitPrice: 300 }], subtotal: 300, total: 300, amountPaid: 300 })
      check('rate control: promotion needs no approval', promo.status === 200, short(promo.body))
      const cut = await sale({ posOpeningEntryId: open, customerId: c.wholesaleId, cartItems: [{ itemId: S.id, name: 'Soap', quantity: 1, unitPrice: 80 }], subtotal: 80, total: 80, amountPaid: 80 })
      check('rate control: manual price below the list price → APPROVAL_REQUIRED', cut.status === 403 && cut.body.code === 'APPROVAL_REQUIRED', short(cut.body))
      setTestSession(session(c))

      // exchange in units: return 1 pc, take 1 box (12 pcs)
      const s1 = await sale({ cartItems: [{ itemId: S.id, name: 'Soap', quantity: 2, unitPrice: 100 }], subtotal: 200, total: 200, amountPaid: 200 })
      const s1l = (await line(s1.body.id))[0]
      const st0 = await stockOf(S.id)
      const ex = await json(await postExchange(req('POST', '/api/sales/exchange', {
        originalSaleId: s1.body.id, returnLines: [{ originalSaleItemId: s1l.id, quantity: 1 }],
        newCartItems: [{ itemId: S.id, name: 'Soap box', quantity: 1, uom: 'box', unitPrice: 1100 }],
        paymentMethod: 'cash', amountPaid: 1000, warehouseId: c.wh,
      })))
      const exl = ex.status === 200 ? (await line(ex.body.sale.id))[0] : null
      check('exchange: unit line takes 12 pcs, the returned pc comes back (net −11)', ex.status === 200 && (await stockOf(S.id)) === st0 - 11 && exl?.uom === 'box' && Number(exl?.uom_factor) === 12 && Number(exl?.list_price) === 1100,
        `${ex.status} ${st0}→${await stockOf(S.id)} ${short(ex.body)}`)

      // promotion report
      const today = new Date().toISOString().slice(0, 10)
      const rep = await json(await promotionReport(req('GET', `/api/reports/promotions?fromDate=2026-01-01&toDate=${today > '2026-12-31' ? today : '2026-12-31'}`)))
      const cpnRow = rep.body.data?.find((r: J) => r.promotionId === cpn.body.id)
      check('promotion report: coupon promotion 1 redemption, Rs 100 given, sales value 1000; voided BOGO left out',
        rep.status === 200 && cpnRow?.redemptions === 1 && cpnRow?.discountGiven === 100 && cpnRow?.salesValue === 1000
          && (rep.body.data.find((r: J) => r.promotionId === bogo.body.id)?.redemptions ?? 0) === 1, short(rep.body))
      setTestSession(session(f))
    })

    // ---------- 11. tenant isolation
    await step('isolation', async () => {
      const g = await makeTenant(admin, 'other')
      tenants.push(g.tenantId)
      setTestSession(session(g))
      const l = await json(await listPriceLists(req('GET', '/api/price-lists?includeInactive=true')))
      check('other company sees none of the price lists', l.status === 200 && l.body.data.length === 0, short(l.body))
      const p = await json(await listPromotions(req('GET', '/api/promotions?includeInactive=true')))
      check('other company sees none of the promotions', p.status === 200 && p.body.data.length === 0, short(p.body))
      const q = await json(await priceQuote(req('POST', '/api/price-quote', { lines: [{ itemId: soap.id, quantity: 1 }] })))
      check('quoting another company\'s item → 400 ITEM_NOT_FOUND', q.status === 400 && q.body.code === 'ITEM_NOT_FOUND', short(q.body))
      const bl = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=${ALT}`)))
      check('another company\'s additional barcode is not found', bl.status === 404, short(bl.body))
      const ok = await newItem({ name: 'Same code elsewhere', sellingPrice: 5, barcode: ALT })
      check('the same barcode is free in another company', !!ok.id, short(ok))
      const pu = await json(await putBarcodes(req('PUT', `/api/items/${soap.id}/barcodes`, { barcodes: [] }), ctx(soap.id)))
      check('cannot edit another company\'s item barcodes', pu.status === 404, short(pu.body))
      setTestSession(session(f))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) for (const t of tenants) await cleanup(admin, t)
    await admin.end()
    await closeAllPools().catch(() => undefined)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
