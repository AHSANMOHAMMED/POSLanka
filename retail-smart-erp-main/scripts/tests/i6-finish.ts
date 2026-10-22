/**
 * I6 — platform-admin roles, promo codes at checkout, PayHere refunds, broadcast push.
 *
 *   PAYHERE_MERCHANT_ID=1211111 PAYHERE_MERCHANT_SECRET=testsecret NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_deps DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/i6-finish.ts
 *
 * Calls the real route handlers (admin session cookie / bearer via the next/headers mock, account
 * session via the @/lib/auth mock). PayHere's Refund API and the Expo push endpoint are replaced
 * by a mocked global fetch. Throw-away rows stay in the test database (admins are deactivated).
 */
import { Client } from 'pg'
import { randomBytes, randomUUID, createHash } from 'crypto'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { setTestSession } from './w8-harness/auth-mock'

process.env.PAYHERE_MERCHANT_ID ||= '1211111'
process.env.PAYHERE_MERCHANT_SECRET ||= 'testsecret'
process.env.NEXTAUTH_SECRET ||= 'i3-test-secret'
delete process.env.PAYHERE_APP_ID
delete process.env.PAYHERE_APP_SECRET
delete process.env.RESEND_API_KEY

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
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  const addr = `10.66.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr, ...headers },
  })
}
function formReq(url: string, fields: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) as J } } catch { return { status: res.status, body: { raw: text } } }
}
const md5u = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase()
function notifySig(orderId: string, amount: string, currency: string, status: string) {
  return md5u(process.env.PAYHERE_MERCHANT_ID! + orderId + amount + currency + status + md5u(process.env.PAYHERE_MERCHANT_SECRET!))
}

/* ------------------------------------------------------------------ fetch mock */
type Handler = (url: string, init: RequestInit) => Promise<Response> | Response
const realFetch = globalThis.fetch
const fetchCalls: Array<{ url: string; body: string }> = []
let fetchHandler: Handler | null = null
globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (fetchHandler && /payhere\.lk|exp\.host|expo\.test/.test(url)) {
    fetchCalls.push({ url, body: typeof init.body === 'string' ? init.body : '' })
    return fetchHandler(url, init)
  }
  return realFetch(input, init)
}) as typeof fetch
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')

  // Route modules read env at load: import them after the env defaults above
  const { closeAllPools } = await import('@/lib/db')
  const admins = await import('@/app/api/sys-control/users/admins/route')
  const adminAction = (await import('@/app/api/sys-control/users/admins/[id]/route')).POST
  const settings = await import('@/app/api/sys-control/settings/route')
  const coupons = await import('@/app/api/sys-control/coupons/route')
  const payments = await import('@/app/api/sys-control/payments/route')
  const paymentReview = (await import('@/app/api/sys-control/payments/[id]/route')).PUT
  const messages = await import('@/app/api/sys-control/messages/route')
  const notifications = await import('@/app/api/sys-control/notifications/route')
  const errorLogs = await import('@/app/api/sys-control/error-logs/route')
  const impersonate = (await import('@/app/api/sys-control/vendors/[id]/impersonate/route')).POST
  const vendorActions = (await import('@/app/api/sys-control/vendors/[id]/actions/route')).POST
  const vendorPut = (await import('@/app/api/sys-control/vendors/[id]/route')).PUT
  const phTx = await import('@/app/api/sys-control/payhere-transactions/route')
  const refund = (await import('@/app/api/sys-control/payhere-transactions/[id]/refund/route')).POST
  const mobileLogin = (await import('@/app/api/sys-control/auth/mobile-login/route')).POST
  const checkout = (await import('@/app/api/payhere/checkout/route')).POST
  const notify = (await import('@/app/api/payhere/notify/route')).POST
  const { quoteCoupon, quoteCouponForDeposit } = await import('@/lib/billing/coupons')
  const { getAdminFromSession } = await import('@/lib/admin')
  const { sendBroadcast } = await import('@/lib/admin/broadcast')

  const pg = new Client({ connectionString: url })
  await pg.connect()
  const tag = randomBytes(3).toString('hex')
  const adminIds: string[] = []
  const parkedOwners: string[] = []

  async function makeAdmin(role: string, password = 'x'): Promise<{ id: string; token: string; email: string }> {
    const id = randomUUID()
    const email = `i6-${role}-${tag}-${adminIds.length}@example.test`
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, password === 'x' ? 'x' : await bcrypt.hash(password, 4), `I6 ${role}`, role])
    const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    adminIds.push(id)
    return { id, token, email }
  }
  const as = (a: { token: string } | null) => { setTestHeader('authorization', null); setTestCookie('admin_session', a ? a.token : null) }

  async function makeTenant(label: string) {
    const id = randomUUID()
    const slug = `i6-${label}-${tag}-${id.slice(0, 4)}`
    const r = await pg.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4) RETURNING business_id`, [id, `I6 ${label} ${tag}`, slug, `${slug}@example.test`])
    return { id, slug, businessId: r.rows[0].business_id as string }
  }
  async function makeUser(tenantId: string, role: string) {
    const id = randomUUID()
    await pg.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, $5)`, [id, tenantId, `${role}-${id.slice(0, 6)}@example.test`, `${role} user`, role])
    return id
  }
  async function makeAccount(wallet = 0) {
    const id = randomUUID()
    await pg.query(`INSERT INTO accounts (id, email, password_hash, full_name, phone, wallet_balance) VALUES ($1, $2, 'x', 'I6 Acc', $3, $4)`,
      [id, `i6-acc-${id.slice(0, 8)}@example.test`, `07${id.replace(/\D/g, '').slice(0, 8)}${ip++}`, wallet.toFixed(2)])
    return id
  }
  async function makeTier(monthly: number, yearly: number) {
    const id = randomUUID()
    await pg.query(`INSERT INTO pricing_tiers (id, name, display_name, price_monthly, price_yearly) VALUES ($1, $2, $2, $3, $4)`, [id, `i6-${id.slice(0, 6)}`, monthly.toFixed(2), yearly.toFixed(2)])
    return id
  }
  async function makeSub(tenantId: string, accountId: string, tierId: string) {
    const id = randomUUID()
    await pg.query(`INSERT INTO subscriptions (id, tenant_id, billing_account_id, tier_id, status, billing_cycle, current_period_start, current_period_end)
      VALUES ($1, $2, $3, $4, 'active', 'monthly', now() - interval '10 days', now() + interval '20 days')`, [id, tenantId, accountId, tierId])
    return id
  }
  async function makeCoupon(code: string, o: { type?: string; value?: number; maxUses?: number | null; used?: number; perAccount?: number; until?: string | null; tiers?: string[] | null; minCycle?: string | null } = {}) {
    const id = randomUUID()
    await pg.query(`INSERT INTO coupon_codes (id, code, discount_type, discount_value, max_uses, used_count, max_uses_per_account, valid_until, applicable_tiers, min_billing_cycle)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, code, o.type ?? 'percentage', (o.value ?? 20).toFixed(2), o.maxUses ?? null, o.used ?? 0, o.perAccount ?? 1, o.until ?? null, o.tiers ? JSON.stringify(o.tiers) : null, o.minCycle ?? null])
    return id
  }

  try {
    // Only the admins of this test are active owners (others are parked and restored at the end)
    const others = (await pg.query(`SELECT id FROM super_admins WHERE is_active AND role = 'owner'`)).rows.map((r) => r.id as string)
    if (others.length) {
      await pg.query(`UPDATE super_admins SET role = 'viewer' WHERE id = ANY($1::uuid[])`, [others])
      parkedOwners.push(...others)
    }
    const owner = await makeAdmin('owner')
    const support = await makeAdmin('support')
    const billing = await makeAdmin('billing')
    const viewer = await makeAdmin('viewer')
    const roles = { owner, support, billing, viewer } as const

    // ============================================================ static: every route names a permission
    await step('every sys-control handler states a permission', async () => {
      const files: string[] = []
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') files.push(p) } }
      walk(join(process.cwd(), 'src/app/api/sys-control'))
      const bad = files.filter((f) => {
        const src = readFileSync(f, 'utf8')
        if (/auth\/(login|mobile-login)\//.test(f)) return false
        return /validateAdminSession\(\s*\)/.test(src) || !/validateAdminSession\(/.test(src)
      })
      check(`all ${files.length} sys-control routes call validateAdminSession(<permission>)`, bad.length === 0, bad)
    })

    // ============================================================ role matrix
    await step('role matrix', async () => {
      const fakeId = randomUUID()
      type Probe = { name: string; allowed: Array<keyof typeof roles>; run: () => Promise<Response> }
      const probes: Probe[] = [
        { name: 'GET admins (read)', allowed: ['owner', 'support', 'billing', 'viewer'], run: () => admins.GET() },
        { name: 'GET payhere transactions (read)', allowed: ['owner', 'support', 'billing', 'viewer'], run: () => phTx.GET(req('GET', '/api/sys-control/payhere-transactions')) },
        { name: 'GET payments (read)', allowed: ['owner', 'support', 'billing', 'viewer'], run: () => payments.GET(req('GET', '/api/sys-control/payments')) },
        { name: 'POST admins (admins)', allowed: ['owner'], run: () => admins.POST(req('POST', '/api/sys-control/users/admins', { email: 'bad' })) },
        { name: 'PUT settings (settings)', allowed: ['owner'], run: () => settings.PUT(req('PUT', '/api/sys-control/settings', { key: 'nope' })) },
        { name: 'POST coupons (billing)', allowed: ['owner', 'billing'], run: () => coupons.POST(req('POST', '/api/sys-control/coupons', {})) },
        { name: 'PUT payment slip (billing)', allowed: ['owner', 'billing'], run: () => paymentReview(req('PUT', `/api/sys-control/payments/${fakeId}`, { status: 'nope' }), ctx(fakeId)) },
        { name: 'POST refund (billing)', allowed: ['owner', 'billing'], run: () => refund(req('POST', `/api/sys-control/payhere-transactions/${fakeId}/refund`, { reason: 'test refund' }), ctx(fakeId)) },
        { name: 'POST messages (messages)', allowed: ['owner', 'support'], run: () => messages.POST(req('POST', '/api/sys-control/messages', {})) },
        { name: 'POST notifications (notifications)', allowed: ['owner', 'support'], run: () => notifications.POST(req('POST', '/api/sys-control/notifications', {})) },
        { name: 'PUT error logs (error_logs)', allowed: ['owner', 'support'], run: () => errorLogs.PUT(req('PUT', '/api/sys-control/error-logs', {})) },
        { name: 'POST impersonate (vendors.impersonate)', allowed: ['owner', 'support'], run: () => impersonate(req('POST', `/api/sys-control/vendors/${fakeId}/impersonate`, {}), ctx(fakeId)) },
        { name: 'vendor action suspend (vendors.manage)', allowed: ['owner'], run: () => vendorActions(req('POST', `/api/sys-control/vendors/${fakeId}/actions`, { action: 'suspend', reason: 'role test' }), ctx(fakeId)) },
        { name: 'vendor action change_plan (billing)', allowed: ['owner', 'billing'], run: () => vendorActions(req('POST', `/api/sys-control/vendors/${fakeId}/actions`, { action: 'change_plan', tierId: randomUUID(), reason: 'role test' }), ctx(fakeId)) },
        { name: 'vendor PUT status (vendors.manage)', allowed: ['owner'], run: () => vendorPut(req('PUT', `/api/sys-control/vendors/${fakeId}`, { status: 'active' }), ctx(fakeId)) },
      ]
      for (const p of probes) {
        const got: Record<string, number> = {}
        let ok = true
        for (const r of Object.keys(roles) as Array<keyof typeof roles>) {
          as(roles[r])
          const res = await json(await p.run())
          got[r] = res.status
          const allowed = p.allowed.includes(r)
          if (allowed && (res.status === 401 || res.status === 403)) ok = false
          if (!allowed && !(res.status === 403 && res.body.code === 'ROLE_FORBIDDEN')) ok = false
        }
        check(`${p.name}: allowed for ${p.allowed.join('/')}, 403 for the rest`, ok, got)
      }
      as(null)
      const anon = await json(await admins.GET())
      check('no session → 401', anon.status === 401, anon)
    })

    // ============================================================ owners: roles + last owner
    await step('admin roles: create, change, last owner', async () => {
      as(owner)
      const created = await json(await admins.POST(req('POST', '/api/sys-control/users/admins', { email: `i6-new-${tag}@example.test`, fullName: 'I6 New', sendEmail: false, requireTotp: false })))
      if (created.body.admin?.id) adminIds.push(created.body.admin.id)
      check('new admin without a role → viewer (least privilege)', created.status === 201 && created.body.admin?.role === 'viewer', created.body)
      const withRole = await json(await admins.POST(req('POST', '/api/sys-control/users/admins', { email: `i6-bill-${tag}@example.test`, fullName: 'I6 Bill', role: 'billing', sendEmail: false, requireTotp: false })))
      if (withRole.body.admin?.id) adminIds.push(withRole.body.admin.id)
      check('create with role billing', withRole.status === 201 && withRole.body.admin?.role === 'billing', withRole.body)
      const bad = await json(await admins.POST(req('POST', '/api/sys-control/users/admins', { email: `i6-x-${tag}@example.test`, fullName: 'I6 X', role: 'superuser' })))
      check('unknown role → 400', bad.status === 400, bad.body)

      const selfDemote = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${owner.id}`, { action: 'change_role', role: 'viewer' }), ctx(owner.id)))
      check('last active owner cannot be demoted → 409', selfDemote.status === 409 && /last active owner/i.test(selfDemote.body.error || ''), selfDemote.body)

      const promote = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${support.id}`, { action: 'change_role', role: 'owner' }), ctx(support.id)))
      check('promote support → owner', promote.status === 200 && promote.body.admin?.role === 'owner', promote.body)
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = $2 AND details->>'op' = 'change_role'`, [owner.id, support.id])).rows
      check('role change audited with from/to', audit.length === 1 && audit[0].details.role?.from === 'support' && audit[0].details.role?.to === 'owner', audit)

      // Two owners deactivate each other at the same time: the row lock lets exactly one through
      const [a, b] = await Promise.all([
        (async () => { as(owner); return json(await adminAction(req('POST', `/api/sys-control/users/admins/${support.id}`, { action: 'deactivate' }), ctx(support.id))) })(),
        (async () => { await new Promise((r) => setTimeout(r, 5)); as(support); return json(await adminAction(req('POST', `/api/sys-control/users/admins/${owner.id}`, { action: 'deactivate' }), ctx(owner.id))) })(),
      ])
      const activeOwners = (await pg.query(`SELECT count(*)::int AS n FROM super_admins WHERE is_active AND role = 'owner' AND id = ANY($1::uuid[])`, [[owner.id, support.id]])).rows[0].n
      check('concurrent deactivation keeps an active owner', activeOwners >= 1 && [a.status, b.status].includes(200), { a: a.status, b: b.status, activeOwners })
      // restore: owner active + support back to support
      await pg.query(`UPDATE super_admins SET is_active = true, deactivated_at = NULL WHERE id = ANY($1::uuid[])`, [[owner.id, support.id]])
      await pg.query(`UPDATE super_admins SET role = 'support' WHERE id = $1`, [support.id])
      for (const x of [owner, support]) {
        await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour') ON CONFLICT DO NOTHING`, [x.id, x.token])
      }

      as(owner)
      const lastOwnerDeact = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${owner.id}`, { action: 'deactivate' }), ctx(owner.id)))
      check('cannot deactivate yourself (last owner) → 400', lastOwnerDeact.status === 400, lastOwnerDeact.body)

      as(viewer)
      const me = await getAdminFromSession()
      check('console layout gets the role', me?.role === 'viewer', me)
    })

    // ============================================================ mobile admin login carries the role
    await step('mobile admin login role', async () => {
      const mob = await makeAdmin('support', 'Mobile@12345')
      as(null)
      const login = await json(await mobileLogin(req('POST', '/api/sys-control/auth/mobile-login', { email: mob.email, password: 'Mobile@12345' })))
      check('mobile login returns role + permissions', login.status === 200 && login.body.admin?.role === 'support' && Array.isArray(login.body.permissions) && login.body.permissions.includes('vendors.impersonate') && !login.body.permissions.includes('billing'), login.body)
      setTestHeader('authorization', `Bearer ${login.body.token}`)
      const fakeId = randomUUID()
      const read = await json(await payments.GET(req('GET', '/api/sys-control/payments', undefined, { authorization: `Bearer ${login.body.token}` })))
      setTestHeader('authorization', `Bearer ${login.body.token}`)
      const approve = await json(await paymentReview(req('PUT', `/api/sys-control/payments/${fakeId}`, { status: 'approved' }, { authorization: `Bearer ${login.body.token}` }), ctx(fakeId)))
      check('support bearer: list payments 200, approve slip 403', read.status === 200 && approve.status === 403 && approve.body.code === 'ROLE_FORBIDDEN', { read: read.status, approve: approve.status })
      setTestHeader('authorization', null)
    })

    // ============================================================ promo codes
    const tierId = await makeTier(5000, 50000)
    const otherTier = await makeTier(7000, 70000)
    await step('promo code at PayHere checkout, counted once', async () => {
      const t = await makeTenant('coupon')
      const acc = await makeAccount()
      const sub = await makeSub(t.id, acc, tierId)
      const code = `I6P${tag}`.toUpperCase()
      const couponId = await makeCoupon(code, { value: 20, maxUses: 10, perAccount: 1 })
      setTestSession({ user: { id: randomUUID(), accountId: acc, tenantId: t.id, tenantSlug: t.slug, role: 'owner' } } as unknown as Parameters<typeof setTestSession>[0])

      const co = await json(await checkout(req('POST', '/api/payhere/checkout', { subscriptionId: sub, tierId, billingCycle: 'monthly', couponCode: code.toLowerCase() })))
      const row = (await pg.query(`SELECT id, amount, coupon_id, coupon_code, list_amount, discount_amount FROM payhere_transactions WHERE order_id = $1`, [co.body.orderId])).rows[0]
      check('checkout applies 20% server-side (5000 → 4000) and stores the discount', co.status === 200 && Number(row?.amount) === 4000 && Number(row?.discount_amount) === 1000 && Number(row?.list_amount) === 5000 && row?.coupon_id === couponId && co.body.coupon?.discount === 1000, { co: co.body, row })

      const fields = { merchant_id: process.env.PAYHERE_MERCHANT_ID!, order_id: co.body.orderId, payhere_amount: '4000.00', payhere_currency: 'LKR', status_code: '2', payment_id: `ph-${tag}`, method: 'VISA', md5sig: notifySig(co.body.orderId, '4000.00', 'LKR', '2') }
      const before = (await pg.query(`SELECT used_count FROM coupon_codes WHERE id = $1`, [couponId])).rows[0].used_count
      check('not counted before the payment succeeds', before === 0, before)
      const n1 = await notify(formReq('/api/payhere/notify', fields))
      const n2 = await notify(formReq('/api/payhere/notify', fields))
      const [n3] = await Promise.all([notify(formReq('/api/payhere/notify', fields)), notify(formReq('/api/payhere/notify', fields))])
      const used = (await pg.query(`SELECT used_count FROM coupon_codes WHERE id = $1`, [couponId])).rows[0].used_count
      const red = (await pg.query(`SELECT count(*)::int AS n, max(discount_amount) AS d FROM coupon_redemptions WHERE coupon_id = $1`, [couponId])).rows[0]
      check('notify + retries (sequential and concurrent) count the use once', n1.status === 200 && n2.status === 200 && n3.status === 200 && used === 1 && red.n === 1 && Number(red.d) === 1000, { used, red })

      const again = await json(await checkout(req('POST', '/api/payhere/checkout', { subscriptionId: sub, tierId, billingCycle: 'monthly', couponCode: code })))
      check('same account again → 400 already used', again.status === 400 && again.body.code === 'COUPON_INVALID' && /already used/i.test(again.body.error), again.body)

      // failed payment with a code: nothing counted
      const acc2 = await makeAccount()
      const t2 = await makeTenant('coupon2')
      const sub2 = await makeSub(t2.id, acc2, tierId)
      setTestSession({ user: { id: randomUUID(), accountId: acc2, tenantId: t2.id, tenantSlug: t2.slug, role: 'owner' } } as unknown as Parameters<typeof setTestSession>[0])
      const co2 = await json(await checkout(req('POST', '/api/payhere/checkout', { subscriptionId: sub2, tierId, billingCycle: 'monthly', couponCode: code })))
      await notify(formReq('/api/payhere/notify', { ...fields, order_id: co2.body.orderId, status_code: '-2', md5sig: notifySig(co2.body.orderId, '4000.00', 'LKR', '-2') }))
      const used2 = (await pg.query(`SELECT used_count FROM coupon_codes WHERE id = $1`, [couponId])).rows[0].used_count
      check('failed payment does not count the code', co2.status === 200 && used2 === 1, { co2: co2.status, used2 })

      const expired = `I6E${tag}`.toUpperCase()
      await makeCoupon(expired, { until: new Date(Date.now() - 86_400_000).toISOString() })
      const ex = await json(await checkout(req('POST', '/api/payhere/checkout', { subscriptionId: sub2, tierId, billingCycle: 'monthly', couponCode: expired })))
      check('expired code → 400', ex.status === 400 && /expired/i.test(ex.body.error), ex.body)
      const full = `I6X${tag}`.toUpperCase()
      await makeCoupon(full, { maxUses: 3, used: 3 })
      const fx = await json(await checkout(req('POST', '/api/payhere/checkout', { subscriptionId: sub2, tierId, billingCycle: 'monthly', couponCode: full })))
      check('exhausted code → 400', fx.status === 400 && /usage limit/i.test(fx.body.error), fx.body)
      const pending = (await pg.query(`SELECT count(*)::int AS n FROM payhere_transactions WHERE account_id = $1 AND coupon_code IN ($2, $3)`, [acc2, expired, full])).rows[0].n
      check('rejected codes create no transaction', pending === 0, pending)

      const tierOnly = `I6T${tag}`.toUpperCase()
      await makeCoupon(tierOnly, { tiers: [otherTier] })
      const q1 = await quoteCoupon({ code: tierOnly, accountId: acc2, tierId, billingCycle: 'monthly', amount: 5000 })
      const yearlyOnly = `I6Y${tag}`.toUpperCase()
      await makeCoupon(yearlyOnly, { minCycle: 'annual', type: 'fixed_amount', value: 9000 })
      const q2 = await quoteCoupon({ code: yearlyOnly, accountId: acc2, tierId, billingCycle: 'monthly', amount: 5000 })
      const q3 = await quoteCoupon({ code: yearlyOnly, accountId: acc2, tierId, billingCycle: 'yearly', amount: 50000 })
      check('plan / yearly-only rules; fixed amount', !q1.ok && !q2.ok && q3.ok && q3.discount === 9000 && q3.finalAmount === 41000, { q1, q2, q3: q3.ok ? q3.finalAmount : q3 })
    })

    await step('promo code on a bank slip: counted on approval, once', async () => {
      const t = await makeTenant('slip')
      const acc = await makeAccount()
      const sub = await makeSub(t.id, acc, tierId)
      const code = `I6B${tag}`.toUpperCase()
      const couponId = await makeCoupon(code, { type: 'fixed_amount', value: 500 })
      const q = await quoteCouponForDeposit({ code, accountId: acc, subscriptionId: sub, periodMonths: 3 })
      check('slip quote: 3 months × 5000 − 500', q.ok && q.listAmount === 15000 && q.finalAmount === 14500, q)
      const depId = randomUUID()
      await pg.query(`INSERT INTO payment_deposits (id, account_id, subscription_id, amount, deposit_date, period_months, coupon_id, coupon_code, list_amount, discount_amount)
        VALUES ($1, $2, $3, 14500, current_date, 3, $4, $5, 15000, 500)`, [depId, acc, sub, couponId, code])
      as(billing)
      const ap = await json(await paymentReview(req('PUT', `/api/sys-control/payments/${depId}`, { status: 'approved' }), ctx(depId)))
      const ap2 = await json(await paymentReview(req('PUT', `/api/sys-control/payments/${depId}`, { status: 'approved' }), ctx(depId)))
      const used = (await pg.query(`SELECT used_count FROM coupon_codes WHERE id = $1`, [couponId])).rows[0].used_count
      const red = (await pg.query(`SELECT source, paid_amount FROM coupon_redemptions WHERE payment_deposit_id = $1`, [depId])).rows
      check('approve (billing) → redemption with the slip; second approval refused', ap.status === 200 && ap2.status === 400 && used === 1 && red.length === 1 && red[0].source === 'bank_deposit' && Number(red[0].paid_amount) === 14500, { ap: ap.body, ap2: ap2.status, used, red })
      const list = await json(await payments.GET(req('GET', '/api/sys-control/payments?status=approved')))
      const shown = (list.body.payments ?? []).find((p: J) => p.id === depId)
      check('slip list shows the code and discount', shown?.couponCode === code && Number(shown?.discountAmount) === 500, shown)
    })

    // ============================================================ refunds
    await step('PayHere refund: credentials, idempotency, failure + retry', async () => {
      const t = await makeTenant('refund')
      const acc = await makeAccount()
      const sub = await makeSub(t.id, acc, tierId)
      const txId = randomUUID()
      const orderId = `I6R-${tag}-${txId.slice(0, 6)}`
      await pg.query(`INSERT INTO payhere_transactions (id, account_id, subscription_id, order_id, payhere_payment_id, amount, status, period_months, billing_cycle, paid_at, activated_at)
        VALUES ($1, $2, $3, $4, $5, 5000, 'success', 1, 'monthly', now(), now())`, [txId, acc, sub, orderId, `32${Date.now()}`])
      const periodBefore = (await pg.query(`SELECT current_period_end FROM subscriptions WHERE id = $1`, [sub])).rows[0].current_period_end

      as(billing)
      const nc = await json(await refund(req('POST', `/api/sys-control/payhere-transactions/${txId}/refund`, { reason: 'Customer asked' }), ctx(txId)))
      check('no PAYHERE_APP_ID/SECRET → 503 REFUND_NOT_CONFIGURED with a clear message', nc.status === 503 && nc.body.code === 'REFUND_NOT_CONFIGURED' && /PAYHERE_APP_ID/.test(nc.body.error), nc.body)
      const listed = await json(await phTx.GET(req('GET', '/api/sys-control/payhere-transactions')))
      check('transactions list says refunds are not configured', listed.body.refundsConfigured === false, listed.body.refundsConfigured)

      process.env.PAYHERE_APP_ID = 'app-id'
      process.env.PAYHERE_APP_SECRET = 'app-secret'
      fetchCalls.length = 0
      fetchHandler = async (u) => {
        if (u.endsWith('/merchant/v1/oauth/token')) return jsonRes({ access_token: 'tok', token_type: 'bearer', expires_in: 599 })
        if (u.endsWith('/merchant/v1/payment/refund')) { await new Promise((r) => setTimeout(r, 50)); return jsonRes({ status: 1, msg: 'Successfully submitted the refund request', data: 77001 }) }
        return jsonRes({}, 404)
      }
      const [r1, r2] = await Promise.all([
        refund(req('POST', `/api/sys-control/payhere-transactions/${txId}/refund`, { reason: 'Customer asked' }), ctx(txId)).then(json),
        refund(req('POST', `/api/sys-control/payhere-transactions/${txId}/refund`, { reason: 'Customer asked' }), ctx(txId)).then(json),
      ])
      const refundCalls = fetchCalls.filter((c) => c.url.endsWith('/payment/refund'))
      const tokenCall = fetchCalls.find((c) => c.url.endsWith('/oauth/token'))
      check('double click: one 200 + one 409, PayHere refund called once', [r1.status, r2.status].sort().join(',') === '200,409' && refundCalls.length === 1, { r1: r1.status, r2: r2.status, calls: refundCalls.length })
      check('sandbox endpoints + client-credentials grant + payment_id sent', !!tokenCall && tokenCall.url.startsWith('https://sandbox.payhere.lk') && /grant_type=client_credentials/.test(tokenCall.body) && JSON.parse(refundCalls[0]?.body || '{}').payment_id?.startsWith('32'), { tokenCall, refundCalls })
      const row = (await pg.query(`SELECT status, refund_status, refunded_amount, refund_reference, refund_reason, refunded_by FROM payhere_transactions WHERE id = $1`, [txId])).rows[0]
      check('transaction records refund status / amount / reference / admin', row.status === 'refunded' && row.refund_status === 'refunded' && Number(row.refunded_amount) === 5000 && row.refund_reference === '77001' && row.refund_reason === 'Customer asked' && row.refunded_by === billing.id, row)
      const ok = r1.status === 200 ? r1 : r2
      check('response says what the payment bought; subscription untouched', ok.body.subscription?.id === sub && ok.body.subscription?.periodMonths === 1, ok.body)
      const periodAfter = (await pg.query(`SELECT current_period_end FROM subscriptions WHERE id = $1`, [sub])).rows[0].current_period_end
      check('subscription period not changed by the refund', new Date(periodAfter).getTime() === new Date(periodBefore).getTime())
      const third = await json(await refund(req('POST', `/api/sys-control/payhere-transactions/${txId}/refund`, { reason: 'again' }), ctx(txId)))
      check('refund again → 409 ALREADY_REFUNDED', third.status === 409 && third.body.code === 'ALREADY_REFUNDED', third.body)
      const audit = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = $2 AND details->>'op' = 'refund'`, [billing.id, txId])).rows[0].n
      check('refund audited once', audit === 1, audit)

      // rejected by PayHere → failed (retry allowed) → success
      const tx2 = randomUUID()
      await pg.query(`INSERT INTO payhere_transactions (id, account_id, subscription_id, order_id, payhere_payment_id, amount, status, period_months, billing_cycle, paid_at, activated_at)
        VALUES ($1, $2, $3, $4, '3200000099', 2500, 'success', 1, 'monthly', now(), now())`, [tx2, acc, sub, `I6R2-${tag}`])
      fetchHandler = (u) => u.endsWith('/oauth/token') ? jsonRes({ access_token: 'tok' }) : jsonRes({ status: -1, msg: 'Payment not eligible for refund' })
      const rej = await json(await refund(req('POST', `/api/sys-control/payhere-transactions/${tx2}/refund`, { reason: 'Duplicate' }), ctx(tx2)))
      const r2row = (await pg.query(`SELECT status, refund_status, refund_error FROM payhere_transactions WHERE id = $1`, [tx2])).rows[0]
      check('PayHere rejection → 502, recorded as failed, payment still success', rej.status === 502 && rej.body.code === 'REFUND_REJECTED' && r2row.refund_status === 'failed' && r2row.status === 'success' && /not eligible/.test(r2row.refund_error), { rej: rej.body, r2row })
      fetchHandler = (u) => u.endsWith('/oauth/token') ? jsonRes({ access_token: 'tok' }) : jsonRes({ status: 1, msg: 'ok', data: 'R-2' })
      const retry = await json(await refund(req('POST', `/api/sys-control/payhere-transactions/${tx2}/refund`, { reason: 'Duplicate' }), ctx(tx2)))
      check('retry after a failed attempt succeeds', retry.status === 200 && retry.body.reference === 'R-2', retry.body)
      fetchHandler = (u) => u.endsWith('/oauth/token') ? jsonRes({ error: 'invalid_client' }, 401) : jsonRes({ status: 1 })
      const tx3 = randomUUID()
      await pg.query(`INSERT INTO payhere_transactions (id, account_id, order_id, payhere_payment_id, amount, status, period_months, paid_at) VALUES ($1, $2, $3, '3200000100', 100, 'success', 1, now())`, [tx3, acc, `I6R3-${tag}`])
      const authFail = await json(await refund(req('POST', `/api/sys-control/payhere-transactions/${tx3}/refund`, { reason: 'Bad creds' }), ctx(tx3)))
      check('bad app credentials → 502 REFUND_AUTH_FAILED', authFail.status === 502 && authFail.body.code === 'REFUND_AUTH_FAILED', authFail.body)
      as(support)
      const denied = await json(await refund(req('POST', `/api/sys-control/payhere-transactions/${tx3}/refund`, { reason: 'Support try' }), ctx(tx3)))
      check('support role cannot refund', denied.status === 403, denied.body)
      fetchHandler = null
      delete process.env.PAYHERE_APP_ID
      delete process.env.PAYHERE_APP_SECRET
    })

    // ============================================================ broadcast push
    await step('broadcast push: batching, scope, per-vendor status', async () => {
      const A = await makeTenant('pushA')
      const B = await makeTenant('pushB')
      const C = await makeTenant('pushC')
      const aOwner = await makeUser(A.id, 'owner')
      const aCashier = await makeUser(A.id, 'cashier')
      const bManager = await makeUser(B.id, 'manager')
      await makeUser(C.id, 'owner') // no phone
      const tok = (n: string) => `ExponentPushToken[i6-${tag}-${n}]`
      const devices: Array<[string, string, string]> = []
      for (let i = 0; i < 120; i++) devices.push([A.id, aOwner, tok(`a${i}`)])
      devices.push([A.id, aCashier, tok('cashier')])
      devices.push([B.id, bManager, tok('b1')], [B.id, bManager, tok('b-dead')])
      for (const [t, u, k] of devices) await pg.query(`INSERT INTO user_devices (tenant_id, user_id, push_token, platform) VALUES ($1, $2, $3, 'android')`, [t, u, k])

      fetchCalls.length = 0
      fetchHandler = async (_u, init) => {
        const msgs = JSON.parse(String(init.body)) as Array<{ to: string }>
        return jsonRes({ data: msgs.map((m) => m.to.includes('b-dead') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: randomUUID() }) })
      }
      as(support)
      const audience = { mode: 'selected', businessIds: [A.businessId, B.businessId, C.businessId] }
      const prev = await json(await notifications.POST(req('POST', '/api/sys-control/notifications', { title: 'I6 push', body: 'Maintenance tonight', link: '/account/billing', channels: ['push'], audience, dryRun: true })))
      check('preview counts phones of owners + managers (cashier excluded)', prev.status === 200 && prev.body.preview?.pushDeviceCount === 122 && prev.body.preview?.pushUserCount === 3, prev.body.preview)
      const sent = await json(await notifications.POST(req('POST', '/api/sys-control/notifications', { title: 'I6 push', body: 'Maintenance tonight', link: '/account/billing', channels: ['push', 'in_app'], audience })))
      const pushCalls = fetchCalls.filter((c) => /exp\.host/.test(c.url))
      const sizes = pushCalls.map((c) => JSON.parse(c.body).length)
      check('Expo called in batches of ≤100 (122 phones → 100 + 22)', sizes.length === 2 && sizes[0] === 100 && sizes[1] === 22, sizes)
      const payload = JSON.parse(pushCalls[0]?.body || '[]')[0]
      check('push carries title, body and the broadcast link', payload?.title === 'I6 push' && payload?.data?.link === '/account/billing' && payload?.data?.type === 'platform_announcement', payload)
      const r = sent.body.result
      check('totals: 121 sent, 1 failed, 1 vendor without phone, status partial', sent.status === 201 && r.pushSent === 121 && r.pushFailed === 1 && r.pushNoDevice === 1 && r.status === 'partial', r)
      const rows = (await pg.query(`SELECT vendor_id, push_status, push_sent, push_failed FROM platform_broadcast_recipients WHERE broadcast_id = $1`, [r.id])).rows
      const byV = Object.fromEntries(rows.map((x) => [x.vendor_id, x]))
      check('per-vendor push status: A sent 120, B partial 1/1, C no_device', byV[A.id]?.push_status === 'sent' && byV[A.id]?.push_sent === 120 && byV[B.id]?.push_status === 'partial' && byV[B.id]?.push_failed === 1 && byV[C.id]?.push_status === 'no_device', rows)
      const dead = (await pg.query(`SELECT count(*)::int AS n FROM user_devices WHERE push_token = $1`, [tok('b-dead')])).rows[0].n
      check('unregistered device removed', dead === 0, dead)
      const inbox = (await pg.query(`SELECT data FROM in_app_notifications WHERE tenant_id = $1 AND type = 'platform_announcement' ORDER BY created_at DESC LIMIT 1`, [A.id])).rows[0]
      check('inbox row carries the link for the bell', inbox?.data?.link === '/account/billing', inbox)

      fetchCalls.length = 0
      const all = await sendBroadcast({ title: 'I6 all staff', body: 'Hello everyone', channels: ['push'], recipientScope: 'owners', pushScope: 'all_staff', category: 'info', audience: { mode: 'selected', businessIds: [A.businessId] }, kind: 'notification', superAdminId: owner.id, baseUrl: 'http://localhost' })
      check('pushScope all_staff includes the cashier phone (121)', all.pushSent === 121, all)
      fetchHandler = null
    })
  } finally {
    fetchHandler = null
    if (parkedOwners.length) await pg.query(`UPDATE super_admins SET role = 'owner' WHERE id = ANY($1::uuid[])`, [parkedOwners])
    if (adminIds.length) {
      await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = ANY($1::uuid[])`, [adminIds])
      await pg.query(`UPDATE super_admins SET is_active = false, deactivated_at = now(), role = 'viewer' WHERE id = ANY($1::uuid[])`, [adminIds])
    }
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
