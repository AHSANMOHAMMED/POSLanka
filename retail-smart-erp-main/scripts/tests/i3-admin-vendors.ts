/**
 * I3 — super-admin vendor console: search, create, lifecycle actions, billing rules.
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/i3-admin-vendors.ts
 *
 * Calls the real /api/sys-control handlers with a real admin_sessions row (cookie supplied via
 * the next/headers mock) and the real mobile login route to prove sign-in is blocked/unblocked.
 * Covers: search by Business ID (any spelling) / partial / owner email + filters; create persists
 * legal name, BRN, TIN, VAT flag (→ default VAT template), tier, and returns the Business ID;
 * suspend / reactivate block and restore login; extend trial (running and expired+locked);
 * change plan (paid ↔ free); temporary owner password; archive (soft); CSV export; slug check;
 * audit rows for every action; non-admin rejected; bank-slip approval extends exactly once;
 * tier price change pins existing subscribers' price.
 * Throw-away data is removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { closeAllPools } from '@/lib/db'
import { GET as listVendors, POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as getVendor } from '@/app/api/sys-control/vendors/[id]/route'
import { POST as vendorAction } from '@/app/api/sys-control/vendors/[id]/actions/route'
import { GET as exportVendors } from '@/app/api/sys-control/vendors/export/route'
import { GET as slugCheck } from '@/app/api/sys-control/vendors/slug-check/route'
import { PUT as reviewPayment } from '@/app/api/sys-control/payments/[id]/route'
import { GET as listPayments } from '@/app/api/sys-control/payments/route'
import { GET as listSubscriptions } from '@/app/api/sys-control/subscriptions/route'
import { PUT as updateSubscription } from '@/app/api/sys-control/subscriptions/[id]/route'
import { PUT as updateTier } from '@/app/api/sys-control/pricing-tiers/[id]/route'
import { POST as mobileLogin } from '@/app/api/auth/mobile-login/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  // fresh client IP per call so the per-IP admin rate limits never interfere
  const addr = `10.33.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const tierIdsToDrop: string[] = []

  // ---------------------------------------------------------------- super admin + session
  const adminId = randomUUID()
  const token = randomBytes(32).toString('hex')
  await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'I3 Admin')`, [adminId, `i3-admin-${tag}@example.test`])
  await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [adminId, token])
  const asAdmin = () => setTestCookie('admin_session', token)
  const asNobody = () => setTestCookie('admin_session', null)

  const tiers = (await pg.query(`SELECT id, name, display_name, price_monthly, price_yearly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const freeTier = tiers.find((t) => t.name === 'trial')
  const paidTiers = tiers.filter((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-'))
  const starter = paidTiers[0]
  const other = paidTiers[1] ?? paidTiers[0]
  if (!freeTier || !starter) throw new Error('Test DB needs the free "trial" tier and at least one paid tier')

  const auditCount = async (resourceIds: string[], op?: string) => {
    const r = await pg.query(
      `SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = ANY($2::uuid[]) ${op ? `AND details->>'op' = $3` : ''}`,
      op ? [adminId, resourceIds, op] : [adminId, resourceIds],
    )
    return r.rows[0].n as number
  }
  const login = async (businessId: string, email: string, password: string) =>
    (await mobileLogin(req('POST', '/api/auth/mobile-login', { businessId, email, password }))).status

  const slug = `i3-shop-${tag}`
  const ownerEmail = `i3-owner-${tag}@example.test`
  const ownerPassword = 'Owner@12345'
  let vendorId = ''
  let businessId = ''
  let subId = ''
  let currentPassword = ownerPassword

  try {
    // ============================================================ non-admin rejected
    await step('non-admin rejected', async () => {
      asNobody()
      const a = await listVendors(req('GET', '/api/sys-control/vendors'))
      const b = await createVendor(req('POST', '/api/sys-control/vendors', { name: 'x' }))
      const c = await vendorAction(req('POST', `/api/sys-control/vendors/${randomUUID()}/actions`, { action: 'suspend', reason: 'test' }), ctx(randomUUID()))
      const d = await exportVendors(req('GET', '/api/sys-control/vendors/export'))
      const e = await listSubscriptions(req('GET', '/api/sys-control/subscriptions'))
      check('list / create / action / export / subscriptions → 401 without admin session',
        [a, b, c, d, e].every((r) => r.status === 401), [a, b, c, d, e].map((r) => r.status))
      setTestCookie('admin_session', 'not-a-real-session')
      const f = await listVendors(req('GET', '/api/sys-control/vendors'))
      check('forged admin cookie → 401', f.status === 401)
    })

    // ============================================================ slug check + create
    await step('create vendor persists fields + returns Business ID', async () => {
      asAdmin()
      const free = await json(await slugCheck(req('GET', `/api/sys-control/vendors/slug-check?slug=${slug}`)))
      check('slug check: unused slug available', free.status === 200 && free.body.available === true, free.body)
      const reserved = await json(await slugCheck(req('GET', `/api/sys-control/vendors/slug-check?slug=admin`)))
      check('slug check: reserved word refused', reserved.body.available === false, reserved.body)

      const bad = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
        name: 'I3 Bad', slug: `i3-bad-${tag}`, email: `bad-${tag}@example.test`, phone: '+94771234567', address: 'Colombo', ownerName: 'Bad Owner', ownerPassword: 'Owner@12345', vatRegistered: true,
      })))
      check('VAT-registered without TIN → 400', bad.status === 400, bad)

      const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
        name: `I3 Shop ${tag}`,
        legalName: `I3 Shop (Private) Limited ${tag}`,
        slug,
        email: `shop-${tag}@example.test`,
        phone: `+9477${String(Date.now()).slice(-7)}`,
        address: '12 Galle Road, Colombo 03',
        businessType: 'supermarket',
        brn: `PV ${tag}`,
        taxId: `1234${tag}`,
        vatRegistered: true,
        tierId: starter.id,
        billingCycle: 'monthly',
        ownerName: 'I3 Owner',
        ownerEmail,
        ownerPassword,
      })))
      check('POST /vendors → 200', res.status === 200, res)
      vendorId = res.body.vendor?.id
      businessId = res.body.businessId
      if (vendorId) tenantIds.push(vendorId)
      check('response carries Business ID PL######', /^PL\d{6}$/.test(businessId || ''), businessId)
      check('response carries a login URL', typeof res.body.loginUrl === 'string' && res.body.loginUrl.includes(slug))

      const t = (await pg.query(`SELECT * FROM tenants WHERE id = $1`, [vendorId])).rows[0]
      check('legal name / BRN / TIN / address / type persisted',
        t?.legal_name === `I3 Shop (Private) Limited ${tag}` && t?.brn === `PV ${tag}` && t?.tax_id === `1234${tag}` && t?.address === '12 Galle Road, Colombo 03' && t?.business_type === 'supermarket', t)
      check('VAT flag stored in settings', t?.settings?.vatRegistered === true)
      check('business_id persisted = response', t?.business_id === businessId)
      const s = (await pg.query(`SELECT * FROM subscriptions WHERE tenant_id = $1`, [vendorId])).rows[0]
      subId = s?.id
      check('subscription on the chosen tier, active, price locked',
        s?.tier_id === starter.id && s?.status === 'active' && Number(s?.subscribed_price_monthly) === Number(starter.price_monthly), s)
      check('paid plan sets a sign-in cut-off after the period', !!t?.plan_expires_at && new Date(t.plan_expires_at) > new Date(s.current_period_end))
      const tax = (await pg.query(
        `SELECT tt.name, ti.rate FROM accounting_settings a JOIN tax_templates tt ON tt.id = a.default_tax_template_id
         JOIN tax_template_items ti ON ti.tax_template_id = tt.id WHERE a.tenant_id = $1`, [vendorId])).rows
      check('VAT-registered → default sales tax template is VAT 18%', tax.some((r) => /vat/i.test(r.name) && Number(r.rate) === 18), tax)

      const dup = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
        name: 'Dup', slug, email: `dup-${tag}@example.test`, phone: '+94771234567', address: 'Colombo', ownerName: 'Dup Owner', ownerPassword: 'Owner@12345',
      })))
      check('duplicate slug → 409', dup.status === 409, dup.status)

      const nv = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
        name: `I3 Cafe ${tag}`, slug: `i3-cafe-${tag}`, email: `cafe-${tag}@example.test`, phone: '+94771234568', address: 'Kandy', businessType: 'restaurant',
        ownerName: 'Cafe Owner', ownerPassword: 'Owner@12345', vatRegistered: false,
      })))
      if (nv.body.vendor?.id) tenantIds.push(nv.body.vendor.id)
      const nvSet = (await pg.query(`SELECT default_tax_template_id FROM accounting_settings WHERE tenant_id = $1`, [nv.body.vendor?.id])).rows[0]
      const nvSub = (await pg.query(`SELECT s.status, s.current_period_end, t.plan_expires_at, s.tier_id FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1`, [nv.body.vendor?.id])).rows[0]
      check('not VAT-registered → no default sales tax', nv.status === 200 && nvSet && nvSet.default_tax_template_id === null, nvSet)
      check('no tier given → free plan that never expires', nvSub?.tier_id === freeTier.id && nvSub?.status === 'trial' && nvSub?.plan_expires_at === null, nvSub)
      // Only name, phone and address: web address, owner name, login and password are filled in
      const noPhone = await json(await createVendor(req('POST', '/api/sys-control/vendors', { name: `I3 Min ${tag}`, address: 'Galle' })))
      check('missing phone → 400', noPhone.status === 400, noPhone.status)
      const noAddr = await json(await createVendor(req('POST', '/api/sys-control/vendors', { name: `I3 Min ${tag}`, phone: '+94771234569' })))
      check('missing address → 400', noAddr.status === 400, noAddr.status)
      const min = await json(await createVendor(req('POST', '/api/sys-control/vendors', { name: `I3 Min ${tag}`, phone: '+94771234569', address: 'Galle' })))
      if (min.body.vendor?.id) tenantIds.push(min.body.vendor.id)
      check('name + phone + address only → 200', min.status === 200, min)
      check('web address generated from the name', min.body.vendor?.slug === `i3-min-${tag}`, min.body.vendor?.slug)
      check('owner login generated from the web address', min.body.owner?.email === `owner@i3-min-${tag}.poslanka.local`, min.body.owner?.email)
      check('owner password generated and returned once', typeof min.body.generatedPassword === 'string' && min.body.generatedPassword.length === 12)
      const minOwner = (await pg.query(`SELECT full_name, password_hash FROM users WHERE tenant_id = $1 AND role = 'owner'`, [min.body.vendor?.id])).rows[0]
      check('owner name defaults to the business name', minOwner?.full_name === `I3 Min ${tag}`, minOwner?.full_name)
      check('generated password signs in', !!minOwner && await bcrypt.compare(min.body.generatedPassword || '', minOwner.password_hash))
      const min2 = await json(await createVendor(req('POST', '/api/sys-control/vendors', { name: `I3 Min ${tag}`, phone: '+94771234570', address: 'Galle' })))
      if (min2.body.vendor?.id) tenantIds.push(min2.body.vendor.id)
      check('same name again → next free web address', min2.status === 200 && min2.body.vendor?.slug === `i3-min-${tag}-2`, min2.body.vendor?.slug)
      const inv = await json(await createVendor(req('POST', '/api/sys-control/vendors', { name: `I3 Inv ${tag}`, phone: '+94771234571', address: 'Galle', sendInvite: true })))
      check('invitation without any email → 400', inv.status === 400, inv.status)

      check('create audited with Business ID', (await pg.query(`SELECT 1 FROM admin_audit_logs WHERE resource_id = $1 AND action = 'create' AND details->>'businessId' = $2`, [vendorId, businessId])).rowCount === 1)
    })

    // ============================================================ search
    await step('search by Business ID and filters', async () => {
      asAdmin()
      const ids = async (qs: string) => {
        const r = await json(await listVendors(req('GET', `/api/sys-control/vendors?${qs}`)))
        return { status: r.status, ids: (r.body.vendors || []).map((v: J) => v.id) as string[], body: r.body }
      }
      const dashed = `${businessId.slice(0, 2)}-${businessId.slice(2)}`
      const exact = await ids(`q=${encodeURIComponent(businessId)}`)
      check('q=PL###### finds exactly that vendor', exact.status === 200 && exact.ids.length === 1 && exact.ids[0] === vendorId, exact.ids)
      const lower = await ids(`q=${encodeURIComponent(dashed.toLowerCase())}`)
      check('q=pl-###### (dash, lower case) finds it', lower.ids.includes(vendorId))
      const partial = await ids(`q=${businessId.slice(-4)}`)
      check('partial Business ID digits find it', partial.ids.includes(vendorId))
      const byOwner = await ids(`q=${encodeURIComponent(ownerEmail)}`)
      check('owner email finds it', byOwner.ids.includes(vendorId))
      const typed = await ids(`q=${tag}&businessType=restaurant`)
      check('business type filter applied', !typed.ids.includes(vendorId) && typed.ids.length === 1, typed.ids)
      const tiered = await ids(`q=${tag}&tierId=${starter.id}`)
      check('plan filter applied', tiered.ids.length === 1 && tiered.ids[0] === vendorId, tiered.ids)
      const row = exact.body.vendors?.[0]
      check('row has owner, plan name, user counts', row?.owner?.email === ownerEmail && row?.tierDisplayName === starter.display_name && row?.userCount === 1, row)
      check('pagination + status facets returned', exact.body.pagination?.total === 1 && typeof exact.body.statusCounts?.active === 'number')
    })

    // ============================================================ detail
    await step('vendor detail', async () => {
      asAdmin()
      const d = await json(await getVendor(req('GET', `/api/sys-control/vendors/${vendorId}`), ctx(vendorId)))
      check('GET detail → 200 with owner, subscription, usage, staff, tiers',
        d.status === 200 && d.body.owner?.email === ownerEmail && d.body.subscription?.tier?.id === starter.id &&
        d.body.usage?.activeUsers === 1 && Array.isArray(d.body.staff) && d.body.staff.length === 1 && Array.isArray(d.body.tiers), d.body)
      check('detail keeps the mobile-compatible vendor shape', Array.isArray(d.body.vendor?.branches) && d.body.vendor?.userCount === 1 && !!d.body.vendor?.featureFlags)
    })

    // ============================================================ suspend / reactivate
    await step('suspend / reactivate block and restore sign-in', async () => {
      asAdmin()
      check('owner can sign in (mobile login, Business ID)', (await login(businessId, ownerEmail, ownerPassword)) === 200)
      const noReason = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'suspend', reason: '' }), ctx(vendorId)))
      check('suspend without reason → 400', noReason.status === 400)
      const s = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'suspend', reason: 'I3 unpaid invoice' }), ctx(vendorId)))
      check('suspend → 200', s.status === 200, s.body)
      const t = (await pg.query(`SELECT status, deletion_scheduled_at FROM tenants WHERE id = $1`, [vendorId])).rows[0]
      check('tenant suspended, no deletion scheduled', t.status === 'suspended' && t.deletion_scheduled_at === null, t)
      check('suspended vendor cannot sign in', (await login(businessId, ownerEmail, ownerPassword)) === 401)
      const again = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'suspend', reason: 'again' }), ctx(vendorId)))
      check('suspending twice → 400', again.status === 400)
      const r = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'reactivate', reason: 'paid' }), ctx(vendorId)))
      check('reactivate → 200', r.status === 200 && !r.body.warning, r.body)
      check('reactivated vendor can sign in again', (await login(businessId, ownerEmail, ownerPassword)) === 200)
      check('suspend + reactivate audited', (await auditCount([vendorId], 'suspend')) === 1 && (await auditCount([vendorId], 'reactivate')) === 1)
    })

    // ============================================================ extend
    await step('extend trial', async () => {
      asAdmin()
      const end = new Date(Date.now() + 2 * 86_400_000)
      await pg.query(`UPDATE subscriptions SET status = 'trial', trial_ends_at = $2, current_period_end = $2 WHERE id = $1`, [subId, end])
      const r = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'extend_trial', days: 10, reason: 'I3 evaluation' }), ctx(vendorId)))
      const s = (await pg.query(`SELECT s.trial_ends_at, s.status, t.plan_expires_at FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`, [subId])).rows[0]
      const days = Math.round((new Date(s.trial_ends_at).getTime() - end.getTime()) / 86_400_000)
      check('running trial extended by 10 days from its end', r.status === 200 && r.body.kind === 'trial' && days === 10, { r: r.body, days })
      check('sign-in cut-off follows the trial', Math.abs(new Date(s.plan_expires_at).getTime() - new Date(s.trial_ends_at).getTime()) < 1000, s)

      // expired + locked by the billing job
      const past = new Date(Date.now() - 3 * 86_400_000)
      await pg.query(`UPDATE subscriptions SET status = 'locked', trial_ends_at = $2, current_period_end = $2 WHERE id = $1`, [subId, past])
      await pg.query(`UPDATE tenants SET status = 'locked', locked_reason = 'trial_expired', locked_at = now(), deletion_scheduled_at = now() + interval '7 days', plan_expires_at = $2 WHERE id = $1`, [vendorId, past])
      check('locked trial cannot sign in', (await login(businessId, ownerEmail, ownerPassword)) === 401)
      const r2 = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'extend', days: 5, reason: 'I3 more time' }), ctx(vendorId)))
      const t2 = (await pg.query(`SELECT t.status, t.deletion_scheduled_at, s.status AS sub_status, s.trial_ends_at FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id WHERE t.id = $1`, [vendorId])).rows[0]
      const fromNow = Math.round((new Date(t2.trial_ends_at).getTime() - Date.now()) / 86_400_000)
      check('expired trial: extend unlocks, clears deletion, trial ends 5 days from now',
        r2.status === 200 && t2.status === 'active' && t2.deletion_scheduled_at === null && t2.sub_status === 'trial' && fromNow === 5, { r2: r2.body, t2 })
      check('unlocked trial can sign in', (await login(businessId, ownerEmail, ownerPassword)) === 200)
      check('extensions audited on the subscription', (await auditCount([subId], 'extend_trial')) === 1 && (await auditCount([subId], 'extend')) === 1)
    })

    // ============================================================ change plan
    await step('change plan', async () => {
      asAdmin()
      const r = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'change_plan', tierId: other.id, billingCycle: 'yearly', reason: 'I3 upgrade' }), ctx(vendorId)))
      const s = (await pg.query(`SELECT s.*, t.plan FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`, [subId])).rows[0]
      check('trial → paid plan: tier, cycle, locked price, active with a fresh period',
        r.status === 200 && s.tier_id === other.id && s.billing_cycle === 'yearly' && Number(s.subscribed_price_yearly) === Number(other.price_yearly) &&
        s.status === 'active' && s.trial_ends_at === null && new Date(s.current_period_end) > new Date(Date.now() + 300 * 86_400_000), { r: r.body, s })
      const same = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'change_plan', tierId: other.id, billingCycle: 'yearly', reason: 'noop' }), ctx(vendorId)))
      check('same plan again → 400', same.status === 400)
      const f = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'change_plan', tierId: freeTier.id, reason: 'I3 downgrade' }), ctx(vendorId)))
      const s2 = (await pg.query(`SELECT s.status, s.current_period_end, t.plan, t.plan_expires_at FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`, [subId])).rows[0]
      check('→ free plan: trial status, never expires, plan=trial', f.status === 200 && s2.status === 'trial' && new Date(s2.current_period_end).getFullYear() >= 2099 && s2.plan === 'trial' && s2.plan_expires_at === null, s2)
      const ext = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'extend', days: 5, reason: 'nope' }), ctx(vendorId)))
      check('extending a free plan → 400', ext.status === 400)
      check('plan changes audited', (await auditCount([subId], 'change_plan')) === 2)
    })

    // ============================================================ owner password
    await step('reset owner password (temporary)', async () => {
      asAdmin()
      await new Promise((r) => setTimeout(r, 1100)) // password_changed_at is compared at 1 s resolution
      const r = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'reset_password', mode: 'temporary' }), ctx(vendorId)))
      check('temporary password returned once', r.status === 200 && typeof r.body.temporaryPassword === 'string' && r.body.temporaryPassword.length >= 12, r.body)
      check('old password no longer works', (await login(businessId, ownerEmail, ownerPassword)) === 401)
      check('temporary password works', (await login(businessId, ownerEmail, r.body.temporaryPassword)) === 200)
      currentPassword = r.body.temporaryPassword
      const a = await pg.query(`SELECT details FROM admin_audit_logs WHERE resource_id = $1 AND details->>'op' = 'reset_password'`, [vendorId])
      check('reset audited without the password', a.rowCount === 1 && !JSON.stringify(a.rows[0].details).includes(r.body.temporaryPassword))
      const mail = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'reset_password', mode: 'email' }), ctx(vendorId)))
      check('reset link by email → 200 (dev transport)', mail.status === 200, mail.body)
      const welcome = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'resend_welcome' }), ctx(vendorId)))
      check('resend sign-in details → 200', welcome.status === 200 && welcome.body.kind === 'sign_in_details', welcome.body)
    })

    // ============================================================ CSV export
    await step('CSV export', async () => {
      asAdmin()
      const res = await exportVendors(req('GET', `/api/sys-control/vendors/export?q=${tag}`))
      const text = await res.text()
      check('export → text/csv with the vendor and its Business ID', res.status === 200 && (res.headers.get('content-type') || '').includes('text/csv') &&
        text.includes(`${businessId.slice(0, 2)}-${businessId.slice(2)}`) && text.split('\r\n').filter(Boolean).length === tenantIds.length + 1, text.slice(0, 300))
      const a = await pg.query(`SELECT 1 FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'vendor_export'`, [adminId])
      check('export audited', a.rowCount === 1)
    })

    // ============================================================ bank slip approval
    await step('bank-slip approval extends exactly once', async () => {
      asAdmin()
      // put the vendor back on a paid plan with a known period end
      const end = new Date(Date.now() + 10 * 86_400_000)
      await pg.query(`UPDATE subscriptions SET tier_id = $2, status = 'active', trial_ends_at = NULL, current_period_end = $3 WHERE id = $1`, [subId, starter.id, end])
      const acct = (await pg.query(`SELECT billing_account_id FROM subscriptions WHERE id = $1`, [subId])).rows[0].billing_account_id
      const depId = randomUUID()
      await pg.query(`INSERT INTO payment_deposits (id, account_id, subscription_id, amount, deposit_date, period_months, bank_reference) VALUES ($1, $2, $3, 1990, current_date, 1, $4)`,
        [depId, acct, subId, `I3-${tag}`])
      const list = await json(await listPayments(req('GET', `/api/sys-control/payments?status=pending&q=I3-${tag}`)))
      check('pending slip listed with its vendor', list.status === 200 && list.body.payments?.[0]?.id === depId && list.body.payments[0].tenant?.businessId === businessId, list.body)
      const [a, b] = await Promise.all([
        reviewPayment(req('PUT', `/api/sys-control/payments/${depId}`, { status: 'approved' }), ctx(depId)),
        reviewPayment(req('PUT', `/api/sys-control/payments/${depId}`, { status: 'approved' }), ctx(depId)),
      ])
      check('two simultaneous approvals → one succeeds', [a.status, b.status].sort().join(',') === '200,400', [a.status, b.status])
      const s = (await pg.query(`SELECT s.current_period_end, t.plan_expires_at FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`, [subId])).rows[0]
      const expected = new Date(end)
      expected.setMonth(expected.getMonth() + 1)
      check('period extended by exactly one month from its end', Math.abs(new Date(s.current_period_end).getTime() - expected.getTime()) < 5000, { got: s.current_period_end, expected })
      check('sign-in cut-off moved with the period', new Date(s.plan_expires_at) > new Date(s.current_period_end))
      await pg.query(`DELETE FROM payment_deposits WHERE id = $1`, [depId])
    })

    // ============================================================ wallet top-up + manual lock
    await step('wallet top-up approval credits once; manual lock never schedules deletion', async () => {
      asAdmin()
      const acct = (await pg.query(`SELECT billing_account_id FROM subscriptions WHERE id = $1`, [subId])).rows[0].billing_account_id
      const before = Number((await pg.query(`SELECT wallet_balance FROM accounts WHERE id = $1`, [acct])).rows[0].wallet_balance)
      const depId = randomUUID()
      await pg.query(`INSERT INTO payment_deposits (id, account_id, amount, deposit_date, period_months, is_wallet_deposit) VALUES ($1, $2, 2500, current_date, 0, true)`, [depId, acct])
      const [a, b] = await Promise.all([
        reviewPayment(req('PUT', `/api/sys-control/payments/${depId}`, { status: 'approved' }), ctx(depId)),
        reviewPayment(req('PUT', `/api/sys-control/payments/${depId}`, { status: 'approved' }), ctx(depId)),
      ])
      const after = Number((await pg.query(`SELECT wallet_balance FROM accounts WHERE id = $1`, [acct])).rows[0].wallet_balance)
      const ledger = (await pg.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE payment_deposit_id = $1`, [depId])).rows[0].n
      check('wallet credited exactly once with a ledger row', [a.status, b.status].sort().join(',') === '200,400' && after - before === 2500 && ledger === 1, { before, after, ledger })
      await pg.query(`DELETE FROM credit_transactions WHERE payment_deposit_id = $1`, [depId])
      await pg.query(`DELETE FROM payment_deposits WHERE id = $1`, [depId])

      const lock = await json(await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${subId}`, { lock: true, reason: 'I3 manual lock with a long free-text reason that exceeds fifty characters' }), ctx(subId)))
      const t = (await pg.query(`SELECT status, locked_reason, deletion_scheduled_at FROM tenants WHERE id = $1`, [vendorId])).rows[0]
      check('manual lock: locked, no automatic deletion scheduled', lock.status === 200 && t.status === 'locked' && t.locked_reason === 'admin_locked' && t.deletion_scheduled_at === null, { lock: lock.body, t })
      const unlock = await json(await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${subId}`, { unlock: true }), ctx(subId)))
      check('unlock restores sign-in', unlock.status === 200 && (await login(businessId, ownerEmail, currentPassword)) === 200)
      const list = await json(await listSubscriptions(req('GET', `/api/sys-control/subscriptions?q=${businessId}`)))
      check('subscriptions list: paginated, found by Business ID', list.status === 200 && list.body.subscriptions?.length === 1 && list.body.pagination?.total === 1, list.body)
    })

    // ============================================================ tier price change
    await step('tier price change keeps subscribers on their price', async () => {
      asAdmin()
      const tierId = randomUUID()
      tierIdsToDrop.push(tierId)
      await pg.query(`INSERT INTO pricing_tiers (id, name, display_name, price_monthly, price_yearly, is_active) VALUES ($1, $2, 'I3 tier', 1000, 10000, true)`, [tierId, `i3-${tag}`])
      const end = new Date(Date.now() + 20 * 86_400_000)
      await pg.query(`UPDATE subscriptions SET tier_id = $2, subscribed_price_monthly = NULL, subscribed_price_yearly = NULL, current_period_end = $3 WHERE id = $1`, [subId, tierId, end])
      const r = await json(await updateTier(req('PUT', `/api/sys-control/pricing-tiers/${tierId}`, { priceMonthly: 1500, priceYearly: 15000 }), ctx(tierId)))
      const s = (await pg.query(`SELECT subscribed_price_monthly, subscribed_price_yearly, current_period_end FROM subscriptions WHERE id = $1`, [subId])).rows[0]
      check('price update → 200, 1 subscriber grandfathered', r.status === 200 && r.body.grandfatheredCount === 1, r.body)
      check('subscriber pinned to the old price', Number(s.subscribed_price_monthly) === 1000 && Number(s.subscribed_price_yearly) === 10000, s)
      check('subscriber period untouched', new Date(s.current_period_end).getTime() === end.getTime())
      await pg.query(`UPDATE subscriptions SET tier_id = $2 WHERE id = $1`, [subId, starter.id])
    })

    // ============================================================ archive
    await step('archive (soft)', async () => {
      asAdmin()
      const wrong = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'archive', reason: 'I3 closing', confirm: 'nope' }), ctx(vendorId)))
      check('archive with wrong confirmation → 400', wrong.status === 400)
      const r = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'archive', reason: 'I3 closing', confirm: `${businessId.slice(0, 2)}-${businessId.slice(2)}` }), ctx(vendorId)))
      const t = (await pg.query(`SELECT status, deletion_scheduled_at FROM tenants WHERE id = $1`, [vendorId])).rows[0]
      const users = (await pg.query(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1`, [vendorId])).rows[0].n
      check('archived: status cancelled, nothing deleted, no deletion scheduled', r.status === 200 && t.status === 'cancelled' && t.deletion_scheduled_at === null && users === 1, { r: r.body, t })
      const imp = await json(await vendorAction(req('POST', `/api/sys-control/vendors/${vendorId}/actions`, { action: 'extend', days: 3, reason: 'nope' }), ctx(vendorId)))
      check('archived vendor cannot be extended until reactivated', imp.status === 400)
      check('archive audited as delete', (await pg.query(`SELECT 1 FROM admin_audit_logs WHERE resource_id = $1 AND action = 'delete' AND details->>'op' = 'archive'`, [vendorId])).rowCount === 1)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await cleanup(pg, tenantIds, tierIdsToDrop, adminId).catch((e) => console.error('cleanup failed:', e))
    }
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

/** Remove the throw-away vendors: every tenant-scoped row first (retrying in FK order), then the globals. */
async function cleanup(pg: Client, tenantIds: string[], tierIds: string[], adminId: string) {
  if (tenantIds.length) {
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
        try {
          await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])
        } catch {
          next.push(t)
        }
      }
      pending = next
    }
    await pg.query(`DELETE FROM staff_invites WHERE tenant_assignments::text LIKE ANY($1)`, [tenantIds.map((id) => `%${id}%`)])
    await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds])
    if (accountIds.length) {
      await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
    }
  }
  if (tierIds.length) await pg.query(`DELETE FROM pricing_tiers WHERE id = ANY($1::uuid[])`, [tierIds])
  await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [adminId])
  await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [adminId])
  await pg.query(`DELETE FROM super_admins WHERE id = $1`, [adminId])
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
