/**
 * H1 — POS cash control and server-side sale enforcement integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_r8 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/h1-pos-controls.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on throw-away tenants, prints
 * PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { POST as postSale } from '@/app/api/sales/route'
import { PUT as voidSale } from '@/app/api/sales/[id]/route'
import { POST as postExchange } from '@/app/api/sales/exchange/route'
import { POST as openShift } from '@/app/api/pos-opening-entries/route'
import { GET as getShift } from '@/app/api/pos-opening-entries/[id]/route'
import { POST as closeShift } from '@/app/api/pos-opening-entries/[id]/close/route'
import { PUT as updateClosing } from '@/app/api/pos-closing-entries/[id]/route'
import { GET as dailySummary } from '@/app/api/pos-daily-summary/route'
import { POST as verifyPin } from '@/app/api/auth/verify-pin/route'
import { POST as postMovement, GET as listMovements } from '@/app/api/pos-cash-movements/route'
import { POST as voidMovement } from '@/app/api/pos-cash-movements/[id]/void/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx {
  tenantId: string; slug: string; wh: string; ownerId: string; cashierId: string; cashier2Id: string; customerId: string
  acc: Record<string, string>
}

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const OWNER_PIN = '4321'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx, who: 'owner' | 'cashier' | 'cashier2') {
  const id = who === 'owner' ? f.ownerId : who === 'cashier' ? f.cashierId : f.cashier2Id
  const role = who === 'owner' ? 'owner' : 'cashier'
  return {
    user: {
      id, accountId: null, email: `${who}-${f.slug}@example.test`, name: who, role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'H1', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: who === 'owner', mode: 'company',
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `h1-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = {
    tenantId, slug, wh: randomUUID(), ownerId: randomUUID(), cashierId: randomUUID(), cashier2Id: randomUUID(), customerId: randomUUID(), acc: {},
  }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'H1 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  const pin = await bcrypt.hash(OWNER_PIN, 4)
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, pin_hash) VALUES ($1, $2, $3, 'x', 'Owner', 'owner', $4)`,
    [f.ownerId, tenantId, `owner-${slug}@example.test`, pin])
  for (const [id, n] of [[f.cashierId, 'Cashier One'], [f.cashier2Id, 'Cashier Two']]) {
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, 'cashier')`,
      [id, tenantId, `${id.slice(0, 8)}-${slug}@example.test`, n])
  }
  await admin.query(`INSERT INTO customers (id, tenant_id, name, credit_limit) VALUES ($1, $2, 'Kamal Silva', 1500)`, [f.customerId, tenantId])

  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, name, no, root, type])
    return id
  }
  f.acc.cash = await acc('Cash', '1100', 'asset', 'cash')
  f.acc.bank = await acc('Bank', '1200', 'asset', 'bank')
  f.acc.ar = await acc('Receivable', '1300', 'asset', 'receivable')
  f.acc.income = await acc('Sales', '4000', 'income', 'income_account')
  f.acc.expense = await acc('Petty expenses', '5100', 'expense', 'expense_account')
  f.acc.overShort = await acc('Cash over/short', '5200', 'expense', 'expense_account')
  f.acc.ap = await acc('Payable', '2100', 'liability', 'payable')
  const fy = randomUUID()
  f.acc.fy = fy
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, tenantId, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
       default_bank_account_id, default_expense_account_id, default_payable_account_id, default_cash_over_short_account_id,
       current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false)`,
    [tenantId, f.acc.ar, f.acc.income, f.acc.cash, f.acc.bank, f.acc.expense, f.acc.ap, f.acc.overShort, fy])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, stock: number) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, $4, 0, $5, true)`,
    [id, f.tenantId, `H1-${id.slice(0, 8)}`, name, price])
  if (stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: f.ownerId,
    }))
  }
  return id
}
async function stockOf(admin: Client, wh: string, itemId: string) {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}
async function glOf(admin: Client, voucherType: string, voucherId: string) {
  return (await admin.query(`SELECT account_id a, debit::float d, credit::float c FROM gl_entries WHERE voucher_type=$1 AND voucher_id=$2`, [voucherType, voucherId])).rows as Array<{ a: string; d: number; c: number }>
}
const net = (rows: Array<{ a: string; d: number; c: number }>, account: string) =>
  Math.round(rows.filter((r) => r.a === account).reduce((x, r) => x + r.d - r.c, 0) * 100) / 100

async function approve(f: Fx, scopes: string[]): Promise<string> {
  const r = await json(await verifyPin(req('POST', '/api/auth/verify-pin', { pin: OWNER_PIN, scope: 'supervisor', approvalScopes: scopes, reason: 'h1 test' })))
  if (r.status !== 200 || !r.body.approvalToken) throw new Error(`verify-pin failed: ${short(r.body)}`)
  return r.body.approvalToken as string
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin, 'main')
    tenants.push(f.tenantId)
    const X = await newItem(admin, f, 'Rice 5kg', 1000, 100)
    const Y = await newItem(admin, f, 'Milk powder', 500, 1)
    const P1 = randomUUID()
    const P2 = randomUUID()
    await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id, max_discount_percent, allow_rate_change) VALUES ($1,$2,'Counter 1',$3,10,false)`, [P1, f.tenantId, f.wh])
    await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id, allow_negative_stock) VALUES ($1,$2,'Counter 2',$3,true)`, [P2, f.tenantId, f.wh])
    for (const [p, u, d] of [[P1, f.cashierId, true], [P1, f.cashier2Id, false], [P2, f.cashier2Id, true]] as const) {
      await admin.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1,$2,$3,$4)`, [f.tenantId, p, u, d])
    }
    const line = (qty = 1, price = 1000, item = X) => ({ itemId: item, name: 'Rice 5kg', quantity: qty, unitPrice: price })
    const sale = async (body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...body })))

    let shift1 = ''
    let shift2 = ''

    // ---------- 1. one open shift per cashier and per counter
    await step('shift uniqueness', async () => {
      setTestSession(session(f, 'cashier'))
      const o = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P1, openingBalances: [{ paymentMethod: 'cash', amount: 1000 }, { paymentMethod: 'card', amount: 0 }] })))
      check('cashier opens a shift on Counter 1 → 200', o.status === 200 && o.body.status === 'open', short(o.body))
      shift1 = o.body.id
      const again = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P1 })))
      check('second open shift for the same cashier → 400 SHIFT_ALREADY_OPEN', again.status === 400 && again.body.code === 'SHIFT_ALREADY_OPEN', short(again.body))
      setTestSession(session(f, 'cashier2'))
      const counter = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P1 })))
      check('another cashier on the already-open counter → 409 COUNTER_ALREADY_OPEN', counter.status === 409 && counter.body.code === 'COUNTER_ALREADY_OPEN', short(counter.body))
      const o2 = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P2, openingBalances: [{ paymentMethod: 'cash', amount: 0 }] })))
      check('cashier 2 opens Counter 2 → 200', o2.status === 200, short(o2.body))
      shift2 = o2.body.id
      const dup = await admin.query(`INSERT INTO pos_opening_entries (tenant_id, entry_number, pos_profile_id, user_id, warehouse_id, status) VALUES ($1,'POS-RACE',$2,$3,$4,'open')`,
        [f.tenantId, P1, f.ownerId, f.wh]).then(() => 'inserted', (e) => e.code)
      check('database rejects a second open shift on a counter (partial unique index)', dup === '23505', String(dup))
    })

    // ---------- 2. sales must be tied to an open shift of the cashier
    await step('sale shift validation', async () => {
      setTestSession(session(f, 'cashier'))
      const none = await sale({ cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('cashier sale without a shift → 400 SHIFT_REQUIRED', none.status === 400 && none.body.code === 'SHIFT_REQUIRED', short(none.body))
      const other = await sale({ posOpeningEntryId: shift2, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('cashier sale on another cashier\'s shift → 403 SHIFT_NOT_YOURS', other.status === 403 && other.body.code === 'SHIFT_NOT_YOURS', short(other.body))
      const ok = await sale({ posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('cashier sale on own open shift → 200', ok.status === 200 && ok.body.posOpeningEntryId === shift1, short(ok.body))
      const li = (await admin.query(`SELECT list_price::float lp FROM sale_items WHERE sale_id=$1`, [ok.body.id])).rows[0]
      check('sale line keeps the catalog list price (1000)', li?.lp === 1000, JSON.stringify(li))
      setTestSession(session(f, 'owner'))
      const owner = await sale({ cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('back-office (owner) sale without a shift still allowed', owner.status === 200, short(owner.body))
    })

    // ---------- 3. discount limit + approval tokens
    await step('discount approval', async () => {
      setTestSession(session(f, 'cashier'))
      const base = { posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000 }
      const small = await sale({ ...base, discount: 50, discountType: 'fixed', total: 950, amountPaid: 950 })
      check('5% discount within the 10% counter limit → 200', small.status === 200, short(small.body))
      const big = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800 })
      check('20% discount over the limit without approval → 403 APPROVAL_REQUIRED [discount]', big.status === 403 && big.body.code === 'APPROVAL_REQUIRED' && JSON.stringify(big.body.scopes) === '["discount"]', short(big.body))
      const lineDisc = await sale({ ...base, cartItems: [{ ...line(), discount: 200 }], subtotal: 800, total: 800, amountPaid: 800 })
      check('20% line discount over the limit → 403', lineDisc.status === 403 && lineDisc.body.code === 'APPROVAL_REQUIRED', short(lineDisc.body))

      const wrongScope = await approve(f, ['credit_override'])
      const w = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800, approvalTokens: [wrongScope] })
      check('approval for another scope does not cover the discount → 403', w.status === 403 && w.body.code === 'APPROVAL_REQUIRED', short(w.body))
      const token = await approve(f, ['discount'])
      const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA')
      const t = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800, approvalTokens: [tampered] })
      check('tampered token → 403', t.status === 403 && t.body.code === 'APPROVAL_REQUIRED', short(t.body))
      const ok = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800, approvalTokens: [token] })
      check('20% discount with a supervisor token → 200, approved_by = supervisor', ok.status === 200 && ok.body.approvedBy === f.ownerId, short(ok.body))
      const reuse = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800, approvalTokens: [token] })
      check('same token again → 403 APPROVAL_REUSED (single use)', reuse.status === 403 && reuse.body.code === 'APPROVAL_REUSED', short(reuse.body))
      setTestSession(session(f, 'cashier2'))
      const stolen = await approve(f, ['discount'])
      setTestSession(session(f, 'cashier'))
      const s2 = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800, approvalTokens: [stolen] })
      check('token issued to another cashier is not accepted → 403', s2.status === 403 && s2.body.code === 'APPROVAL_REQUIRED', short(s2.body))
      const log = (await admin.query(`SELECT count(*)::int n FROM activity_logs WHERE tenant_id=$1 AND entity_type='pos_approval'`, [f.tenantId])).rows[0].n
      check('verify-pin approvals are written to the activity log', log >= 3, String(log))

      // offline sale: no token possible → accepted and flagged
      const off = await sale({ ...base, discount: 200, discountType: 'fixed', total: 800, amountPaid: 800, offlineRef: `OFF-H1-${Date.now()}`, clientSaleId: randomUUID() })
      check('offline sale over the limit → 200 flagged approvalMissing', off.status === 200 && !!off.body.flags?.approvalMissing, short(off.body))
    })

    // ---------- 4. rate change on a counter without rate changes
    await step('price approval', async () => {
      setTestSession(session(f, 'cashier'))
      const lower = await sale({ posOpeningEntryId: shift1, cartItems: [line(1, 900)], paymentMethod: 'cash', subtotal: 900, total: 900, amountPaid: 900 })
      check('price below catalog without approval → 403 [price_change]', lower.status === 403 && JSON.stringify(lower.body.scopes) === '["price_change"]', short(lower.body))
      const token = await approve(f, ['price_change'])
      const ok = await sale({ posOpeningEntryId: shift1, cartItems: [line(1, 900)], paymentMethod: 'cash', subtotal: 900, total: 900, amountPaid: 900, approvalTokens: [token] })
      const li = ok.status === 200 ? (await admin.query(`SELECT unit_price::float u, list_price::float lp FROM sale_items WHERE sale_id=$1`, [ok.body.id])).rows[0] : null
      check('price below catalog with approval → 200 (line 900, list 1000)', ok.status === 200 && li?.u === 900 && li?.lp === 1000, `${short(ok.body)} ${JSON.stringify(li)}`)
      await sleep(300)
      const meta = (await admin.query(`SELECT metadata FROM activity_logs WHERE tenant_id=$1 AND entity_type='sale' AND entity_id=$2`, [f.tenantId, ok.body.id])).rows[0]?.metadata
      check('sale activity log carries shift, counter, approver and before/after price', meta?.posOpeningEntryId === shift1 && meta?.posProfileId === P1 && meta?.approvedBy === f.ownerId && meta?.priceOverrides?.[0]?.before === 1000, JSON.stringify(meta))
    })

    // ---------- 5. credit limit
    await step('credit limit', async () => {
      setTestSession(session(f, 'cashier'))
      const base = { posOpeningEntryId: shift1, customerId: f.customerId, cartItems: [line()], paymentMethod: 'credit', subtotal: 1000, total: 1000, amountPaid: 0 }
      const first = await sale(base)
      check('credit sale 1000 within limit 1500 → 200', first.status === 200, short(first.body))
      const second = await sale(base)
      check('second credit sale (owes 1000 + 1000 > 1500) → 403 [credit_override]', second.status === 403 && JSON.stringify(second.body.scopes) === '["credit_override"]' && second.body.credit?.outstanding === 1000, short(second.body))
      const token = await approve(f, ['credit_override'])
      const ok = await sale({ ...base, approvalTokens: [token] })
      check('credit sale over limit with supervisor override → 200', ok.status === 200 && ok.body.approvedBy === f.ownerId, short(ok.body))
      const cash = await sale({ ...base, paymentMethod: 'cash', amountPaid: 1000 })
      check('fully paid sale for the same customer is not limited → 200', cash.status === 200, short(cash.body))
    })

    // ---------- 6. negative stock per counter
    await step('negative stock', async () => {
      setTestSession(session(f, 'cashier'))
      const blocked = await sale({ posOpeningEntryId: shift1, cartItems: [line(2, 500, Y)], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('counter without negative stock: selling 2 of 1 → 400', blocked.status === 400, short(blocked.body))
      setTestSession(session(f, 'cashier2'))
      const allowed = await sale({ posOpeningEntryId: shift2, cartItems: [line(2, 500, Y)], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('counter with allowNegativeStock: selling 2 of 1 → 200, flagged', allowed.status === 200 && allowed.body.flags?.negativeStockAllowed === true, short(allowed.body))
      check('stock went to −1', (await stockOf(admin, f.wh, Y)) === -1, String(await stockOf(admin, f.wh, Y)))
    })

    // ---------- 7. cash paid in / out
    let paidOutId = ''
    let paidInId = ''
    await step('cash movements', async () => {
      setTestSession(session(f, 'cashier'))
      const noTok = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_out', category: 'petty_expense', amount: 200, note: 'Tea for staff' })))
      check('paid-out without supervisor → 403 APPROVAL_REQUIRED', noTok.status === 403 && noTok.body.code === 'APPROVAL_REQUIRED', short(noTok.body))
      const badCat = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_in', category: 'bank_drop', amount: 10 })))
      check('paid-in with a paid-out category → 400', badCat.status === 400, short(badCat.body))
      const token = await approve(f, ['cash_paid_out'])
      const out = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_out', category: 'petty_expense', amount: 200, note: 'Tea for staff', approvalToken: token })))
      check('paid-out 200 with approval → 200, approved_by supervisor', out.status === 200 && out.body.approvedBy === f.ownerId && out.body.status === 'posted', short(out.body))
      paidOutId = out.body.id
      const gl = await glOf(admin, 'pos_cash_movement', paidOutId)
      check('GL paid-out: Dr petty expense 200 / Cr cash 200', net(gl, f.acc.expense) === 200 && net(gl, f.acc.cash) === -200, JSON.stringify(gl))
      const inn = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_in', category: 'float_top_up', amount: 100 })))
      check('paid-in 100 (below threshold) without approval → 200', inn.status === 200, short(inn.body))
      paidInId = inn.body.id
      const gl2 = await glOf(admin, 'pos_cash_movement', paidInId)
      check('GL float top-up: Dr cash 100 / Cr bank 100', net(gl2, f.acc.cash) === 100 && net(gl2, f.acc.bank) === -100, JSON.stringify(gl2))
      const bigIn = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_in', category: 'float_top_up', amount: 6000 })))
      check('paid-in 6000 (above threshold) without approval → 403', bigIn.status === 403, short(bigIn.body))
      setTestSession(session(f, 'owner'))
      const tooMuch = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_out', category: 'bank_drop', amount: 1_000_000 })))
      check('paid-out above the drawer cash → 400 INSUFFICIENT_DRAWER_CASH', tooMuch.status === 400 && tooMuch.body.code === 'INSUFFICIENT_DRAWER_CASH', short(tooMuch.body))
      setTestSession(session(f, 'cashier'))
      const v1 = await json(await voidMovement(req('POST', `/api/pos-cash-movements/${paidInId}/void`, { reason: 'Entered twice' }), ctx(paidInId)))
      check('cashier voiding a movement without approval → 403', v1.status === 403 && v1.body.code === 'APPROVAL_REQUIRED', short(v1.body))
      const vt = await approve(f, ['cash_movement_void'])
      const v2 = await json(await voidMovement(req('POST', `/api/pos-cash-movements/${paidInId}/void`, { reason: 'Entered twice', approvalToken: vt }), ctx(paidInId)))
      check('void with approval → 200 voided', v2.status === 200 && v2.body.status === 'voided' && v2.body.voidedBy === f.cashierId, short(v2.body))
      const gl3 = await glOf(admin, 'pos_cash_movement', paidInId)
      check('voided movement GL nets to zero', net(gl3, f.acc.cash) === 0 && net(gl3, f.acc.bank) === 0, JSON.stringify(gl3))
      const list = await json(await listMovements(req('GET', `/api/pos-cash-movements?openingEntryId=${shift1}`)))
      check('movement list: 2 movements, totals paid out 200 / paid in 0', list.status === 200 && list.body.data.length === 2 && list.body.totals.paidOut === 200 && list.body.totals.paidIn === 0, short(list.body))
    })

    // ---------- 8. void requires a reason and records voided_by
    let voidedSaleId = ''
    await step('void reason', async () => {
      setTestSession(session(f, 'cashier'))
      const s = await sale({ posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      voidedSaleId = s.body.id
      setTestSession(session(f, 'owner'))
      const noReason = await json(await voidSale(req('PUT', `/api/sales/${voidedSaleId}`, {}), ctx(voidedSaleId)))
      check('void without a reason → 400', noReason.status === 400, short(noReason.body))
      const blank = await json(await voidSale(req('PUT', `/api/sales/${voidedSaleId}`, { voidReason: '   ' }), ctx(voidedSaleId)))
      check('void with a blank reason → 400', blank.status === 400, short(blank.body))
      const ok = await json(await voidSale(req('PUT', `/api/sales/${voidedSaleId}`, { voidReason: 'Customer changed mind' }), ctx(voidedSaleId)))
      check('void with reason → 200, voided_by recorded', ok.status === 200 && ok.body.voidedBy === f.ownerId, short(ok.body))
    })

    // ---------- 9. card sale (for per-method variance) and exchange permission
    await step('exchange permission', async () => {
      setTestSession(session(f, 'cashier'))
      const card = await sale({ posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'card', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('card sale on the shift → 200', card.status === 200, short(card.body))
      const ex = await json(await postExchange(req('POST', '/api/sales/exchange', {
        originalSaleId: card.body.id, returnLines: [{ originalSaleItemId: randomUUID(), quantity: 1 }], newCartItems: [line()],
        posOpeningEntryId: shift1,
      })))
      check('cashier without processReturns cannot exchange (returns goods) → 403', ex.status === 403, short(ex.body))
    })

    // ---------- 10. expected cash, close with per-method variance, Z data
    let closingId = ''
    await step('shift close', async () => {
      setTestSession(session(f, 'cashier'))
      const cashIn = (await admin.query(
        `SELECT COALESCE(SUM(p.amount),0)::float s FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.pos_opening_entry_id=$1 AND s.status<>'void' AND p.method='cash'`, [shift1])).rows[0].s
      const expectedCash = 1000 + cashIn - 200
      const g = await json(await getShift(req('GET', `/api/pos-opening-entries/${shift1}`), ctx(shift1)))
      check('expected cash = opening + cash sales − paid-out (voided paid-in ignored)', g.status === 200 && g.body.paymentMethodBreakdown.expectedAmounts.cash === expectedCash, `${expectedCash} vs ${short(g.body.paymentMethodBreakdown)}`)
      const actual = [{ paymentMethod: 'cash', amount: expectedCash - 50 }, { paymentMethod: 'card', amount: 1030 }]
      const noReason = await json(await closeShift(req('POST', `/api/pos-opening-entries/${shift1}/close`, { actualAmounts: actual }), ctx(shift1)))
      check('close with a variance but no reason → 400 VARIANCE_REASON_REQUIRED', noReason.status === 400 && noReason.body.code === 'VARIANCE_REASON_REQUIRED', short(noReason.body))
      const other = await json(await closeShift(req('POST', `/api/pos-opening-entries/${shift1}/close`, { actualAmounts: actual, varianceReason: 'other' }), ctx(shift1)))
      check('reason "other" without a note → 400', other.status === 400, short(other.body))
      const c = await json(await closeShift(req('POST', `/api/pos-opening-entries/${shift1}/close`, { actualAmounts: actual, varianceReason: 'counting_error', varianceNote: 'recount tomorrow' }), ctx(shift1)))
      check('close with reason → 200 (cash −50, card +30)', c.status === 200 && c.body.summary?.totalVariance === -20 && c.body.varianceReason === 'counting_error', short(c.body.summary || c.body))
      closingId = c.body.closingEntry?.id
      const gl = await glOf(admin, 'pos_shift_closing', closingId)
      check('GL variance per method: Cr cash 50, Dr bank (card) 30, over/short net 20', net(gl, f.acc.cash) === -50 && net(gl, f.acc.bank) === 30 && net(gl, f.acc.overShort) === 20, JSON.stringify(gl))
      const z = c.body.zReport
      check('Z data: cash movements paid out 200, 1 voided', z?.cashMovements?.paidOut === 200 && z?.cashMovements?.voidedCount === 1, short(z?.cashMovements))
      check('Z data: discounts (3 discounted sales incl. offline, 450 off)', z?.discounts?.count === 3 && z?.discounts?.total === 450, short(z?.discounts))
      check('Z data: 1 void of 1000 with reason', z?.voids?.count === 1 && z?.voids?.total === 1000 && z?.voids?.items?.[0]?.reason === 'Customer changed mind', short(z?.voids))
      check('Z data: approvals counted', z?.approvals?.count >= 3, short(z?.approvals))
      check('Z data: ledger ties out (cash GL = expected − float)', z?.ledger?.posted === true && z?.ledger?.tiesOut === true, short(z?.ledger))
      const stored = (await admin.query(`SELECT variance_reason, variance_note, report_data IS NOT NULL has FROM pos_closing_entries WHERE id=$1`, [closingId])).rows[0]
      check('closing stores variance reason, note and the Z snapshot', stored?.variance_reason === 'counting_error' && stored?.variance_note === 'recount tomorrow' && stored?.has === true, JSON.stringify(stored))

      const closed = await sale({ posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      check('sale on the closed shift → 400 SHIFT_NOT_OPEN', closed.status === 400 && closed.body.code === 'SHIFT_NOT_OPEN', short(closed.body))
      const off = await sale({ posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000, offlineRef: `OFF-H1C-${Date.now()}`, clientSaleId: randomUUID() })
      check('offline sale synced after the shift closed → 200, flagged shiftIssue', off.status === 200 && off.body.flags?.shiftIssue?.code === 'SHIFT_NOT_OPEN', short(off.body))
      const mv = await json(await postMovement(req('POST', '/api/pos-cash-movements', { openingEntryId: shift1, type: 'paid_in', category: 'float_top_up', amount: 10 })))
      check('cash movement on a closed shift → 400 SHIFT_NOT_OPEN', mv.status === 400 && mv.body.code === 'SHIFT_NOT_OPEN', short(mv.body))

      setTestSession(session(f, 'owner'))
      const today = new Date()
      const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const ds = await json(await dailySummary(req('GET', `/api/pos-daily-summary?date=${d}`)))
      check('daily summary carries paid-out, voids and discounts', ds.status === 200 && ds.body.summary.cashPaidOut === 200 && ds.body.summary.voidsCount === 1 && ds.body.summary.discountTotal === 450, short(ds.body.summary))
    })

    // ---------- 11. cancelling a closing must not swallow a failed GL reversal
    await step('closing cancel', async () => {
      setTestSession(session(f, 'owner'))
      await admin.query(`UPDATE fiscal_years SET is_closed = true WHERE id=$1`, [f.acc.fy])
      const fail = await json(await updateClosing(req('PUT', `/api/pos-closing-entries/${closingId}`, { status: 'cancelled', cancellationReason: 'recount' }), ctx(closingId)))
      const st = (await admin.query(`SELECT c.status cs, o.status os FROM pos_closing_entries c JOIN pos_opening_entries o ON o.id=c.opening_entry_id WHERE c.id=$1`, [closingId])).rows[0]
      check('GL reversal fails (closed fiscal year) → 400 and nothing changes', fail.status === 400 && fail.body.code === 'GL_REVERSAL_FAILED' && st.cs === 'submitted' && st.os === 'closed', `${short(fail.body)} ${JSON.stringify(st)}`)
      await admin.query(`UPDATE fiscal_years SET is_closed = false WHERE id=$1`, [f.acc.fy])
      const ok = await json(await updateClosing(req('PUT', `/api/pos-closing-entries/${closingId}`, { status: 'cancelled', cancellationReason: 'recount' }), ctx(closingId)))
      const st2 = (await admin.query(`SELECT c.status cs, o.status os FROM pos_closing_entries c JOIN pos_opening_entries o ON o.id=c.opening_entry_id WHERE c.id=$1`, [closingId])).rows[0]
      const gl = await glOf(admin, 'pos_shift_closing', closingId)
      check('cancel → 200, shift reopened, variance GL reversed', ok.status === 200 && st2.cs === 'cancelled' && st2.os === 'open' && net(gl, f.acc.cash) === 0 && net(gl, f.acc.bank) === 0, `${short(ok.body)} ${JSON.stringify(st2)}`)
    })

    // ---------- 12. void of a sale whose shift is closed
    await step('void after close', async () => {
      setTestSession(session(f, 'cashier'))
      const s = await sale({ posOpeningEntryId: shift1, cartItems: [line()], paymentMethod: 'cash', subtotal: 1000, total: 1000, amountPaid: 1000 })
      const cashIn = (await admin.query(
        `SELECT COALESCE(SUM(p.amount),0)::float s FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.pos_opening_entry_id=$1 AND s.status<>'void' AND p.method='cash'`, [shift1])).rows[0].s
      const actual = [{ paymentMethod: 'cash', amount: 1000 + cashIn - 200 }, { paymentMethod: 'card', amount: 1000 }]
      const c = await json(await closeShift(req('POST', `/api/pos-opening-entries/${shift1}/close`, { actualAmounts: actual }), ctx(shift1)))
      check('re-close balanced shift → 200', c.status === 200, short(c.body))
      const before = (await admin.query(`SELECT total_sales::float t, report_data::text r FROM pos_closing_entries WHERE id=$1`, [c.body.closingEntry?.id])).rows[0]

      setTestSession(session(f, 'owner'))
      const noShift = await json(await voidSale(req('PUT', `/api/sales/${s.body.id}`, { voidReason: 'Wrong customer' }), ctx(s.body.id)))
      check('supervisor void of a closed shift\'s cash sale without an open shift → 400 OPEN_SHIFT_REQUIRED', noShift.status === 400 && noShift.body.code === 'OPEN_SHIFT_REQUIRED', short(noShift.body))
      const P3 = randomUUID()
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Office',$3)`, [P3, f.tenantId, f.wh])
      await admin.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id) VALUES ($1,$2,$3)`, [f.tenantId, P3, f.ownerId])
      const o = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P3, openingBalances: [{ paymentMethod: 'cash', amount: 2000 }] })))
      const v = await json(await voidSale(req('PUT', `/api/sales/${s.body.id}`, { voidReason: 'Wrong customer' }), ctx(s.body.id)))
      check('void with an open supervisor shift → 200', o.status === 200 && v.status === 200, `${short(o.body)} ${short(v.body)}`)
      const after = (await admin.query(`SELECT total_sales::float t, report_data::text r FROM pos_closing_entries WHERE id=$1`, [c.body.closingEntry?.id])).rows[0]
      check('closed shift totals and Z snapshot unchanged', before.t === after.t && before.r === after.r)
      const mv = (await admin.query(`SELECT type, category, amount::float a FROM pos_cash_movements WHERE opening_entry_id=$1`, [o.body.id])).rows
      check('refund recorded as a void_refund paid-out on the supervisor\'s shift', mv.length === 1 && mv[0].category === 'void_refund' && mv[0].a === 1000, JSON.stringify(mv))
      const g = await json(await getShift(req('GET', `/api/pos-opening-entries/${o.body.id}`), ctx(o.body.id)))
      check('supervisor shift expected cash 2000 − 1000 = 1000', g.body.paymentMethodBreakdown?.expectedAmounts?.cash === 1000, short(g.body.paymentMethodBreakdown))
      const cl = await json(await closeShift(req('POST', `/api/pos-opening-entries/${o.body.id}/close`, { actualAmounts: [{ paymentMethod: 'cash', amount: 1000 }] }), ctx(o.body.id)))
      check('supervisor shift closes balanced and its ledger ties out', cl.status === 200 && cl.body.zReport?.ledger?.tiesOut === true, short(cl.body.zReport?.ledger || cl.body))
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
