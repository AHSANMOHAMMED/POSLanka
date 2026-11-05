/**
 * O1 — mall / multi-shop business type (drizzle/0195, 0196; src/lib/business-types):
 *   1. pure helpers: every ordinary business type gets exactly the same feature presets, effective
 *      switches, roles, permission categories and landing pages as before (old logic inlined here);
 *      a mall gets the union of its segments; the app's copy of scope.ts is identical
 *   2. super admin creates a mall with segments (validation: no segments / unknown segment → 400)
 *   3. an existing supermarket WITH data (items, stock, sales, customers, staff, POS profiles,
 *      settings) is changed to mall [supermarket, textile, electronics, restaurant]: no row of any
 *      tenant table disappears (only seed tables grow), same tenant id / Business ID, switches only
 *      turned on, staff still sign in, a sale still works, a food-court counter is accepted
 *   4. mall → supermarket keeps everything; non-admin 403
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/o1-mall.ts
 *
 * Calls the real route handlers (auth mocked) on throw-away vendors; removed at the end unless
 * KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { clearBranchScopeCache } from '@/lib/auth/branch-access'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as getVendor } from '@/app/api/sys-control/vendors/[id]/route'
import { PUT as changeType } from '@/app/api/sys-control/vendors/[id]/business-type/route'
import { GET as getFeatures } from '@/app/api/features/route'
import { POST as mobileLogin } from '@/app/api/auth/mobile-login/route'
import { POST as postSale } from '@/app/api/sales/route'
import { POST as openShift } from '@/app/api/pos-opening-entries/route'
import { POST as createProfile } from '@/app/api/pos-profiles/route'
import { PUT as updateProfile } from '@/app/api/pos-profiles/[id]/route'
import {
  BUSINESS_TYPE_FEATURE_PRESETS,
  DEFAULT_VENDOR_FEATURE_FLAGS,
  FEATURE_FLAGS,
  defaultFeatureFlagsForBusinessType,
  effectiveFeatureFlags,
  featureAppliesTo,
  getFeatureDef,
  isTypeScopedFeature,
  normalizeFeatureFlags,
  type FeatureFlag,
  type FeatureFlagsMap,
} from '@/lib/features/flags'
import { BUSINESS_TYPE_CATEGORIES, BUSINESS_TYPE_ROLES, getCategoriesForBusinessType, getRolesForBusinessType, PERMISSION_CATEGORIES, type UserRole } from '@/lib/auth/roles'
import { landingPathForRole } from '@/lib/auth/landing'
import { getTerms } from '@/lib/terminology'
import { getChartOfAccountsForBusinessType, walkAccountTemplates } from '@/lib/accounting/default-coa'
import { planFeatureChange } from '@/lib/business-types/change-type'
import { SEGMENT_TYPES, primaryBusinessType, tillBusinessType } from '@/lib/business-types/scope'
import { getSessionValidation, sessionValidationKey, setSessionValidation } from '@/lib/auth/session-validation-cache'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.47.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
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

// ---------------------------------------------------------------- the logic before the mall type
const ORDINARY_TYPES = ['retail', 'restaurant', 'supermarket', 'auto_service', 'dealership', 'pharmacy', 'electronics', 'hardware', 'print_studio', 'office', 'textile']
const ALL_ROLES: UserRole[] = ['owner', 'manager', 'system_manager', 'accounts_manager', 'sales_manager', 'purchase_manager', 'hr_manager', 'stock_manager', 'cashier', 'technician', 'chef', 'waiter', 'pos_user', 'report_user', 'dealer_sales']
const oldApplies = (flag: FeatureFlag, bt: string | null | undefined) => {
  const types = getFeatureDef(flag)?.businessTypes
  return !types || !bt || types.includes(bt)
}
const oldEffective = (input: Partial<Record<string, boolean>> | null, bt: string) => {
  const flags = normalizeFeatureFlags(input)
  for (const key of FEATURE_FLAGS) if (flags[key] && isTypeScopedFeature(key) && !oldApplies(key, bt)) flags[key] = false
  return flags
}
const oldDefault = (bt: string) => ({ ...DEFAULT_VENDOR_FEATURE_FLAGS, ...(BUSINESS_TYPE_FEATURE_PRESETS[bt] || {}) })
const oldRoles = (bt: string) => {
  const specific = new Set(Object.values(BUSINESS_TYPE_ROLES).flat())
  const allowed = new Set(BUSINESS_TYPE_ROLES[bt] || [])
  return ALL_ROLES.filter((r) => !specific.has(r) || allowed.has(r))
}
const oldCategories = (bt: string) => {
  const specific = new Set(Object.values(BUSINESS_TYPE_CATEGORIES).flat())
  const allowed = new Set(BUSINESS_TYPE_CATEGORIES[bt] || [])
  return Object.keys(PERMISSION_CATEGORIES).filter((c) => !specific.has(c) || allowed.has(c))
}
const oldLanding = (role: string, bt: string) => {
  switch (role) {
    case 'cashier': case 'pos_user': return '/pos'
    case 'waiter': return bt === 'restaurant' ? '/restaurant/orders' : '/pos'
    case 'chef': return bt === 'restaurant' ? '/restaurant/kitchen' : '/dashboard'
    case 'technician':
      if (bt === 'auto_service' || bt === 'dealership') return '/work-orders'
      if (bt === 'electronics' || bt === 'textile') return '/service-jobs'
      if (bt === 'print_studio') return '/print-jobs'
      return '/dashboard'
    case 'dealer_sales': return bt === 'dealership' ? '/dealership/sales' : '/pos'
    case 'stock_manager': return '/items'
    case 'purchase_manager': return '/purchase-orders'
    case 'accounts_manager': return '/accounting'
    case 'hr_manager': return '/hr'
    case 'report_user': return '/reports'
    case 'sales_manager': return '/selling'
    default: return '/dashboard'
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Tables only seeding may grow on a type change
// Logs written in the background by earlier requests (sale activity log, storage usage deltas)
const LOG_TABLES = new Set(['activity_logs', 'tenant_usage_deltas'])
const SEED_TABLES = new Set(['categories', 'chart_of_accounts', 'cancellation_reasons', 'units', 'vehicle_types', 'inspection_templates', 'inspection_categories', 'inspection_checklist_items', 'insurance_companies'])

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const adminIds: string[] = []
  const makeAdmin = async (role: string) => {
    const id = randomUUID()
    const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'O1 Admin', $3)`, [id, `o1-${role}-${tag}@example.test`, role])
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    adminIds.push(id)
    return token
  }
  const ownerToken = await makeAdmin('owner')
  const viewerToken = await makeAdmin('viewer')

  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const tier = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-')) ?? tiers[0]

  let n = 0
  const vendorBody = (businessType: string, extra: Record<string, unknown> = {}) => {
    n++
    return {
      name: `O1 Shop ${n} ${tag}`, slug: `o1-shop-${n}-${tag}`, email: `o1-shop-${n}-${tag}@example.test`,
      phone: `+9477${String(Date.now() + n).slice(-7)}`, address: 'Colombo', businessType,
      ...(tier ? { tierId: tier.id } : {}), billingCycle: 'monthly', ownerName: 'O1 Owner', ownerEmail: `o1-owner-${n}-${tag}@example.test`, ownerPassword: 'Owner@12345',
      ...extra,
    }
  }
  const create = async (businessType: string, extra: Record<string, unknown> = {}) => {
    setTestCookie('admin_session', ownerToken)
    const body = vendorBody(businessType, extra)
    const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', body)))
    if (res.status === 200) tenantIds.push(res.body.vendor.id)
    return { ...res, slug: body.slug }
  }
  const change = async (id: string, body: unknown, token = ownerToken) => {
    setTestCookie('admin_session', token)
    return json(await changeType(req('PUT', `/api/sys-control/vendors/${id}/business-type`, body), ctx(id)))
  }
  const savedFlags = async (id: string) => (await pg.query(`SELECT settings->'featureFlags' f FROM tenants WHERE id = $1`, [id])).rows[0].f as Record<string, boolean>
  const tenantTables = (await pg.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' ORDER BY 1`,
  )).rows.map((r) => r.table_name as string)
  const counts = async (tenantId: string) => {
    const out: Record<string, number> = {}
    for (const t of tenantTables) out[t] = (await pg.query(`SELECT count(*)::int n FROM "${t}" WHERE tenant_id = $1`, [tenantId])).rows[0].n
    return out
  }
  const compareCounts = (before: Record<string, number>, after: Record<string, number>) => {
    const lost = Object.keys(before).filter((t) => (after[t] ?? 0) < before[t])
    const grew = Object.keys(before).filter((t) => (after[t] ?? 0) > before[t] && !LOG_TABLES.has(t))
    return { lost, grew, unexpected: grew.filter((t) => !SEED_TABLES.has(t)) }
  }

  try {
    // ======================================================== 1. pure helpers
    await step('pure helpers', async () => {
      const appCopy = readFileSync(join(process.cwd(), 'apps/mobile/src/lib/businessScope.ts'), 'utf8')
      const source = readFileSync(join(process.cwd(), 'src/lib/business-types/scope.ts'), 'utf8')
      const body = (s: string) => s.slice(s.indexOf('export const MALL'))
      check('app copy of scope.ts (apps/mobile/src/lib/businessScope.ts) is identical below its header', body(appCopy) === body(source) && body(source).length > 500)

      const diffs: string[] = []
      const saved = { installments: true, pharmacy: true, print_jobs: true, service_jobs: true, deliveries: true, loyalty: false, weighing_scale: true }
      for (const bt of ORDINARY_TYPES) {
        if (!same(defaultFeatureFlagsForBusinessType(bt), oldDefault(bt))) diffs.push(`preset ${bt}`)
        for (const k of FEATURE_FLAGS) if (featureAppliesTo(k, bt) !== oldApplies(k, bt)) diffs.push(`applies ${k} ${bt}`)
        if (!same(effectiveFeatureFlags(saved, bt), oldEffective(saved, bt))) diffs.push(`effective ${bt}`)
        if (!same(effectiveFeatureFlags(null, bt), oldEffective(null, bt))) diffs.push(`effective(null) ${bt}`)
        if (!same(getRolesForBusinessType(bt), oldRoles(bt))) diffs.push(`roles ${bt}`)
        if (!same(Object.keys(getCategoriesForBusinessType(bt)), oldCategories(bt))) diffs.push(`perm categories ${bt}`)
        for (const r of ALL_ROLES) if (landingPathForRole(r, bt) !== oldLanding(r, bt)) diffs.push(`landing ${r} ${bt}`)
        if (getTerms(bt) !== getTerms({ businessType: bt, businessSegments: null })) diffs.push(`terms ${bt}`)
        if (!same(getChartOfAccountsForBusinessType(bt), getChartOfAccountsForBusinessType([bt]))) diffs.push(`coa ${bt}`)
      }
      check('ordinary types: presets, applicability, effective switches, roles, landing, terms exactly as before', diffs.length === 0, diffs)
      check('no business type → switches unfiltered, all roles', same(effectiveFeatureFlags(saved, null), normalizeFeatureFlags(saved)) && featureAppliesTo('pharmacy', null))

      const mall = { businessType: 'mall', businessSegments: ['supermarket', 'electronics', 'restaurant'] }
      const preset = defaultFeatureFlagsForBusinessType(mall)
      const anyOn = (k: FeatureFlag) => mall.businessSegments.some((t) => oldDefault(t)[k])
      check('mall preset: a switch is off only when off for ALL segments', FEATURE_FLAGS.every((k) => preset[k] === anyOn(k)) && preset.installments && !preset.print_jobs, preset)
      check('mall applicability = union (installments yes via electronics, pharmacy/print jobs no)',
        featureAppliesTo('installments', mall) && featureAppliesTo('customer_display', mall) && !featureAppliesTo('pharmacy', mall) && !featureAppliesTo('print_jobs', mall))
      const eff = effectiveFeatureFlags({ ...DEFAULT_VENDOR_FEATURE_FLAGS }, mall)
      check('mall effective switches: pharmacy off, warranty claims on', !eff.pharmacy && eff.warranty_claims && eff.installments)
      const roles = getRolesForBusinessType(mall)
      check('mall roles = union: chef, waiter, technician; no dealer sales', roles.includes('chef') && roles.includes('waiter') && roles.includes('technician') && !roles.includes('dealer_sales'), roles)
      check('mall permission categories include Restaurant, not Auto Service', 'Restaurant' in getCategoriesForBusinessType(mall) && !('Auto Service' in getCategoriesForBusinessType(mall)))
      check('mall landing: chef → kitchen, waiter → restaurant orders, technician → service jobs, cashier → POS',
        landingPathForRole('chef', mall) === '/restaurant/kitchen' && landingPathForRole('waiter', mall) === '/restaurant/orders'
        && landingPathForRole('technician', mall) === '/service-jobs' && landingPathForRole('cashier', mall) === '/pos')
      check('mall without restaurant: chef → dashboard', landingPathForRole('chef', { businessType: 'mall', businessSegments: ['supermarket', 'textile'] }) === '/dashboard')
      check('mall terms = primary type (supermarket) terms', getTerms(mall) === getTerms('supermarket') && primaryBusinessType(mall) === 'supermarket')
      check('till: food-court counter → restaurant, other counters → supermarket, foreign segment ignored',
        tillBusinessType(mall, 'restaurant') === 'restaurant' && tillBusinessType(mall, null) === 'supermarket' && tillBusinessType(mall, 'pharmacy') === 'supermarket')

      const coa = getChartOfAccountsForBusinessType(mall)
      const nums: string[] = []
      const names: string[] = []
      walkAccountTemplates(coa, (a) => { nums.push(a.accountNumber); names.push(a.name) })
      check('mall chart: union of accounts, no duplicate numbers or names',
        new Set(nums).size === nums.length && new Set(names).size === names.length
        && names.includes('Dine-In Revenue') && names.includes('Hire Purchase Interest Income') && names.includes('Online Sales Revenue') && names.includes('Cold Storage'), { nums, names })

      const plan = planFeatureChange(oldDefault('supermarket'), 'supermarket', mall)
      check('type change plan: supermarket → mall turns on installments, warranty, service jobs; never print jobs',
        plan.turnOn.includes('installments') && plan.turnOn.includes('warranty_claims') && plan.turnOn.includes('service_jobs') && !plan.turnOn.includes('print_jobs'), plan)
      const vendorOff = planFeatureChange({ ...oldDefault('supermarket'), loyalty: false }, 'supermarket', mall)
      check('… a switch the vendor turned off itself stays off (loyalty)', !vendorOff.turnOn.includes('loyalty'))
      check('… nothing turned on when no type is added (mall → supermarket)', planFeatureChange(oldDefault('electronics'), mall, 'supermarket').turnOn.length === 0)
    })

    // ======================================================== 2. create a mall
    let mallId = ''
    await step('create mall', async () => {
      const noSeg = await create('mall')
      check('mall without segments → 400', noSeg.status === 400 && noSeg.body.field === 'businessSegments', noSeg)
      const bad = await create('mall', { businessSegments: ['supermarket', 'spaceport'] })
      check('unknown segment → 400', bad.status === 400 && bad.body.field === 'businessSegments', bad)
      const ok = await create('mall', { businessSegments: ['restaurant', 'supermarket', 'textile', 'restaurant'] })
      check('mall with segments → 200', ok.status === 200, ok)
      mallId = ok.body.vendor?.id
      const row = (await pg.query(`SELECT business_type::text bt, business_segments segs FROM tenants WHERE id = $1`, [mallId])).rows[0]
      check('stored: mall, segments cleaned to menu order', row?.bt === 'mall' && same(row.segs, ['supermarket', 'textile', 'restaurant']), row)
      const flags = await savedFlags(mallId)
      check('switches = union of the segments\' presets', same(normalizeFeatureFlags(flags), defaultFeatureFlagsForBusinessType({ businessType: 'mall', businessSegments: ['supermarket', 'textile', 'restaurant'] })), flags)
      const cats = (await pg.query(`SELECT name FROM categories WHERE tenant_id = $1`, [mallId])).rows.map((r) => r.name as string)
      check('categories of every segment seeded once', cats.length > 0 && new Set(cats.map((c) => c.toLowerCase())).size === cats.length, cats)
      const accs = (await pg.query(`SELECT name FROM chart_of_accounts WHERE tenant_id = $1`, [mallId])).rows.map((r) => r.name as string)
      check('chart of accounts of every segment (Dine-In Revenue, Tailoring Advances, Cold Storage)', ['Dine-In Revenue', 'Tailoring Advances', 'Cold Storage'].every((a) => accs.includes(a)))
      const reasons = (await pg.query(`SELECT reason FROM cancellation_reasons WHERE tenant_id = $1 AND document_type = 'sales_order'`, [mallId])).rows.map((r) => r.reason)
      check('cancellation reasons merged (restaurant + textile)', reasons.includes('Kitchen issue') && reasons.includes('Tailoring order cancelled'), reasons)
      setTestCookie('admin_session', ownerToken)
      const got = await json(await getVendor(req('GET', `/api/sys-control/vendors/${mallId}`), ctx(mallId)))
      check('vendor detail: businessSegments + segmentTypes with labels, union roles',
        got.status === 200 && same(got.body.vendor?.businessSegments, ['supermarket', 'textile', 'restaurant'])
        && got.body.vendor?.segmentTypes?.length === SEGMENT_TYPES.length && got.body.vendor.segmentTypes.every((s: J) => s.value && s.label)
        && got.body.assignableRoles?.includes('chef') && got.body.assignableRoles?.includes('technician'), got.body.vendor && { segs: got.body.vendor.businessSegments, roles: got.body.assignableRoles })
    })

    // ======================================================== 3. supermarket with data → mall
    await step('supermarket → mall keeps everything', async () => {
      const sm = await create('supermarket')
      check('supermarket created', sm.status === 200, sm)
      const id = sm.body.vendor.id as string
      const businessId = sm.body.businessId as string
      const flags0 = await savedFlags(id)
      check('ordinary vendor creation unchanged: switches = supermarket preset', same(normalizeFeatureFlags(flags0), oldDefault('supermarket')), flags0)

      // data: settings, a switch the vendor turned off, items + stock, customer, staff, extra counter, a sale
      await pg.query(`UPDATE tenants SET settings = jsonb_set(jsonb_set(settings, '{receiptFooterNote}', '"Thank you"'), '{featureFlags,loyalty}', 'false') WHERE id = $1`, [id])
      const owner = (await pg.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' LIMIT 1`, [id])).rows[0].id as string
      const wh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY is_default DESC LIMIT 1`, [id])).rows[0].id as string
      const profile = (await pg.query(`SELECT id FROM pos_profiles WHERE tenant_id = $1 LIMIT 1`, [id])).rows[0].id as string
      const item = randomUUID()
      await pg.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1,$2,'O1-RICE','Rice 5kg',500,800,true)`, [item, id])
      await withTenantTransaction(id, (tx) => applyStockChange(tx, { tenantId: id, warehouseId: wh, itemId: item, mode: 'delta', qty: 50, referenceType: 'test_seed', source: 'system', userId: owner }))
      await pg.query(`INSERT INTO customers (tenant_id, name, phone) VALUES ($1, 'O1 Customer', '0771234567')`, [id])
      const cashierEmail = `o1-cashier-${tag}@example.test`
      const cashier = randomUUID()
      await pg.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'O1 Cashier','cashier')`, [cashier, id, cashierEmail, await bcrypt.hash('Cashier@123', 4)])
      await pg.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1,$2,$3,true)`, [id, profile, cashier])

      const asOwner = (bt: string, segs: string[] | null) => {
        clearBranchScopeCache(id)
        setTestSession({
          user: {
            id: owner, accountId: null, email: `owner-${tag}@example.test`, name: 'Owner', role: 'owner',
            tenantId: id, tenantSlug: sm.slug, tenantName: 'O1', businessType: bt, businessSegments: segs,
            aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
          },
        } as unknown as Parameters<typeof setTestSession>[0])
      }
      asOwner('supermarket', null)
      const shift = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: profile, openingBalances: [{ paymentMethod: 'cash', amount: 1000 }] })))
      check('shift opened', shift.status === 200 || shift.status === 201, shift)
      const sale = (qty: number) => postSale(req('POST', '/api/sales', {
        discount: 0, tax: 0, creditAmount: 0, paymentMethod: 'cash', posOpeningEntryId: shift.body.id,
        cartItems: [{ itemId: item, name: 'Rice 5kg', quantity: qty, unitPrice: 800 }], subtotal: 800 * qty, total: 800 * qty, amountPaid: 800 * qty,
      }))
      const s1 = await json(await sale(2))
      check('sale before the change', s1.status === 200 || s1.status === 201, s1)

      const before = await counts(id)
      const key = sessionValidationKey(id, cashier, 1)
      setSessionValidation(key, { validatedAt: Date.now(), businessType: 'supermarket', businessSegments: null })

      // validation + permissions
      check('viewer admin → 403', (await change(id, { businessType: 'mall', businessSegments: ['supermarket'] }, viewerToken)).status === 403)
      setTestCookie('admin_session', '')
      const anon = await json(await changeType(req('PUT', `/api/sys-control/vendors/${id}/business-type`, { businessType: 'mall', businessSegments: ['supermarket'] }), ctx(id)))
      check('no admin session → refused (401/403)', anon.status === 401 || anon.status === 403, anon.status)
      const noSeg = await change(id, { businessType: 'mall' })
      check('change to mall without segments → 400', noSeg.status === 400 && noSeg.body.field === 'businessSegments', noSeg)
      const emptySeg = await change(id, { businessType: 'mall', businessSegments: [] })
      check('change to mall with [] → 400', emptySeg.status === 400, emptySeg)
      const badSeg = await change(id, { businessType: 'mall', businessSegments: ['supermarket', 'mall'] })
      check('unknown segment (mall inside mall) → 400', badSeg.status === 400, badSeg)
      const badType = await change(id, { businessType: 'spaceport' })
      check('unknown business type → 400', badType.status === 400, badType)
      const missing = await change(randomUUID(), { businessType: 'retail' })
      check('unknown vendor → 404', missing.status === 404, missing)
      const refused = compareCounts(before, await counts(id))
      check('nothing changed by refused requests', refused.lost.length === 0 && refused.grew.length === 0, refused)

      const res = await change(id, { businessType: 'mall', businessSegments: ['supermarket', 'textile', 'electronics', 'restaurant'] })
      check('supermarket → mall [supermarket, textile, electronics, restaurant] → 200', res.status === 200 && res.body.ok === true, res)
      check('response shape: vendor {id, businessType, businessSegments}, changes {featuresTurnedOn, seeded, rolesAdded}',
        res.body.vendor?.id === id && res.body.vendor?.businessType === 'mall' && same(res.body.vendor?.businessSegments, ['supermarket', 'textile', 'electronics', 'restaurant'])
        && Array.isArray(res.body.changes?.featuresTurnedOn) && typeof res.body.changes?.seeded === 'object' && Array.isArray(res.body.changes?.rolesAdded), res.body)
      check('… turned on installments, warranty claims, service jobs', ['installments', 'warranty_claims', 'service_jobs'].every((k) => res.body.changes.featuresTurnedOn.includes(k)), res.body.changes)
      check('… roles added: chef, waiter, technician', ['chef', 'waiter', 'technician'].every((r) => res.body.changes.rolesAdded.includes(r)), res.body.changes.rolesAdded)
      check('… seeded categories + accounts', (res.body.changes.seeded.categories ?? 0) > 0 && (res.body.changes.seeded.accounts ?? 0) > 0, res.body.changes.seeded)

      const after = await counts(id)
      const cmp = compareCounts(before, after)
      check(`every tenant table (${tenantTables.length}) kept its rows; only seed tables grew`, cmp.lost.length === 0 && cmp.unexpected.length === 0, cmp)
      const t = (await pg.query(`SELECT id, business_id, business_type::text bt, settings FROM tenants WHERE id = $1`, [id])).rows[0]
      check('same tenant id and Business ID', t.id === id && t.business_id === businessId)
      check('other settings kept; vendor\'s own "loyalty off" kept', t.settings.receiptFooterNote === 'Thank you' && t.settings.featureFlags.loyalty === false && t.settings.featureFlags.installments === true, t.settings.featureFlags)
      check('session-validation cache of the tenant cleared', getSessionValidation(key) === undefined)
      const stock = Number((await pg.query(`SELECT current_stock FROM warehouse_stock WHERE item_id = $1`, [item])).rows[0].current_stock)
      check('stock unchanged (50 − 2 = 48)', stock === 48, stock)

      const again = await change(id, { businessType: 'mall', businessSegments: ['supermarket', 'textile', 'electronics', 'restaurant'] })
      check('same change again is a no-op (nothing seeded, nothing turned on)', again.status === 200 && Object.keys(again.body.changes.seeded).length === 0 && again.body.changes.featuresTurnedOn.length === 0, again.body.changes)

      // staff still sign in, app gets the segments
      const login = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: cashierEmail, password: 'Cashier@123', businessId })))
      check('cashier still signs in (mobile) with businessType mall + businessSegments', login.status === 200 && !!login.body.token
        && login.body.user?.businessType === 'mall' && same(login.body.user?.businessSegments, ['supermarket', 'textile', 'electronics', 'restaurant']), login.body.user ?? login.body)

      asOwner('mall', ['supermarket', 'textile', 'electronics', 'restaurant'])
      const feats = await json(await getFeatures())
      check('/api/features for the mall: installments + service jobs on, pharmacy off', feats.status === 200 && feats.body.flags.installments && feats.body.flags.service_jobs && !feats.body.flags.pharmacy, feats.body)
      const s2 = await json(await sale(1))
      check('a sale still works after the change', s2.status === 200 || s2.status === 201, s2)

      // counters: food-court counter
      const setSeg = await json(await updateProfile(req('PUT', `/api/pos-profiles/${profile}`, { businessSegment: 'restaurant' }), ctx(profile)))
      const segRow = async () => (await pg.query(`SELECT business_segment FROM pos_profiles WHERE id = $1`, [profile])).rows[0].business_segment
      check('counter set to restaurant (food court) → 200', setSeg.status === 200 && (await segRow()) === 'restaurant', setSeg)
      const foreign = await json(await updateProfile(req('PUT', `/api/pos-profiles/${profile}`, { businessSegment: 'pharmacy' }), ctx(profile)))
      check('counter set to a type the mall does not run → 400', foreign.status === 400 && (await segRow()) === 'restaurant', foreign)
      const other = await json(await updateProfile(req('PUT', `/api/pos-profiles/${profile}`, { name: 'Main counter' }), ctx(profile)))
      check('other edits keep the counter type', other.status === 200 && (await segRow()) === 'restaurant')
      const cleared = await json(await updateProfile(req('PUT', `/api/pos-profiles/${profile}`, { businessSegment: null }), ctx(profile)))
      check('null clears the counter type', cleared.status === 200 && (await segRow()) === null, cleared)
      const created = await json(await createProfile(req('POST', '/api/pos-profiles', {
        name: 'Food court', warehouseId: wh, costCenterId: (await pg.query(`SELECT id FROM cost_centers WHERE tenant_id = $1 LIMIT 1`, [id])).rows[0].id,
        businessSegment: 'restaurant', userIds: [owner],
      })))
      check('new food-court counter (businessSegment restaurant) accepted', (created.status === 200 || created.status === 201) && created.body.businessSegment === 'restaurant', created)

      // mall → supermarket keeps everything
      const before2 = await counts(id)
      const back = await change(id, { businessType: 'supermarket', businessSegments: ['textile'] })
      check('mall → supermarket → 200, segments cleared (ignored for ordinary types)', back.status === 200 && back.body.vendor?.businessSegments === null && back.body.changes.featuresTurnedOn.length === 0, back.body)
      check('… reports switches that no longer apply (installments still saved on)', back.body.changes.featuresNoLongerApplicable?.includes('installments') && (await savedFlags(id)).installments === true, back.body.changes)
      const cmp2 = compareCounts(before2, await counts(id))
      check('… every tenant table kept its rows, nothing seeded', cmp2.lost.length === 0 && cmp2.grew.length === 0, cmp2)
      const row = (await pg.query(`SELECT business_type::text bt, business_segments segs, business_id FROM tenants WHERE id = $1`, [id])).rows[0]
      check('… stored supermarket, no segments, same Business ID', row.bt === 'supermarket' && row.segs === null && row.business_id === businessId, row)
      const login2 = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: cashierEmail, password: 'Cashier@123', businessId })))
      check('… cashier signs in, businessSegments null', login2.status === 200 && login2.body.user?.businessType === 'supermarket' && login2.body.user?.businessSegments === null, login2.body.user)

      // ordinary → ordinary
      const toElec = await change(id, { businessType: 'electronics' })
      check('supermarket → electronics → 200 (ordinary change)', toElec.status === 200 && toElec.body.vendor.businessType === 'electronics', toElec.body)
    })

    // ======================================================== 4. the created mall can drop to retail
    await step('mall → retail', async () => {
      if (!mallId) return
      const before = await counts(mallId)
      const r = await change(mallId, { businessType: 'retail' })
      const cmp = compareCounts(before, await counts(mallId))
      check('created mall → retail keeps its rows', r.status === 200 && cmp.lost.length === 0 && cmp.unexpected.length === 0, { r: r.body, cmp })
    })
  } finally {
    await closeAllPools().catch(() => undefined)
    if (!process.env.KEEP_TEST_DATA) await cleanup(pg, tenantIds)
    for (const adminId of adminIds) {
      await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [adminId]).catch(() => undefined)
      await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [adminId]).catch(() => undefined)
      await pg.query(`DELETE FROM super_admins WHERE id = $1`, [adminId]).catch(() => undefined)
    }
    await pg.end()
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

async function cleanup(pg: Client, tenantIds: string[]) {
  if (!tenantIds.length) return
  const tables = (await pg.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
  )).rows.map((r) => r.table_name as string)
  const accountIds = (await pg.query(`SELECT DISTINCT account_id FROM account_tenants WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])).rows.map((r) => r.account_id)
  let pending = tables
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: string[] = []
    for (const t of pending) {
      try { await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]) } catch { next.push(t) }
    }
    pending = next
  }
  await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds]).catch((e) => console.error('tenants cleanup:', e.message))
  if (accountIds.length) {
    await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
    await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
  }
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
