/**
 * M1 — per-vendor feature switches (super admin → vendor → Features) really switch things off.
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   NEXTAUTH_SECRET=ci-test-secret-not-for-production \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/m1-feature-switches.ts
 *
 * Catalogue (no DB), for EVERY switch: off → its menu links and module tab are filtered out
 * (nav-gate, as Navbar / ModuleSidebar / ModuleWorkspace use it), its pages are blocked
 * (pageBlockedByFeature, as FeatureRouteGuard uses it) and its API paths map to it
 * (featuresForApiPath, as the proxy uses it); basic reports, read-only accounting masters and the
 * shared employee list stay where they should; industry switches follow the business type.
 * Live (real route handlers on a throw-away tenant): the proxy answers 403 FEATURE_DISABLED (its
 * internal /api/features/check call routed to the real handler); /api/features returns the
 * effective switches; loyalty earn, gift-card items, price lists and promotions on the sale /
 * quote / offline bundle; scale labels; extra warehouses; fingerprint devices.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenant } from '@/lib/db'
import { POST as postSale } from '@/app/api/sales/route'
import { GET as getFeatures } from '@/app/api/features/route'
import { GET as checkFeature } from '@/app/api/features/check/route'
import { GET as barcodeLookup } from '@/app/api/items/barcode-lookup/route'
import { POST as createWarehouse } from '@/app/api/warehouses/route'
import { GET as iclockPing } from '@/app/iclock/ping/route'
import { invalidateIclockDevice } from '@/lib/attendance/iclock-server'
import { quoteCart, loadPricingBundle } from '@/lib/pricing/load-context'
import { gtinCheckDigit } from '@/lib/inventory/barcode-parse'
import { proxy } from '@/proxy'
import {
  FEATURE_DEFS, FEATURE_FLAGS, DEFAULT_VENDOR_FEATURE_FLAGS, effectiveFeatureFlags, featuresForApiPath, featureForApiPath,
  featuresForHref, isTypeScopedFeature, type FeatureFlag, type FeatureFlagsMap,
} from '@/lib/features/flags'
import { isHrefAllowedByFeatures, isModuleAllowedByFeatures, pageBlockedByFeature } from '@/lib/features/nav-gate'
import { MODULE_TABS, getModuleSidebar } from '@/lib/navigation/module-sidebar'

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

const allOn = (): FeatureFlagsMap => Object.fromEntries(FEATURE_FLAGS.map((k) => [k, true])) as FeatureFlagsMap
const onlyOff = (...keys: FeatureFlag[]): FeatureFlagsMap => ({ ...allOn(), ...Object.fromEntries(keys.map((k) => [k, false])) })
/** API paths a rule stands for: '/api/x' itself; a RegExp gets a sample path */
const samplePath = (rule: string | RegExp) => (typeof rule === 'string' ? `${rule}/sample-id` : (rule.source.includes('items') ? `/api/items/abc/${rule.source.match(/\/(variants|batches|serial-numbers)/)?.[1]}` : ''))

function session(f: Fx, businessType = 'retail') {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'M1', businessType,
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })
}
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 300)

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `m1-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, 'M1 shop', $2, $3, 'retail')`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Kamal Silva')`, [f.customerId, tenantId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, extra: { giftCard?: boolean; plu?: string } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, is_gift_card, plu_code)
     VALUES ($1, $2, $3, $4, 10, $5, false, $6, $7)`,
    [id, f.tenantId, `M1-${id.slice(0, 8)}`, name, price, !!extra.giftCard, extra.plu ?? null])
  return id
}

// ------------------------------------------------------------------------------------------------
// Catalogue: every switch, no DB
// ------------------------------------------------------------------------------------------------
function catalogue() {
  const types = ['retail', 'supermarket', 'pharmacy', 'restaurant', 'auto_service', 'dealership', 'electronics', 'hardware', 'print_studio', 'office', 'textile']
  for (const d of FEATURE_DEFS) {
    const off = onlyOff(d.key)
    // menus: every sidebar link of this switch, for every business type, is filtered out
    let links = 0
    let leaked: string[] = []
    for (const bt of types) {
      for (const tab of MODULE_TABS) {
        for (const sec of getModuleSidebar(tab.key, bt, 'owner')) {
          for (const item of sec.items) {
            const keys = featuresForHref(item.href)
            if (keys.length !== 1 || keys[0] !== d.key) continue
            links++
            if (isHrefAllowedByFeatures(item.href, off) || !isHrefAllowedByFeatures(item.href, allOn())) leaked.push(`${bt}:${item.href}`)
          }
        }
      }
    }
    leaked = [...new Set(leaked)]
    check(`${d.key}: off → its ${links} menu link(s) filtered out, on → shown`, leaked.length === 0, leaked.join(', '))
    for (const m of d.modules || []) {
      const others = FEATURE_DEFS.filter((o) => o.key !== d.key && o.modules?.includes(m)).map((o) => o.key)
      check(`${d.key}: off → module tab "${m}" hidden${others.length ? ` (with ${others.join(', ')} off too)` : ''}`,
        !isModuleAllowedByFeatures(m, onlyOff(d.key, ...others)) && isModuleAllowedByFeatures(m, allOn()))
      const landing = MODULE_TABS.find((t) => t.key === m)?.href
      if (landing) check(`${d.key}: off → module landing ${landing} blocked`, pageBlockedByFeature(landing, onlyOff(d.key, ...others)) !== null && pageBlockedByFeature(landing, allOn()) === null)
    }
    // pages
    // (a module landing such as /hr follows all of the module's switches: checked with the modules above)
    const isLanding = (h: string) => MODULE_TABS.some((t) => t.href === h)
    const pageLeaks = (d.hrefs || []).filter((h) => pageBlockedByFeature(`${h}/x`, off) !== d.key
      || (!isLanding(h) && pageBlockedByFeature(h, off) !== d.key) || pageBlockedByFeature(h, allOn()) !== null)
    if (d.hrefs?.length) check(`${d.key}: off → its ${d.hrefs.length} page(s) blocked (also by URL), on → open`, pageLeaks.length === 0, pageLeaks.join(', '))
    // API (as the proxy decides)
    const apiLeaks = (d.api || []).map(samplePath).filter((p) => p && featureForApiPath(p, 'GET') !== d.key && featureForApiPath(p, 'POST') !== d.key)
    if (d.api?.length) check(`${d.key}: its ${d.api.length} API area(s) map to the switch (403 when off)`, apiLeaks.length === 0, apiLeaks.join(', '))
    const writeLeaks = (d.apiWrite || []).map(samplePath).filter((p) => featureForApiPath(p, 'POST') !== d.key || featureForApiPath(p, 'DELETE') !== d.key || featureForApiPath(p, 'GET') !== null)
    if (d.apiWrite?.length) check(`${d.key}: changes refused, reads kept for ${d.apiWrite.length} API area(s)`, writeLeaks.length === 0, writeLeaks.join(', '))
  }

  // basic reports stay with advanced reports off; advanced ones go
  const noAdv = onlyOff('advanced_reports')
  check('advanced reports off: daily sales, sales summary, payment collection, stock balance, tax reports and the till’s daily summary stay',
    ['/accounting/reports/daily-sales', '/accounting/reports/sales-summary', '/accounting/reports/payment-collection', '/accounting/reports/stock-balance',
      '/accounting/reports/tax-report', '/accounting/reports/vat-schedule', '/pos/daily-summary'].every((p) => pageBlockedByFeature(p, noAdv) === null)
    && ['/api/reports/daily-sales', '/api/reports/sales-summary', '/api/reports/payment-collection', '/api/reports/stock-balance', '/api/reports/tax-report', '/api/reports/tax-vat-schedule', '/api/reports/reorder-suggestions']
      .every((p) => featuresForApiPath(p).length === 0))
  check('advanced reports off: analysis reports and their API blocked',
    ['/accounting/reports/sales-by-item', '/accounting/reports/margin-analysis', '/accounting/reports/peak-hours', '/reports', '/reports/staff-performance'].every((p) => pageBlockedByFeature(p, noAdv) === 'advanced_reports')
    && ['/api/reports/sales-by-item', '/api/reports/margin-analysis', '/api/reports/staff-performance', '/api/reports/aged-payables'].every((p) => featureForApiPath(p) === 'advanced_reports'))

  // accounting: whole module incl. its landing page; reads the POS needs stay
  const noAcc = onlyOff('accounting')
  check('accounting off: /accounting, opening balances, period closing, audit, settings, tax templates, modes of payment, payment terms, dunning types, AR / AP blocked',
    ['/accounting', '/accounting/opening-balances', '/accounting/period-closing', '/accounting/audit', '/accounting/settings', '/accounting/tax-templates',
      '/accounting/modes-of-payment', '/accounting/payment-terms', '/accounting/dunning-types', '/accounting/reports/accounts-receivable', '/accounting/reports/accounts-payable']
      .every((p) => pageBlockedByFeature(p, noAcc) === 'accounting'))
  check('accounting off: POS / items still READ tax templates, modes of payment, payment terms, accounting settings; changes refused',
    ['/api/accounting/tax-templates', '/api/accounting/modes-of-payment', '/api/accounting/payment-terms-templates', '/api/accounting/settings'].every((p) => featuresForApiPath(p, 'GET').length === 0 && featureForApiPath(p, 'PUT') === 'accounting' && featureForApiPath(`${p}/1`, 'DELETE') === 'accounting'))
  check('accounting off: AR / AP, audit, setup, day book and GL report APIs refused',
    ['/api/accounting/reports/accounts-receivable', '/api/accounting/reports/accounts-payable', '/api/accounting/audit', '/api/accounting/setup', '/api/reports/day-book', '/api/reports/general-ledger'].every((p) => featureForApiPath(p) === 'accounting'))
  check('accounting off: cheques / e-invoicing / sales reports / expenses keep their own rules',
    pageBlockedByFeature('/accounting/cheques', noAcc) === null && pageBlockedByFeature('/accounting/e-invoicing', noAcc) === null
    && pageBlockedByFeature('/accounting/reports/daily-sales', noAcc) === null && pageBlockedByFeature('/accounting/expenses', noAcc) === null)

  // HR: two switches share the module and the employee list
  const payOff = onlyOff('hr_payroll')
  check('payroll off, attendance on: HR tab + landing + employees + attendance stay; salary pages and API go',
    isModuleAllowedByFeatures('hr', payOff) && pageBlockedByFeature('/hr', payOff) === null && pageBlockedByFeature('/hr/employees', payOff) === null
    && pageBlockedByFeature('/hr/attendance', payOff) === null && pageBlockedByFeature('/hr/salary-slips', payOff) === 'hr_payroll'
    && featuresForApiPath('/api/employee-profiles').length === 2 && featureForApiPath('/api/hr/salary-components/standard', 'POST') === 'hr_payroll')
  const hrOff = onlyOff('hr_payroll', 'hr_attendance')
  check('both HR switches off: HR tab, employees and their API go', !isModuleAllowedByFeatures('hr', hrOff) && pageBlockedByFeature('/hr/employees', hrOff) !== null
    && !isHrefAllowedByFeatures('/hr/employees', hrOff) && featureForApiPath('/api/hr/settings') === 'hr_attendance')
  check('purchase off: buying pages incl. GRN go; stock intake and purchase invoices (basic stock-in) stay',
    pageBlockedByFeature('/buying/grn', onlyOff('purchase')) === 'purchase' && pageBlockedByFeature('/inventory/stock-intake', onlyOff('purchase')) === null
    && featuresForApiPath('/api/stock-intake', 'POST').length === 0 && featuresForApiPath('/api/purchases', 'POST').length === 0)

  // business type
  const sm = effectiveFeatureFlags({}, 'supermarket')
  const el = effectiveFeatureFlags({}, 'electronics')
  check('industry switches count as off for other business types (as the POS does)', !sm.installments && !sm.warranty_claims && !sm.print_jobs && !sm.pharmacy && sm.deliveries
    && el.installments && el.warranty_claims && !el.pharmacy && !effectiveFeatureFlags({}, 'retail').appointments)
  check('customer display and the weighing scale are not type-scoped (the POS offers them to every type)',
    !isTypeScopedFeature('customer_display') && !isTypeScopedFeature('weighing_scale') && el.customer_display && effectiveFeatureFlags({}, 'hardware').weighing_scale)
  check('a saved "off" stays off; unsaved keys run at the global default (live vendors keep what they had)',
    effectiveFeatureFlags({ loyalty: false }, 'retail').loyalty === false && effectiveFeatureFlags({}, 'retail').loyalty === DEFAULT_VENDOR_FEATURE_FLAGS.loyalty
    && effectiveFeatureFlags(null, 'retail').multi_warehouse === DEFAULT_VENDOR_FEATURE_FLAGS.multi_warehouse)
}

async function main() {
  catalogue()

  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  const serial = `M1T${randomUUID().slice(0, 8).toUpperCase()}`
  try {
    const f = await makeTenant(admin)
    tenants.push(f.tenantId)
    setTestSession(session(f))
    const setFlags = async (flags: Record<string, boolean>) => {
      await admin.query(`UPDATE tenants SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{featureFlags}', $2::jsonb) WHERE id = $1`, [f.tenantId, JSON.stringify(flags)])
    }
    const sale = async (body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...body })))
    const line = (itemId: string, price: number, extra: Record<string, unknown> = {}) => ({ cartItems: [{ itemId, name: 'Item', quantity: 1, unitPrice: price }], paymentMethod: 'cash', subtotal: price, total: price, amountPaid: price, ...extra })

    await step('proxy + /api/features', async () => {
      // The proxy asks /api/features/check over HTTP: route that call to the real handler
      process.env.NEXTAUTH_URL_INTERNAL = 'http://feature-check.test'
      const realFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input instanceof Request ? input.url : input)
        if (u.startsWith('http://feature-check.test/')) return checkFeature(new NextRequest(u, { headers: init?.headers }))
        return realFetch(input, init)
      }) as typeof fetch
      try {
        let n = 0
        const viaProxy = async (method: string, path: string) => json(await proxy(req(method, path, undefined, { authorization: `Bearer m1-${n++}` })))
        await setFlags({ loyalty: false, accounting: false, hr_payroll: false })
        const a = await viaProxy('GET', '/api/loyalty-programs')
        check('proxy: loyalty off → GET /api/loyalty-programs 403 FEATURE_DISABLED', a.status === 403 && a.body.code === 'FEATURE_DISABLED' && a.body.feature === 'loyalty', short(a.body))
        const b = await viaProxy('GET', '/api/accounting/tax-templates')
        check('proxy: accounting off → reading tax templates still passes', b.status === 200, short(b.body))
        const c = await viaProxy('POST', '/api/accounting/tax-templates')
        check('proxy: accounting off → creating a tax template 403', c.status === 403 && c.body.feature === 'accounting', short(c.body))
        const d = await viaProxy('GET', '/api/employee-profiles')
        check('proxy: payroll off but attendance on → employee list passes', d.status === 200, short(d.body))
        const e = await viaProxy('GET', '/api/salary-slips')
        check('proxy: payroll off → salary slips 403', e.status === 403 && e.body.feature === 'hr_payroll', short(e.body))
        const g = await viaProxy('GET', '/api/reports/daily-sales')
        check('proxy: unswitched API (daily sales) passes', g.status === 200, short(g.body))
        await setFlags({ loyalty: true })
        const h = await viaProxy('GET', '/api/loyalty-programs')
        check('proxy: switched back on → passes', h.status === 200, short(h.body))

        await admin.query(`UPDATE tenants SET business_type = 'supermarket' WHERE id = $1`, [f.tenantId])
        setTestSession(session(f, 'supermarket'))
        const i = await viaProxy('GET', '/api/installments')
        check('proxy: hire purchase for a supermarket (not its type) → 403', i.status === 403 && i.body.feature === 'installments', short(i.body))
        const fl = await json(await getFeatures())
        check('/api/features returns the effective switches (type-scoped off, others as saved)', fl.status === 200 && fl.body.flags.installments === false && fl.body.flags.deliveries === true && fl.body.flags.loyalty === true, short(fl.body))
        await admin.query(`UPDATE tenants SET business_type = 'retail' WHERE id = $1`, [f.tenantId])
        setTestSession(session(f))
        const bad = await json(await checkFeature(req('GET', '/api/features/check?flags=loyalty,bogus')))
        check('/api/features/check refuses unknown switches', bad.status === 400)
      } finally {
        globalThis.fetch = realFetch
      }
      await setFlags({})
    })

    await step('loyalty: no points earned while off', async () => {
      await admin.query(`INSERT INTO loyalty_programs (tenant_id, name, collection_factor, status) VALUES ($1, 'Points', 1, 'active')`, [f.tenantId])
      const soap = await newItem(admin, f, 'Soap', 100)
      const on = await sale(line(soap, 100, { customerId: f.customerId }))
      const earnedOn = (await admin.query(`SELECT COALESCE(sum(points),0)::int p FROM loyalty_transactions WHERE sale_id = $1 AND type = 'earn'`, [on.body.id])).rows[0].p
      check('loyalty on → a customer sale earns points', on.status === 200 && earnedOn === 100, `${on.status} ${earnedOn} ${short(on.body)}`)
      await setFlags({ loyalty: false })
      const before = (await admin.query(`SELECT loyalty_points FROM customers WHERE id = $1`, [f.customerId])).rows[0].loyalty_points
      const off = await sale(line(soap, 100, { customerId: f.customerId }))
      const earnedOff = (await admin.query(`SELECT count(*)::int n FROM loyalty_transactions WHERE sale_id = $1 AND type = 'earn'`, [off.body.id])).rows[0].n
      const after = (await admin.query(`SELECT loyalty_points FROM customers WHERE id = $1`, [f.customerId])).rows[0].loyalty_points
      check('loyalty off → the sale goes through but earns nothing', off.status === 200 && earnedOff === 0 && after === before, `${off.status} ${earnedOff} ${before}→${after}`)
      await setFlags({})
    })

    await step('gift cards: gift-card items not sold while off', async () => {
      const card = await newItem(admin, f, 'Gift card 1000', 1000, { giftCard: true })
      await setFlags({ gift_cards: false })
      const off = await sale(line(card, 1000))
      check('gift cards off → selling a gift-card item 403', off.status === 403 && off.body.feature === 'gift_cards', short(off.body))
      const offline = await sale(line(card, 1000, { offlineRef: `OFF-M1-${Date.now()}` }))
      check('an offline gift-card sale made before the switch still syncs', offline.status === 200, short(offline.body))
      await setFlags({})
      const on = await sale(line(card, 1000))
      check('gift cards on → sold, card issued', on.status === 200 && (on.body.generatedGiftCards?.length ?? 0) === 1, short(on.body))
    })

    await step('price lists and promotions', async () => {
      const tea = await newItem(admin, f, 'Tea 100g', 100)
      const rice = await newItem(admin, f, 'Rice 1kg', 200)
      const pl = randomUUID()
      await admin.query(`INSERT INTO price_lists (id, tenant_id, name, applies_to) VALUES ($1, $2, 'Everyone', 'all')`, [pl, f.tenantId])
      await admin.query(`INSERT INTO price_list_items (tenant_id, price_list_id, item_id, price) VALUES ($1, $2, $3, 80)`, [f.tenantId, pl, tea])
      await admin.query(`INSERT INTO promotions (tenant_id, name, type, apply_to, discount_type, value, item_ids) VALUES ($1, '10% rice', 'percent_off', 'items', 'percent', 10, ARRAY[$2]::uuid[])`, [f.tenantId, rice])
      const quote = () => withTenant(f.tenantId, (db) => quoteCart(db, f.tenantId, { lines: [{ itemId: tea, quantity: 1 }, { itemId: rice, quantity: 1 }] }))
      const q1 = await quote()
      check('on: the price list prices tea at 80 and the promotion takes 10% off rice', q1.lines[0].unitPrice === 80 && q1.lines[0].priceListId === pl && q1.lines[1].promotionDiscount === 20, short(q1.lines))
      const stale = await sale(line(tea, 100))
      check('on: a sale at the catalog price where a price list applies → 409 PRICE_CHANGED', stale.status === 409 && stale.body.code === 'PRICE_CHANGED', short(stale.body))

      await setFlags({ price_lists: false, promotions: false })
      const q2 = await quote()
      check('off: quote at the catalog price, no promotion', q2.lines[0].unitPrice === 100 && q2.lines[0].priceListId === null && q2.lines[1].promotionDiscount === 0 && q2.totals.totalDiscount === 0, short(q2.lines))
      const ok = await sale(line(tea, 100))
      check('off: a sale at the catalog price goes through (no price list applied)', ok.status === 200, short(ok.body))
      const row = (await admin.query(`SELECT price_list_id, promotion_discount::float pd FROM sale_items WHERE sale_id = $1`, [ok.body.id])).rows[0]
      check('off: the sale line has no price list / promotion', row && row.price_list_id === null && Number(row.pd) === 0, JSON.stringify(row))
      const riceSale = await sale(line(rice, 200))
      const rs = (await admin.query(`SELECT promotion_discount::float pd, total::float t FROM sales WHERE id = $1`, [riceSale.body.id])).rows[0]
      check('off: rice sells at 200 with no automatic promotion', riceSale.status === 200 && Number(rs?.pd) === 0 && Number(rs?.t) === 200, short(riceSale.body) + JSON.stringify(rs))
      const bundle = await withTenant(f.tenantId, (db) => loadPricingBundle(db, f.tenantId))
      check('off: the offline / app pricing bundle carries no price lists or promotions', bundle.priceLists.length === 0 && bundle.promotions.length === 0)
      await setFlags({})
      const bundleOn = await withTenant(f.tenantId, (db) => loadPricingBundle(db, f.tenantId))
      check('on: the bundle carries them again', bundleOn.priceLists.length === 1 && bundleOn.promotions.length === 1)
    })

    await step('weighing scale labels', async () => {
      await newItem(admin, f, 'Carrots (kg)', 400, { plu: '12345' })
      const base = '201234501500'
      const code = `${base}${gtinCheckDigit(base)}`
      const look = async () => json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=${code}&warehouseId=${f.wh}`)))
      const on = await look()
      check('scale on → the label is read (1.5 kg)', on.status === 200 && on.body.scan?.quantity === 1.5, short(on.body))
      await setFlags({ weighing_scale: false })
      const off = await look()
      check('scale off → the label is not read as weight / price', !(off.status === 200 && off.body.scan?.quantity === 1.5), short(off.body))
      await setFlags({})
    })

    await step('multiple branches', async () => {
      const body = (code: string) => ({ name: `Branch ${code}`, code })
      const off = await json(await createWarehouse(req('POST', '/api/warehouses', body('B2'))))
      check('multi-branch off (default), one branch → adding a second 403', off.status === 403 && off.body.feature === 'multi_warehouse', short(off.body))
      await setFlags({ multi_warehouse: true })
      const on = await json(await createWarehouse(req('POST', '/api/warehouses', body('B3'))))
      check('multi-branch on → added', on.status === 201 || on.status === 200, short(on.body))
      await setFlags({})
      const legacy = await json(await createWarehouse(req('POST', '/api/warehouses', body('B4'))))
      check('a business already running several branches is not cut off when the switch is off', legacy.status === 201 || legacy.status === 200, short(legacy.body))
    })

    await step('fingerprint devices', async () => {
      await admin.query(`INSERT INTO attendance_devices (tenant_id, name, serial_number) VALUES ($1, 'Door', $2)`, [f.tenantId, serial])
      const ping = async () => {
        invalidateIclockDevice()
        const res = await iclockPing(new NextRequest(`http://localhost/iclock/ping?SN=${serial}`, { headers: { 'x-forwarded-for': '203.0.113.9' } }))
        return { status: res.status, text: await res.text() }
      }
      const on = await ping()
      check('attendance on → device answered OK', on.status === 200, `${on.status} ${on.text}`)
      await setFlags({ hr_attendance: false })
      const off = await ping()
      check('attendance off → device refused with a plain-text 403 (keeps its punches)', off.status === 403 && off.text.startsWith('ERROR'), `${off.status} ${off.text}`)
      await setFlags({})
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') for (const t of tenants) await cleanup(admin, t)
    await admin.query(`DELETE FROM attendance_pending_devices WHERE serial_number = $1`, [serial]).catch(() => undefined)
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
