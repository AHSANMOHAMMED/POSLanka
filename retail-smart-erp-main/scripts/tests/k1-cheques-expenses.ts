/**
 * K1 — cheques, cashier money-out (expenses / reimbursement claims) and the owner dashboard.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_ws_cheques DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/k1-cheques-expenses.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on throw-away tenants, prints
 * PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenants.
 * Every dashboard figure is checked against a hand-computed value.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { tenantToday } from '@/lib/accounting/gl'
import { POST as postSale } from '@/app/api/sales/route'
import { POST as addSalePayment } from '@/app/api/sales/[id]/payments/route'
import { POST as addPurchasePayment } from '@/app/api/purchases/[id]/payments/route'
import { GET as listCheques, POST as createCheque } from '@/app/api/cheques/route'
import { GET as getCheque, PATCH as patchCheque } from '@/app/api/cheques/[id]/route'
import { GET as listExpenses, POST as createExpense } from '@/app/api/expenses/route'
import { PATCH as patchExpense } from '@/app/api/expenses/[id]/route'
import { GET as listCategories, POST as createCategory } from '@/app/api/expense-categories/route'
import { GET as ownerDashboardGet } from '@/app/api/dashboard/owner/route'
import { POST as openShift } from '@/app/api/pos-opening-entries/route'
import { POST as verifyPin } from '@/app/api/auth/verify-pin/route'
import { runChequeReminders, runStockAlerts } from '@/lib/notifications/scheduled'
import { customerOutstanding } from '@/lib/pos/sale-controls'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx {
  tenantId: string; slug: string; wh: string; wh2: string; ownerId: string; cashierId: string; customerId: string; supplierId: string
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

function session(f: Fx, who: 'owner' | 'cashier') {
  const id = who === 'owner' ? f.ownerId : f.cashierId
  return {
    user: {
      id, accountId: null, email: `${who}-${f.slug}@example.test`, name: who === 'owner' ? 'Owner' : 'Cashier', role: who,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'K1', businessType: 'retail',
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
const r2 = (n: number) => Math.round(n * 100) / 100
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `k1-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = {
    tenantId, slug, wh: randomUUID(), wh2: randomUUID(), ownerId: randomUUID(), cashierId: randomUUID(),
    customerId: randomUUID(), supplierId: randomUUID(), acc: {},
  }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'K1 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Kandy', 'KDY', false)`, [f.wh2, tenantId])
  const pin = await bcrypt.hash(OWNER_PIN, 4)
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, pin_hash) VALUES ($1, $2, $3, 'x', 'Owner', 'owner', $4)`,
    [f.ownerId, tenantId, `owner-${slug}@example.test`, pin])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Cashier', 'cashier')`,
    [f.cashierId, tenantId, `cashier-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Nimal Traders')`, [f.customerId, tenantId])
  await admin.query(`INSERT INTO suppliers (id, tenant_id, name, balance) VALUES ($1, $2, 'Lanka Wholesale', 0)`, [f.supplierId, tenantId])

  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, name, no, root, type])
    return id
  }
  f.acc.cash = await acc('Cash', '1100', 'asset', 'cash')
  f.acc.bank = await acc('Bank', '1200', 'asset', 'bank')
  f.acc.chequesInHand = await acc('Cheques in hand', '1250', 'asset', 'bank')
  f.acc.ar = await acc('Receivable', '1300', 'asset', 'receivable')
  f.acc.stock = await acc('Stock', '1400', 'asset', 'stock')
  f.acc.income = await acc('Sales', '4000', 'income', 'income_account')
  f.acc.cogs = await acc('COGS', '5000', 'expense', 'cost_of_goods_sold')
  f.acc.expense = await acc('General expenses', '5100', 'expense', 'expense_account')
  f.acc.utilities = await acc('Utilities', '5150', 'expense', 'expense_account')
  f.acc.ap = await acc('Payable', '2100', 'liability', 'payable')
  const fy = randomUUID()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, tenantId, `${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
       default_bank_account_id, default_expense_account_id, default_payable_account_id, default_cogs_account_id, default_stock_account_id,
       current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)`,
    [tenantId, f.acc.ar, f.acc.income, f.acc.cash, f.acc.bank, f.acc.expense, f.acc.ap, f.acc.cogs, f.acc.stock, fy])
  // The 'cheque' mode of payment points at "Cheques in hand" (not the bank): clearing moves it
  await admin.query(`INSERT INTO modes_of_payment (tenant_id, name, type, method_key, default_account_id) VALUES ($1,'Cheque','bank','cheque',$2)`,
    [tenantId, f.acc.chequesInHand])
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

async function newItem(admin: Client, f: Fx, name: string, cost: number, price: number, stock: Array<[string, number]> = [], opts: { trackStock?: boolean } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, f.tenantId, `K1-${id.slice(0, 8)}`, name, cost, price, opts.trackStock ?? true])
  for (const [wh, qty] of stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: wh, itemId: id, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: f.ownerId,
    }))
  }
  return id
}
async function glOf(admin: Client, voucherType: string, voucherId: string) {
  return (await admin.query(`SELECT account_id a, debit::float d, credit::float c, party_id p FROM gl_entries WHERE voucher_type=$1 AND voucher_id=$2`, [voucherType, voucherId])).rows as Array<{ a: string; d: number; c: number; p: string | null }>
}
const net = (rows: Array<{ a: string; d: number; c: number }>, account: string) =>
  r2(rows.filter((r) => r.a === account).reduce((x, r) => x + r.d - r.c, 0))
async function accountBalance(admin: Client, tenantId: string, account: string) {
  const r = await admin.query(`SELECT COALESCE(SUM(debit - credit), 0)::float b FROM gl_entries WHERE tenant_id=$1 AND account_id=$2`, [tenantId, account])
  return r2(r.rows[0].b)
}
async function approve(scopes: string[]): Promise<string> {
  const r = await json(await verifyPin(req('POST', '/api/auth/verify-pin', { pin: OWNER_PIN, scope: 'supervisor', approvalScopes: scopes, reason: 'k1 test' })))
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
    const today = await tenantToday(f.tenantId)
    setTestSession(session(f, 'owner'))
    const X = await newItem(admin, f, 'Cement bag', 1500, 2000, [[f.wh, 500]])
    const line = (qty: number, price = 2000) => ({ itemId: X, name: 'Cement bag', quantity: qty, unitPrice: price })
    const sale = async (body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...body })))
    const chequeOf = async (where: string, params: unknown[]) => (await admin.query(`SELECT * FROM cheques WHERE tenant_id=$1 AND ${where}`, [f.tenantId, ...params])).rows
    const saleRow = async (id: string) => (await admin.query(`SELECT status, paid_amount::float paid, total::float total FROM sales WHERE id=$1`, [id])).rows[0]
    const act = async (id: string, body: Record<string, unknown>) => json(await patchCheque(req('PATCH', `/api/cheques/${id}`, body), ctx(id)))

    // =============================================================== 1. cheque at the POS
    let postDatedId = ''
    let saleTodayId = ''
    let chequeTodayId = ''
    await step('POS sale by cheque', async () => {
      const missing = await sale({ customerId: f.customerId, cartItems: [line(1)], paymentMethod: 'cheque', subtotal: 2000, total: 2000, amountPaid: 2000 })
      check('cheque sale without cheque details → 400 CHEQUE_DETAILS_REQUIRED', missing.status === 400 && missing.body.code === 'CHEQUE_DETAILS_REQUIRED', short(missing.body))

      const mismatch = await sale({
        customerId: f.customerId, cartItems: [line(1)], paymentMethod: 'cheque', subtotal: 2000, total: 2000, amountPaid: 2000,
        cheque: { chequeNo: '000111', bankName: 'BOC', chequeDate: today, amount: 2500 },
      })
      check('cheque amount ≠ cheque tender → 400 CHEQUE_AMOUNT_MISMATCH (no sale)', mismatch.status === 400 && mismatch.body.code === 'CHEQUE_AMOUNT_MISMATCH', short(mismatch.body))

      const pdc = await sale({
        customerId: f.customerId, cartItems: [line(5)], paymentMethod: 'cheque', subtotal: 10000, total: 10000, amountPaid: 10000,
        cheque: { chequeNo: '123456', bankName: 'Commercial Bank', branchName: 'Kandy', chequeDate: addDays(today, 10) },
      })
      check('post-dated cheque sale → 200 completed', pdc.status === 200 && pdc.body.status === 'completed', short(pdc.body))
      const [c] = await chequeOf('sale_id=$2', [pdc.body.id])
      postDatedId = c?.id
      check('cheque registered: received, pending, 10000, linked to payment, branch = sale warehouse',
        !!c && c.direction === 'received' && c.status === 'pending' && Number(c.amount) === 10000 && !!c.payment_id && c.warehouse_id === f.wh && c.customer_id === f.customerId,
        short(c))
      const pay = await admin.query(`SELECT method, reference FROM payments WHERE id=$1`, [c?.payment_id])
      check('payment row method cheque, reference = cheque no', pay.rows[0]?.method === 'cheque' && pay.rows[0]?.reference === '123456', short(pay.rows))
      const gl = await glOf(admin, 'sale', pdc.body.id)
      check('GL: cheque payment debited to the cheque mode account (Cheques in hand) 10000', net(gl, f.acc.chequesInHand) === 10000, short(gl))

      const deposit = await act(postDatedId, { action: 'deposit' })
      check('depositing a post-dated cheque before its date → 400 CHEQUE_NOT_DUE', deposit.status === 400 && deposit.body.code === 'CHEQUE_NOT_DUE', short(deposit.body))
      const future = await act(postDatedId, { action: 'deposit', date: addDays(today, 11) })
      check('a future event date → 400 DATE_IN_FUTURE', future.status === 400 && future.body.code === 'DATE_IN_FUTURE', short(future.body))

      const s2 = await sale({
        customerId: f.customerId, cartItems: [line(2)], paymentMethod: 'cheque', subtotal: 4000, total: 4000, amountPaid: 4000,
        cheque: { chequeNo: '200001', bankName: 'HNB', chequeDate: today, amount: 4000 },
      })
      saleTodayId = s2.body.id
      chequeTodayId = (await chequeOf('sale_id=$2', [saleTodayId]))[0]?.id
      check('cheque dated today with matching amount → 200', s2.status === 200 && !!chequeTodayId, short(s2.body))
    })

    await step('split tender cash + cheque', async () => {
      const r = await sale({
        customerId: f.customerId, cartItems: [line(3)], paymentMethod: 'cash', subtotal: 6000, total: 6000, amountPaid: 6000,
        paymentSplits: [{ method: 'cash', amount: 1000 }, { method: 'cheque', amount: 5000 }],
        cheque: { chequeNo: '300001', bankName: 'Sampath', chequeDate: today },
      })
      check('split cash 1000 + cheque 5000 → 200', r.status === 200, short(r.body))
      const [c] = await chequeOf('sale_id=$2', [r.body.id])
      check('cheque of the split = 5000', !!c && Number(c.amount) === 5000, short(c))
      const two = await sale({
        customerId: f.customerId, cartItems: [line(1)], paymentMethod: 'cheque', subtotal: 2000, total: 2000, amountPaid: 2000,
        paymentSplits: [{ method: 'cheque', amount: 1000 }, { method: 'cheque', amount: 1000 }],
        cheque: { chequeNo: '300002', bankName: 'Sampath', chequeDate: today },
      })
      check('two cheque splits on one sale → 400 ONE_CHEQUE_PER_SALE', two.status === 400 && two.body.code === 'ONE_CHEQUE_PER_SALE', short(two.body))

      // cancel the cheque before banking: the sale is partly paid again (cash 1000 of 6000)
      const cancel = await act(c.id, { action: 'cancel', reason: 'Customer replaced the cheque' })
      check('cancel a cheque in hand → cancelled', cancel.status === 200 && cancel.body.status === 'cancelled' && cancel.body.reopened?.saleId === r.body.id, short(cancel.body))
      const s = await saleRow(r.body.id)
      check('cancelled cheque re-opens the sale: partial, paid 1000', s.status === 'partial' && s.paid === 1000, short(s))
      const again = await act(c.id, { action: 'cancel', reason: 'x' })
      check('cancel again → 400 INVALID_TRANSITION', again.status === 400 && again.body.code === 'INVALID_TRANSITION', short(again.body))
    })

    await step('feature switch', async () => {
      await admin.query(`UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{featureFlags}', '{"cheques": false}'::jsonb) WHERE id=$1`, [f.tenantId])
      const r = await sale({
        cartItems: [line(1)], paymentMethod: 'cheque', subtotal: 2000, total: 2000, amountPaid: 2000,
        cheque: { chequeNo: '400001', bankName: 'BOC', chequeDate: today },
      })
      check('cheques switched off → 403 FEATURE_DISABLED', r.status === 403 && r.body.feature === 'cheques', short(r.body))
      await admin.query(`UPDATE tenants SET settings = settings - 'featureFlags' WHERE id=$1`, [f.tenantId])
    })

    // =============================================================== 2. deposit → clear, bounce
    await step('deposit and clear', async () => {
      const dep = await act(chequeTodayId, { action: 'deposit', depositAccountId: f.acc.bank })
      check('deposit → deposited with the bank account', dep.status === 200 && dep.body.status === 'deposited' && dep.body.depositAccountId === f.acc.bank && !!dep.body.depositedAt, short(dep.body))
      const before = await accountBalance(admin, f.tenantId, f.acc.bank)
      const clr = await act(chequeTodayId, { action: 'clear' })
      check('clear → cleared, history pending → deposited → cleared',
        clr.status === 200 && clr.body.status === 'cleared' && (clr.body.statusHistory || []).map((h: J) => h.status).join('>') === 'pending>deposited>cleared', short(clr.body))
      const gl = await glOf(admin, 'cheque', chequeTodayId)
      check('clearing posts Dr Bank 4000 / Cr Cheques in hand 4000', net(gl, f.acc.bank) === 4000 && net(gl, f.acc.chequesInHand) === -4000, short(gl))
      check('bank balance +4000', r2((await accountBalance(admin, f.tenantId, f.acc.bank)) - before) === 4000)
      const bounce = await act(chequeTodayId, { action: 'bounce', reason: 'late' })
      check('a cleared cheque cannot bounce → 400 INVALID_TRANSITION', bounce.status === 400 && bounce.body.code === 'INVALID_TRANSITION', short(bounce.body))
    })

    let bounceSaleId = ''
    await step('bounce re-opens the customer balance', async () => {
      const s = await sale({
        customerId: f.customerId, cartItems: [line(4)], paymentMethod: 'cheque', subtotal: 8000, total: 8000, amountPaid: 8000,
        cheque: { chequeNo: '500001', bankName: 'NSB', chequeDate: today },
      })
      bounceSaleId = s.body.id
      const [c] = await chequeOf('sale_id=$2', [bounceSaleId])
      const outBefore = await withTenantTransaction(f.tenantId, (tx) => customerOutstanding(tx, f.customerId))
      await act(c.id, { action: 'deposit' })
      const b = await act(c.id, { action: 'bounce', reason: 'Refer to drawer' })
      check('bounce → bounced with reason', b.status === 200 && b.body.status === 'bounced' && b.body.bounceReason === 'Refer to drawer' && !!b.body.bouncedAt, short(b.body))
      const row = await saleRow(bounceSaleId)
      check('sale back to pending, paid 0', row.status === 'pending' && row.paid === 0, short(row))
      const pay = await admin.query(`SELECT voided_at, void_reason FROM payments WHERE id=$1`, [c.payment_id])
      check('cheque payment row voided with the reason', !!pay.rows[0]?.voided_at && /bounced/.test(pay.rows[0]?.void_reason || ''), short(pay.rows))
      const outAfter = await withTenantTransaction(f.tenantId, (tx) => customerOutstanding(tx, f.customerId))
      check('customer outstanding +8000', r2(outAfter - outBefore) === 8000, `${outBefore} → ${outAfter}`)
      const gl = await glOf(admin, 'cheque', c.id)
      check('GL: Dr Receivable (customer) 8000 / Cr Cheques in hand 8000',
        net(gl, f.acc.ar) === 8000 && net(gl, f.acc.chequesInHand) === -8000 && gl.some((g) => g.a === f.acc.ar && g.p === f.customerId), short(gl))
      const ret = await act(c.id, { action: 'return' })
      check('bounced cheque handed back → returned', ret.status === 200 && ret.body.status === 'returned' && !!ret.body.returnedAt, short(ret.body))
      const gl2 = await glOf(admin, 'cheque', c.id)
      check('returning posts nothing more', gl2.length === gl.length)
    })

    // =============================================================== 3. receipt against credit by cheque
    await step('credit sale settled by cheque', async () => {
      const cs = await sale({ customerId: f.customerId, cartItems: [line(3)], paymentMethod: 'credit', subtotal: 6000, total: 6000, amountPaid: 0 })
      check('credit sale → 200 pending', cs.status === 200 && cs.body.status === 'pending', short(cs.body))
      const noDetails = await json(await addSalePayment(req('POST', `/api/sales/${cs.body.id}/payments`, { amount: 6000, method: 'cheque' }), ctx(cs.body.id)))
      check('receipt by cheque without details → 400', noDetails.status === 400 && noDetails.body.code === 'CHEQUE_DETAILS_REQUIRED', short(noDetails.body))
      const p = await json(await addSalePayment(req('POST', `/api/sales/${cs.body.id}/payments`, {
        amount: 6000, method: 'cheque', cheque: { chequeNo: '600001', bankName: 'DFCC', chequeDate: today },
      }), ctx(cs.body.id)))
      check('receipt by cheque → 200 completed', p.status === 200 && p.body.status === 'completed', short(p.body))
      const [c] = await chequeOf('sale_id=$2', [cs.body.id])
      check('cheque registered against the receipt', !!c && !!c.payment_id && Number(c.amount) === 6000, short(c))
      const b = await act(c.id, { action: 'bounce', reason: 'Insufficient funds' })
      const row = await saleRow(cs.body.id)
      check('bounce (straight from in hand) re-opens the credit invoice', b.status === 200 && row.status === 'pending' && row.paid === 0, short([b.body, row]))
    })

    // =============================================================== 4. supplier payment by cheque
    await step('supplier payment by issued cheque', async () => {
      const pid = randomUUID()
      await admin.query(`INSERT INTO purchases (id, tenant_id, purchase_no, supplier_id, warehouse_id, subtotal, total, status) VALUES ($1,$2,'PI-K1-1',$3,$4,10000,10000,'pending')`,
        [pid, f.tenantId, f.supplierId, f.wh])
      await admin.query(`UPDATE suppliers SET balance = 10000 WHERE id=$1`, [f.supplierId])
      const r = await json(await addPurchasePayment(req('POST', `/api/purchases/${pid}/payments`, {
        amount: 10000, paymentMethod: 'cheque', cheque: { chequeNo: '900001', bankName: 'BOC', chequeDate: addDays(today, 5) },
      }), ctx(pid)))
      check('purchase payment by cheque → 200 paid', r.status === 200 && r.body.purchaseStatus === 'paid', short(r.body))
      const [c] = await chequeOf('purchase_id=$2', [pid])
      check('issued cheque registered (supplier, purchase payment)', !!c && c.direction === 'issued' && c.supplier_id === f.supplierId && !!c.purchase_payment_id && c.status === 'pending', short(c))
      const sup = async () => Number((await admin.query(`SELECT balance FROM suppliers WHERE id=$1`, [f.supplierId])).rows[0].balance)
      check('supplier balance 10000 → 0', (await sup()) === 0)
      const dep = await act(c.id, { action: 'deposit' })
      check('issued cheques are not deposited → 400', dep.status === 400 && dep.body.code === 'INVALID_TRANSITION', short(dep.body))
      const b = await act(c.id, { action: 'bounce', reason: 'Signature differs' })
      check('issued cheque bounced → 200', b.status === 200 && b.body.reopened?.purchaseId === pid, short(b.body))
      const p = (await admin.query(`SELECT status, paid_amount::float paid FROM purchases WHERE id=$1`, [pid])).rows[0]
      check('purchase re-opened: pending, paid 0', p.status === 'pending' && p.paid === 0, short(p))
      check('supplier balance back to 10000 (+ audit row)', (await sup()) === 10000
        && (await admin.query(`SELECT 1 FROM supplier_balance_audit WHERE reference_type='cheque' AND reference_id=$1`, [c.id])).rows.length === 1)
      const gl = await glOf(admin, 'cheque', c.id)
      check('GL: Dr Cheques in hand 10000 / Cr Payable (supplier) 10000', net(gl, f.acc.chequesInHand) === 10000 && net(gl, f.acc.ap) === -10000, short(gl))
      const mismatch = await json(await addPurchasePayment(req('POST', `/api/purchases/${pid}/payments`, {
        amount: 4000, paymentMethod: 'cheque', cheque: { chequeNo: '900002', bankName: 'BOC', chequeDate: today, amount: 3000 },
      }), ctx(pid)))
      check('issued cheque amount ≠ payment → 400', mismatch.status === 400 && mismatch.body.code === 'CHEQUE_AMOUNT_MISMATCH', short(mismatch.body))
    })

    // =============================================================== 5. register list / stand-alone / permissions
    await step('cheques register', async () => {
      setTestSession(session(f, 'cashier'))
      const created = await json(await createCheque(req('POST', '/api/cheques', {
        direction: 'received', chequeNo: '777001', bankName: 'Peoples Bank', chequeDate: addDays(today, 3), amount: 1500, customerId: f.customerId,
      })))
      check('cashier records a stand-alone received cheque → 201', created.status === 201 && created.body.status === 'pending', short(created.body))
      const issued = await json(await createCheque(req('POST', '/api/cheques', {
        direction: 'issued', chequeNo: '777002', bankName: 'BOC', chequeDate: today, amount: 100, partyName: 'CEB',
      })))
      check('cashier cannot record an issued cheque → 403', issued.status === 403, short(issued.body))
      const mine = await json(await listCheques(req('GET', '/api/cheques')))
      check('cashier sees only the cheques they recorded', mine.status === 200 && mine.body.data.length === 1 && mine.body.data[0].chequeNo === '777001', short(mine.body))
      const deny = await act(created.body.id, { action: 'deposit' })
      check('cashier cannot change cheque status → 403', deny.status === 403, short(deny.body))
      setTestSession(session(f, 'owner'))

      const due = await json(await listCheques(req('GET', '/api/cheques?dueWithinDays=7&direction=received')))
      // open received cheques dated ≤ today+7: stand-alone 777001 (1500). 123456 is +10 days.
      const nos = (due.body.data || []).map((c: J) => c.chequeNo).sort()
      check('due within 7 days (received, open) = [777001]', due.status === 200 && JSON.stringify(nos) === JSON.stringify(['777001']), short(nos))
      check('daysToDue = 3', due.body.data?.[0]?.daysToDue === 3, short(due.body.data?.[0]))
      const all = await json(await listCheques(req('GET', '/api/cheques?status=open')))
      check('open cheques total: received in hand 10000 + 1500 = 11500 (issued none open)',
        all.body.totals?.receivedOpen === 11500 && all.body.totals?.issuedOpen === 0, short(all.body.totals))
      const bounced = await json(await listCheques(req('GET', '/api/cheques?status=bounced')))
      check('bounced filter: 2 (6000 credit receipt + 10000 issued)', bounced.body.totals?.count === 2 && bounced.body.totals?.amount === 16000, short(bounced.body.totals))
      const branch = await json(await listCheques(req('GET', `/api/cheques?warehouseId=${f.wh2}`)))
      check('branch filter (Kandy has none)', branch.body.totals?.count === 0, short(branch.body.totals))
      const one = await json(await getCheque(req('GET', `/api/cheques/${postDatedId}`), ctx(postDatedId)))
      check('GET one → actions [deposit, clear, bounce, cancel]', one.status === 200 && JSON.stringify(one.body.actions) === JSON.stringify(['deposit', 'clear', 'bounce', 'cancel']), short(one.body.actions))
    })

    // =============================================================== 6. expenses & petty cash
    const P1 = randomUUID()
    let shiftId = ''
    let teaId = ''
    let utilId = ''
    await step('drawer expenses', async () => {
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id, expense_limit) VALUES ($1,$2,'Counter 1',$3,1000)`, [P1, f.tenantId, f.wh])
      await admin.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1,$2,$3,true)`, [f.tenantId, P1, f.cashierId])
      setTestSession(session(f, 'cashier'))
      const cats = await json(await listCategories())
      check('expense categories seeded on first use', cats.status === 200 && cats.body.data.length >= 10, short(cats.body))
      teaId = cats.body.data.find((c: J) => c.name === 'Tea & refreshments')?.id
      utilId = cats.body.data.find((c: J) => c.name === 'Electricity & water')?.id
      const noShift = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'drawer', amount: 200, categoryId: teaId })))
      check('drawer expense without an open shift → 400 SHIFT_REQUIRED', noShift.status === 400 && noShift.body.code === 'SHIFT_REQUIRED', short(noShift.body))
      const o = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P1, openingBalances: [{ paymentMethod: 'cash', amount: 3000 }] })))
      shiftId = o.body.id
      check('cashier opens shift with 3000 float', o.status === 200, short(o.body))

      const small = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'drawer', amount: 450, categoryId: teaId, payee: 'Tea kade', receiptNo: 'R-12' })))
      check('drawer expense 450 within the 1000 counter limit → 201 paid', small.status === 201 && small.body.status === 'paid' && small.body.paidFrom === 'drawer' && /^EXP-\d{5}$/.test(small.body.expenseNo), short(small.body))
      const mv = (await admin.query(`SELECT type, category, amount::float a, status FROM pos_cash_movements WHERE id=$1`, [small.body.cashMovementId])).rows[0]
      check('… as a paid-out petty_expense of 450 on the shift', mv?.type === 'paid_out' && mv?.category === 'petty_expense' && mv?.a === 450, short(mv))
      const gl = await glOf(admin, 'pos_cash_movement', small.body.cashMovementId)
      check('… GL Dr General expenses 450 / Cr Cash 450', net(gl, f.acc.expense) === 450 && net(gl, f.acc.cash) === -450, short(gl))
      check('… branch = shift warehouse', small.body.warehouseId === f.wh)

      const big = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'drawer', amount: 1500, categoryId: teaId })))
      check('drawer expense 1500 above the limit → 403 APPROVAL_REQUIRED', big.status === 403 && big.body.code === 'APPROVAL_REQUIRED', short(big.body))
      const token = await approve(['cash_paid_out'])
      const ok = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'drawer', amount: 1500, categoryId: teaId, approvalToken: token })))
      check('… with a supervisor approval → 201', ok.status === 201, short(ok.body))
      const reuse = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'drawer', amount: 1040, categoryId: teaId, approvalToken: token })))
      check('… the approval cannot be reused', reuse.status === 403, short(reuse.body))
      // drawer: 3000 − 450 − 1500 = 1050
      const tooMuch = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'drawer', amount: 1060, categoryId: teaId, approvalToken: await approve(['cash_paid_out']) })))
      check('more than the drawer holds (1050) → 400 INSUFFICIENT_DRAWER_CASH', tooMuch.status === 400 && tooMuch.body.code === 'INSUFFICIENT_DRAWER_CASH' && tooMuch.body.drawerCash === 1050, short(tooMuch.body))
      const bank = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'bank', paymentMethod: 'bank_transfer', amount: 100, categoryId: teaId })))
      check('cashier cannot record a bank expense → 403', bank.status === 403, short(bank.body))
      setTestSession(session(f, 'owner'))
    })

    await step('office / bank / cheque expenses', async () => {
      // the utilities category posts to its own account
      await admin.query(`UPDATE expense_categories SET account_id=$1 WHERE id=$2`, [f.acc.utilities, utilId])
      const bank = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'bank', paymentMethod: 'bank_transfer', amount: 2500, categoryId: utilId, payee: 'CEB' })))
      check('bank expense 2500 → 201 paid', bank.status === 201 && bank.body.status === 'paid', short(bank.body))
      const gl = await glOf(admin, 'expense', bank.body.id)
      check('… GL Dr Utilities (category account) 2500 / Cr Bank 2500', net(gl, f.acc.utilities) === 2500 && net(gl, f.acc.bank) === -2500, short(gl))

      const cash = await json(await createExpense(req('POST', '/api/expenses', { paidFrom: 'cash', amount: 300, description: 'Courier' })))
      const glc = await glOf(admin, 'expense', cash.body.id)
      check('office cash expense without category → default expense account, Cr Cash', cash.status === 201 && net(glc, f.acc.expense) === 300 && net(glc, f.acc.cash) === -300, short([cash.body, glc]))

      const chq = await json(await createExpense(req('POST', '/api/expenses', {
        paidFrom: 'bank', paymentMethod: 'cheque', amount: 3000, categoryId: utilId, payee: 'Water Board',
        cheque: { chequeNo: '880001', bankName: 'BOC', chequeDate: today },
      })))
      check('expense by cheque → 201', chq.status === 201, short(chq.body))
      const [c] = await chequeOf('expense_id=$2', [chq.body.id])
      check('… issued cheque registered for the payee', !!c && c.direction === 'issued' && c.party_name === 'Water Board' && Number(c.amount) === 3000, short(c))
      const glq = await glOf(admin, 'expense', chq.body.id)
      check('… GL Dr Utilities 3000 / Cr Cheques in hand 3000', net(glq, f.acc.utilities) === 3000 && net(glq, f.acc.chequesInHand) === -3000, short(glq))
      const b = await act(c.id, { action: 'bounce', reason: 'Stale' })
      const e = (await admin.query(`SELECT status FROM expenses WHERE id=$1`, [chq.body.id])).rows[0]
      const glq2 = await glOf(admin, 'expense', chq.body.id)
      check('bounced expense cheque: expense unpaid again (approved), posting reversed', b.status === 200 && e.status === 'approved' && net(glq2, f.acc.utilities) === 0 && net(glq2, f.acc.chequesInHand) === 0, short([b.body, e, glq2]))

      const v = await json(await patchExpense(req('PATCH', `/api/expenses/${bank.body.id}`, { action: 'void', reason: 'Duplicate' }), ctx(bank.body.id)))
      const glv = await glOf(admin, 'expense', bank.body.id)
      check('void a bank expense → void, GL nets to 0', v.status === 200 && v.body.status === 'void' && net(glv, f.acc.utilities) === 0 && net(glv, f.acc.bank) === 0, short([v.body, glv]))
    })

    await step('reimbursement claims', async () => {
      setTestSession(session(f, 'cashier'))
      const claim = await json(await createExpense(req('POST', '/api/expenses', { kind: 'reimbursement', amount: 750, categoryId: teaId, description: 'Bought milk for the shop', receiptNo: 'K-55' })))
      check('staff claim → 201 pending CLM-', claim.status === 201 && claim.body.status === 'pending' && /^CLM-\d{5}$/.test(claim.body.expenseNo) && claim.body.claimantId === f.cashierId, short(claim.body))
      let inbox = 0
      for (let i = 0; i < 30 && inbox === 0; i++) { // notify() is fire-and-forget
        inbox = (await admin.query(`SELECT 1 FROM in_app_notifications WHERE tenant_id=$1 AND user_id=$2 AND type='expense_claim'`, [f.tenantId, f.ownerId])).rows.length
        if (!inbox) await new Promise((r) => setTimeout(r, 100))
      }
      check('owner notified of the claim (in-app)', inbox === 1, String(inbox))
      const selfApprove = await json(await patchExpense(req('PATCH', `/api/expenses/${claim.body.id}`, { action: 'approve' }), ctx(claim.body.id)))
      check('cashier cannot approve → 403', selfApprove.status === 403, short(selfApprove.body))
      const early = await json(await patchExpense(req('PATCH', `/api/expenses/${claim.body.id}`, { action: 'pay', paidFrom: 'drawer' }), ctx(claim.body.id)))
      check('unapproved claim cannot be paid → 400', early.status === 400 && early.body.code === 'INVALID_STATUS', short(early.body))
      setTestSession(session(f, 'owner'))
      const ap = await json(await patchExpense(req('PATCH', `/api/expenses/${claim.body.id}`, { action: 'approve' }), ctx(claim.body.id)))
      check('owner approves → approved', ap.status === 200 && ap.body.status === 'approved' && ap.body.approvedBy === f.ownerId, short(ap.body))
      setTestSession(session(f, 'cashier'))
      const pay = await json(await patchExpense(req('PATCH', `/api/expenses/${claim.body.id}`, { action: 'pay', paidFrom: 'drawer' }), ctx(claim.body.id)))
      check('cashier pays the approved claim from the drawer (no approval needed) → paid', pay.status === 200 && pay.body.status === 'paid' && !!pay.body.cashMovementId, short(pay.body))
      const bank = await json(await patchExpense(req('PATCH', `/api/expenses/${claim.body.id}`, { action: 'pay', paidFrom: 'drawer' }), ctx(claim.body.id)))
      check('paying twice → 400', bank.status === 400, short(bank.body))

      const claim2 = await json(await createExpense(req('POST', '/api/expenses', { kind: 'reimbursement', amount: 5000, description: 'Taxi' })))
      setTestSession(session(f, 'owner'))
      const rj = await json(await patchExpense(req('PATCH', `/api/expenses/${claim2.body.id}`, { action: 'reject', reason: 'No receipt' }), ctx(claim2.body.id)))
      check('owner rejects with a reason → rejected', rj.status === 200 && rj.body.status === 'rejected' && rj.body.rejectedReason === 'No receipt', short(rj.body))
      const claim3 = await json(await createExpense(req('POST', '/api/expenses', { kind: 'reimbursement', amount: 1200, description: 'Fuel', claimantId: f.cashierId })))
      await json(await patchExpense(req('PATCH', `/api/expenses/${claim3.body.id}`, { action: 'approve' }), ctx(claim3.body.id)))
      const p3 = await json(await patchExpense(req('PATCH', `/api/expenses/${claim3.body.id}`, { action: 'pay', paidFrom: 'bank', paymentMethod: 'bank_transfer' }), ctx(claim3.body.id)))
      const gl3 = await glOf(admin, 'expense', claim3.body.id)
      check('accounts pay a claim by bank: Dr expense 1200 / Cr Bank 1200', p3.status === 200 && net(gl3, f.acc.expense) === 1200 && net(gl3, f.acc.bank) === -1200, short([p3.body, gl3]))

      // the owner's own approved claim is visible to the cashier, who pays it from the till
      const claim4 = await json(await createExpense(req('POST', '/api/expenses', { kind: 'reimbursement', amount: 200, description: 'Parking' })))
      await json(await patchExpense(req('PATCH', `/api/expenses/${claim4.body.id}`, { action: 'approve' }), ctx(claim4.body.id)))
      setTestSession(session(f, 'cashier'))
      const toPay = await json(await listExpenses(req('GET', '/api/expenses?kind=reimbursement&status=approved')))
      check('cashier lists approved claims of others to pay from the till', toPay.status === 200 && toPay.body.data.some((x: J) => x.id === claim4.body.id), short(toPay.body))
      const p4 = await json(await patchExpense(req('PATCH', `/api/expenses/${claim4.body.id}`, { action: 'pay', paidFrom: 'drawer' }), ctx(claim4.body.id)))
      check('… and pays it → paid', p4.status === 200 && p4.body.status === 'paid', short(p4.body))
      setTestSession(session(f, 'owner'))
      await json(await patchExpense(req('PATCH', `/api/expenses/${claim4.body.id}`, { action: 'void', reason: 'test' }), ctx(claim4.body.id)))

      // lists & totals
      setTestSession(session(f, 'cashier'))
      const mine = await json(await listExpenses(req('GET', '/api/expenses')))
      check('cashier sees only their own entries (3 drawer expenses + 3 claims made/claimed)', mine.status === 200 && mine.body.totals.count === 5, short(mine.body.totals))
      setTestSession(session(f, 'owner'))
      const exp = await json(await listExpenses(req('GET', '/api/expenses?kind=expense')))
      // paid expenses: 450 + 1500 (drawer) + 300 (office cash) = 2250; bank 2500 void; cheque 3000 approved (unpaid)
      check('expense totals: paid 2250, unpaid (approved) 3000, from drawer 1950', exp.body.totals.paid === 2250 && exp.body.totals.approved === 3000 && exp.body.totals.fromDrawer === 1950, short(exp.body.totals))
      const claims = await json(await listExpenses(req('GET', '/api/expenses?kind=reimbursement')))
      check('claim totals: paid 750 + 1200 = 1950 (4 claims incl. rejected and void)', claims.body.totals.paid === 1950 && claims.body.totals.count === 4, short(claims.body.totals))
      const byCat = await json(await listExpenses(req('GET', `/api/expenses?status=paid&categoryId=${teaId}`)))
      check('filter by category: tea paid = 450 + 1500 + 750 = 2700', byCat.body.totals.paid === 2700, short(byCat.body.totals))
      const created = await json(await createCategory(req('POST', '/api/expense-categories', { name: 'Security', accountId: f.acc.expense })))
      check('accounts add a category → 201', created.status === 201, short(created.body))
    })

    // =============================================================== 7. owner dashboard (own tenant: clean numbers)
    const g = await makeTenant(admin, 'dash')
    tenants.push(g.tenantId)
    await step('owner dashboard figures', async () => {
      setTestSession(session(g, 'owner'))
      const A = await newItem(admin, g, 'Item A', 100, 150, [[g.wh, 10], [g.wh2, 5]])
      const B = await newItem(admin, g, 'Item B', 40, 60, [[g.wh, 20]])
      await newItem(admin, g, 'Service C', 0, 500, [], { trackStock: false })
      // a negative branch balance is not stock: excluded from the value
      await admin.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock, min_stock) VALUES ($1,$2,$3,-3,1)`, [g.tenantId, g.wh2, B])
      const gsale = async (body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { discount: 0, tax: 0, creditAmount: 0, paymentMethod: 'cash', ...body })))
      // Sale 1 (Colombo): A×2 @150 + B×10 @60 = 900, cart discount 90 → 810
      const s1 = await gsale({ warehouseId: g.wh, cartItems: [{ itemId: A, name: 'Item A', quantity: 2, unitPrice: 150 }, { itemId: B, name: 'Item B', quantity: 10, unitPrice: 60 }],
        subtotal: 900, discount: 90, discountType: 'fixed', total: 810, amountPaid: 810 })
      check('dashboard sale 1 → 200', s1.status === 200, short(s1.body))
      const costs = (await admin.query(`SELECT item_id, unit_cost::float c FROM sale_items WHERE sale_id=$1`, [s1.body.id])).rows
      check('sale_items.unit_cost recorded at sale time (A 100, B 40)', costs.find((r) => r.item_id === A)?.c === 100 && costs.find((r) => r.item_id === B)?.c === 40, short(costs))
      // cost of A changes after sale 1: sale 1 keeps 100, sale 2 uses 120
      await admin.query(`UPDATE items SET cost_price = 120 WHERE id=$1`, [A])
      const s2 = await gsale({ warehouseId: g.wh2, cartItems: [{ itemId: A, name: 'Item A', quantity: 1, unitPrice: 150 }], subtotal: 150, total: 150, amountPaid: 150 })
      check('dashboard sale 2 → 200', s2.status === 200, short(s2.body))
      // a voided sale counts for nothing
      const s3 = await gsale({ warehouseId: g.wh, cartItems: [{ itemId: B, name: 'Item B', quantity: 1, unitPrice: 60 }], subtotal: 60, total: 60, amountPaid: 60 })
      await admin.query(`UPDATE sales SET status='void' WHERE id=$1`, [s3.body.id])
      // a return line copies the original line's cost (trigger), not today's item cost
      const orig = (await admin.query(`SELECT id FROM sale_items WHERE sale_id=$1 AND item_id=$2`, [s1.body.id, A])).rows[0].id
      const trg = await admin.query(`INSERT INTO sale_items (tenant_id, sale_id, item_id, item_name, quantity, unit_price, total, original_sale_item_id)
        VALUES ($1,$2,$3,'Item A',-1,150,-150,$4) RETURNING id, unit_cost::float c`, [g.tenantId, s3.body.id, A, orig])
      check('return line unit_cost = original line cost 100 (item cost is now 120)', trg.rows[0].c === 100, short(trg.rows))

      // levels for low stock: A@CMB 8 ≤ 10 low; B@CMB 9 > 5 ok (s3 took 1 before void… stock not restored by direct void)
      await admin.query(`UPDATE warehouse_stock SET min_stock = 10 WHERE warehouse_id=$1 AND item_id=$2`, [g.wh, A])
      await admin.query(`UPDATE warehouse_stock SET min_stock = 5 WHERE warehouse_id=$1 AND item_id=$2`, [g.wh, B])
      await admin.query(`UPDATE warehouse_stock SET min_stock = 4 WHERE warehouse_id=$1 AND item_id=$2`, [g.wh2, A])
      const stockRows = (await admin.query(`SELECT warehouse_id w, item_id i, current_stock::float q FROM warehouse_stock WHERE tenant_id=$1`, [g.tenantId])).rows
      const q = (w: string, i: string) => stockRows.find((r) => r.w === w && r.i === i)?.q ?? 0
      check('stock after sales: A CMB 8, A KDY 4, B CMB 9, B KDY −3', q(g.wh, A) === 8 && q(g.wh2, A) === 4 && q(g.wh, B) === 9 && q(g.wh2, B) === -3, short(stockRows))

      // cheques of the dashboard tenant
      const ch = async (direction: string, no: string, date: string, amount: number, status: string, wh: string) =>
        admin.query(`INSERT INTO cheques (tenant_id, direction, cheque_no, bank_name, cheque_date, amount, status, warehouse_id, party_name) VALUES ($1,$2,$3,'BOC',$4,$5,$6,$7,'Party')`,
          [g.tenantId, direction, no, date, amount, status, wh])
      await ch('received', 'D1', addDays(today, 3), 1000, 'pending', g.wh)
      await ch('received', 'D2', addDays(today, 7), 2000, 'deposited', g.wh2)
      await ch('received', 'D3', addDays(today, 8), 9999, 'pending', g.wh)      // beyond 7 days
      await ch('issued', 'D4', addDays(today, 1), 1500, 'pending', g.wh)
      await ch('received', 'D5', addDays(today, -2), 700, 'pending', g.wh)      // overdue
      await ch('received', 'D6', addDays(today, -5), 300, 'bounced', g.wh2)
      await ch('received', 'D7', addDays(today, 2), 400, 'cleared', g.wh)       // done
      // batches
      const bt = async (item: string, wh: string, no: string, exp: string, qty: number) =>
        admin.query(`INSERT INTO item_batches (tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
          [g.tenantId, item, no, wh, exp, qty])
      await bt(A, g.wh, 'BA1', addDays(today, 10), 5)
      await bt(B, g.wh, 'BB1', addDays(today, 40), 7)    // beyond 30 days
      await bt(B, g.wh2, 'BB2', addDays(today, -1), 2)   // expired
      await bt(A, g.wh, 'BA0', addDays(today, 5), 0)     // empty

      const d = await json(await ownerDashboardGet(req('GET', `/api/dashboard/owner?fromDate=${today}&toDate=${today}`)))
      check('GET /api/dashboard/owner → 200', d.status === 200, short(d.body))
      const st = d.body.stock
      const cmb = st.byBranch.find((b: J) => b.warehouseId === g.wh)
      const kdy = st.byBranch.find((b: J) => b.warehouseId === g.wh2)
      // at cost: CMB 8×120 + 9×40 = 1320; KDY 4×120 = 480 (B −3 excluded); total 1800
      check('stock at cost: Colombo 1320, Kandy 480, total 1800', cmb?.atCost === 1320 && kdy?.atCost === 480 && st.atCost === 1800, short(st))
      // at price: CMB 8×150 + 9×60 = 1740; KDY 4×150 = 600; total 2340
      check('stock at selling price: Colombo 1740, Kandy 600, total 2340', cmb?.atSellingPrice === 1740 && kdy?.atSellingPrice === 600 && st.atSellingPrice === 2340, short(st))
      // revenue 810 + 150 = 960; COGS 2×100 + 10×40 + 1×120 = 720; GP 240; margin 25%
      const p = d.body.profit
      check('gross profit: revenue 960 − COGS 720 = 240 (25%), 2 sales', p.revenue === 960 && p.costOfGoods === 720 && p.grossProfit === 240 && p.marginPercent === 25 && p.sales === 2, short(p))
      // per item: A revenue 810×300/900 + 150 = 420, cost 200 + 120 = 320, profit 100; B revenue 540, cost 400, profit 140
      const ti = p.topItems
      check('top items by profit: B 140 (540 − 400), A 100 (420 − 320)',
        ti[0]?.itemId === B && ti[0]?.profit === 140 && ti[0]?.revenue === 540 && ti[0]?.cost === 400 && ti[0]?.quantity === 10
        && ti[1]?.itemId === A && ti[1]?.profit === 100 && ti[1]?.revenue === 420 && ti[1]?.cost === 320 && ti[1]?.quantity === 3, short(ti))
      const c = d.body.cheques
      check('cheques next 7 days: received 2 / 3000, issued 1 / 1500', c.next7Days.received.count === 2 && c.next7Days.received.amount === 3000 && c.next7Days.issued.count === 1 && c.next7Days.issued.amount === 1500, short(c.next7Days))
      check('cheques overdue 1 / 700, bounced 1 / 300', c.overdue.count === 1 && c.overdue.amount === 700 && c.bounced.count === 1 && c.bounced.amount === 300, short([c.overdue, c.bounced]))
      const e = d.body.expiring
      check('expiring in 30 days: 1 batch, 5 units, 600 at cost; expired 1 batch (2 units, 80)',
        e.next30Days.count === 1 && e.next30Days.quantity === 5 && e.next30Days.valueAtCost === 600 && e.expired.count === 1 && e.expired.valueAtCost === 80, short(e))
      const l = d.body.lowStock
      // A@CMB 8 ≤ 10, A@KDY 4 ≤ 4, B@KDY −3 ≤ 1 (out of stock); B@CMB 9 > 5
      check('low stock: 3 lines, 1 out of stock', l.count === 3 && l.outOfStock === 1, short(l))

      const d2 = await json(await ownerDashboardGet(req('GET', `/api/dashboard/owner?fromDate=${today}&toDate=${today}&warehouseId=${g.wh2}`)))
      check('branch Kandy: stock 480 / 600, GP 150 − 120 = 30', d2.body.stock.atCost === 480 && d2.body.stock.atSellingPrice === 600 && d2.body.profit.revenue === 150 && d2.body.profit.grossProfit === 30, short([d2.body.stock, d2.body.profit]))
      check('branch Kandy: cheques received 1 / 2000, bounced 1, low stock 2', d2.body.cheques.next7Days.received.amount === 2000 && d2.body.cheques.bounced.count === 1 && d2.body.lowStock.count === 2, short([d2.body.cheques.next7Days, d2.body.lowStock]))
      const d3 = await json(await ownerDashboardGet(req('GET', `/api/dashboard/owner?fromDate=${addDays(today, -40)}&toDate=${addDays(today, -1)}`)))
      check('a period without sales: revenue 0, GP 0', d3.body.profit.revenue === 0 && d3.body.profit.grossProfit === 0 && d3.body.profit.marginPercent === null, short(d3.body.profit))
      setTestSession(session(g, 'cashier'))
      const denied = await json(await ownerDashboardGet(req('GET', '/api/dashboard/owner')))
      check('cashier cannot open the owner dashboard → 403', denied.status === 403, short(denied.body))
    })

    // =============================================================== 8. reminders
    await step('cheque and low-stock reminders', async () => {
      // 08:00 Asia/Colombo today = the default digest hour
      const at8 = new Date(Date.parse(`${today}T02:30:00Z`))
      const sum = await runChequeReminders({ tenantIds: [g.tenantId], now: at8 })
      const mine = sum.outcomes.find((o) => o.userId === g.ownerId)
      check('cheque reminder sent to the owner (in-app + push attempt)', !!mine && mine.outcome.inApp.includes(g.ownerId), short(sum))
      check('cashier gets no cheque reminder', !sum.outcomes.some((o) => o.userId === g.cashierId))
      const n = (await admin.query(`SELECT title, body FROM in_app_notifications WHERE tenant_id=$1 AND user_id=$2 AND type='cheque_due'`, [g.tenantId, g.ownerId])).rows
      check('reminder lists the issued cheque due tomorrow and the overdue one', n.length === 1 && /presented/.test(n[0].body) && /overdue/.test(n[0].body), short(n))
      const again = await runChequeReminders({ tenantIds: [g.tenantId], now: at8 })
      check('same day again → de-duplicated', again.sent === 0, short(again))
      const at9 = new Date(Date.parse(`${today}T03:30:00Z`))
      const off = await runChequeReminders({ tenantIds: [g.tenantId], now: at9 })
      check('outside the digest hour → nobody due', off.dueUsers === 0, short(off))
      const stock = await runStockAlerts({ tenantIds: [g.tenantId], now: at8 })
      check('low-stock digest delivered to the owner', stock.outcomes.some((o) => o.userId === g.ownerId && o.type === 'stock_digest' && o.outcome.inApp.length === 1), short(stock.outcomes))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) {
      for (const t of tenants) await cleanup(admin, t)
    }
    await admin.end()
    await closeAllPools()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
