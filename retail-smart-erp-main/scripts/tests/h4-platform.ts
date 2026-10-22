/**
 * H4 — platform integration test: web offline queue, public API keys + /api/v1, full tenant
 * backup, dashboard cash-variance metrics and read-side RBAC.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_r8 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/h4-harness/tsconfig.json scripts/tests/h4-platform.ts
 *
 * Calls the real route handlers (auth mocked via the h4 harness, which also honours the API-key
 * principal like the real authWithCompany) on throw-away tenants, prints PASS/FAIL per check and
 * exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import zlib from 'zlib'
import { NextRequest } from 'next/server'
import { setTestSession } from './h4-harness/auth-mock'
import { closeAllPools, withTenant, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import {
  classifySyncResponse, generateClientSaleId, isUuid, backoffMs, MAX_AUTO_ATTEMPTS,
} from '@/lib/offline/sync-policy'
import { allocateOfflineRef, type RefStorage } from '@/lib/offline/offline-ref'
import { syncPendingSales, type PendingSale, type PendingSaleStore, type SyncTransport } from '@/lib/offline/pos-queue'
import { generateApiKey, parseApiKey } from '@/lib/auth/api-keys'
import { canViewBlock, fetchMetrics, fetchQuickListData, filterBlocksForSession } from '@/lib/workspace/metrics'
import { getDefaultWorkspace } from '@/lib/workspace/defaults'
import { POST as postSale } from '@/app/api/sales/route'
import { POST as postOfflineRejected } from '@/app/api/sales/offline-rejected/route'
import { GET as listKeys, POST as createKey } from '@/app/api/settings/api-keys/route'
import { DELETE as revokeKey } from '@/app/api/settings/api-keys/[id]/route'
import { GET as v1Items } from '@/app/api/v1/items/route'
import { GET as v1Item } from '@/app/api/v1/items/[id]/route'
import { GET as v1Stock } from '@/app/api/v1/stock/route'
import { GET as v1Customers, POST as v1CreateCustomer } from '@/app/api/v1/customers/route'
import { GET as v1Sales, POST as v1CreateSale } from '@/app/api/v1/sales/route'
import { GET as v1Sale } from '@/app/api/v1/sales/[id]/route'
import { GET as backupGET } from '@/app/api/export/backup/route'
import { GET as itemsGET } from '@/app/api/items/route'
import { GET as itemGET } from '@/app/api/items/[id]/route'
import { GET as customersGET } from '@/app/api/customers/route'
import { GET as giftCardsGET } from '@/app/api/gift-cards/route'
import { GET as layawaysGET } from '@/app/api/layaways/route'
import { GET as heldSalesGET } from '@/app/api/held-sales/route'
import { GET as numberCardGET } from '@/app/api/workspace/number-card/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; wh2: string; userId: string; customerId: string; users: Record<string, string> }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx, role = 'owner') {
  const id = role === 'owner' ? f.userId : f.users[role]
  return {
    user: {
      id, accountId: null, email: `${role}-${f.slug}@example.test`, name: role, role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'H4', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response | undefined): Promise<{ status: number; body: J; headers: Headers }> {
  if (!res) return { status: 0, body: { error: 'no response' }, headers: new Headers() }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body, headers: res.headers }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 300)

const ROLES = ['manager', 'cashier', 'system_manager', 'stock_manager']

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `h4-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), wh2: randomUUID(), userId: randomUUID(), customerId: randomUUID(), users: {} }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'H4 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Branch', 'BR', false)`, [f.wh2, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, pin_hash, full_name, role) VALUES ($1, $2, $3, 'SECRET-HASH-OWNER', 'SECRET-PIN', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  for (const role of ROLES) {
    const id = randomUUID()
    f.users[role] = id
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'SECRET-HASH', $4, $5)`,
      [id, tenantId, `${role}-${slug}@example.test`, role, role])
  }
  await admin.query(`INSERT INTO customers (id, tenant_id, name, phone) VALUES ($1, $2, 'Nimal Perera', '0771234567')`, [f.customerId, tenantId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, cost: number, stock?: Array<[string, number]>) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, barcode)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
    [id, f.tenantId, `H4-${id.slice(0, 8)}`, name, cost, price, `BC${id.slice(0, 8)}`])
  for (const [wh, qty] of stock || []) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: wh, itemId: id, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: f.userId,
    }))
  }
  return id
}

/** Minimal unzip (central directory + inflateRaw) for checking the backup archive. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('no end of central directory')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header')
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtra = buf.readUInt16LE(local + 28)
    const data = buf.subarray(local + 30 + lNameLen + lExtra, local + 30 + lNameLen + lExtra + csize)
    const raw = method === 8 ? zlib.inflateRawSync(data) : data
    if ((zlib.crc32(raw) >>> 0) !== crc) throw new Error(`crc mismatch for ${name}`)
    out.set(name, raw.toString('utf8'))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function memoryStore(initial: PendingSale[] = []): PendingSaleStore & { rows: Map<string, PendingSale> } {
  const rows = new Map(initial.map((s) => [s.clientSaleId, s]))
  return {
    rows,
    list: async () => [...rows.values()].map((s) => JSON.parse(JSON.stringify(s)) as PendingSale)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    put: async (s) => { rows.set(s.clientSaleId, JSON.parse(JSON.stringify(s))) },
    remove: async (id) => { rows.delete(id) },
  }
}

function pending(f: Fx, payload: Record<string, unknown>, extra: Partial<PendingSale> = {}): PendingSale {
  const clientSaleId = (payload.clientSaleId as string) || randomUUID()
  return {
    clientSaleId, payload: { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...payload, clientSaleId },
    createdAt: new Date().toISOString(), attempts: 0, tenantSlug: f.slug, ...extra,
  }
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin, 'main')
    const g = await makeTenant(admin, 'other')
    tenants.push(f.tenantId, g.tenantId)
    setTestSession(session(f))
    const A = await newItem(admin, f, 'Dhal 1kg', 400, 310, [[f.wh, 50], [f.wh2, 7]])
    const B = await newItem(admin, f, 'Sugar 1kg', 300, 250, [[f.wh, 50]])
    const G = await newItem(admin, g, 'Other tenant item', 999, 1, [[g.wh, 5]])

    // ==================== 1. offline sync policy (pure) ====================
    await step('offline policy', async () => {
      const id = randomUUID()
      check('policy: 200 with our sale → synced', classifySyncResponse(200, { id: randomUUID(), clientSaleId: id }, id).kind === 'synced')
      check('policy: 200 with ANOTHER clientSaleId → rejected (never treated as ours)', classifySyncResponse(200, { id: randomUUID(), clientSaleId: randomUUID() }, id).kind === 'rejected')
      check('policy: 409 OFFLINE_REF_CONFLICT → ref_conflict (not synced)', classifySyncResponse(409, { code: 'OFFLINE_REF_CONFLICT', error: 'x' }, id).kind === 'ref_conflict')
      check('policy: other 409 → rejected (kept, not deleted)', classifySyncResponse(409, { error: 'conflict' }, id).kind === 'rejected')
      check('policy: 400 → rejected', classifySyncResponse(400, { error: 'bad' }, id).kind === 'rejected')
      check('policy: 503 / 429 / 408 → transient', ['503', '429', '408'].every((s) => classifySyncResponse(Number(s), {}, id).kind === 'transient'))
      check('policy: 401 → auth (keep for re-login)', classifySyncResponse(401, {}, id).kind === 'auth')
      check('policy: backoff 5s → 10s → capped at 10 min', backoffMs(1) === 5000 && backoffMs(2) === 10000 && backoffMs(30) === 600000)
      check('generateClientSaleId → RFC 4122 v4 UUID', isUuid(generateClientSaleId()) && /^.{14}4/.test(generateClientSaleId()))
      const orig = globalThis.crypto
      try {
        Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: orig.getRandomValues.bind(orig) }, configurable: true })
        const a = generateClientSaleId()
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
        const b = generateClientSaleId()
        check('generateClientSaleId fallback without randomUUID / WebCrypto still yields a UUID', isUuid(a) && isUuid(b) && a !== b, `${a} ${b}`)
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true })
      }
    })

    // ==================== 2. offline queue against the real sales route ====================
    const realTransport: SyncTransport = {
      postSale: async (payload) => { const r = await json(await postSale(req('POST', '/api/sales', payload))); return { status: r.status, body: r.body } },
      reportRejected: async (report) => { const r = await json(await postOfflineRejected(req('POST', '/api/sales/offline-rejected', report))); return { status: r.status, body: r.body } },
    }
    await step('offline queue', async () => {
      setTestSession(session(f, 'cashier'))
      const good = pending(f, { cartItems: [{ itemId: A, name: 'Dhal', quantity: 1, unitPrice: 400 }], paymentMethod: 'cash', subtotal: 400, total: 400, amountPaid: 400 })
      const bad = pending(f, { cartItems: [{ itemId: B, name: 'Sugar', quantity: 2, unitPrice: 300 }], paymentMethod: 'cash', subtotal: 600, total: 60, amountPaid: 60 })
      const foreign = pending(f, { cartItems: [{ itemId: A, name: 'Dhal', quantity: 1, unitPrice: 400 }], paymentMethod: 'cash', subtotal: 400, total: 400, amountPaid: 400 }, { tenantSlug: 'someone-else' })
      const store = memoryStore([good, bad, foreign])
      const r1 = await syncPendingSales(realTransport, { store, tenantSlug: f.slug })
      const goodRows = (await admin.query(`SELECT id FROM sales WHERE tenant_id=$1 AND client_sale_id=$2`, [f.tenantId, good.clientSaleId])).rows
      check('confirmed sale removed from the queue and exists once on the server', !store.rows.has(good.clientSaleId) && goodRows.length === 1, short(r1))
      const badEntry = store.rows.get(bad.clientSaleId)
      check('server-rejected sale (TOTAL_MISMATCH 400) is KEPT as rejected with the error', !!badEntry?.rejected && /total|mismatch/i.test(badEntry?.lastError || ''), short(badEntry))
      check('rejected sale reported once to /api/sales/offline-rejected', badEntry?.reported === true)
      const log = await admin.query(`SELECT count(*)::int c FROM activity_logs WHERE tenant_id=$1 AND metadata->>'clientSaleId'=$2`, [f.tenantId, bad.clientSaleId])
      check('manager alert recorded (activity log) for the rejected sale', log.rows[0].c === 1, JSON.stringify(log.rows))
      check('another company\'s queued sale is not replayed', store.rows.has(foreign.clientSaleId) && !store.rows.get(foreign.clientSaleId)!.attempts)

      // Replay of an already-synced clientSaleId: server answers 200 with the existing sale
      const replay = memoryStore([pending(f, { ...good.payload })])
      await syncPendingSales(realTransport, { store: replay, tenantSlug: f.slug })
      const dup = (await admin.query(`SELECT count(*)::int c FROM sales WHERE tenant_id=$1 AND client_sale_id=$2`, [f.tenantId, good.clientSaleId])).rows[0].c
      check('replayed clientSaleId → synced without a duplicate sale', replay.rows.size === 0 && dup === 1, String(dup))

      // OFFLINE_REF_CONFLICT: another sale already uses the printed number → renumbered, kept
      const ref = `OFF-H4T-${Date.now() % 100000}`
      const first = await json(await postSale(req('POST', '/api/sales', { ...good.payload, clientSaleId: randomUUID(), offlineRef: ref })))
      const clash = pending(f, { cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }], paymentMethod: 'cash', subtotal: 300, total: 300, amountPaid: 300, offlineRef: ref }, { offlineRef: ref })
      const cs = memoryStore([clash])
      await syncPendingSales(realTransport, { store: cs, tenantSlug: f.slug })
      const kept = (await admin.query(`SELECT offline_ref, flags->>'offlineRefAlias' alias FROM sales WHERE tenant_id=$1 AND client_sale_id=$2`, [f.tenantId, clash.clientSaleId])).rows[0]
      check('OFFLINE_REF_CONFLICT → sale kept with a unique ref + printed alias (not dropped)', first.status === 200 && cs.rows.size === 0 && !!kept && kept.offline_ref !== ref && kept.alias === ref, short(kept))

      // Web offline receipt numbers: OFF-W<5>-<seq>, per company, stable device code
      const mem = new Map<string, string>()
      const st: RefStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) } }
      const r1a = allocateOfflineRef(f.slug, st)
      const r1b = allocateOfflineRef(f.slug, st)
      const r2a = allocateOfflineRef(g.slug, st)
      check('web offline refs: OFF-W…-00001, 00002; own sequence per company; same device code',
        /^OFF-W[A-Z0-9]{5}-00001$/.test(r1a) && r1b === r1a.replace(/00001$/, '00002') && r2a === r1a, `${r1a} ${r1b} ${r2a}`)

      // A queued sale whose shift closed before it synced: with an offlineRef it is accepted and
      // flagged (offline sale); the same payload replayed as an online sale is rejected.
      const sp = randomUUID()
      const closedShift = randomUUID()
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Till Q',$3)`, [sp, f.tenantId, f.wh])
      await admin.query(`INSERT INTO pos_opening_entries (id, tenant_id, entry_number, pos_profile_id, user_id, warehouse_id, status) VALUES ($1,$2,'POS-H4-Q',$3,$4,$5,'closed')`, [closedShift, f.tenantId, sp, f.users.cashier, f.wh])
      const shiftPayload = { cartItems: [{ itemId: A, name: 'Dhal', quantity: 1, unitPrice: 400 }], paymentMethod: 'cash', subtotal: 400, total: 400, amountPaid: 400, posOpeningEntryId: closedShift }
      const online = await json(await postSale(req('POST', '/api/sales', { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...shiftPayload, clientSaleId: randomUUID() })))
      const qref = allocateOfflineRef(f.slug, st)
      const queued = pending(f, { ...shiftPayload, offlineRef: qref }, { offlineRef: qref })
      const qs = memoryStore([queued])
      await syncPendingSales(realTransport, { store: qs, tenantSlug: f.slug })
      const row = (await admin.query(`SELECT offline_ref, flags FROM sales WHERE tenant_id=$1 AND client_sale_id=$2`, [f.tenantId, queued.clientSaleId])).rows[0]
      check('queued sale on a since-closed shift syncs as an offline sale (flagged, not rejected)', online.status >= 400 && qs.rows.size === 0 && row?.offline_ref === qref && row.flags?.offline === true, `${online.status} ${short(row)} ${short([...qs.rows.values()])}`)

      // Transient failures: exponential backoff, then rejected after MAX_AUTO_ATTEMPTS
      let reported = 0
      const flaky: SyncTransport = {
        postSale: async () => ({ status: 503, body: { error: 'Service unavailable' } }),
        reportRejected: async () => { reported++; return { status: 200, body: { recorded: true } } },
      }
      let clock = Date.now()
      const ts = memoryStore([pending(f, { total: 1 })])
      const id = [...ts.rows.keys()][0]
      await syncPendingSales(flaky, { store: ts, now: () => clock })
      const e1 = ts.rows.get(id)!
      check('503 → kept with attempts=1 and nextAttemptAt ≈ now+5s', e1.attempts === 1 && !e1.rejected && e1.nextAttemptAt === clock + 5000, short(e1))
      await syncPendingSales(flaky, { store: ts, now: () => clock })
      check('not retried before nextAttemptAt', ts.rows.get(id)!.attempts === 1)
      for (let i = 0; i < MAX_AUTO_ATTEMPTS + 2; i++) {
        clock += 11 * 60_000
        await syncPendingSales(flaky, { store: ts, now: () => clock })
      }
      const e2 = ts.rows.get(id)!
      check(`gives up after ${MAX_AUTO_ATTEMPTS} attempts → rejected (kept locally) and reported once`, !!e2.rejected && e2.attempts === MAX_AUTO_ATTEMPTS && reported === 1, short(e2))

      // Network failure: stop, keep, attempt not counted
      const down: SyncTransport = { postSale: async () => { throw new TypeError('Failed to fetch') }, reportRejected: async () => { throw new TypeError('Failed to fetch') } }
      const ns = memoryStore([pending(f, { total: 1 }), pending(f, { total: 2 })])
      const nr = await syncPendingSales(down, { store: ns })
      check('network error → stops (still offline), entries kept, attempts not counted', nr.stoppedOffline && ns.rows.size === 2 && [...ns.rows.values()].every((s) => s.attempts === 0), short(nr))

      // Rejection report says the sale exists after all → dropped from the queue
      const exists: SyncTransport = {
        postSale: async () => ({ status: 400, body: { error: 'whatever' } }),
        reportRejected: async () => ({ status: 200, body: { recorded: false, sale: { id: randomUUID(), invoiceNo: 'INV-1' } } }),
      }
      const es = memoryStore([pending(f, { total: 1 })])
      await syncPendingSales(exists, { store: es })
      check('server says the sale exists after all → entry removed (synced)', es.rows.size === 0)
      setTestSession(session(f))
    })

    // ==================== 3. API keys + /api/v1 ====================
    let key = ''
    let keyId = ''
    let readKey = ''
    await step('api keys', async () => {
      check('generated key parses and has a 12-char id', !!parseApiKey(generateApiKey().key))
      setTestSession(session(f, 'cashier'))
      const denied = await json(await createKey(req('POST', '/api/settings/api-keys', { name: 'x', scopes: ['items:read'] })))
      check('cashier cannot create API keys → 403', denied.status === 403, short(denied.body))
      setTestSession(session(f))
      const created = await json(await createKey(req('POST', '/api/settings/api-keys', {
        name: 'Web shop', scopes: ['items:read', 'stock:read', 'customers:read', 'customers:write', 'sales:read', 'sales:write'],
      })))
      key = created.body.secret
      keyId = created.body.id
      check('owner creates key → 201 with the secret shown once', created.status === 201 && /^plk_[A-Za-z0-9]{12}_/.test(key || ''), short(created.body))
      const stored = (await admin.query(`SELECT key_hash, key_prefix FROM api_keys WHERE id=$1`, [keyId])).rows[0]
      check('only the sha256 hash is stored (not the secret)', stored && stored.key_hash.length === 64 && !JSON.stringify(stored).includes(key.split('_')[2]), short(stored))
      const list = await json(await listKeys())
      check('list never returns the secret or its hash', list.status === 200 && Array.isArray(list.body) && !JSON.stringify(list.body).includes(stored.key_hash) && !JSON.stringify(list.body).includes(key), short(list.body))
      const ro = await json(await createKey(req('POST', '/api/settings/api-keys', { name: 'BI read only', scopes: ['items:read'], expiresInDays: 30 })))
      readKey = ro.body.secret
      const bogus = await json(await createKey(req('POST', '/api/settings/api-keys', { name: 'bad', scopes: ['admin:all'] })))
      check('unknown scope rejected → 400', bogus.status === 400)
      setTestSession(null)
    })

    const auth = (k: string) => ({ authorization: `Bearer ${k}` })
    await step('v1 auth', async () => {
      const none = await json(await v1Items(req('GET', '/api/v1/items')))
      check('no key → 401', none.status === 401 && none.body.code === 'MISSING_API_KEY', short(none.body))
      const wrong = await json(await v1Items(req('GET', '/api/v1/items', undefined, auth(key.slice(0, -4) + 'AAAA'))))
      check('wrong secret (right prefix) → 401', wrong.status === 401 && wrong.body.code === 'INVALID_API_KEY', short(wrong.body))
      const scope = await json(await v1Stock(req('GET', '/api/v1/stock', undefined, auth(readKey))))
      check('key without stock:read → 403 INSUFFICIENT_SCOPE', scope.status === 403 && scope.body.code === 'INSUFFICIENT_SCOPE', short(scope.body))
      const xkey = await json(await v1Items(req('GET', '/api/v1/items', undefined, { 'x-api-key': readKey })))
      check('X-API-Key header accepted; rate-limit headers present', xkey.status === 200 && xkey.headers.get('x-ratelimit-limit') !== null, short(xkey.body))
    })

    await step('v1 items / stock', async () => {
      const r = await json(await v1Items(req('GET', '/api/v1/items?search=Dhal', undefined, auth(key))))
      const it = r.body.data?.[0]
      check('items list → item with stock per warehouse', r.status === 200 && it?.id === A && it.stock.length === 2 && Number(it.totalStock) === it.stock.reduce((t: number, w: J) => t + Number(w.currentStock), 0) && it.stock.some((w: J) => w.warehouseId === f.wh2 && w.currentStock === '7.000'), short(r.body))
      check('items list never exposes cost price', !JSON.stringify(r.body).includes('costPrice') && !JSON.stringify(r.body).includes('310'))
      const all = await json(await v1Items(req('GET', '/api/v1/items?pageSize=100', undefined, auth(key))))
      check('items list only shows this company\'s items', all.status === 200 && !all.body.data.some((i: J) => i.id === G) && all.body.pagination.total === 2, short(all.body.pagination))
      const one = await json(await v1Item(req('GET', `/api/v1/items/${A}`, undefined, auth(key)), ctx(A)))
      check('item get → 200', one.status === 200 && one.body.data.id === A)
      const other = await json(await v1Item(req('GET', `/api/v1/items/${G}`, undefined, auth(key)), ctx(G)))
      check('item of another company → 404', other.status === 404, short(other.body))
      const st = await json(await v1Stock(req('GET', `/api/v1/stock?warehouseId=${f.wh2}`, undefined, auth(key))))
      check('stock levels by warehouse', st.status === 200 && st.body.data.length === 1 && st.body.data[0].itemId === A && st.body.data[0].currentStock === '7.000', short(st.body))
    })

    await step('v1 customers', async () => {
      const c = await json(await v1CreateCustomer(req('POST', '/api/v1/customers', { name: 'Kamala Silva', phone: '0719998887' }, auth(key))))
      check('create customer → 201 (app create logic)', c.status === 201 && c.body.data?.name === 'Kamala Silva', short(c.body))
      const dupe = await json(await v1CreateCustomer(req('POST', '/api/v1/customers', { name: 'Again', phone: '0719998887' }, auth(key))))
      check('duplicate phone rejected by the shared logic → 400', dupe.status === 400, short(dupe.body))
      const credit = await json(await v1CreateCustomer(req('POST', '/api/v1/customers', { name: 'X', creditLimit: 100000 }, auth(key))))
      check('fields outside the public schema (creditLimit) → 400', credit.status === 400)
      const l = await json(await v1Customers(req('GET', '/api/v1/customers?search=Kamala', undefined, auth(key))))
      check('list customers', l.status === 200 && l.body.data.length === 1)
    })

    let v1SaleId = ''
    await step('v1 sales', async () => {
      const body = {
        customerId: f.customerId,
        cartItems: [{ itemId: B, quantity: 2, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 600, total: 600, amountPaid: 600,
      }
      const noKey = await json(await v1CreateSale(req('POST', '/api/v1/sales', body, auth(key))))
      check('sale without Idempotency-Key → 400', noKey.status === 400 && noKey.body.code === 'IDEMPOTENCY_KEY_REQUIRED')
      const ret = await json(await v1CreateSale(req('POST', '/api/v1/sales', { ...body, isReturn: true }, { ...auth(key), 'idempotency-key': 'order-ret-0001' })))
      check('returns / extra fields not accepted through the public API → 400', ret.status === 400)
      const idem = `order-${randomUUID()}`
      const before = (await admin.query(`SELECT current_stock::float s FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.wh, B])).rows[0].s
      const s1 = await json(await v1CreateSale(req('POST', '/api/v1/sales', body, { ...auth(key), 'idempotency-key': idem })))
      v1SaleId = s1.body.data?.id
      check('create sale → 201 via the POS sale logic (lines + payment)', s1.status === 201 && s1.body.data?.status === 'completed' && s1.body.data.lines.length === 1 && s1.body.data.payments.length === 1, short(s1.body))
      const s2 = await json(await v1CreateSale(req('POST', '/api/v1/sales', body, { ...auth(key), 'idempotency-key': idem })))
      check('same Idempotency-Key → 200 replay of the same sale', s2.status === 200 && s2.body.data?.id === v1SaleId && s2.headers.get('idempotent-replayed') === 'true', short(s2.body))
      const after = (await admin.query(`SELECT current_stock::float s FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.wh, B])).rows[0].s
      check('stock moved once (−2)', before - after === 2, `${before} → ${after}`)
      const [p1, p2] = await Promise.all([
        v1CreateSale(req('POST', '/api/v1/sales', body, { ...auth(key), 'idempotency-key': `${idem}-race` })),
        v1CreateSale(req('POST', '/api/v1/sales', body, { ...auth(key), 'idempotency-key': `${idem}-race` })),
      ])
      const raced = (await admin.query(`SELECT count(*)::int c FROM sales s WHERE tenant_id=$1 AND created_at > now() - interval '1 minute' AND total=600 AND customer_id=$2`, [f.tenantId, f.customerId])).rows[0].c
      check('two concurrent requests with one key → one sale', [p1.status, p2.status].every((s) => s === 200 || s === 201) && raced === 2, `${p1.status}/${p2.status} sales=${raced}`)
      const bad = await json(await v1CreateSale(req('POST', '/api/v1/sales', { ...body, total: 60, amountPaid: 60 }, { ...auth(key), 'idempotency-key': `bad-${randomUUID()}` })))
      check('server-side validation still applies (TOTAL_MISMATCH → 400)', bad.status === 400 && bad.body.code === 'TOTAL_MISMATCH', short(bad.body))
      const g1 = await json(await v1Sale(req('GET', `/api/v1/sales/${v1SaleId}`, undefined, auth(key)), ctx(v1SaleId)))
      check('get sale', g1.status === 200 && g1.body.data.id === v1SaleId)
      const list = await json(await v1Sales(req('GET', '/api/v1/sales?pageSize=5', undefined, auth(key))))
      check('list sales', list.status === 200 && list.body.data.some((s: J) => s.id === v1SaleId))
      const log = await admin.query(`SELECT count(*)::int c FROM activity_logs WHERE tenant_id=$1 AND entity_id=$2 AND description LIKE '%via API key%'`, [f.tenantId, v1SaleId])
      check('sale creation via API audited', log.rows[0].c === 1)
      const ro = await json(await v1CreateSale(req('POST', '/api/v1/sales', body, { ...auth(readKey), 'idempotency-key': `ro-${randomUUID()}` })))
      check('read-only key cannot create sales → 403', ro.status === 403)
    })

    await step('v1 key lifecycle', async () => {
      await admin.query(`INSERT INTO rate_limit_attempts (key, category, attempts, first_attempt_at, updated_at)
        VALUES ($1, 'api_key', 100000, now(), now())
        ON CONFLICT (key, category) DO UPDATE SET attempts = 100000, first_attempt_at = now()`, [keyId])
      const limited = await json(await v1Items(req('GET', '/api/v1/items', undefined, auth(key))))
      check('over the per-key rate limit → 429 with Retry-After', limited.status === 429 && !!limited.headers.get('retry-after'), short(limited.body))
      await admin.query(`DELETE FROM rate_limit_attempts WHERE key=$1 AND category='api_key'`, [keyId])

      await admin.query(`UPDATE users SET is_active=false WHERE id=$1`, [f.userId])
      const inactive = await json(await v1Items(req('GET', '/api/v1/items', undefined, auth(key))))
      check('creator deactivated → key stops working (401)', inactive.status === 401, short(inactive.body))
      await admin.query(`UPDATE users SET is_active=true WHERE id=$1`, [f.userId])

      await admin.query(`UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE key_prefix=$1`, [parseApiKey(readKey)!.prefix])
      const expired = await json(await v1Items(req('GET', '/api/v1/items', undefined, auth(readKey))))
      check('expired key → 401 API_KEY_EXPIRED', expired.status === 401 && expired.body.code === 'API_KEY_EXPIRED', short(expired.body))

      setTestSession(session(f))
      const rv = await json(await revokeKey(req('DELETE', `/api/settings/api-keys/${keyId}`), ctx(keyId)))
      setTestSession(null)
      const revoked = await json(await v1Items(req('GET', '/api/v1/items', undefined, auth(key))))
      check('revoked key → 401 API_KEY_REVOKED', rv.status === 200 && revoked.status === 401 && revoked.body.code === 'API_KEY_REVOKED', short(revoked.body))
    })

    // ==================== 4. full tenant backup ====================
    await step('backup', async () => {
      setTestSession(session(f, 'manager'))
      const mgr = await json(await backupGET())
      check('manager cannot download a full backup → 403', mgr.status === 403)
      setTestSession(session(f))
      const res = await backupGET()
      const buf = Buffer.from(await res.arrayBuffer())
      check('owner backup → 200 application/zip', res.status === 200 && res.headers.get('content-type') === 'application/zip', `${res.status} ${buf.slice(0, 200).toString()}`)
      const files = unzip(buf)
      const manifest = JSON.parse(files.get('manifest.json') || '{}')
      check('manifest lists tables with row counts', manifest.format === 'poslanka-tenant-backup' && manifest.tables.length > 50 && manifest.tenantId === f.tenantId, short(manifest).slice(0, 200))
      const itemsJ = (files.get('tables/items.jsonl') || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      check('items.jsonl has exactly this company\'s items', itemsJ.length === 2 && itemsJ.every((i: J) => i.tenant_id === f.tenantId), String(itemsJ.length))
      const all = [...files.values()].join('\n')
      check('no other tenant data anywhere in the archive', !all.includes(g.tenantId) && !all.includes('Other tenant item'))
      const usersJ = (files.get('tables/users.jsonl') || '').trim().split('\n').map((l) => JSON.parse(l))
      check('users exported without password / PIN hashes', usersJ.length === 5 && usersJ.every((u: J) => !('password_hash' in u) && !('pin_hash' in u)) && !all.includes('SECRET-HASH') && !all.includes('SECRET-PIN'))
      const keysJ = (files.get('tables/api_keys.jsonl') || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      check('api_keys exported without key_hash', keysJ.length === 2 && keysJ.every((k: J) => !('key_hash' in k)))
      check('sales of the offline / API tests are in the backup', (files.get('tables/sales.jsonl') || '').includes(v1SaleId))
      check('FILES.txt explains that binaries are not included', (files.get('FILES.txt') || '').includes('NOT in this archive'))
      const audit = await admin.query(`SELECT metadata->>'stage' stage FROM activity_logs WHERE tenant_id=$1 AND entity_type='backup' ORDER BY created_at`, [f.tenantId])
      await new Promise((r) => setTimeout(r, 300))
      const audit2 = await admin.query(`SELECT metadata->>'stage' stage FROM activity_logs WHERE tenant_id=$1 AND entity_type='backup' ORDER BY created_at`, [f.tenantId])
      check('backup start and completion audited', audit2.rows.map((r) => r.stage).join(',') === 'started,completed', JSON.stringify(audit.rows) + JSON.stringify(audit2.rows))
    })

    // ==================== 5. dashboard metrics ====================
    await step('dashboard', async () => {
      const prof = randomUUID()
      const open1 = randomUUID()
      const open2 = randomUUID()
      const close = randomUUID()
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Counter 1',$3)`, [prof, f.tenantId, f.wh])
      const prof2 = randomUUID()
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Counter 2',$3)`, [prof2, f.tenantId, f.wh])
      await admin.query(`INSERT INTO pos_opening_entries (id, tenant_id, entry_number, pos_profile_id, user_id, warehouse_id, status) VALUES ($1,$2,'POS-H4-1',$3,$4,$5,'closed')`, [open1, f.tenantId, prof, f.users.cashier, f.wh])
      await admin.query(`INSERT INTO pos_opening_entries (id, tenant_id, entry_number, pos_profile_id, user_id, warehouse_id, status) VALUES ($1,$2,'POS-H4-2',$3,$4,$5,'open')`, [open2, f.tenantId, prof2, f.users.manager, f.wh])
      await admin.query(`INSERT INTO pos_closing_entries (id, tenant_id, entry_number, opening_entry_id, pos_profile_id, user_id, opening_time, closing_time, status)
        VALUES ($1,$2,'CLS-H4-1',$3,$4,$5, now() - interval '8 hours', now(), 'submitted')`, [close, f.tenantId, open1, prof, f.users.cashier])
      await admin.query(`INSERT INTO pos_closing_reconciliation (tenant_id, closing_entry_id, payment_method, opening_amount, expected_amount, actual_amount)
        VALUES ($1,$2,'cash',1000,5400,5250), ($1,$2,'card',0,2000,2000)`, [f.tenantId, close])
      const m = await withTenant(f.tenantId, (db) => fetchMetrics(db, ['open_shifts', 'today_cash_variance', 'week_cash_variance']))
      check('open shifts = 1', m.open_shifts?.value === 1, JSON.stringify(m))
      check("today's cash variance = −150 (cash only)", m.today_cash_variance?.value === -150 && m.week_cash_variance?.value === -150, JSON.stringify(m))
      const ql = await withTenant(f.tenantId, (db) => fetchQuickListData(db, 'recent_shift_variance', 5))
      check('shift variance list shows cashier, expected, counted, variance', ql?.rows.length === 1 && Number(ql.rows[0].variance) === -150 && ql.rows[0].cashierName === 'cashier', JSON.stringify(ql?.rows))
      const cashier = session(f, 'cashier') as unknown as Parameters<typeof canViewBlock>[0]
      const owner = session(f) as unknown as Parameters<typeof canViewBlock>[0]
      check('cashier cannot see cash variance / revenue blocks; owner can', !canViewBlock(cashier, 'today_cash_variance') && !canViewBlock(cashier, 'today_sales_total') && canViewBlock(cashier, 'open_shifts') && canViewBlock(owner, 'today_cash_variance'))
      const dash = getDefaultWorkspace('dashboard', 'retail')!
      const keysOf = (blocks: J[]) => blocks.map((b) => b.data?.metricKey || b.data?.chartKey || b.data?.listKey).filter(Boolean)
      const ownerKeys = keysOf(filterBlocksForSession(dash.blocks, owner) as unknown as J[])
      check('default dashboard: sales, top products, low stock, open shifts, cash variance', ['today_sales_count', 'top_selling_items', 'low_stock_items', 'open_shifts', 'today_cash_variance', 'recent_shift_variance'].every((k) => ownerKeys.includes(k)), ownerKeys.join(','))
      const cashierKeys = keysOf(filterBlocksForSession(dash.blocks, cashier) as unknown as J[])
      check('cashier dashboard hides financial blocks', !cashierKeys.includes('today_cash_variance') && !cashierKeys.includes('recent_sales') && cashierKeys.includes('low_stock_items'), cashierKeys.join(','))
      setTestSession(session(f, 'cashier'))
      const nc = await json(await numberCardGET(req('GET', '/api/workspace/number-card?keys=today_sales_count,today_sales_total')))
      check('number-card route omits revenue for a cashier', nc.status === 200 && 'today_sales_count' in nc.body && !('today_sales_total' in nc.body), short(nc.body))
    })

    // ==================== 6. read-side RBAC ====================
    await step('rbac', async () => {
      setTestSession(session(f, 'cashier'))
      const ci = await json(await itemsGET(req('GET', '/api/items?search=Dhal')))
      check('cashier item lookup still works (POS) but without cost price', ci.status === 200 && ci.body.data[0].id === A && ci.body.data[0].costPrice === null, short(ci.body.data?.[0]))
      const cOne = await json(await itemGET(req('GET', `/api/items/${A}`), ctx(A)))
      check('cashier item detail without cost price', cOne.status === 200 && cOne.body.costPrice === null)
      setTestSession(session(f, 'manager'))
      const mi = await json(await itemsGET(req('GET', '/api/items?search=Dhal')))
      check('manager sees cost price', mi.status === 200 && Number(mi.body.data[0].costPrice) === 310)
      setTestSession(session(f, 'cashier'))
      const cc = await json(await customersGET(req('GET', '/api/customers?search=Nimal')))
      check('cashier customer lookup works', cc.status === 200 && cc.body.data.length === 1)
      setTestSession(session(f, 'system_manager'))
      const hc = await json(await customersGET(req('GET', '/api/customers')))
      check('system_manager (no sales / customer / report access) cannot list customers → 403', hc.status === 403)
      const ls = await json(await layawaysGET(req('GET', '/api/layaways')))
      check('system_manager cannot list layaways → 403', ls.status === 403)
      setTestSession(session(f, 'cashier'))
      const gc = await json(await giftCardsGET(req('GET', '/api/gift-cards')))
      check('cashier cannot list the gift-card register → 403 (POS uses lookup)', gc.status === 403)
      const lc = await json(await layawaysGET(req('GET', '/api/layaways')))
      check('cashier can list layaways', lc.status === 200)
      setTestSession(session(f, 'stock_manager'))
      const hs = await json(await heldSalesGET(req('GET', '/api/held-sales')))
      check('stock_manager cannot list held sales → 403', hs.status === 403)
      await admin.query(`INSERT INTO held_sales (tenant_id, hold_number, cart_items, held_by) VALUES ($1, 'HOLD-H4', '[]', $2)`, [f.tenantId, f.users.cashier])
      setTestSession(session(f, 'cashier'))
      const hc2 = await json(await heldSalesGET(req('GET', '/api/held-sales')))
      check('held sales: cashier sees them, without the holder\'s password hash', hc2.status === 200 && hc2.body.length === 1 && hc2.body[0].heldByUser?.fullName === 'cashier' && !JSON.stringify(hc2.body).includes('SECRET-HASH'), short(hc2.body))
    })
  } finally {
    setTestSession(null)
    if (!process.env.KEEP_TEST_DATA) for (const t of tenants) await cleanup(admin, t)
    await admin.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
