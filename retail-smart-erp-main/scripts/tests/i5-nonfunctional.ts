/**
 * I5 non-functional hardening: health/readiness, pool timeouts, cross-instance realtime fan-out,
 * DB-backed rate limits, CSRF origin check, PayHere exactly-once activation, retention cron,
 * upload magic bytes, metrics auth, shared audit-run state, request ids.
 *
 *   DATABASE_URL=postgresql://postgres:…@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   NEXTAUTH_SECRET=i5-test-secret CRON_SECRET=i5-cron PAYHERE_MERCHANT_ID=1211111 PAYHERE_MERCHANT_SECRET=testsecret \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/i5-nonfunctional.ts
 *
 * Calls the real route handlers / libraries (auth mocked via the w8 harness) on throw-away
 * fixtures. Prints PASS/FAIL per check, exits non-zero on failure.
 */
import { Client } from 'pg'
import { randomUUID, createHash } from 'crypto'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'

// Env must be in place before the modules that read it at load time are imported
process.env.NEXTAUTH_SECRET ||= 'i5-test-secret'
process.env.CRON_SECRET ||= 'i5-cron'
process.env.PAYHERE_MERCHANT_ID ||= '1211111'
process.env.PAYHERE_MERCHANT_SECRET ||= 'testsecret'
process.env.NEXT_PUBLIC_BASE_DOMAIN ||= 'poslanka.lk'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}
async function json(res: Response | undefined): Promise<{ status: number; body: J; headers: Headers }> {
  if (!res) return { status: 0, body: {}, headers: new Headers() }
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text), headers: res.headers } } catch { return { status: res.status, body: { raw: text }, headers: res.headers } }
}
let ipCounter = 1
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url.startsWith('http') ? url : `http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`, ...headers },
  })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { if (await fn()) return true; await sleep(25) }
  return false
}
function md5u(s: string) { return createHash('md5').update(s).digest('hex').toUpperCase() }
function notifySig(orderId: string, amount: string, currency: string, status: string) {
  return md5u((process.env.PAYHERE_MERCHANT_ID || '') + orderId + amount + currency + status + md5u(process.env.PAYHERE_MERCHANT_SECRET || ''))
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')

  const { closeAllPools } = await import('@/lib/db')
  const { getSharedPool } = await import('@/lib/db/pool')
  const admin = new Client({ connectionString: url })
  await admin.connect()

  const tenantId = randomUUID()
  const ownerId = randomUUID()
  const slug = `i5-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'I5 NFR', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [ownerId, tenantId, `owner-${slug}@example.test`])
  const owner = {
    user: {
      id: ownerId, accountId: null, email: 'owner@example.test', name: 'Owner', role: 'owner', customRoleId: null,
      tenantId, tenantSlug: slug, tenantName: 'I5', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
  const accountIds: string[] = []
  const tierIds: string[] = []

  try {
    // ================================================================ pool timeouts
    await step('pool session timeouts', async () => {
      const pool = getSharedPool()
      const st = await pool.query<{ statement_timeout: string }>('SHOW statement_timeout')
      check('statement_timeout applied on pooled connections (30s, SET on connect: PgBouncer-safe)', st.rows[0]?.statement_timeout === '30s', st.rows)
      const it = await pool.query<{ idle_in_transaction_session_timeout: string }>('SHOW idle_in_transaction_session_timeout')
      check('idle_in_transaction_session_timeout applied (1min)', it.rows[0]?.idle_in_transaction_session_timeout === '1min', it.rows)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(`SELECT set_config('statement_timeout', '0', true)`)
        const local = await client.query<{ statement_timeout: string }>('SHOW statement_timeout')
        await client.query('COMMIT')
        const after = await client.query<{ statement_timeout: string }>('SHOW statement_timeout')
        check('long jobs can lift it per transaction (backup path), default restored after', local.rows[0].statement_timeout === '0' && after.rows[0].statement_timeout === '30s', { local: local.rows, after: after.rows })
      } finally { client.release() }
      const { metricsState } = await import('@/lib/observability/metrics')
      check('pooled queries are counted for /api/metrics', metricsState().dbQueries >= 3, metricsState().dbQueries)
    })

    // ================================================================ health
    await step('health / readiness', async () => {
      const { GET: health } = await import('@/app/api/health/route')
      const { GET: live } = await import('@/app/api/health/live/route')
      const { GET: ready } = await import('@/app/api/health/ready/route')
      const { setShuttingDown } = await import('@/lib/observability/metrics')
      const r1 = await json(await ready())
      check('ready: 200 with database ok', r1.status === 200 && r1.body.status === 'ready' && r1.body.database === 'ok', r1.body)
      const h1 = await json(await health())
      check('/api/health stays backward compatible (status, database, tenantIsolation, version)',
        h1.status === 200 && h1.body.status === 'ok' && h1.body.database === 'ok' && typeof h1.body.tenantIsolation === 'string' && typeof h1.body.version === 'string', h1.body)

      // Simulate a database outage: the shared pool answers with an error
      const realPool = globalThis.__poslankaPgPool
      globalThis.__poslankaPgPool = { query: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432') } } as unknown as typeof realPool
      try {
        const r2 = await json(await ready())
        check('ready: 503 + database error when the DB is down', r2.status === 503 && r2.body.database === 'error' && r2.body.status === 'not_ready', r2.body)
        check('ready: DB error text is not leaked publicly', !JSON.stringify(r2.body).includes('ECONNREFUSED'), r2.body)
        const h2 = await json(await health())
        check('/api/health: 503 degraded when the DB is down', h2.status === 503 && h2.body.database === 'error' && h2.body.status === 'degraded', h2.body)
        const l2 = await json(live())
        check('live: 200 even when the DB is down (no restart loop)', l2.status === 200 && l2.body.status === 'ok', l2.body)
      } finally {
        globalThis.__poslankaPgPool = realPool
      }
      // Hung database: SELECT 1 must give up within ~2 s
      globalThis.__poslankaPgPool = { query: () => new Promise(() => undefined) } as unknown as typeof realPool
      try {
        const t0 = Date.now()
        const r3 = await json(await ready())
        check('ready: hung DB times out (~2 s) → 503', r3.status === 503 && Date.now() - t0 < 3500, { ms: Date.now() - t0, body: r3.body })
      } finally {
        globalThis.__poslankaPgPool = realPool
      }
      setShuttingDown(true)
      try {
        const r4 = await json(await ready())
        check('ready: 503 while draining after SIGTERM', r4.status === 503 && r4.body.shuttingDown === true, r4.body)
      } finally { setShuttingDown(false) }
      const r5 = await json(await ready())
      check('ready: back to 200', r5.status === 200, r5.body)
    })

    // ================================================================ realtime fan-out
    await step('cross-instance realtime fan-out (LISTEN/NOTIFY)', async () => {
      const { wsManager } = await import('@/lib/websocket/server')
      const { broadcastChange } = await import('@/lib/websocket/broadcast')
      const { encodeFanout, FANOUT_CHANNEL, decodeFanout, instanceId } = await import('@/lib/websocket/fanout')
      const { waitForListening } = await import('@/lib/db/listen-hub')
      wsManager.init()
      check('fan-out listener connected', await waitForListening(5000))

      const token = jwt.sign({ id: ownerId, name: 'Owner', tenantId, tenantSlug: slug, role: 'owner', mode: 'tenant' }, process.env.NEXTAUTH_SECRET!, { expiresIn: '1h' })
      const received: J[] = []
      let ended = false
      const clientId = wsManager.addSSEClient(token, (data) => {
        for (const line of data.split('\n')) if (line.startsWith('data: ')) received.push(JSON.parse(line.slice(6)))
        return true
      }, () => { ended = true })
      check('SSE client registered with a fresh token', !!clientId)
      const old = jwt.sign({ id: ownerId, tenantId, mode: 'tenant', iat: Math.floor(Date.now() / 1000) - 3600 }, process.env.NEXTAUTH_SECRET!, { expiresIn: '2h' })
      check('SSE refuses a token older than SSE_TOKEN_MAX_AGE_SEC (token-in-URL replay)', wsManager.addSSEClient(old, () => true) === null)

      // Published by "another instance" on a separate connection
      const otherId = randomUUID()
      const pub = new Client({ connectionString: url })
      await pub.connect()
      try {
        await pub.query('SELECT pg_notify($1, $2)', [FANOUT_CHANNEL, encodeFanout('tenant', { tenantId, entityType: 'item', action: 'updated', id: otherId, data: { name: 'x' } }, 'other-instance-1')])
        const got = await until(() => received.some((m) => m.id === otherId), 5000)
        check('broadcast published from a second connection reaches this instance\'s SSE client', got, received)
        const msg = received.find((m) => m.id === otherId)
        check('delivered event keeps type/action/tenant/data', msg?.type === 'item' && msg?.action === 'updated' && msg?.tenantId === tenantId && msg?.data?.name === 'x', msg)

        // Other tenant's broadcast is not delivered to this client
        const foreign = randomUUID()
        await pub.query('SELECT pg_notify($1, $2)', [FANOUT_CHANNEL, encodeFanout('tenant', { tenantId: randomUUID(), entityType: 'item', action: 'created', id: foreign }, 'other-instance-1')])
        // Own-instance broadcast through the normal API path: delivered once (locally), the echo is ignored
        const localId = randomUUID()
        broadcastChange(tenantId, 'item', 'created', localId)
        await sleep(400)
        check('other tenants\' events are not delivered', !received.some((m) => m.id === foreign))
        check('single-instance behaviour unchanged: local broadcast delivered exactly once (own NOTIFY echo ignored)',
          received.filter((m) => m.id === localId).length === 1, received.filter((m) => m.id === localId).length)

        // Account-level broadcast from another instance
        const accEvt = randomUUID()
        await pub.query('SELECT pg_notify($1, $2)', [FANOUT_CHANNEL, encodeFanout('account', { userId: ownerId, entityType: 'account-notification', action: 'created', id: accEvt }, 'other-instance-2')])
        check('account-level broadcast from another instance delivered to the user', await until(() => received.some((m) => m.id === accEvt), 5000))
      } finally {
        await pub.end()
      }
      const big = encodeFanout('tenant', { tenantId, entityType: 'item', action: 'updated', id: 'x', data: { blob: 'y'.repeat(20000) } })
      check('payload over the 8 kB NOTIFY limit is sent without data', Buffer.byteLength(big) < 8000 && decodeFanout(big, 'someone-else')?.m.data?.truncated === true)
      check('own-origin payloads are dropped by decodeFanout', decodeFanout(encodeFanout('tenant', { tenantId, entityType: 'item', action: 'updated', id: 'z' }), instanceId()) === null)

      wsManager.shutdown()
      check('shutdown ends open SSE responses', ended)
    })

    // ================================================================ DB-backed rate limits
    await step('DB-backed rate limits', async () => {
      const { POST: lookupTenant } = await import('@/app/api/lookup-tenant/route')
      const { POST: forgotPassword } = await import('@/app/api/auth/forgot-password/route')
      const { consumeRateLimit, checkRateLimit } = await import('@/lib/auth/rate-limit')
      const email = `rl-${randomUUID().slice(0, 8)}@example.test`
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) statuses.push((await lookupTenant(req('POST', '/api/lookup-tenant', { email }))).status)
      check('lookup-tenant: 5 lookups per email per minute, 6th → 429 (different client IPs)', statuses.slice(0, 5).every((s) => s === 200) && statuses[5] === 429, statuses)
      const row = await admin.query(`SELECT attempts FROM rate_limit_attempts WHERE key=$1 AND category='lookup_email'`, [email])
      check('lookup-tenant counter lives in rate_limit_attempts (shared by all instances)', Number(row.rows[0]?.attempts) === 6, row.rows)

      const ident = `zz-${randomUUID().slice(0, 6)}`
      const idStatuses: number[] = []
      for (let i = 0; i < 6; i++) idStatuses.push((await lookupTenant(req('POST', '/api/lookup-tenant', { identifier: ident }))).status)
      check('lookup by Business ID / slug: 6th attempt for one identifier → 429', idStatuses[5] === 429 && idStatuses.slice(0, 5).every((s) => s === 200), idStatuses)

      const fpEmail = `fp-${randomUUID().slice(0, 8)}@example.test`
      const fp: Array<{ status: number; body: J }> = []
      for (let i = 0; i < 4; i++) fp.push(await json(await forgotPassword(req('POST', '/api/auth/forgot-password', { email: fpEmail }))))
      const fpRow = await admin.query(`SELECT attempts FROM rate_limit_attempts WHERE key=$1 AND category='forgot_password'`, [fpEmail])
      check('forgot-password: every attempt counted in the DB', Number(fpRow.rows[0]?.attempts) === 4, fpRow.rows)
      check('forgot-password: limited response is identical (no enumeration)', fp.every((r) => r.status === 200 && r.body.success === true))
      check('forgot-password: 4th request of the hour is over the limit', (await consumeRateLimit(fpEmail, { maxAttempts: 3, windowMs: 3600_000, category: 'forgot_password' })).limited)

      // Same counter seen through a second "instance" (fresh connection, no process state)
      const viaOther = await admin.query(`SELECT attempts FROM rate_limit_attempts WHERE key=$1 AND category='lookup_email'`, [email])
      check('a second instance sees the same counter', Number(viaOther.rows[0]?.attempts) === 6)

      // Login limiter fails closed when its database is unreachable
      const { getDb } = await import('@/lib/db')
      const db = getDb()
      const realExecute = db.execute
      ;(db as unknown as { execute: unknown }).execute = async () => { throw new Error('db down') }
      try {
        const closed = await checkRateLimit('x@example.test', { maxAttempts: 5, windowMs: 60_000, category: 'login', failClosed: true })
        const open = await checkRateLimit('x@example.test', { maxAttempts: 5, windowMs: 60_000, category: 'misc' })
        check('login / PIN limiter fails CLOSED when the DB is down; others fail open', closed.limited && !open.limited, { closed, open })
      } finally {
        ;(db as unknown as { execute: unknown }).execute = realExecute
      }
      await admin.query(`DELETE FROM rate_limit_attempts WHERE key = ANY($1)`, [[email, ident, fpEmail]])
    })

    // ================================================================ CSRF
    await step('CSRF origin check (proxy)', async () => {
      const { proxy } = await import('@/proxy')
      const host = `${slug}.poslanka.lk`
      const call = async (path: string, init: { method?: string; headers?: Record<string, string> }) => {
        const r = await proxy(new NextRequest(`https://${host}${path}`, { method: init.method || 'POST', headers: { host, ...(init.headers || {}) } }))
        return r as Response
      }
      const cookie = 'company-session=abc'
      const foreign = await call('/api/items', { headers: { origin: 'https://evil.example', cookie } })
      check('foreign-Origin cookie POST → 403', foreign.status === 403)
      check('blocked response carries x-request-id', !!foreign.headers.get('x-request-id'))
      const secure = await call('/api/items', { method: 'DELETE', headers: { origin: 'https://evil.example', cookie: '__Secure-company-session=abc' } })
      check('foreign-Origin DELETE with __Secure- cookie → 403', secure.status === 403)
      const nul = await call('/api/items', { headers: { origin: 'null', cookie } })
      check('Origin: null (sandboxed iframe) → 403', nul.status === 403)
      const ref = await call('/api/items', { headers: { referer: 'https://evil.example/page', cookie } })
      check('no Origin but foreign Referer → 403', ref.status === 403)
      const lookalike = await call('/api/items', { headers: { origin: 'https://evil-poslanka.lk', cookie } })
      check('look-alike domain (evil-poslanka.lk) → 403', lookalike.status === 403)
      const platform = await call('/api/items', { headers: { origin: 'https://someone-else.ondigitalocean.app', cookie } })
      check('another *.ondigitalocean.app app → 403', platform.status === 403)

      const same = await call('/api/items', { headers: { origin: `https://${host}`, cookie } })
      check('same-origin cookie POST allowed', same.status === 200 && same.headers.get('x-middleware-next') === '1', same.status)
      const sub = await call('/api/items', { headers: { origin: 'https://app.poslanka.lk', cookie } })
      check('our own subdomain (app.poslanka.lk) allowed', sub.status === 200)
      const bearer = await call('/api/sales', { headers: { origin: 'https://evil.example', authorization: 'Bearer mobile-token' } })
      check('Bearer request without session cookie allowed (mobile app)', bearer.status === 200)
      const noHeaders = await call('/api/sales', { headers: { cookie } })
      check('cookie request without Origin/Referer (non-browser client) allowed', noHeaders.status === 200)
      const webhook = await call('/api/payhere/notify', { headers: { origin: 'https://www.payhere.lk', cookie } })
      check('PayHere notify webhook allowed', webhook.status === 200)
      const webx = await call('/api/webxpay/webhook', { headers: { origin: 'https://webxpay.com', cookie } })
      check('WebXPay webhook allowed', webx.status === 200)
      const cron = await call('/api/cron/retention', { headers: { origin: 'https://github.com', cookie } })
      check('cron routes allowed', cron.status === 200)
      const v1 = await call('/api/v1/items', { headers: { origin: 'https://partner.example', cookie } })
      check('public API /api/v1 allowed', v1.status === 200)
      const get = await call('/api/items', { method: 'GET', headers: { origin: 'https://evil.example', cookie } })
      check('GET is never blocked', get.status === 200)
      const rid = await call('/api/items', { method: 'GET', headers: { 'x-request-id': 'lb-req-12345678' } })
      check('x-request-id from the load balancer is propagated', rid.headers.get('x-request-id') === 'lb-req-12345678')
      const page = await proxy(new NextRequest(`https://${host}/c/${slug}/dashboard`, { headers: { host, 'RSC': '1' } }))
      check('page routing unaffected (tenant rewrite still applies)', (page as Response).status !== 403)
    })

    // ================================================================ request id → logs
    await step('request id correlation', async () => {
      const { runWithRequestContext, currentRequestId, ensureRequestId } = await import('@/lib/logger')
      const id = ensureRequestId(null)
      const seen = await runWithRequestContext({ requestId: id }, async () => { await sleep(5); return currentRequestId() })
      check('request id flows through async work (AsyncLocalStorage)', seen === id && currentRequestId() === undefined)
      check('garbage upstream request ids are replaced', ensureRequestId('<script>') !== '<script>' && ensureRequestId('abc-12345678') === 'abc-12345678')
      const { scrubPII } = await import('@/lib/ai/error-logger')
      const scrubbed = scrubPII('Key (email)=(john@x.com) already exists; call 0771234567; card 4111111111111111') || ''
      check('error text is scrubbed of PII before it goes to the AI provider', !/john@x\.com|0771234567|4111111111111111/.test(scrubbed), scrubbed)
    })

    // ================================================================ PayHere exactly-once activation
    await step('PayHere notify: activation failure is retried', async () => {
      const { POST: notify } = await import('@/app/api/payhere/notify/route')
      const { retryUnactivatedPayments } = await import('@/lib/payhere/activate-payment')
      const acc = randomUUID(); accountIds.push(acc)
      await admin.query(`INSERT INTO accounts (id, email, password_hash, full_name, phone, wallet_balance) VALUES ($1, $2, 'x', 'Acc', $3, '0')`,
        [acc, `acc-${acc.slice(0, 8)}@example.test`, `07${acc.replace(/\D/g, '').slice(0, 8)}`])
      const tier = randomUUID(); tierIds.push(tier)
      await admin.query(`INSERT INTO pricing_tiers (id, name, display_name, price_monthly, price_yearly) VALUES ($1, $2, $2, '3000.00', '30000.00')`, [tier, `i5-${tier.slice(0, 6)}`])
      const subId = randomUUID()
      await admin.query(`INSERT INTO subscriptions (id, tenant_id, billing_account_id, tier_id, status, billing_cycle, current_period_start, current_period_end)
        VALUES ($1, $2, $3, $4, 'past_due', 'monthly', now() - interval '40 days', now() - interval '10 days')`, [subId, tenantId, acc, tier])
      const orderId = `I5-${randomUUID().slice(0, 12)}`
      const txnId = randomUUID()
      await admin.query(`INSERT INTO payhere_transactions (id, account_id, subscription_id, order_id, amount, currency, status, billing_cycle)
        VALUES ($1, $2, $3, $4, '3000.00', 'LKR', 'pending', 'monthly')`, [txnId, acc, subId, orderId])
      const fields = { merchant_id: process.env.PAYHERE_MERCHANT_ID!, order_id: orderId, payhere_amount: '3000.00', payhere_currency: 'LKR', status_code: '2', payment_id: 'p-i5', method: 'VISA', md5sig: notifySig(orderId, '3000.00', 'LKR', '2') }
      const form = () => new NextRequest('http://localhost/api/payhere/notify', { method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

      // Make activation fail: subscriptions of this tenant reject updates (simulated outage mid-activation)
      await admin.query(`CREATE OR REPLACE FUNCTION i5_block_sub_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.tenant_id = '${tenantId}'::uuid THEN RAISE EXCEPTION 'i5 simulated activation failure'; END IF; RETURN NEW; END $$`)
      await admin.query(`CREATE TRIGGER i5_block_sub_update BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION i5_block_sub_update()`)
      let n1
      try {
        n1 = await json(await notify(form()))
      } finally {
        await admin.query(`DROP TRIGGER IF EXISTS i5_block_sub_update ON subscriptions`)
        await admin.query(`DROP FUNCTION IF EXISTS i5_block_sub_update()`)
      }
      const t1 = (await admin.query(`SELECT status, activated_at FROM payhere_transactions WHERE id=$1`, [txnId])).rows[0]
      const s1 = (await admin.query(`SELECT status, current_period_end FROM subscriptions WHERE id=$1`, [subId])).rows[0]
      check('activation failure → 500 so PayHere retries', n1.status === 500, n1)
      check('payment recorded (success) but not marked activated', t1.status === 'success' && t1.activated_at === null, t1)
      check('nothing half-applied (subscription unchanged)', s1.status === 'past_due', s1)

      const n2 = await json(await notify(form()))
      const t2 = (await admin.query(`SELECT status, activated_at FROM payhere_transactions WHERE id=$1`, [txnId])).rows[0]
      const s2 = (await admin.query(`SELECT status, current_period_end FROM subscriptions WHERE id=$1`, [subId])).rows[0]
      check('retried notification activates the paid subscription', n2.status === 200 && t2.activated_at !== null && s2.status === 'active' && new Date(s2.current_period_end) > new Date(), { n2: n2.body, t2, s2 })

      const n3 = await json(await notify(form()))
      const s3 = (await admin.query(`SELECT current_period_end FROM subscriptions WHERE id=$1`, [subId])).rows[0]
      check('third notification is a no-op (no second period)', n3.status === 200 && +new Date(s3.current_period_end) === +new Date(s2.current_period_end), { s2, s3 })

      // Concurrent duplicate notifications for a fresh order apply exactly once
      const order2 = `I5-${randomUUID().slice(0, 12)}`
      const txn2 = randomUUID()
      await admin.query(`INSERT INTO payhere_transactions (id, account_id, subscription_id, order_id, amount, currency, status, billing_cycle)
        VALUES ($1, $2, $3, $4, '3000.00', 'LKR', 'pending', 'monthly')`, [txn2, acc, subId, order2])
      const f2 = { ...fields, order_id: order2, md5sig: notifySig(order2, '3000.00', 'LKR', '2') }
      const mk = () => new NextRequest('http://localhost/api/payhere/notify', { method: 'POST', body: new URLSearchParams(f2).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })
      const before = new Date(s3.current_period_end)
      const par = await Promise.all([notify(mk()), notify(mk()), notify(mk())])
      const s4 = (await admin.query(`SELECT current_period_end FROM subscriptions WHERE id=$1`, [subId])).rows[0]
      const days = (new Date(s4.current_period_end).getTime() - before.getTime()) / 86400000
      check('3 concurrent notifications extend the period exactly once', par.every((r) => r.status === 200) && days > 27 && days < 32, { days, statuses: par.map((r) => r.status) })

      // Cron backstop: a paid-but-unactivated row is picked up
      const order3 = `I5-${randomUUID().slice(0, 12)}`
      const txn3 = randomUUID()
      await admin.query(`INSERT INTO payhere_transactions (id, account_id, subscription_id, order_id, amount, currency, status, billing_cycle, paid_at, updated_at)
        VALUES ($1, $2, $3, $4, '3000.00', 'LKR', 'success', 'monthly', now() - interval '1 hour', now() - interval '1 hour')`, [txn3, acc, subId, order3])
      const retry = await retryUnactivatedPayments(5 * 60 * 1000, 1000)
      const t3 = (await admin.query(`SELECT activated_at FROM payhere_transactions WHERE id=$1`, [txn3])).rows[0]
      check('cron backstop activates paid-but-not-activated payments', retry.activated >= 1 && t3.activated_at !== null, { retry, t3 })
    })

    // ================================================================ retention
    await step('retention cron', async () => {
      const { POST: retention } = await import('@/app/api/cron/retention/route')
      const unauth = await retention(req('POST', '/api/cron/retention'))
      check('retention cron requires CRON_SECRET', unauth.status === 401)
      const oldAct = randomUUID(); const newAct = randomUUID()
      await admin.query(`INSERT INTO activity_logs (id, tenant_id, action, entity_type, created_at) VALUES ($1, $3, 'create', 'item', now() - interval '500 days'), ($2, $3, 'create', 'item', now() - interval '10 days')`, [oldAct, newAct, tenantId])
      const oldErr = randomUUID(); const newErr = randomUUID()
      await admin.query(`INSERT INTO ai_error_logs (id, tenant_id, level, source, message, created_at) VALUES ($1, $3, 'error', 'i5', 'old', now() - interval '120 days'), ($2, $3, 'error', 'i5', 'new', now() - interval '5 days')`, [oldErr, newErr, tenantId])
      const oldN = randomUUID(); const newN = randomUUID()
      await admin.query(`INSERT INTO notification_logs (id, tenant_id, channel, status, recipient_contact, content, created_at) VALUES ($1, $3, 'sms', 'sent', '0770000000', 'x', now() - interval '200 days'), ($2, $3, 'sms', 'sent', '0770000000', 'y', now() - interval '20 days')`, [oldN, newN, tenantId])
      const rlOld = `i5-old-${randomUUID().slice(0, 6)}`; const rlNew = `i5-new-${randomUUID().slice(0, 6)}`
      await admin.query(`INSERT INTO rate_limit_attempts (key, category, attempts, first_attempt_at) VALUES ($1, 'i5', 1, now() - interval '3 days'), ($2, 'i5', 1, now())`, [rlOld, rlNew])
      const res = await json(await retention(req('POST', '/api/cron/retention', undefined, { authorization: `Bearer ${process.env.CRON_SECRET}` })))
      check('retention run succeeds', res.status === 200 && res.body.success === true, res.body)
      const { getSharedPool: pool } = await import('@/lib/db/pool')
      const conns = await Promise.all(Array.from({ length: 3 }, () => pool().connect()))
      try {
        const vals = await Promise.all(conns.map(async (c) => (await c.query<{ statement_timeout: string }>('SHOW statement_timeout')).rows[0].statement_timeout))
        check('pooled connections are back to the 30s limit after the retention run', vals.every((v) => v === '30s'), vals)
      } finally { conns.forEach((c) => c.release()) }
      const left = async (table: string, ids: string[]) => (await admin.query(`SELECT id::text FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => r.id)
      const act = await left('activity_logs', [oldAct, newAct])
      check('activity_logs: >400 days deleted, recent kept', act.length === 1 && act[0] === newAct, act)
      const errs = await left('ai_error_logs', [oldErr, newErr])
      check('ai_error_logs: >90 days deleted, recent kept', errs.length === 1 && errs[0] === newErr, errs)
      const nl = await left('notification_logs', [oldN, newN])
      check('notification_logs: >180 days deleted, recent kept', nl.length === 1 && nl[0] === newN, nl)
      const rl = (await admin.query(`SELECT key FROM rate_limit_attempts WHERE key = ANY($1)`, [[rlOld, rlNew]])).rows.map((r) => r.key)
      check('rate_limit_attempts: expired counters deleted, live kept', rl.length === 1 && rl[0] === rlNew, rl)
      check('policy table reported per rule', Array.isArray(res.body.results) && res.body.results.some((r: J) => r.table === 'activity_logs'), res.body.results)
      await admin.query(`DELETE FROM rate_limit_attempts WHERE key = $1`, [rlNew])
    })

    // ================================================================ uploads
    await step('upload content validation', async () => {
      const { validateFileContent, validateFile } = await import('@/lib/files/storage')
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
      check('real PNG accepted', validateFileContent(png, 'a.png').valid)
      check('HTML renamed to .png rejected', !validateFileContent(Buffer.from('<html><script>alert(1)</script>'), 'a.png').valid)
      check('Windows executable renamed to .pdf rejected', !validateFileContent(Buffer.from('MZ\x90\x00\x03'), 'invoice.pdf').valid)
      check('executable renamed to .txt rejected', !validateFileContent(Buffer.from('MZ\x90\x00\x03\x00\x00'), 'notes.txt').valid)
      check('plain CSV accepted', validateFileContent(Buffer.from('a,b\n1,2\n'), 'x.csv').valid)
      check('xlsx needs a zip container', validateFileContent(Buffer.from('PK\x03\x04rest'), 'x.xlsx').valid && !validateFileContent(Buffer.from('id,name'), 'x.xlsx').valid)
      check('default upload limit is 20 MB', !validateFile({ name: 'a.pdf', type: 'application/pdf', size: 21 * 1024 * 1024 }).valid && validateFile({ name: 'a.pdf', type: 'application/pdf', size: 19 * 1024 * 1024 }).valid)

      setTestSession(owner)
      const { POST: upload } = await import('@/app/api/files/route')
      const fd = new FormData()
      fd.append('file', new File([Buffer.from('<svg onload=alert(1)>')], 'logo.png', { type: 'image/png' }))
      const r = await json(await upload(new NextRequest('http://localhost/api/files', { method: 'POST', body: fd })))
      check('POST /api/files rejects a fake PNG (400, content mismatch)', r.status === 400 && /does not match/.test(String(r.body.error)), r)
    })

    // ================================================================ metrics
    await step('metrics endpoint', async () => {
      const { GET: metrics } = await import('@/app/api/metrics/route')
      delete process.env.METRICS_TOKEN
      const off = await metrics(new Request('http://localhost/api/metrics'))
      check('metrics disabled (404) without METRICS_TOKEN', off.status === 404)
      process.env.METRICS_TOKEN = 'i5-metrics-token'
      const none = await metrics(new Request('http://localhost/api/metrics'))
      const wrong = await metrics(new Request('http://localhost/api/metrics', { headers: { authorization: 'Bearer nope' } }))
      check('metrics requires the bearer token (401)', none.status === 401 && wrong.status === 401)
      const ok = await metrics(new Request('http://localhost/api/metrics', { headers: { authorization: 'Bearer i5-metrics-token' } }))
      const text = await ok.text()
      check('metrics with token: Prometheus text incl. pool + memory', ok.status === 200 && /poslanka_db_pool_connections\{state="total"\}/.test(text) && /poslanka_process_memory_bytes/.test(text) && /poslanka_broadcast_fanout_total/.test(text), text.slice(0, 300))
      delete process.env.METRICS_TOKEN
    })

    // ================================================================ shared audit-run state
    await step('system audit progress shared across instances', async () => {
      const { startFullAudit, getAuditProgress } = await import('@/lib/audit/runner')
      const first = await startFullAudit(tenantId)
      const second = await startFullAudit(tenantId)
      check('audit claimed once; a concurrent start is refused (any instance)', first === true && second === false, { first, second })
      const row = await admin.query(`SELECT status FROM audit_runs WHERE tenant_id=$1`, [tenantId])
      check('progress persisted in audit_runs', row.rows[0]?.status === 'running' || row.rows[0]?.status === 'completed', row.rows)
      const done = await until(async () => (await getAuditProgress(tenantId)).status === 'completed', 60_000)
      const p = await getAuditProgress(tenantId)
      check('audit completes and reports progress from the DB', done && p.completedCategories === p.totalCategories, p)
      await admin.query(`UPDATE audit_runs SET status='running', progress = jsonb_set(progress, '{status}', '"running"'), updated_at = now() - interval '1 hour' WHERE tenant_id=$1`, [tenantId])
      const stale = await getAuditProgress(tenantId)
      check('a run abandoned by a dead instance is reported as interrupted', stale.status === 'error', stale)
      check('…and can be started again', await startFullAudit(tenantId))
      await until(async () => (await getAuditProgress(tenantId)).status === 'completed', 60_000)
    })
  } finally {
    setTestSession(null)
    if (!process.env.KEEP_TEST_DATA) {
      await admin.query(`SET session_replication_role = replica`)
      const steps: Array<[string, unknown[]]> = [
        [`DELETE FROM payhere_transactions WHERE account_id = ANY($1::uuid[])`, [accountIds]],
        [`DELETE FROM subscriptions WHERE tenant_id=$1`, [tenantId]],
        [`DELETE FROM pricing_tiers WHERE id = ANY($1::uuid[])`, [tierIds]],
        [`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [accountIds]],
        ...['audit_runs', 'ai_alerts', 'activity_logs', 'ai_error_logs', 'notification_logs', 'files', 'users', 'tenant_usage', 'tenant_usage_deltas']
          .map((t): [string, unknown[]] => [`DELETE FROM ${t} WHERE tenant_id=$1`, [tenantId]]),
        [`DELETE FROM tenants WHERE id=$1`, [tenantId]],
      ]
      for (const [stmt, params] of steps) {
        await admin.query(stmt, params).catch((e) => console.warn('cleanup:', e.message))
      }
      await admin.query(`SET session_replication_role = origin`)
    }
    await admin.end()
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  await closeAllPools().catch(() => undefined)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
