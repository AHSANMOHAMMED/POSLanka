/**
 * J1 — pharmacy POS (prescriptions, register, expiry) and vendor feature switches on the sale route.
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/j1-pharmacy-features.ts
 *
 * Real route handlers on a throw-away pharmacy tenant (auth via the w8 harness). Covers: prescription
 * and controlled medicines refused without a prescription, recorded with one (register row on the
 * sale), OTC needs nothing, offline sales accepted; rx-check; register search / controlled filter;
 * expiry report; generic-name item search; credit / gift card / loyalty / coupon switches refuse the
 * sale and offline sales still sync; API path / page → switch mapping.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { POST as postSale } from '@/app/api/sales/route'
import { GET as rxCheck } from '@/app/api/pharmacy/rx-check/route'
import { GET as expiryReport } from '@/app/api/pharmacy/expiry/route'
import { GET as register } from '@/app/api/prescriptions/route'
import { GET as listItems } from '@/app/api/items/route'
import { featureForApiPath, featureForHref, featureAppliesTo, normalizeFeatureFlags } from '@/lib/features/flags'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; customerId: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx) {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'J1', businessType: 'pharmacy',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
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
const short = (b: unknown) => JSON.stringify(b).slice(0, 300)

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `j1-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, 'J1 pharmacy', $2, $3, 'pharmacy')`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Nimal Perera')`, [f.customerId, tenantId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, extra: { generic?: string; schedule?: string | null } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, generic_name, drug_schedule)
     VALUES ($1, $2, $3, $4, 10, $5, false, $6, $7)`,
    [id, f.tenantId, `J1-${id.slice(0, 8)}`, name, price, extra.generic ?? null, extra.schedule ?? null])
  return id
}
const sale = async (f: Fx, body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...body })))
const line = (itemId: string, name: string, price: number) => ({ cartItems: [{ itemId, name, quantity: 1, unitPrice: price }], paymentMethod: 'cash', subtotal: price, total: price, amountPaid: price })
const rx = { doctorName: 'Dr. N. Perera', prescriptionNo: 'RX-1', prescriptionDate: '2026-10-24' }

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin, 'ph')
    tenants.push(f.tenantId)
    setTestSession(session(f))
    const otc = await newItem(admin, f, 'Panadol 500mg', 50, { generic: 'Paracetamol', schedule: 'otc' })
    const amox = await newItem(admin, f, 'Amoxil 250mg', 120, { generic: 'Amoxicillin', schedule: 'prescription' })
    const diaz = await newItem(admin, f, 'Valium 5mg', 80, { generic: 'Diazepam', schedule: 'controlled' })
    const soap = await newItem(admin, f, 'Lifebuoy soap', 90)

    await step('prescriptions at the sale', async () => {
      const a = await sale(f, line(otc, 'Panadol', 50))
      check('OTC medicine sells without a prescription', a.status === 200, short(a.body))
      const b = await sale(f, line(amox, 'Amoxil', 120))
      check('prescription medicine without a prescription → 400 PRESCRIPTION_REQUIRED', b.status === 400 && b.body.code === 'PRESCRIPTION_REQUIRED' && b.body.level === 'prescription', short(b.body))
      check('the refusal names the medicine', Array.isArray(b.body.items) && b.body.items[0]?.id === amox, short(b.body))
      const c = await sale(f, { ...line(amox, 'Amoxil', 120), prescription: rx })
      check('with the doctor’s details → 200', c.status === 200, short(c.body))
      const row = (await admin.query(`SELECT * FROM prescriptions WHERE sale_id = $1`, [c.body.id])).rows[0]
      check('prescription register row on the sale', row?.doctor_name === 'Dr. N. Perera' && row?.prescription_no === 'RX-1' && row?.has_controlled === false, JSON.stringify(row))
      const d = await sale(f, { ...line(diaz, 'Valium', 80), prescription: rx })
      check('controlled drug without SLMC no. / patient → 400', d.status === 400 && d.body.level === 'controlled', short(d.body))
      const e = await sale(f, { ...line(diaz, 'Valium', 80), prescription: { ...rx, doctorRegNo: 'SLMC 12345', patientName: 'K. Silva' } })
      check('controlled drug with SLMC no. and patient → 200', e.status === 200, short(e.body))
      const er = (await admin.query(`SELECT has_controlled FROM prescriptions WHERE sale_id = $1`, [e.body.id])).rows[0]
      check('register marks it controlled', er?.has_controlled === true)
      const g = await sale(f, { ...line(soap, 'Soap', 90), prescription: rx })
      check('non-medicine with a stray prescription → 200, no register row', g.status === 200 && (await admin.query(`SELECT 1 FROM prescriptions WHERE sale_id = $1`, [g.body.id])).rowCount === 0, short(g.body))
      const off = await sale(f, { ...line(diaz, 'Valium', 80), offlineRef: `OFF-J1-${Date.now()}` })
      check('offline sale of a controlled drug still syncs (already happened)', off.status === 200, short(off.body))
    })

    await step('rx-check, register, generic search, expiry', async () => {
      const r = await json(await rxCheck(req('GET', `/api/pharmacy/rx-check?ids=${otc},${amox},${diaz}`)))
      check('rx-check: strictest level is controlled, lists both medicines', r.body.level === 'controlled' && r.body.items.length === 2, short(r.body))
      const n = await json(await rxCheck(req('GET', `/api/pharmacy/rx-check?ids=${otc},${soap}`)))
      check('rx-check: OTC + soap → none', n.body.level === 'none', short(n.body))
      const all = await json(await register(req('GET', '/api/prescriptions')))
      check('register lists the two prescriptions', all.status === 200 && all.body.pagination.total === 2, short(all.body))
      check('register shows the medicines on the bill', all.body.data.some((p: J) => String(p.medicines || '').includes('Valium')), short(all.body.data))
      const ctl = await json(await register(req('GET', '/api/prescriptions?controlled=1')))
      check('controlled-drug filter', ctl.body.pagination.total === 1, short(ctl.body))
      const q = await json(await register(req('GET', '/api/prescriptions?q=12345')))
      check('search by SLMC no.', q.body.pagination.total === 1, short(q.body))
      const s = await json(await listItems(req('GET', '/api/items?search=amoxicillin')))
      const found = (s.body.data || s.body.items || s.body) as J[]
      check('item search by generic name finds the brand', Array.isArray(found) && found.some((i) => i.id === amox), short(s.body))

      const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
      const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
      const later = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)
      for (const [b, exp, qty] of [['B-SOON', soon, 20], ['B-OLD', past, 5], ['B-LATER', later, 50], ['B-EMPTY', soon, 0]] as const) {
        await admin.query(`INSERT INTO item_batches (tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
          [f.tenantId, amox, b, f.wh, exp, qty])
      }
      const x = await json(await expiryReport(req('GET', '/api/pharmacy/expiry?days=90')))
      const batches = (x.body.data || []).map((d: J) => d.batchNumber)
      check('expiry report: expired and expiring-soon batches, not later or empty ones', x.status === 200 && batches.includes('B-SOON') && batches.includes('B-OLD') && !batches.includes('B-LATER') && !batches.includes('B-EMPTY'), short(x.body))
      check('expired first, with stock value at cost', batches[0] === 'B-OLD' && x.body.summary.expiredBatches === 1 && x.body.summary.expiredValue === 50, short(x.body.summary))
    })

    await step('feature switches on the sale', async () => {
      const setFlags = (flags: Record<string, boolean>) => admin.query(`UPDATE tenants SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{featureFlags}', $2::jsonb) WHERE id = $1`, [f.tenantId, JSON.stringify(flags)])
      await admin.query(`UPDATE customers SET credit_limit = 100000 WHERE id = $1`, [f.customerId]).catch(() => undefined)
      await setFlags({ credit_customer: false, gift_cards: false, loyalty: false, promotions: false })
      const credit = await sale(f, { customerId: f.customerId, cartItems: [{ itemId: soap, name: 'Soap', quantity: 1, unitPrice: 90 }], paymentMethod: 'credit', subtotal: 90, total: 90, amountPaid: 0 })
      check('credit sale with credit sales switched off → 403 FEATURE_DISABLED', credit.status === 403 && credit.body.feature === 'credit_customer', short(credit.body))
      const gift = await sale(f, { ...line(soap, 'Soap', 90), paymentMethod: 'gift_card', giftCardId: randomUUID() })
      check('gift card payment switched off → 403', gift.status === 403 && gift.body.feature === 'gift_cards', short(gift.body))
      const coupon = await sale(f, { ...line(soap, 'Soap', 90), couponCodes: ['SAVE10'] })
      check('coupon with promotions switched off → 403', coupon.status === 403 && coupon.body.feature === 'promotions', short(coupon.body))
      const loyal = await sale(f, { ...line(soap, 'Soap', 90), customerId: f.customerId, loyaltyPointsRedeemed: 10 })
      check('loyalty redemption switched off → 403', loyal.status === 403 && loyal.body.feature === 'loyalty', short(loyal.body))
      const cash = await sale(f, line(soap, 'Soap', 90))
      check('plain cash sale unaffected', cash.status === 200, short(cash.body))
      const offCredit = await sale(f, { customerId: f.customerId, cartItems: [{ itemId: soap, name: 'Soap', quantity: 1, unitPrice: 90 }], paymentMethod: 'credit', subtotal: 90, total: 90, amountPaid: 0, offlineRef: `OFF-J1C-${Date.now()}` })
      check('offline credit sale made before the switch still syncs', offCredit.status !== 403, short(offCredit.body))
      await setFlags({})
    })

    await step('switch catalogue', async () => {
      check('API paths map to their switch', featureForApiPath('/api/layaways') === 'layaways' && featureForApiPath('/api/layaways/abc/complete') === 'layaways'
        && featureForApiPath('/api/items/123/variants') === 'variants' && featureForApiPath('/api/items/123') === null
        && featureForApiPath('/api/accounting/journal-entries') === 'accounting' && featureForApiPath('/api/accounting/tax-templates') === null
        && featureForApiPath('/api/prescriptions') === 'pharmacy' && featureForApiPath('/api/sys-control/vendors') === null && featureForApiPath('/api/sales') === null)
      check('pages map to their switch', featureForHref('/pharmacy/prescriptions') === 'pharmacy' && featureForHref('/quotations?x=1') === 'quotation'
        && featureForHref('/accounting/reports/sales-summary') === null && featureForHref('/accounting/reports/profit-and-loss') === 'accounting')
      check('pharmacy switch only matters to pharmacies', featureAppliesTo('pharmacy', 'pharmacy') && !featureAppliesTo('pharmacy', 'supermarket') && featureAppliesTo('variants', 'supermarket'))
      const n = normalizeFeatureFlags({ quotation: false, bogus: true } as Record<string, boolean>)
      check('unsaved switches keep their defaults; unknown keys dropped', n.quotation === false && n.layaways === true && n.multi_warehouse === false && !('bogus' in n))
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') for (const t of tenants) await cleanup(admin, t)
    await admin.end()
    await closeAllPools()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
