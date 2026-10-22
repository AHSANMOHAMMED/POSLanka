/**
 * GF audit — auth, permissions & platform billing.
 *
 *   PAYHERE_MERCHANT_ID=1211111 PAYHERE_MERCHANT_SECRET=testsecret NEXTAUTH_SECRET=gf-test-secret \
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_audit_f DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/gF-auth.ts
 *
 * Covers: live role/deactivation/password/account checks for sessions, single-use reset links,
 * owner-promotion + permission-escalation guards on staff management, plan seat limits,
 * atomic invite acceptance, server-side PayHere pricing, idempotent PayHere notify with
 * correct period / grandfathered price / wallet handling, proration across billing cycles,
 * past_due → locked enforcement, and the added permission checks.
 */
import { Client } from 'pg'
import { randomUUID, createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { getLiveCompanyUser } from '@/lib/auth/live-user'
import { rolePermissionsNotHeld } from '@/lib/auth/roles'
import { calculateProration, renewalStartDate } from '@/lib/billing/proration'
import { quotePlanChange } from '@/lib/billing/plan-change'
import { POST as staffReset } from '@/app/api/auth/staff-reset-password/route'
import { POST as accountReset } from '@/app/api/auth/reset-password/route'
import { POST as createUser } from '@/app/api/users/route'
import { PUT as updateUser } from '@/app/api/users/[id]/route'
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route'
import { POST as payhereCheckout } from '@/app/api/payhere/checkout/route'
import { POST as payhereNotify } from '@/app/api/payhere/notify/route'
import { POST as enforceSubs } from '@/app/api/cron/enforce-subscriptions/route'
import { GET as getSmsSettings } from '@/app/api/sms-settings/route'
import { GET as getCostHistory } from '@/app/api/items/[id]/cost-history/route'
import { DELETE as deleteCollectionFile } from '@/app/api/collections/[id]/files/route'
import { checkAdminTotp, generateTotpSecret } from '@/lib/admin/totp'
import { authenticator } from 'otplib'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const SECRET = process.env.NEXTAUTH_SECRET || ''
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

interface Fx { tenantId: string; slug: string; ownerId: string }
let ipCounter = 1
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`, ...headers },
  })
}
function formReq(url: string, fields: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: {} }
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: { raw: text } } }
}
function sessionFor(f: Fx, userId: string, role: string, accountId: string | null = null) {
  return {
    user: {
      id: userId, accountId, email: `${role}@example.test`, name: role, role, customRoleId: null,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'GF', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const ownerId = randomUUID()
  const slug = `gf-${label}-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)`, [tenantId, `GF ${label}`, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [ownerId, tenantId, `owner-${slug}@example.test`])
  return { tenantId, slug, ownerId }
}
async function makeUser(admin: Client, f: Fx, role: string, extra: { accountId?: string } = {}): Promise<string> {
  const id = randomUUID()
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, account_id) VALUES ($1, $2, $3, 'x', $4, $5, $6)`,
    [id, f.tenantId, `${role}-${id.slice(0, 6)}@example.test`, `${role} user`, role, extra.accountId ?? null])
  return id
}
async function makeAccount(admin: Client, wallet = 0): Promise<string> {
  const id = randomUUID()
  await admin.query(`INSERT INTO accounts (id, email, password_hash, full_name, phone, wallet_balance) VALUES ($1, $2, 'x', 'Acc', $3, $4)`,
    [id, `acc-${id.slice(0, 8)}@example.test`, `07${id.replace(/\D/g, '').slice(0, 8)}${ipCounter++}`, wallet.toFixed(2)])
  return id
}
async function makeTier(admin: Client, monthly: number, yearly: number, maxUsers: number | null = null): Promise<string> {
  const id = randomUUID()
  await admin.query(`INSERT INTO pricing_tiers (id, name, display_name, price_monthly, price_yearly, max_users) VALUES ($1, $2, $2, $3, $4, $5)`,
    [id, `gf-${id.slice(0, 6)}`, monthly.toFixed(2), yearly.toFixed(2), maxUsers])
  return id
}
function md5u(s: string) { return createHash('md5').update(s).digest('hex').toUpperCase() }
function notifySig(orderId: string, amount: string, currency: string, status: string) {
  return md5u((process.env.PAYHERE_MERCHANT_ID || '') + orderId + amount + currency + status + md5u(process.env.PAYHERE_MERCHANT_SECRET || ''))
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!SECRET || !process.env.PAYHERE_MERCHANT_SECRET) throw new Error('NEXTAUTH_SECRET and PAYHERE_MERCHANT_* must be set')
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const A = await makeTenant(admin, 'a')

  // ===================================================== live session state
  await step('live user state', async () => {
    const acc = await makeAccount(admin)
    const uid = await makeUser(admin, A, 'manager', { accountId: acc })
    const nowSec = Math.floor(Date.now() / 1000)
    let live = await getLiveCompanyUser(A.tenantId, uid, nowSec)
    check('active manager → ok with role manager', live.ok && live.role === 'manager', live)
    await admin.query(`UPDATE users SET role='cashier' WHERE id=$1`, [uid])
    live = await getLiveCompanyUser(A.tenantId, uid, nowSec)
    check('demotion picked up on next request (role cashier)', live.ok && live.role === 'cashier', live)
    await admin.query(`UPDATE users SET password_changed_at = now() + interval '5 seconds' WHERE id=$1`, [uid])
    live = await getLiveCompanyUser(A.tenantId, uid, nowSec)
    check('password changed after token issued → rejected', !live.ok && live.reason === 'password_changed', live)
    await admin.query(`UPDATE users SET password_changed_at = NULL WHERE id=$1`, [uid])
    await admin.query(`UPDATE accounts SET is_active=false WHERE id=$1`, [acc])
    live = await getLiveCompanyUser(A.tenantId, uid, nowSec)
    check('suspended global account → rejected', !live.ok && live.reason === 'account_inactive', live)
    await admin.query(`UPDATE accounts SET is_active=true WHERE id=$1`, [acc])
    await admin.query(`UPDATE users SET is_active=false WHERE id=$1`, [uid])
    live = await getLiveCompanyUser(A.tenantId, uid, nowSec)
    check('deactivated user → rejected', !live.ok && live.reason === 'inactive', live)
  })

  // ===================================================== reset links are single use
  await step('reset links single use', async () => {
    const uid = await makeUser(admin, A, 'cashier')
    const email = (await admin.query(`SELECT email FROM users WHERE id=$1`, [uid])).rows[0].email
    const token = await new SignJWT({ userId: uid, email, tenantId: A.tenantId, purpose: 'staff-password-reset' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(Math.floor(Date.now() / 1000) - 5).setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET))
    const first = await json(await staffReset(req('POST', '/api/auth/staff-reset-password', { token, newPassword: 'NewPass#2026a', confirmPassword: 'NewPass#2026a' })))
    check('staff reset: first use succeeds', first.status === 200, first)
    const second = await json(await staffReset(req('POST', '/api/auth/staff-reset-password', { token, newPassword: 'Other#2026bb', confirmPassword: 'Other#2026bb' })))
    check('staff reset: same link rejected the second time', second.status === 400, second)

    const acc = await makeAccount(admin)
    const accEmail = (await admin.query(`SELECT email FROM accounts WHERE id=$1`, [acc])).rows[0].email
    const atoken = await new SignJWT({ accountId: acc, email: accEmail, purpose: 'password-reset' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(Math.floor(Date.now() / 1000) - 5).setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET))
    const a1 = await json(await accountReset(req('POST', '/api/auth/reset-password', { token: atoken, newPassword: 'NewPass#2026a', confirmPassword: 'NewPass#2026a' })))
    const a2 = await json(await accountReset(req('POST', '/api/auth/reset-password', { token: atoken, newPassword: 'Other#2026bb', confirmPassword: 'Other#2026bb' })))
    check('account reset: first use 200, replay 400', a1.status === 200 && a2.status === 400, { a1, a2 })
  })

  // ===================================================== staff management guards
  await step('staff management guards', async () => {
    const managerId = await makeUser(admin, A, 'manager')
    const cashierId = await makeUser(admin, A, 'cashier')
    const hrId = await makeUser(admin, A, 'hr_manager')

    setTestSession(sessionFor(A, A.ownerId, 'owner'))
    const promote = await json(await updateUser(req('PUT', `/api/users/${cashierId}`, { role: 'owner' }), { params: Promise.resolve({ id: cashierId }) }))
    check('owner cannot promote staff to owner via PUT (400)', promote.status === 400, promote)

    const acc = await makeAccount(admin)
    const linked = await makeUser(admin, A, 'manager', { accountId: acc })
    await admin.query(`INSERT INTO account_tenants (account_id, tenant_id, role) VALUES ($1, $2, 'manager')`, [acc, A.tenantId])
    const demote = await json(await updateUser(req('PUT', `/api/users/${linked}`, { role: 'cashier', password: 'Reset#Pass2026' }), { params: Promise.resolve({ id: linked }) }))
    const m = await admin.query(`SELECT role FROM account_tenants WHERE account_id=$1 AND tenant_id=$2`, [acc, A.tenantId])
    const u = await admin.query(`SELECT password_changed_at FROM users WHERE id=$1`, [linked])
    check('role change synced to account portal membership', demote.status === 200 && m.rows[0]?.role === 'cashier', { demote, m: m.rows })
    check('admin password reset sets passwordChangedAt (signs user out)', !!u.rows[0]?.password_changed_at)

    setTestSession(sessionFor(A, managerId, 'manager'))
    const mkSys = await json(await createUser(req('POST', '/api/users', { mode: 'create', email: `sys-${randomUUID().slice(0, 6)}@example.test`, fullName: 'Sys', role: 'system_manager', password: 'Strong#Pass2026' })))
    check('manager cannot create a system_manager (would gain manageSettings) → 403', mkSys.status === 403, mkSys)
    const mkCashier = await json(await createUser(req('POST', '/api/users', { mode: 'create', email: `c-${randomUUID().slice(0, 6)}@example.test`, fullName: 'Cash', role: 'cashier', password: 'Strong#Pass2026' })))
    check('manager can still create a cashier', mkCashier.status === 201, mkCashier)
    const toHr = await json(await updateUser(req('PUT', `/api/users/${cashierId}`, { role: 'hr_manager' }), { params: Promise.resolve({ id: cashierId }) }))
    check('manager cannot re-role cashier to hr_manager (payroll powers) → 403', toHr.status === 403, toHr)
    const takeOver = await json(await updateUser(req('PUT', `/api/users/${hrId}`, { password: 'Takeover#2026' }), { params: Promise.resolve({ id: hrId }) }))
    check('manager cannot reset an hr_manager password → 403', takeOver.status === 403, takeOver)
    check('rolePermissionsNotHeld(manager, hr_manager) lists processPayroll',
      rolePermissionsNotHeld('manager', 'hr_manager', A.tenantId).includes('processPayroll'))
    check('owner may grant any role', rolePermissionsNotHeld('owner', 'system_manager', A.tenantId).length === 0)
  })

  // ===================================================== plan seat limit
  await step('plan user limit', async () => {
    const B = await makeTenant(admin, 'seat')
    const acc = await makeAccount(admin)
    const tier = await makeTier(admin, 1000, 10000, 2)
    await admin.query(`INSERT INTO subscriptions (tenant_id, billing_account_id, tier_id, status) VALUES ($1, $2, $3, 'active')`, [B.tenantId, acc, tier])
    setTestSession(sessionFor(B, B.ownerId, 'owner'))
    const mk = (n: string) => createUser(req('POST', '/api/users', { mode: 'create', email: `${n}-${randomUUID().slice(0, 6)}@example.test`, fullName: n, role: 'cashier', password: 'Strong#Pass2026' }))
    const second = await json(await mk('second'))
    const third = await json(await mk('third'))
    check('2-user plan: second user allowed', second.status === 201, second)
    check('2-user plan: third user blocked with 402 USER_LIMIT', third.status === 402 && third.body.code === 'USER_LIMIT', third)
    const inactive = await makeUser(admin, B, 'cashier')
    await admin.query(`UPDATE users SET is_active=false WHERE id=$1`, [inactive])
    const react = await json(await updateUser(req('PUT', `/api/users/${inactive}`, { isActive: true }), { params: Promise.resolve({ id: inactive }) }))
    check('re-activating a user beyond the limit → 402', react.status === 402, react)
  })

  // ===================================================== invite acceptance
  await step('invite acceptance is atomic', async () => {
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    const email = `inv-${randomUUID().slice(0, 6)}@example.test`
    await admin.query(`INSERT INTO staff_invites (email, token, tenant_assignments, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [email, token, JSON.stringify([{ tenantId: A.tenantId, role: 'cashier' }])])
    const body = { fullName: 'Invitee', password: 'Strong#Pass2026', confirmPassword: 'Strong#Pass2026' }
    const [r1, r2] = await Promise.all([
      json(await acceptInvite(req('POST', `/api/invites/${token}/accept`, body), { params: Promise.resolve({ token }) })),
      json(await acceptInvite(req('POST', `/api/invites/${token}/accept`, body), { params: Promise.resolve({ token }) })),
    ])
    const n = await admin.query(`SELECT count(*)::int n FROM users WHERE tenant_id=$1 AND email=$2`, [A.tenantId, email])
    check('concurrent accepts: exactly one succeeds', [r1.status, r2.status].filter(s => s === 200).length === 1, { r1, r2 })
    check('concurrent accepts: one user row created', n.rows[0].n === 1, n.rows)
    const r3 = await json(await acceptInvite(req('POST', `/api/invites/${token}/accept`, body), { params: Promise.resolve({ token }) }))
    check('used invite rejected (400)', r3.status === 400, r3)

    const expTok = randomUUID().replace(/-/g, '') + 'x'
    await admin.query(`INSERT INTO staff_invites (email, token, tenant_assignments, expires_at) VALUES ($1, $2, $3, now() - interval '1 minute')`,
      [`exp-${email}`, expTok, JSON.stringify([{ tenantId: A.tenantId, role: 'cashier' }])])
    const r4 = await json(await acceptInvite(req('POST', `/api/invites/${expTok}/accept`, body), { params: Promise.resolve({ token: expTok }) }))
    check('expired invite rejected (400)', r4.status === 400, r4)
  })

  // ===================================================== PayHere: server-side pricing
  await step('payhere checkout prices server-side', async () => {
    const C = await makeTenant(admin, 'pay')
    const acc = await makeAccount(admin, 0)
    const basic = await makeTier(admin, 3000, 30000)
    const premium = await makeTier(admin, 9000, 90000)
    const subId = randomUUID()
    await admin.query(`INSERT INTO subscriptions (id, tenant_id, billing_account_id, tier_id, status, billing_cycle, current_period_start, current_period_end)
      VALUES ($1, $2, $3, $4, 'active', 'monthly', now() - interval '15 days', now() + interval '15 days')`, [subId, C.tenantId, acc, basic])
    setTestSession(sessionFor(C, C.ownerId, 'owner', acc))

    const renew = await json(await payhereCheckout(req('POST', '/api/payhere/checkout', { subscriptionId: subId, tierId: basic, billingCycle: 'monthly', amount: 1 })))
    const rt = await admin.query(`SELECT amount FROM payhere_transactions WHERE order_id=$1`, [renew.body.orderId])
    check('renewal: client amount=1 ignored, full price charged', renew.status === 200 && Number(rt.rows[0]?.amount) === 3000, { renew, rows: rt.rows })

    const cheap = await json(await payhereCheckout(req('POST', '/api/payhere/checkout', { subscriptionId: subId, tierId: randomUUID(), billingCycle: 'monthly' })))
    check('renewal: priced from the subscription tier, not the body tierId', cheap.status === 200, cheap)

    const up = await json(await payhereCheckout(req('POST', '/api/payhere/checkout', { subscriptionId: subId, tierId: premium, newTierId: premium, billingCycle: 'monthly', amount: 1, walletCreditApplied: 5000 })))
    const ut = await admin.query(`SELECT amount, wallet_credit_applied, new_tier_id FROM payhere_transactions WHERE order_id=$1`, [up.body.orderId])
    const amount = Number(ut.rows[0]?.amount)
    check('upgrade: amount is the prorated quote (~3000 for half a month), not 1', up.status === 200 && amount > 2500 && amount < 3500, ut.rows)
    check('upgrade: forged walletCreditApplied ignored (wallet empty → 0)', Number(ut.rows[0]?.wallet_credit_applied) === 0, ut.rows)

    // ---- notify: upgrade success applies tier + locks its price; replay is a no-op
    const amt = Number(ut.rows[0].amount).toFixed(2)
    const fields = { merchant_id: process.env.PAYHERE_MERCHANT_ID || '', order_id: up.body.orderId, payhere_amount: amt, payhere_currency: 'LKR', status_code: '2', payment_id: 'p1', method: 'VISA', md5sig: notifySig(up.body.orderId, amt, 'LKR', '2') }
    const n1 = await json(await payhereNotify(formReq('/api/payhere/notify', fields)))
    const s1 = await admin.query(`SELECT tier_id, subscribed_price_monthly, current_period_end FROM subscriptions WHERE id=$1`, [subId])
    check('notify: upgrade applied with new tier', n1.status === 200 && s1.rows[0].tier_id === premium, { n1, s: s1.rows })
    check('notify: new tier price locked in (next renewal not at old 3000)', Number(s1.rows[0].subscribed_price_monthly) === 9000, s1.rows)
    const n2 = await json(await payhereNotify(formReq('/api/payhere/notify', fields)))
    const s2 = await admin.query(`SELECT current_period_end FROM subscriptions WHERE id=$1`, [subId])
    check('notify replay: no double processing', n2.status === 200 && +s2.rows[0].current_period_end === +s1.rows[0].current_period_end)

    const badCur = { ...fields, order_id: renew.body.orderId, payhere_amount: '3000.00', payhere_currency: 'USD', md5sig: notifySig(renew.body.orderId, '3000.00', 'USD', '2') }
    await payhereNotify(formReq('/api/payhere/notify', badCur))
    const bc = await admin.query(`SELECT status FROM payhere_transactions WHERE order_id=$1`, [renew.body.orderId])
    check('notify: currency mismatch not activated', bc.rows[0].status === 'failed', bc.rows)

    // ---- early renewal keeps remaining days
    const r2 = await json(await payhereCheckout(req('POST', '/api/payhere/checkout', { subscriptionId: subId, tierId: premium, billingCycle: 'monthly' })))
    const before = (await admin.query(`SELECT current_period_end FROM subscriptions WHERE id=$1`, [subId])).rows[0].current_period_end as Date
    const r2amt = (await admin.query(`SELECT amount FROM payhere_transactions WHERE order_id=$1`, [r2.body.orderId])).rows[0].amount as string
    check('renewal after upgrade charged at the new locked price (9000)', Number(r2amt) === 9000, r2amt)
    await payhereNotify(formReq('/api/payhere/notify', { ...fields, order_id: r2.body.orderId, payhere_amount: Number(r2amt).toFixed(2), md5sig: notifySig(r2.body.orderId, Number(r2amt).toFixed(2), 'LKR', '2') }))
    const after = (await admin.query(`SELECT current_period_start, current_period_end FROM subscriptions WHERE id=$1`, [subId])).rows[0]
    check('early renewal: new period starts at old period end (no days lost)',
      Math.abs(+after.current_period_start - +before) < 2000 && +after.current_period_end > +before + 27 * 86400000, { before, after })

    // ---- wallet part deducted only on success
    const acc2 = await makeAccount(admin, 1000)
    const D = await makeTenant(admin, 'wal')
    const sub2 = randomUUID()
    await admin.query(`INSERT INTO subscriptions (id, tenant_id, billing_account_id, tier_id, status, billing_cycle, current_period_start, current_period_end)
      VALUES ($1, $2, $3, $4, 'active', 'monthly', now() - interval '15 days', now() + interval '15 days')`, [sub2, D.tenantId, acc2, basic])
    setTestSession(sessionFor(D, D.ownerId, 'owner', acc2))
    const w = await json(await payhereCheckout(req('POST', '/api/payhere/checkout', { subscriptionId: sub2, tierId: premium, newTierId: premium, billingCycle: 'monthly' })))
    const wt = (await admin.query(`SELECT amount, wallet_credit_applied FROM payhere_transactions WHERE order_id=$1`, [w.body.orderId])).rows[0]
    const wal0 = Number((await admin.query(`SELECT wallet_balance FROM accounts WHERE id=$1`, [acc2])).rows[0].wallet_balance)
    check('split upgrade: wallet part recorded (1000) and not yet deducted', Number(wt.wallet_credit_applied) === 1000 && wal0 === 1000, { wt, wal0 })
    const wamt = Number(wt.amount).toFixed(2)
    await payhereNotify(formReq('/api/payhere/notify', { ...fields, order_id: w.body.orderId, payhere_amount: wamt, md5sig: notifySig(w.body.orderId, wamt, 'LKR', '2') }))
    const wal1 = Number((await admin.query(`SELECT wallet_balance FROM accounts WHERE id=$1`, [acc2])).rows[0].wallet_balance)
    check('split upgrade: wallet deducted after card payment succeeded', wal1 === 0, wal1)
  })

  // ===================================================== proration across cycles
  await step('proration', async () => {
    const now = new Date()
    const start = new Date(now.getTime() - 65 * 86400000)
    const end = new Date(start.getTime() + 365 * 86400000)
    const sub = { status: 'active', billingCycle: 'yearly', currentPeriodStart: start, currentPeriodEnd: end }
    const yearly = { id: 'y', priceMonthly: '12000', priceYearly: '120000' }
    const q = quotePlanChange(sub, yearly, yearly, 'monthly', now)
    // 300 days left: credit ≈ 98,630; monthly plan for 300 days ≈ 12000/≈30 * 300 ≈ 118,000 → pay, not refund
    check('yearly → monthly does not refund most of the year', q.ok && q.amountDue > 0, q)
    const legacy = calculateProration({ currentPlanPrice: 120000, newPlanPrice: 12000, currentPeriodStart: start, currentPeriodEnd: end, changeDate: now })
    check('(old maths would have refunded ~88k)', legacy.amountDue < -80000, legacy.amountDue)
    const same = quotePlanChange({ ...sub, billingCycle: 'monthly', currentPeriodStart: new Date(now.getTime() - 10 * 86400000), currentPeriodEnd: new Date(now.getTime() + 20 * 86400000) },
      { id: 'b', priceMonthly: '3000', priceYearly: '30000' }, { id: 'p', priceMonthly: '9000', priceYearly: '90000' }, 'monthly', now)
    check('same-cycle upgrade unchanged: (9000-3000)*20/30 = 4000', same.ok && Math.abs(same.amountDue - 4000) < 0.01, same)
    const trial = quotePlanChange({ ...sub, status: 'trial' }, yearly, yearly, 'monthly', now)
    check('trial → paid is full price', trial.ok && trial.amountDue === 12000 && trial.noProration)
    check('renewalStartDate: lapsed → now, active future end → end',
      +renewalStartDate(now, { status: 'active', currentPeriodEnd: new Date(+now - 1000) }) === +now &&
      +renewalStartDate(now, { status: 'active', currentPeriodEnd: end }) === +end)
  })

  // ===================================================== past_due → locked
  await step('enforce subscriptions locks past_due', async () => {
    const E = await makeTenant(admin, 'due')
    const acc = await makeAccount(admin)
    const tier = await makeTier(admin, 1000, 10000)
    await admin.query(`INSERT INTO subscriptions (tenant_id, billing_account_id, tier_id, status, current_period_start, current_period_end)
      VALUES ($1, $2, $3, 'past_due', now() - interval '40 days', now() - interval '5 days')`, [E.tenantId, acc, tier])
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'gf-cron'
    const r = await json(await enforceSubs(req('POST', '/api/cron/enforce-subscriptions', {}, { authorization: `Bearer ${process.env.CRON_SECRET}` })))
    const t = await admin.query(`SELECT t.status, s.status sstatus FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id WHERE t.id=$1`, [E.tenantId])
    check('past_due beyond grace → tenant + subscription locked', r.status === 200 && t.rows[0].status === 'locked' && t.rows[0].sstatus === 'locked', { r, t: t.rows })
  })

  // ===================================================== added permission checks
  await step('permission checks', async () => {
    const cashierId = await makeUser(admin, A, 'cashier')
    setTestSession(sessionFor(A, cashierId, 'cashier'))
    const sms = await json(await getSmsSettings())
    check('cashier cannot read SMS gateway settings (403)', sms.status === 403, sms)
    const id = randomUUID()
    const cost = await json(await getCostHistory(req('GET', `/api/items/${id}/cost-history`), { params: Promise.resolve({ id }) }))
    check('cashier cannot read item purchase cost history (403)', cost.status === 403, cost)
    const del = await json(await deleteCollectionFile(req('DELETE', `/api/collections/${id}/files?fileId=${randomUUID()}`), { params: Promise.resolve({ id }) }))
    check('cashier cannot remove files from a collection (403)', del.status === 403, del)
    setTestSession(sessionFor(A, A.ownerId, 'owner'))
    const ownerSms = await json(await getSmsSettings())
    check('owner still reads SMS settings', ownerSms.status === 200, ownerSms)
  })

  // ===================================================== super-admin TOTP brute force
  await step('admin TOTP lockout', async () => {
    const id = randomUUID()
    const secret = generateTotpSecret()
    await admin.query(`INSERT INTO super_admins (id, email, password_hash, full_name, totp_enabled, totp_secret) VALUES ($1, $2, 'x', 'SA', true, $3)`,
      [id, `sa-${id.slice(0, 6)}@example.test`, secret])
    const good = authenticator.generate(secret)
    const wrong = good === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) await checkAdminTotp(id, wrong)
    check('after 5 wrong codes even the correct code is refused', (await checkAdminTotp(id, good)) === 'invalid')
    await admin.query(`DELETE FROM rate_limit_attempts WHERE key=$1`, [`sa-totp:${id}`])
    check('correct code accepted when not locked', (await checkAdminTotp(id, good)) === 'ok')
  })

  await admin.end()
  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  await closeAllPools().catch(() => undefined)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
