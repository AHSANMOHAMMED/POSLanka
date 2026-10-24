/**
 * K3 — SMS & WhatsApp as a platform add-on: provider settings, vendor plans, credits, sending.
 *
 *   NEXTAUTH_SECRET=k3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_ws_messaging DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/k3-messaging.ts
 *
 * Calls the real route handlers (super-admin cookie via the next/headers mock, vendor session via the
 * w8 auth mock). Every provider call goes to a fake fetch (setMessagingFetchForTests) — no real SMS.
 * Covers: number normalisation, SMS parts, secret encryption + masking (never returned), keep / clear
 * secrets, test sends, plan save ↔ feature switches, top-ups with ledger + audit, receipts with bill
 * link, credit decrement / refund on failure / timeout, exhaustion and a concurrent race, monthly
 * quota and its reset, expiry, switch off, own gateway, WhatsApp template vs text, payment reminders,
 * low-stock alert, vendor templates, delivery logs + filters + tenant isolation, public bill page.
 * Throw-away data is removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { GET as adminMessagingGet, PUT as adminMessagingPut } from '@/app/api/sys-control/messaging/route'
import { POST as adminTestSend } from '@/app/api/sys-control/messaging/test/route'
import { GET as vendorPlanGet, PUT as vendorPlanPut } from '@/app/api/sys-control/vendors/[id]/messaging/route'
import { POST as topUp } from '@/app/api/sys-control/vendors/[id]/messaging/topup/route'
import { GET as adminLogs } from '@/app/api/sys-control/vendors/[id]/messaging/logs/route'
import { GET as myMessaging, PUT as myAlerts } from '@/app/api/messaging/route'
import { GET as myLogs } from '@/app/api/messaging/logs/route'
import { GET as myTemplates, PUT as putTemplate } from '@/app/api/messaging/templates/route'
import { POST as sendReceipt } from '@/app/api/messaging/send-receipt/route'
import { POST as paymentReminder } from '@/app/api/messaging/payment-reminder/route'
import { GET as publicBill } from '@/app/api/public/bill/[token]/route'
import { sendMessage } from '@/lib/messaging/service'
import { setMessagingFetchForTests } from '@/lib/messaging/providers'
import { normalizeMsisdn, smsSegments } from '@/lib/messaging/phone'
import { billToken, verifyBillToken } from '@/lib/messaging/bill-link'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box'
import { setTenantFeatureFlags } from '@/lib/features/check'
import { handleStockDecrease } from '@/lib/notifications/stock-alerts'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.44.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}

/* ------------------------------------------------------------------ fake providers */
type Mode = 'ok' | 'reject' | 'auth' | 'timeout' | 'slow'
let mode: Mode = 'ok'
const calls: Array<{ url: string; method: string; body: string }> = []
setMessagingFetchForTests(async (url, init) => {
  calls.push({ url, method: String(init.method || 'GET'), body: typeof init.body === 'string' ? init.body : '' })
  if (mode === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 30))
  const host = new URL(url).host
  if (host === 'graph.facebook.com') {
    if (mode === 'auth') return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190 } }), { status: 401 })
    if (mode === 'reject') return new Response(JSON.stringify({ error: { message: 'Re-engagement message', code: 131047 } }), { status: 400 })
    return new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${randomBytes(4).toString('hex')}` }] }), { status: 200 })
  }
  if (host === 'app.notify.lk') {
    if (mode === 'auth') return new Response(JSON.stringify({ status: 'error', errors: 'Invalid api_key' }), { status: 200 })
    if (mode === 'reject') return new Response(JSON.stringify({ status: 'error', errors: 'Insufficient account balance' }), { status: 200 })
    return new Response(JSON.stringify({ status: 'success', data: 'Sent' }), { status: 200 })
  }
  if (host === 'app.newsletters.lk') return new Response(mode === 'ok' || mode === 'slow' ? '0|NL123|1' : '1003|Invalid sender', { status: 200 })
  if (host === 'app.text.lk') return new Response(JSON.stringify({ status: 'success', data: { uid: 'tl-1' } }), { status: 200 })
  return new Response('unexpected host', { status: 500 })
})
const lastCall = () => calls[calls.length - 1]
const qp = (url: string, k: string) => new URL(url).searchParams.get(k)

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'k3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const adminId = randomUUID()
  const token = randomBytes(32).toString('hex')
  await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'K3 Admin')`, [adminId, `k3-admin-${tag}@example.test`])
  await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [adminId, token])
  const asAdmin = () => setTestCookie('admin_session', token)
  const asNobody = () => setTestCookie('admin_session', null)

  // saved platform settings are restored at the end (shared test DB)
  const prevSetting = (await pg.query(`SELECT value FROM system_settings WHERE key = 'messaging_providers'`)).rows[0]?.value ?? null

  const tenantIds: string[] = []
  async function makeTenant(label: string) {
    const id = randomUUID()
    const slug = `k3-${label}-${tag}`
    const ownerId = randomUUID(), cashierId = randomUUID(), customerId = randomUUID(), wh = randomUUID()
    await pg.query(`INSERT INTO tenants (id, name, slug, email, phone, currency) VALUES ($1, $2, $3, $4, '0112345678', 'LKR')`, [id, `K3 ${label} Stores`, slug, `${slug}@example.test`])
    tenantIds.push(id)
    await pg.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [wh, id])
    await pg.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner'), ($4, $2, $5, 'x', 'Cashier', 'cashier')`,
      [ownerId, id, `owner-${slug}@example.test`, cashierId, `cashier-${slug}@example.test`])
    await pg.query(`INSERT INTO customers (id, tenant_id, name, phone, balance) VALUES ($1, $2, 'Nimal Perera', '077 123 4567', 1500)`, [customerId, id])
    const session = (userId: string, role: string) => ({
      user: { id: userId, accountId: null, email: `${role}-${slug}@example.test`, name: role, role, tenantId: id, tenantSlug: slug, tenantName: label, businessType: 'retail', aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company' },
    }) as unknown as Parameters<typeof setTestSession>[0]
    return { id, slug, ownerId, cashierId, customerId, wh, asOwner: () => setTestSession(session(ownerId, 'owner')), asCashier: () => setTestSession(session(cashierId, 'cashier')) }
  }
  async function makeSale(tenantId: string, customerId: string | null, invoiceNo: string, total: number) {
    const id = randomUUID()
    await pg.query(`INSERT INTO sales (id, tenant_id, invoice_no, customer_id, customer_name, subtotal, total, paid_amount, status) VALUES ($1, $2, $3, $4, 'Nimal Perera', $5, $5, $5, 'completed')`,
      [id, tenantId, invoiceNo, customerId, total])
    await pg.query(`INSERT INTO sale_items (tenant_id, sale_id, item_name, quantity, unit_price, total) VALUES ($1, $2, 'Basmati rice 5kg', 2, $3, $4)`, [tenantId, id, total / 2, total])
    return id
  }
  const credits = async (tenantId: string) => (await pg.query(`SELECT sms_credits, whatsapp_credits, sms_used_period FROM messaging_subscriptions WHERE tenant_id = $1`, [tenantId])).rows[0]
  const lastLog = async (tenantId: string) => (await pg.query(`SELECT * FROM notification_logs WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [tenantId])).rows[0]

  const A = await makeTenant('a')
  const B = await makeTenant('b')
  const planBody = (over: J = {}) => ({
    smsEnabled: true, whatsappEnabled: true, useOwnSmsProvider: false, senderMask: 'K3SHOP', billingMode: 'prepaid',
    smsMonthlyQuota: 0, whatsappMonthlyQuota: 0, smsPrice: 1.5, whatsappPrice: 4, expiresAt: '', notes: 'Paid by bank', alertPhone: '', lowStockChannel: 'off', ...over,
  })

  try {
    // ============================================================ pure helpers
    await step('phone numbers + SMS parts', async () => {
      const cases: Array<[string, string | null]> = [
        ['0771234567', '94771234567'], ['077 123 4567', '94771234567'], ['+94 77 123 4567', '94771234567'], ['0094771234567', '94771234567'],
        ['771234567', '94771234567'], ['+94 0771234567', '94771234567'], ['077-123-456', null], ['hello', null], ['+447700900123', '447700900123'],
      ]
      const bad = cases.filter(([i, o]) => normalizeMsisdn(i) !== o)
      check('normalizeMsisdn: 07X / +94 / 0094 / no-zero forms → 947X…, junk refused', bad.length === 0, bad.map(([i]) => [i, normalizeMsisdn(i)]))
      check('SMS parts: 160 GSM = 1, 161 = 2, 70 Sinhala = 1, 71 = 2',
        smsSegments('a'.repeat(160)) === 1 && smsSegments('a'.repeat(161)) === 2 && smsSegments('අ'.repeat(70)) === 1 && smsSegments('අ'.repeat(71)) === 2)
      const enc = encryptSecret('super-secret-key-1234')
      check('secret box: encrypted, round-trips, tamper → null', enc.startsWith('enc:v1:') && !enc.includes('super-secret') && decryptSecret(enc) === 'super-secret-key-1234' && decryptSecret(enc.slice(0, -2) + 'AA') === null)
      const sid = randomUUID()
      const t = billToken(sid)
      check('bill token: round-trips, short, forged refused', verifyBillToken(t) === sid && t.length < 45 && verifyBillToken(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')) === null && verifyBillToken('x.y') === null)
    })

    // ============================================================ platform settings
    await step('platform settings: auth, encryption, masking', async () => {
      asNobody()
      const r0 = await adminMessagingGet()
      check('GET without admin session → 401', r0.status === 401)
      asAdmin()
      const put = await json(await adminMessagingPut(req('PUT', '/api/sys-control/messaging', {
        sms: { provider: 'notify_lk', notify_lk: { userId: '12345', apiKey: 'NLKEY-abcdef-9876', senderId: 'K3PLAT' } },
        whatsapp: { enabled: true, phoneNumberId: '1098765432', businessAccountId: '2233445566', accessToken: 'EAAG-very-secret-token-ZZ99', templateLanguage: 'en' },
      })))
      check('PUT saves → 200, both channels ready', put.status === 200 && put.body.status?.sms === true && put.body.status?.whatsapp === true, put)
      const text = JSON.stringify(put.body)
      check('response never contains the secrets', !text.includes('NLKEY-abcdef-9876') && !text.includes('EAAG-very-secret-token-ZZ99'))
      check('secrets reported as set with last 4 characters', put.body.secrets?.['sms.notify_lk.apiKey']?.set === true && put.body.secrets['sms.notify_lk.apiKey'].hint.endsWith('9876') && put.body.secrets['whatsapp.accessToken'].hint.endsWith('ZZ99'), put.body.secrets)
      const stored = (await pg.query(`SELECT value::text AS v FROM system_settings WHERE key = 'messaging_providers'`)).rows[0]?.v as string
      check('stored encrypted at rest', !!stored && !stored.includes('NLKEY-abcdef-9876') && !stored.includes('EAAG-very-secret') && stored.includes('enc:v1:'))
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE super_admin_id = $1 AND details->>'op' = 'save_messaging_providers' ORDER BY created_at DESC LIMIT 1`, [adminId])).rows[0]
      check('audited with changed field names, no values', !!audit && (audit.details.changed as string[]).includes('sms.notify_lk.apiKey') && !JSON.stringify(audit.details).includes('NLKEY'), audit?.details)

      const keep = await json(await adminMessagingPut(req('PUT', '/api/sys-control/messaging', { sms: { notify_lk: { apiKey: '', senderId: 'K3PLAT2' } } })))
      check('blank secret keeps the saved one', keep.body.secrets?.['sms.notify_lk.apiKey']?.set === true && keep.body.config?.sms?.notify_lk?.senderId === 'K3PLAT2', keep.body)
      const bad = await json(await adminMessagingPut(req('PUT', '/api/sys-control/messaging', { sms: { generic_http: { url: 'http://insecure.example' } } })))
      check('non-https gateway URL refused', bad.status === 400)
      const get = await json(await adminMessagingGet())
      check('GET masked: blank secret fields', get.status === 200 && get.body.config.sms.notify_lk.apiKey === '' && get.body.config.whatsapp.accessToken === '')
    })

    await step('test sends', async () => {
      asAdmin()
      calls.length = 0
      const r = await json(await adminTestSend(req('POST', '/api/sys-control/messaging/test', { channel: 'sms', to: '0771234567' })))
      const c = lastCall()
      check('SMS test → Notify.lk with normalised number + platform sender', r.status === 200 && r.body.ok === true && !!c && qp(c.url, 'to') === '94771234567' && qp(c.url, 'sender_id') === 'K3PLAT2' && qp(c.url, 'api_key') === 'NLKEY-abcdef-9876', { r: r.body, c })
      const w = await json(await adminTestSend(req('POST', '/api/sys-control/messaging/test', { channel: 'whatsapp', to: '0771234567', useHelloWorld: true })))
      const wc = lastCall()
      check('WhatsApp test → Graph API hello_world template', w.body.ok === true && wc.url.includes('/1098765432/messages') && JSON.parse(wc.body).template?.name === 'hello_world', { w: w.body, wc })
      mode = 'auth'
      const f = await json(await adminTestSend(req('POST', '/api/sys-control/messaging/test', { channel: 'sms', to: '0771234567' })))
      mode = 'ok'
      check('bad credentials → AUTH_FAILED', f.body.ok === false && f.body.code === 'AUTH_FAILED', f.body)
      const n = await json(await adminTestSend(req('POST', '/api/sys-control/messaging/test', { channel: 'sms', to: '+447700900123' })))
      check('local gateway refuses a foreign number', n.body.code === 'INVALID_NUMBER', n.body)
    })

    // ============================================================ vendor plan
    await step('no plan → refused, free share only', async () => {
      const r = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'hi' })
      check('sendMessage without a plan → NOT_SUBSCRIBED', !r.ok && r.code === 'NOT_SUBSCRIBED', r)
      A.asCashier()
      const m = await json(await myMessaging())
      check('POS availability: none', m.body.available?.sms === false && m.body.available?.whatsapp === false && m.body.plan === undefined, m.body)
    })

    await step('plan save syncs feature switches + audit', async () => {
      await setTenantFeatureFlags(A.id, { sms: false, whatsapp: false })
      asAdmin()
      const r = await json(await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody()), ctx(A.id)))
      check('PUT plan → 200', r.status === 200 && r.body.plan?.smsEnabled === true && r.body.plan?.senderMask === 'K3SHOP', r.body)
      check('feature switches sms + whatsapp turned on', r.body.featureFlags?.sms === true && r.body.featureFlags?.whatsapp === true, r.body.featureFlags)
      const audit = (await pg.query(`SELECT count(*)::int n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = $2 AND details->>'op' = 'create_messaging_plan'`, [adminId, A.id])).rows[0].n
      check('plan creation audited', audit === 1)
      const badMask = await json(await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody({ senderMask: 'WAY-TOO-LONG-MASK' })), ctx(A.id)))
      check('mask over 11 characters refused', badMask.status === 400)
      asNobody()
      const n = await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody()), ctx(A.id))
      check('plan change without admin → 401', n.status === 401)
    })

    await step('top-ups', async () => {
      asAdmin()
      const t = await json(await topUp(req('POST', `/api/sys-control/vendors/${A.id}/messaging/topup`, { channel: 'sms', credits: 3, amountPaid: 4.5, note: 'slip 77' }), ctx(A.id)))
      check('top up 3 SMS → balance 3', t.status === 200 && t.body.balance === 3, t.body)
      const w = await json(await topUp(req('POST', `/api/sys-control/vendors/${A.id}/messaging/topup`, { channel: 'whatsapp', credits: 5 }), ctx(A.id)))
      check('top up 5 WhatsApp → balance 5', w.body.balance === 5, w.body)
      const neg = await json(await topUp(req('POST', `/api/sys-control/vendors/${A.id}/messaging/topup`, { channel: 'sms', credits: -10 }), ctx(A.id)))
      check('removing more than the balance → 400', neg.status === 400, neg)
      const ledger = (await pg.query(`SELECT change, balance_after, amount_paid, admin_id FROM messaging_credit_ledger WHERE tenant_id = $1 ORDER BY created_at`, [A.id])).rows
      check('ledger rows with admin + amount', ledger.length === 2 && ledger[0].change === 3 && Number(ledger[0].amount_paid) === 4.5 && ledger[0].admin_id === adminId, ledger)
      const audits = (await pg.query(`SELECT count(*)::int n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = $2 AND details->>'op' = 'messaging_topup'`, [adminId, A.id])).rows[0].n
      check('top-ups audited', audits === 2)
      const g = await json(await vendorPlanGet(req('GET', `/api/sys-control/vendors/${A.id}/messaging`), ctx(A.id)))
      check('admin GET shows balances + ledger', g.body.plan?.smsCredits === 3 && g.body.ledger?.length === 2 && !JSON.stringify(g.body).includes('NLKEY'), g.body.plan)
    })

    let saleId = ''
    await step('bill receipt by SMS', async () => {
      saleId = await makeSale(A.id, A.customerId, `INV-K3-${tag}`, 2450)
      A.asCashier()
      const m = await json(await myMessaging())
      check('cashier sees availability only', m.body.available?.sms === true && m.body.available?.whatsapp === true && m.body.plan === undefined, m.body)
      calls.length = 0
      const r = await json(await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId, channel: 'sms' })))
      const c = lastCall()
      const msg = c ? qp(c.url, 'message') || '' : ''
      check('send-receipt → 200 ok, 1 part', r.status === 200 && r.body.ok === true && r.body.units === 1 && r.body.billedVia === 'platform' && r.body.remaining === 2, r.body)
      check('sent with vendor mask to customer number', !!c && qp(c.url, 'sender_id') === 'K3SHOP' && qp(c.url, 'to') === '94771234567')
      check('text has shop, invoice, total and bill link', msg.includes('K3 a Stores') && msg.includes(`INV-K3-${tag}`) && msg.includes('LKR 2,450.00') && msg.includes('/api/public/bill/'), msg)
      check('credits 3 → 2', (await credits(A.id)).sms_credits === 2)
      const log = await lastLog(A.id)
      check('log row: sent, platform, sale_receipt, invoice ref', log?.status === 'sent' && log.billed_via === 'platform' && log.purpose === 'sale_receipt' && log.entity_reference === `INV-K3-${tag}` && Number(log.cost) === 1.5, log)
      const link = msg.slice(msg.indexOf('http'))
      const tokenPart = link.split('/api/public/bill/')[1]
      const page = await publicBill(new Request(link), { params: Promise.resolve({ token: tokenPart }) })
      const html = await page.text()
      check('bill link opens the bill (HTML, items, total)', page.status === 200 && html.includes(`INV-K3-${tag}`) && html.includes('Basmati rice 5kg') && html.includes('2,450.00'), html.slice(0, 200))
      const forged = await publicBill(new Request('http://x'), { params: Promise.resolve({ token: tokenPart.slice(0, -1) + (tokenPart.endsWith('A') ? 'B' : 'A') }) })
      check('forged bill link → 404', forged.status === 404)
      const other = await json(await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId: await makeSale(B.id, null, `INV-B-${tag}`, 10), channel: 'sms' })))
      check('another business’s sale → 404', other.status === 404, other)
      const noPhone = await json(await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId: await makeSale(A.id, null, `INV-K3W-${tag}`, 99), channel: 'sms' })))
      check('walk-in without a number → 400 INVALID_NUMBER', noPhone.status === 400 && noPhone.body.code === 'INVALID_NUMBER', noPhone)
    })

    await step('failures refund, exhaustion refuses', async () => {
      mode = 'reject'
      const f = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'x' })
      mode = 'timeout'
      const t = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'x' })
      mode = 'ok'
      check('provider rejection → PROVIDER_REJECTED, nothing charged', !f.ok && f.code === 'PROVIDER_REJECTED' && f.units === 0, f)
      check('timeout → TIMEOUT', !t.ok && t.code === 'TIMEOUT', t)
      check('credits refunded (still 2)', (await credits(A.id)).sms_credits === 2)
      const log = await lastLog(A.id)
      check('failed send logged with the code', log?.status === 'failed' && String(log.error_message).startsWith('TIMEOUT'), log)
      const a = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'one' })
      const b = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'two' })
      calls.length = 0
      A.asCashier()
      const c = await json(await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId, channel: 'sms' })))
      check('two more sends use the last credits', a.ok && b.ok && b.remaining === 0, [a, b])
      check('no credit → 402 NO_CREDIT, provider not called', c.status === 402 && c.body.code === 'NO_CREDIT' && calls.length === 0 && /top up/i.test(c.body.error), c)
      const av = await json(await myMessaging())
      check('POS availability turns SMS off at zero credits', av.body.available?.sms === false && av.body.available?.whatsapp === true, av.body)
    })

    await step('concurrent sends never overspend', async () => {
      asAdmin()
      await topUp(req('POST', `/api/sys-control/vendors/${A.id}/messaging/topup`, { channel: 'sms', credits: 5 }), ctx(A.id))
      mode = 'slow'
      const all = await Promise.all(Array.from({ length: 10 }, (_, i) => sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: `race ${i}` })))
      mode = 'ok'
      const ok = all.filter((r) => r.ok).length
      const refused = all.filter((r) => r.code === 'NO_CREDIT').length
      check('10 parallel sends on 5 credits → 5 sent, 5 NO_CREDIT, balance 0', ok === 5 && refused === 5 && (await credits(A.id)).sms_credits === 0, { ok, refused, c: await credits(A.id) })
    })

    await step('long Sinhala message costs 2 credits', async () => {
      asAdmin()
      await topUp(req('POST', `/api/sys-control/vendors/${A.id}/messaging/topup`, { channel: 'sms', credits: 3 }), ctx(A.id))
      const r = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'ස්තූතියි '.repeat(10) })
      check('2 parts charged', r.ok && r.units === 2 && (await credits(A.id)).sms_credits === 1, r)
      const typ = qp(lastCall().url, 'type')
      check('sent as unicode', typ === 'unicode', typ)
    })

    await step('WhatsApp: template when configured, text otherwise', async () => {
      calls.length = 0
      A.asCashier()
      const t = await json(await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId, channel: 'whatsapp', phone: '0719998887' })))
      const body = JSON.parse(lastCall().body)
      check('no template → text with bill link to typed number', t.body.ok === true && body.type === 'text' && body.to === '94719998887' && body.text.body.includes('/api/public/bill/'), { t: t.body, body })
      asAdmin()
      await adminMessagingPut(req('PUT', '/api/sys-control/messaging', { whatsapp: { templates: { sale_receipt: 'bill_receipt' } } }))
      A.asCashier()
      await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId, channel: 'whatsapp' }))
      const tb = JSON.parse(lastCall().body)
      const params = tb.template?.components?.[0]?.parameters?.map((p: J) => p.text) ?? []
      check('template bill_receipt with shop, invoice, total, link', tb.type === 'template' && tb.template.name === 'bill_receipt' && tb.template.language.code === 'en' && params.length === 4 && params[1] === `INV-K3-${tag}` && params[3].includes('/api/public/bill/'), tb)
      check('WhatsApp credits 5 → 3', (await credits(A.id)).whatsapp_credits === 3)
      mode = 'reject'
      const rj = await sendMessage({ tenantId: A.id, channel: 'whatsapp', to: '0771234567', purpose: 'manual', text: 'x' })
      mode = 'ok'
      check('Meta 131047 → PROVIDER_REJECTED, refunded', rj.code === 'PROVIDER_REJECTED' && (await credits(A.id)).whatsapp_credits === 3, rj)
    })

    await step('monthly quota, expiry, switch off', async () => {
      asAdmin()
      await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody({ billingMode: 'monthly_quota', smsMonthlyQuota: 2 })), ctx(A.id))
      const r1 = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'q1' })
      const r2 = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'q2' })
      const r3 = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'q3' })
      check('quota 2: two sent, third QUOTA_EXHAUSTED', r1.ok && r2.ok && r2.remaining === 0 && r3.code === 'QUOTA_EXHAUSTED', [r1, r2, r3])
      check('prepaid credits untouched in quota mode', (await credits(A.id)).sms_credits === 1)
      await pg.query(`UPDATE messaging_subscriptions SET period_month = (date_trunc('month', now()) - interval '1 month')::date WHERE tenant_id = $1`, [A.id])
      const r4 = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'new month' })
      check('new month resets the quota', r4.ok && (await credits(A.id)).sms_used_period === 1, r4)

      await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody({ expiresAt: '2020-01-31' })), ctx(A.id))
      const e = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'late' })
      check('expired plan → SUBSCRIPTION_EXPIRED', e.code === 'SUBSCRIPTION_EXPIRED', e)
      await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody()), ctx(A.id))
      await setTenantFeatureFlags(A.id, { sms: false })
      const s = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'off' })
      check('sms switch off → FEATURE_DISABLED', s.code === 'FEATURE_DISABLED', s)
      const g = await json(await vendorPlanGet(req('GET', `/api/sys-control/vendors/${A.id}/messaging`), ctx(A.id)))
      check('console shows the switch is off', g.body.featureFlags?.sms === false)
      await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody()), ctx(A.id))
      const s2 = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'on' })
      check('saving the plan turns it back on', s2.ok, s2)
    })

    await step('own SMS gateway: not charged', async () => {
      await pg.query(`INSERT INTO sms_settings (tenant_id, provider, is_enabled, websms_api_key, websms_api_token, websms_sender_id) VALUES ($1, 'websms_lk', true, 'OWNKEY', 'OWNTOKEN', 'MYSHOP')`, [A.id])
      asAdmin()
      await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody({ useOwnSmsProvider: true })), ctx(A.id))
      const before = (await credits(A.id)).sms_credits
      calls.length = 0
      const r = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'own' })
      const c = lastCall()
      const form = new URLSearchParams(c?.body ?? '')
      check('sent through the vendor’s WebSMS.lk account with its own sender', r.ok && r.billedVia === 'own' && c?.url.includes('newsletters.lk') && form.get('apikey') === 'OWNKEY' && form.get('from') === 'MYSHOP', { r, c })
      check('no credits used', (await credits(A.id)).sms_credits === before)
      await pg.query(`UPDATE sms_settings SET is_enabled = false WHERE tenant_id = $1`, [A.id])
      const off = await sendMessage({ tenantId: A.id, channel: 'sms', to: '0771234567', purpose: 'manual', text: 'own' })
      check('own gateway disabled → OWN_PROVIDER_NOT_CONFIGURED', off.code === 'OWN_PROVIDER_NOT_CONFIGURED', off)
      await vendorPlanPut(req('PUT', `/api/sys-control/vendors/${A.id}/messaging`, planBody()), ctx(A.id))
      await topUp(req('POST', `/api/sys-control/vendors/${A.id}/messaging/topup`, { channel: 'sms', credits: 10 }), ctx(A.id))
    })

    await step('vendor templates', async () => {
      A.asCashier()
      const denied = await putTemplate(req('PUT', '/api/messaging/templates', { purpose: 'sale_receipt', text: 'x' }))
      check('cashier cannot edit templates → 403', denied.status === 403)
      A.asOwner()
      const bad = await json(await putTemplate(req('PUT', '/api/messaging/templates', { purpose: 'sale_receipt', text: 'Hi {{nope}}' })))
      check('unknown placeholder refused', bad.status === 400 && /nope/.test(bad.body.error), bad.body)
      const ok = await json(await putTemplate(req('PUT', '/api/messaging/templates', { purpose: 'sale_receipt', text: 'Ayubowan! {{invoiceNo}} = {{total}} {{link}}' })))
      check('custom text saved', ok.status === 200 && ok.body.custom === true, ok.body)
      calls.length = 0
      A.asCashier()
      await sendReceipt(req('POST', '/api/messaging/send-receipt', { saleId, channel: 'sms' }))
      const m = qp(lastCall().url, 'message') || ''
      check('receipt uses the vendor’s text', m.startsWith(`Ayubowan! INV-K3-${tag} = LKR 2,450.00 http`), m)
      A.asOwner()
      const list = await json(await myTemplates())
      check('GET lists 3 texts with the custom one', list.body.templates?.length === 3 && list.body.templates.find((t: J) => t.purpose === 'sale_receipt')?.custom === true)
      await putTemplate(req('PUT', '/api/messaging/templates', { purpose: 'sale_receipt', text: '' }))
      const back = await json(await myTemplates())
      check('empty text → back to default', back.body.templates.find((t: J) => t.purpose === 'sale_receipt')?.custom === false)
    })

    await step('payment reminders', async () => {
      A.asCashier()
      const denied = await paymentReminder(req('POST', '/api/messaging/payment-reminder', { channel: 'sms', customerId: A.customerId }))
      check('cashier cannot send reminders → 403', denied.status === 403)
      A.asOwner()
      calls.length = 0
      const r = await json(await paymentReminder(req('POST', '/api/messaging/payment-reminder', { channel: 'sms', customerId: A.customerId })))
      const m = qp(lastCall().url, 'message') || ''
      check('reminder sent with the balance', r.status === 200 && r.body.ok === true && m.includes('Nimal Perera') && m.includes('LKR 1,500.00'), { r: r.body, m })
      const bulk = await json(await paymentReminder(req('POST', '/api/messaging/payment-reminder', { channel: 'sms', allWithBalance: true })))
      check('bulk: every customer with a balance', bulk.status === 200 && bulk.body.sent === 1 && bulk.body.failed === 0, bulk.body)
    })

    await step('low-stock alert to the owner', async () => {
      A.asOwner()
      const noPlanPhone = await json(await myAlerts(req('PUT', '/api/messaging', { alertPhone: '', lowStockChannel: 'sms' })))
      check('channel without phone refused', noPlanPhone.status === 400)
      const s = await json(await myAlerts(req('PUT', '/api/messaging', { alertPhone: '0761112223', lowStockChannel: 'sms' })))
      check('owner sets alert phone + SMS', s.status === 200 && s.body.alertPhone === '94761112223', s.body)
      const itemId = randomUUID()
      await pg.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, 'Dhal 1kg', 0, 400, true)`, [itemId, A.id, `K3-${itemId.slice(0, 6)}`])
      calls.length = 0
      const result = { movementId: null, before: 10, after: 2, delta: -8, skipped: false, minStock: 5, crossedMin: true, itemName: 'Dhal 1kg', warehouseStockId: randomUUID() }
      const input = { tenantId: A.id, warehouseId: A.wh, itemId, mode: 'delta', qty: -8, referenceType: 'test', source: 'system' } as unknown as Parameters<typeof handleStockDecrease>[1]
      await handleStockDecrease(result, input)
      const c = lastCall()
      const m = c ? qp(c.url, 'message') || '' : ''
      check('low stock → SMS to the alert phone', !!c && qp(c.url, 'to') === '94761112223' && m.includes('Dhal 1kg') && m.includes('2 left'), { c, m })
      calls.length = 0
      await handleStockDecrease(result, input)
      check('same alert within the de-dupe window → no second SMS', calls.length === 0, calls.length)
      const log = await lastLog(A.id)
      check('logged as low_stock to owner', log?.purpose === 'low_stock' && log.recipient_type === 'owner', log)
    })

    await step('delivery logs, filters, isolation', async () => {
      A.asOwner()
      const all = await json(await myLogs(req('GET', '/api/messaging/logs?pageSize=100')))
      const failed = await json(await myLogs(req('GET', '/api/messaging/logs?status=failed&channel=sms')))
      check('vendor log lists SMS + WhatsApp', all.status === 200 && all.body.total > 10 && all.body.logs.some((l: J) => l.channel === 'whatsapp'), all.body.total)
      check('status + channel filter', failed.body.logs.length >= 2 && failed.body.logs.every((l: J) => l.status === 'failed' && l.channel === 'sms'), failed.body.logs?.length)
      const byInv = await json(await myLogs(req('GET', `/api/messaging/logs?search=INV-K3-${tag}&purpose=sale_receipt`)))
      check('search by bill number + type', byInv.body.total >= 3 && byInv.body.logs.every((l: J) => l.purpose === 'sale_receipt'), byInv.body.total)
      A.asCashier()
      const denied = await myLogs(req('GET', '/api/messaging/logs'))
      check('cashier cannot read the log → 403', denied.status === 403)
      B.asOwner()
      const bLogs = await json(await myLogs(req('GET', '/api/messaging/logs')))
      check('other business sees none of these', bLogs.status === 200 && bLogs.body.total === 0, bLogs.body.total)
      const bPlan = await json(await myMessaging())
      check('other business has no plan', bPlan.body.subscribed === false)
      asAdmin()
      const adm = await json(await adminLogs(req('GET', `/api/sys-control/vendors/${A.id}/messaging/logs?channel=whatsapp&pageSize=2&page=1`), ctx(A.id)))
      check('admin log: channel filter + paging', adm.status === 200 && adm.body.logs.length === 2 && adm.body.total >= 3 && adm.body.logs.every((l: J) => l.channel === 'whatsapp'), adm.body)
      A.asOwner()
      const mine = await json(await myMessaging())
      check('owner sees plan, usage, top-ups but not internal notes', mine.body.subscribed === true && mine.body.usage?.sms?.sent > 5 && mine.body.ledger?.length >= 4 && mine.body.plan?.notes === undefined, mine.body.usage)
      const g = await json(await vendorPlanGet(req('GET', `/api/sys-control/vendors/${A.id}/messaging`), ctx(A.id)))
      check('console: billable units and value this month', g.body.usage?.sms?.units >= 10 && g.body.usage.sms.cost > 0, g.body.usage)
      const over = await json(await adminMessagingGet())
      check('overview lists the vendor with a plan', over.body.vendors?.some((v: J) => v.tenantId === A.id) && !over.body.vendors.some((v: J) => v.tenantId === B.id))
    })
  } finally {
    setMessagingFetchForTests(null)
    if (prevSetting === null) await pg.query(`DELETE FROM system_settings WHERE key = 'messaging_providers'`)
    else await pg.query(`UPDATE system_settings SET value = $1 WHERE key = 'messaging_providers'`, [prevSetting])
    if (process.env.KEEP_TEST_DATA !== '1') await cleanup(pg, tenantIds, adminId)
    await pg.end()
    await closeAllPools().catch(() => undefined)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

async function cleanup(pg: Client, tenantIds: string[], adminId: string) {
  const tables = (await pg.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
  )).rows.map((r) => r.table_name as string)
  let pending = tables
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: string[] = []
    for (const t of pending) {
      try { await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]) } catch { next.push(t) }
    }
    pending = next
  }
  await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds])
  await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [adminId])
  await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [adminId])
  await pg.query(`DELETE FROM super_admins WHERE id = $1`, [adminId])
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
