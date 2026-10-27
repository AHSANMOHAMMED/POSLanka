/**
 * L2 — hire purchase accounting (drizzle/0181 + 0186, src/lib/installments).
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l2-installments.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on a throw-away tenant with two
 * branches (Colombo = A, Kandy = B): plan from a credit sale, schedule math, receipts split into
 * principal / interest / late fee with their journal entries, cheque receipts in the cheques
 * register and their bounce (both from the plan and from the register), void, early settlement
 * with rebate, repossession back into stock with serials and a write-off, hand-registered plans
 * (receivable at creation, cancel), branch denial for branch-restricted staff, idempotency.
 * Prints PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenant.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { clearBranchScopeCache } from '@/lib/auth/branch-access'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { tenantToday } from '@/lib/accounting/gl'
import { POST as postSale } from '@/app/api/sales/route'
import { PUT as voidSale } from '@/app/api/sales/[id]/route'
import { GET as listPlans, POST as createPlan } from '@/app/api/installments/route'
import { GET as getPlan, PATCH as patchPlan } from '@/app/api/installments/[id]/route'
import { POST as payPlan } from '@/app/api/installments/[id]/payments/route'
import { POST as receiptAction } from '@/app/api/installments/[id]/payments/[paymentId]/route'
import { PATCH as patchCheque } from '@/app/api/cheques/[id]/route'
import { addDays, addMonths, calculatePlan, lateFeeFor, settlementQuote } from '@/lib/installments/schedule'
import { postReceiptToGL } from '@/lib/installments/posting'
import { installmentPlans } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = 'owner' | 'managerA' | 'cashierA' | 'cashierB'
interface Fx {
  tenantId: string; slug: string; whA: string; whB: string; customerId: string
  users: Record<Who, { id: string; role: string }>
  acc: Record<string, string>
}

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}
function as(f: Fx, who: Who) {
  const u = f.users[who]
  clearBranchScopeCache('*')
  setTestSession({
    user: {
      id: u.id, accountId: null, email: `${who.toLowerCase()}-${f.slug}@example.test`, name: who, role: u.role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'L2', businessType: 'electronics',
      aiEnabled: false, isSuperAdmin: false, isOwner: u.role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
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
const short = (b: unknown) => JSON.stringify(b).slice(0, 500)
const r2 = (n: number) => Math.round(n * 100) / 100
const denied = (r: { status: number; body: J }) => r.status === 403 && r.body.code === 'BRANCH_ACCESS_DENIED'

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `l2-${tenantId.slice(0, 8)}`
  const roles: Record<Who, string> = { owner: 'owner', managerA: 'manager', cashierA: 'cashier', cashierB: 'cashier' }
  const users = {} as Fx['users']
  for (const who of Object.keys(roles) as Who[]) users[who] = { id: randomUUID(), role: roles[who] }
  const f: Fx = { tenantId, slug, whA: randomUUID(), whB: randomUUID(), customerId: randomUUID(), users, acc: {} }
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, 'L2 test', $2, $3, 'electronics')`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true)`, [f.whA, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Kandy', 'KDY', false)`, [f.whB, tenantId])
  for (const who of Object.keys(roles) as Who[]) {
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, $5)`,
      [users[who].id, tenantId, `${who.toLowerCase()}-${slug}@example.test`, who, roles[who]])
  }
  for (const [who, wh] of [['managerA', f.whA], ['cashierA', f.whA], ['cashierB', f.whB]] as Array<[Who, string]>) {
    await admin.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1,$2,$3,true)`, [tenantId, users[who].id, wh])
  }
  await admin.query(`INSERT INTO customers (id, tenant_id, name, phone) VALUES ($1, $2, 'Kamal Perera', '0771234567')`, [f.customerId, tenantId])

  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, name, no, root, type])
    return id
  }
  f.acc.cash = await acc('Cash', '1110', 'asset', 'cash')
  f.acc.bank = await acc('Bank', '1121', 'asset', 'bank')
  f.acc.chequesInHand = await acc('Cheques in hand', '1125', 'asset', 'bank')
  f.acc.ar = await acc('Accounts Receivable', '1130', 'asset', 'receivable')
  f.acc.stock = await acc('Inventory / Stock', '1140', 'asset', 'stock')
  f.acc.ap = await acc('Accounts Payable', '2110', 'liability', 'payable')
  f.acc.income = await acc('Sales Revenue', '4100', 'income', 'income_account')
  // seeded by the electronics chart: found by name (late fee / receivable / bad debts are created)
  f.acc.interest = await acc('Hire Purchase Interest Income', '4200', 'income', 'income_account')
  f.acc.cogs = await acc('Cost of Goods Sold', '5100', 'expense', 'cost_of_goods_sold')
  f.acc.expense = await acc('General expenses', '5290', 'expense', 'expense_account')
  const fy = randomUUID()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, tenantId, `${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
       default_bank_account_id, default_expense_account_id, default_payable_account_id, default_cogs_account_id, default_stock_account_id,
       current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)`,
    [tenantId, f.acc.ar, f.acc.income, f.acc.cash, f.acc.bank, f.acc.expense, f.acc.ap, f.acc.cogs, f.acc.stock, fy])
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

type GlRow = { a: string; d: number; c: number; p: string | null; vn: string | null; r: string | null }
async function glOf(admin: Client, voucherType: string, voucherId: string): Promise<GlRow[]> {
  return (await admin.query(`SELECT account_id a, debit::float d, credit::float c, party_id p, voucher_number vn, remarks r FROM gl_entries WHERE voucher_type=$1 AND voucher_id=$2 ORDER BY created_at`, [voucherType, voucherId])).rows
}
const net = (rows: GlRow[], account: string) => r2(rows.filter((r) => r.a === account).reduce((x, r) => x + r.d - r.c, 0))
const balanced = (rows: GlRow[]) => rows.length > 0 && r2(rows.reduce((s, r) => s + r.d, 0)) === r2(rows.reduce((s, r) => s + r.c, 0))
async function accountId(admin: Client, tenantId: string, pattern: string) {
  return (await admin.query(`SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND description LIKE $2`, [tenantId, `%[hp:${pattern}]%`])).rows[0]?.id as string | undefined
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin)
    tenants.push(f.tenantId)
    const today = await tenantToday(f.tenantId)
    const colomboToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

    // Item: a TV with serials, 5 in Colombo, cost 60 000, price 100 000
    const X = randomUUID()
    await admin.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_serial_numbers) VALUES ($1,$2,'L2-TV','Smart TV 55"',60000,100000,true,true)`, [X, f.tenantId])
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.whA, itemId: X, mode: 'delta', qty: 5, referenceType: 'test_seed', source: 'system', userId: f.users.owner.id,
    }))
    const serial: Record<string, string> = {}
    for (const sn of ['TV-0001', 'TV-0002', 'TV-0003']) {
      serial[sn] = randomUUID()
      await admin.query(`INSERT INTO item_serial_numbers (id, tenant_id, item_id, warehouse_id, serial_number, status) VALUES ($1,$2,$3,$4,$5,'available')`, [serial[sn], f.tenantId, X, f.whA, sn])
    }
    const stockA = async () => Number((await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.whA, X])).rows[0]?.current_stock || 0)
    const saleRow = async (id: string) => (await admin.query(`SELECT status, paid_amount::float paid, total::float total FROM sales WHERE id=$1`, [id])).rows[0]
    const scheduleOf = async (planId: string) => (await admin.query(
      `SELECT installment_no n, due_date::text due, amount::float amount, principal::float principal, interest::float interest, paid_amount::float paid,
              interest_paid::float ip, principal_paid::float pp, late_fee::float fee, late_fee_paid::float feepaid, status
       FROM installment_schedule WHERE plan_id=$1 ORDER BY installment_no`, [planId])).rows
    const planRow = async (planId: string) => (await admin.query(`SELECT * FROM installment_plans WHERE id=$1`, [planId])).rows[0]
    const creditSale = async (sn: string, paid: number) => {
      as(f, 'owner')
      const r = await json(await postSale(req('POST', '/api/sales', {
        warehouseId: f.whA, customerId: f.customerId, discount: 0, tax: 0, creditAmount: 0,
        cartItems: [{ itemId: X, name: 'Smart TV 55"', quantity: 1, unitPrice: 100000, serialNumberIds: [serial[sn]] }],
        subtotal: 100000, total: 100000, paymentMethod: 'cash', amountPaid: paid,
        paymentSplits: [{ method: 'cash', amount: paid }, { method: 'credit', amount: 100000 - paid }],
      })))
      if (r.status !== 200 && r.status !== 201) throw new Error(`credit sale failed: ${short(r.body)}`)
      return r.body
    }

    // =============================================================== 0. schedule math, dates
    await step('schedule math', async () => {
      const c = calculatePlan({ cashPrice: 100000, downPayment: 20000, interestType: 'flat', interestRate: 24, interestAmount: 0, termMonths: 4, frequency: 'monthly', startDate: '2026-01-31' })
      check('flat interest = financed × rate × months / 12', c.financedAmount === 80000 && c.interestAmount === 6400 && c.totalPayable === 86400, short(c))
      check('4 equal installments of 21 600 (1 600 interest, 20 000 principal)', c.rows.length === 4 && c.rows.every((r) => r.amount === 21600 && r.interest === 1600 && r.principal === 20000), short(c.rows))
      check('due dates month-end clamped (31 Jan → 28 Feb)', c.rows[1].dueDate === '2026-02-28' && c.rows[3].dueDate === '2026-04-30', short(c.rows.map((r) => r.dueDate)))
      const odd = calculatePlan({ cashPrice: 10000, downPayment: 0, interestType: 'fixed', interestRate: 0, interestAmount: 1000, termMonths: 3, frequency: 'weekly', startDate: '2026-01-01' })
      const ps = r2(odd.rows.reduce((s, r) => s + r.principal, 0))
      const is = r2(odd.rows.reduce((s, r) => s + r.interest, 0))
      check('weekly: 13 installments; principal / interest columns add up exactly', odd.installmentCount === 13 && ps === 10000 && is === 1000 && r2(odd.rows.reduce((s, r) => s + r.amount, 0)) === 11000, short({ n: odd.installmentCount, ps, is }))
      const rule = { lateFeeType: 'fixed' as const, lateFeeValue: 500, graceDays: 5 }
      check('late fee only after the grace days', lateFeeFor({ dueDate: '2026-03-01', amount: 1000, status: 'pending' }, rule, '2026-03-06') === 0
        && lateFeeFor({ dueDate: '2026-03-01', amount: 1000, status: 'pending' }, rule, '2026-03-07') === 500)
      check('tenant "today" is the Asia/Colombo date', today === colomboToday, `${today} vs ${colomboToday}`)
    })

    // =============================================================== 1. plan from a credit sale
    let planId = ''
    let saleId = ''
    const start = addDays(today, -40)
    await step('plan from a credit sale', async () => {
      const sale = await creditSale('TV-0001', 20000)
      saleId = sale.id
      check('credit sale with 20 000 down → partial', (await saleRow(saleId)).status === 'partial', short(await saleRow(saleId)))
      as(f, 'cashierA')
      const r = await json(await createPlan(req('POST', '/api/installments', {
        saleId, customerId: f.customerId, customerName: 'Kamal Perera', customerNic: '199012345678',
        items: [{ itemId: X, saleItemId: sale.items?.[0]?.id ?? null, itemName: 'Smart TV 55"', quantity: 1, unitPrice: 100000, serialNumbers: ['TV-0001'] }],
        terms: { cashPrice: 1, downPayment: 0, interestType: 'flat', interestRate: 24, termMonths: 4, frequency: 'monthly', startDate: start, lateFeeType: 'fixed', lateFeeValue: 500, graceDays: 5 },
      })))
      check('cashier creates the plan → 201 HP-…', r.status === 201 && /^HP-/.test(r.body.planNo), short(r.body))
      planId = r.body.id
      const p = await planRow(planId)
      check('plan finances the sale balance (80 000) at the sale branch', Number(p.financed_amount) === 80000 && Number(p.total_payable) === 86400 && p.warehouse_id === f.whA, short(p))
      const glPlan = await glOf(admin, 'installment_plan', planId)
      check('plan from a sale posts nothing at creation (the sale booked the receivable)', glPlan.length === 0)
      const g = await json(await getPlan(req('GET', `/api/installments/${planId}`), ctx(planId)))
      // rows 1 (−40 d) and 2 (≈ −10 d) are past the 5 grace days → 2 × 500
      check('late fees assessed on overdue rows only (Colombo date)', g.status === 200 && g.body.figures.lateFeesDue === 1000 && g.body.figures.overdueCount === 2, short(g.body.figures))
    })
    // fix the sale-item link for the repossession test of this plan (sale line id)
    const saleItemOf = async (sid: string) => (await admin.query(`SELECT id FROM sale_items WHERE sale_id=$1`, [sid])).rows[0]?.id as string

    // =============================================================== 2. receipt: late fee, interest, principal
    let receipt1 = ''
    await step('installment receipt split + GL', async () => {
      as(f, 'cashierA')
      const r = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 22600, paymentMethod: 'cash' }), ctx(planId)))
      check('payment 22 600 → 201 HPR-…', r.status === 201 && /^HPR-/.test(r.body.receipt?.receiptNo), short(r.body))
      receipt1 = r.body.receipt.id
      const rc = r.body.receipt
      check('split: late fees 1 000, interest 1 600, principal 20 000', Number(rc.lateFeeAmount) === 1000 && Number(rc.interestAmount) === 1600 && Number(rc.principalAmount) === 20000 && rc.glMode === 'voucher', short(rc))
      const gl = await glOf(admin, 'installment_payment', receipt1)
      const lateFee = await accountId(admin, f.tenantId, 'late_fee_income')
      check('GL balanced: Dr Cash 22 600 / Cr AR 20 000 / Cr HP Interest 1 600 / Cr Late fee 1 000', balanced(gl)
        && net(gl, f.acc.cash) === 22600 && net(gl, f.acc.ar) === -20000 && net(gl, f.acc.interest) === -1600 && !!lateFee && net(gl, lateFee!) === -1000, short(gl))
      check('AR credit carries the customer', gl.filter((e) => e.a === f.acc.ar).every((e) => e.p === f.customerId))
      const s = await saleRow(saleId)
      check('principal applied to the sale (paid 40 000)', s.paid === 40000 && s.status === 'partial', short(s))
      const rows = await scheduleOf(planId)
      check('row 1 paid (interest 1 600 + principal 20 000 stored), row 2 fee paid', rows[0].status === 'paid' && rows[0].ip === 1600 && rows[0].pp === 20000 && rows[1].feepaid === 500 && rows[1].paid === 0, short(rows))
      // idempotent: posting the same receipt again adds nothing
      const before = (await glOf(admin, 'installment_payment', receipt1)).length
      await withTenantTransaction(f.tenantId, async (tx) => {
        const [plan] = await tx.select().from(installmentPlans).where(eq(installmentPlans.id, planId))
        await postReceiptToGL(tx, f.tenantId, plan, { receiptId: receipt1, receiptNo: rc.receiptNo, kind: 'installment', paymentDate: today, method: 'cash', amount: 22600, principal: 20000, interest: 1600, lateFee: 1000 })
      })
      check('posting a receipt twice is a no-op', (await glOf(admin, 'installment_payment', receipt1)).length === before)
      const over = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 999999, paymentMethod: 'cash' }), ctx(planId)))
      check('overpayment → 400 OVERPAYMENT', over.status === 400 && over.body.code === 'OVERPAYMENT', short(over.body))
    })

    // =============================================================== 3. branch denial
    await step('branch scoping', async () => {
      as(f, 'cashierB')
      const g = await json(await getPlan(req('GET', `/api/installments/${planId}`), ctx(planId)))
      check('Kandy cashier cannot open a Colombo plan', denied(g), short(g.body))
      const p = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 100, paymentMethod: 'cash' }), ctx(planId)))
      check('… nor take a payment on it', denied(p), short(p.body))
      const l = await json(await listPlans(req('GET', '/api/installments')))
      check('… nor see it in the list', l.status === 200 && !(l.body.data as J[]).some((x) => x.id === planId), short(l.body))
      const v = await json(await receiptAction(req('POST', `/api/installments/${planId}/payments/${receipt1}`, { action: 'void', reason: 'test' }), { params: Promise.resolve({ id: planId, paymentId: receipt1 }) }))
      check('cashier cannot void a receipt (403)', v.status === 403, short(v.body))
      as(f, 'managerA')
      const m = await json(await getPlan(req('GET', `/api/installments/${planId}`), ctx(planId)))
      check('Colombo manager opens it', m.status === 200, short(m.body))
    })

    // =============================================================== 4. cheque receipt + bounce from the plan
    await step('cheque receipt bounced from the plan', async () => {
      as(f, 'cashierA')
      const noCheque = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 21600, paymentMethod: 'cheque' }), ctx(planId)))
      check('cheque without details → 400', noCheque.status === 400, short(noCheque.body))
      const r = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, {
        amount: 21600, paymentMethod: 'cheque', cheque: { chequeNo: '700001', bankName: 'Sampath', chequeDate: today },
      }), ctx(planId)))
      check('cheque receipt → 201', r.status === 201 && !!r.body.cheque?.id, short(r.body))
      const cheque = (await admin.query(`SELECT * FROM cheques WHERE id=$1`, [r.body.cheque.id])).rows[0]
      check('cheque in the register: received, pending, plan customer / sale / branch', cheque && cheque.direction === 'received' && cheque.status === 'pending'
        && Number(cheque.amount) === 21600 && cheque.customer_id === f.customerId && cheque.sale_id === saleId && cheque.warehouse_id === f.whA && !cheque.payment_id, short(cheque))
      const gl = await glOf(admin, 'installment_payment', r.body.receipt.id)
      check('cheque receipt debits the cheque mode account', balanced(gl) && net(gl, f.acc.chequesInHand) === 21600, short(gl))
      check('row 2 paid', (await scheduleOf(planId))[1].status === 'paid')
      as(f, 'managerA')
      const b = await json(await receiptAction(req('POST', `/api/installments/${planId}/payments/${r.body.receipt.id}`, { action: 'bounce', reason: 'Refer to drawer' }), { params: Promise.resolve({ id: planId, paymentId: r.body.receipt.id }) }))
      check('mark cheque bounced → 200', b.status === 200 && !!b.body.receipt.voidedAt, short(b.body))
      const c2 = (await admin.query(`SELECT status FROM cheques WHERE id=$1`, [r.body.cheque.id])).rows[0]
      check('cheque bounced in the register', c2.status === 'bounced', short(c2))
      const rows = await scheduleOf(planId)
      check('row 2 unpaid again (fee paid stays)', rows[1].status === 'pending' && rows[1].paid === 0 && rows[1].ip === 0 && rows[1].pp === 0 && rows[1].feepaid === 500, short(rows[1]))
      const gl2 = await glOf(admin, 'installment_payment', r.body.receipt.id)
      check('receipt journal reversed (net zero on every account)', [f.acc.chequesInHand, f.acc.ar, f.acc.interest].every((a) => net(gl2, a) === 0) && gl2.length === gl.length * 2, short(gl2))
      check('sale back to paid 40 000', (await saleRow(saleId)).paid === 40000)
      const again = await json(await receiptAction(req('POST', `/api/installments/${planId}/payments/${r.body.receipt.id}`, { action: 'void', reason: 'again' }), { params: Promise.resolve({ id: planId, paymentId: r.body.receipt.id }) }))
      check('voiding a reversed receipt again → 409', again.status === 409, short(again.body))
    })

    // =============================================================== 5. cheque bounced in the cheques register
    await step('cheque bounced in the cheques register', async () => {
      as(f, 'cashierA')
      const r = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, {
        amount: 21600, paymentMethod: 'cheque', cheque: { chequeNo: '700002', bankName: 'HNB', chequeDate: today },
      }), ctx(planId)))
      check('second cheque receipt → 201', r.status === 201, short(r.body))
      as(f, 'owner')
      const b = await json(await patchCheque(req('PATCH', `/api/cheques/${r.body.cheque.id}`, { action: 'bounce', reason: 'Account closed' }), ctx(r.body.cheque.id)))
      check('register bounce → 200 (no sale re-opened by the register)', b.status === 200 && !b.body.reopened, short(b.body))
      const g = await json(await getPlan(req('GET', `/api/installments/${planId}`), ctx(planId)))
      const rec = (g.body.receipts as J[]).find((x) => x.id === r.body.receipt.id)
      check('opening the plan reverses the bounced receipt', g.status === 200 && !!rec?.voidedAt && rec?.chequeStatus === 'bounced', short(rec))
      const rows = await scheduleOf(planId)
      check('row 2 unpaid again', rows[1].status === 'pending' && rows[1].paid === 0, short(rows[1]))
      const gl = await glOf(admin, 'installment_payment', r.body.receipt.id)
      check('its journal entry is reversed', balanced(gl) && net(gl, f.acc.chequesInHand) === 0 && net(gl, f.acc.ar) === 0, short(gl))
      const g2 = await json(await getPlan(req('GET', `/api/installments/${planId}`), ctx(planId)))
      const gl2 = await glOf(admin, 'installment_payment', r.body.receipt.id)
      check('sync is idempotent (no second reversal)', g2.status === 200 && gl2.length === gl.length)
    })

    // =============================================================== 6. early settlement, void, settle again
    await step('early settlement', async () => {
      as(f, 'cashierA')
      const g = await json(await getPlan(req('GET', `/api/installments/${planId}?rebate=50`), ctx(planId)))
      const q = g.body.settlement
      // row 2 (due) interest 1 600; rows 3–4 (future) 3 200 → 50 % = 1 600 rebate; principal 60 000
      check('quote: principal 60 000 + due interest 1 600 + future 3 200 − rebate 1 600 = 63 200', q && q.principalOutstanding === 60000 && q.interestDue === 1600 && q.futureInterest === 3200 && q.rebate === 1600 && q.total === 63200, short(q))
      const live = (g.body.schedule as J[]).map((r) => ({ installmentNo: r.installmentNo, dueDate: r.dueDate, amount: Number(r.amount), principal: Number(r.principal), interest: Number(r.interest), paidAmount: Number(r.paidAmount), lateFee: Number(r.lateFee), lateFeePaid: Number(r.lateFeePaid), interestPaid: Number(r.interestPaid), principalPaid: Number(r.principalPaid), status: r.status }))
      check('quote matches the shared settlementQuote()', settlementQuote(live, today, 50).total === 63200)
      const short1 = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 60000, paymentMethod: 'cash', settle: true, rebatePercent: 50 }), ctx(planId)))
      check('short settlement → 400 SETTLEMENT_SHORT', short1.status === 400 && short1.body.code === 'SETTLEMENT_SHORT', short(short1.body))
      const s = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 63200, paymentMethod: 'bank_transfer', settle: true, rebatePercent: 50 }), ctx(planId)))
      check('settlement → 201, plan completed', s.status === 201 && s.body.planStatus === 'completed' && Number(s.body.receipt.rebateAmount) === 1600, short(s.body))
      const gl = await glOf(admin, 'installment_payment', s.body.receipt.id)
      check('settlement GL: Dr Bank 63 200 / Cr AR 60 000 / Cr Interest 3 200 (rebate never posted)', balanced(gl) && net(gl, f.acc.bank) === 63200 && net(gl, f.acc.ar) === -60000 && net(gl, f.acc.interest) === -3200, short(gl))
      check('sale fully paid', (await saleRow(saleId)).status === 'completed')
      const p = await planRow(planId)
      check('plan totals: rebate 1 600, balance 0', Number(p.rebate_amount) === 1600 && Number(p.balance) === 0 && p.status === 'completed', short(p))

      as(f, 'managerA')
      const v = await json(await receiptAction(req('POST', `/api/installments/${planId}/payments/${s.body.receipt.id}`, { action: 'void', reason: 'Wrong plan' }), { params: Promise.resolve({ id: planId, paymentId: s.body.receipt.id }) }))
      check('void settlement → 200, plan active again', v.status === 200 && v.body.planStatus === 'active', short(v.body))
      const rows = await scheduleOf(planId)
      check('waived interest restored on the future rows', rows[2].interest === 1600 && rows[2].amount === 21600 && rows[3].interest === 1600 && rows.slice(1).every((r) => r.status === 'pending' && r.paid === 0), short(rows))
      const p2 = await planRow(planId)
      check('plan rebate back to 0, balance 64 800', Number(p2.rebate_amount) === 0 && Number(p2.balance) === 64800, short(p2))
      check('sale re-opened (paid 40 000)', (await saleRow(saleId)).paid === 40000)
      const glv = await glOf(admin, 'installment_payment', s.body.receipt.id)
      check('settlement journal reversed', net(glv, f.acc.bank) === 0 && net(glv, f.acc.interest) === 0 && net(glv, f.acc.ar) === 0)

      as(f, 'cashierA')
      const s2 = await json(await payPlan(req('POST', `/api/installments/${planId}/payments`, { amount: 63200, paymentMethod: 'cash', settle: true, rebatePercent: 50 }), ctx(planId)))
      check('settle again → completed', s2.status === 201 && s2.body.planStatus === 'completed', short(s2.body))
      const all = (await admin.query(`SELECT COALESCE(SUM(credit - debit),0)::float n FROM gl_entries WHERE tenant_id=$1 AND account_id=$2 AND voucher_type='installment_payment'`, [f.tenantId, f.acc.interest])).rows[0].n
      check('interest income on the plan = 6 400 − 1 600 rebate = 4 800', r2(all) === 4800, String(all))
    })

    // =============================================================== 7. repossession
    await step('repossession: stock, serials, write-off', async () => {
      const sale = await creditSale('TV-0002', 10000)
      const sid = await saleItemOf(sale.id)
      as(f, 'cashierA')
      const c = await json(await createPlan(req('POST', '/api/installments', {
        saleId: sale.id, customerId: f.customerId, customerName: 'Kamal Perera',
        items: [{ itemId: X, saleItemId: sid, itemName: 'Smart TV 55"', quantity: 1, unitPrice: 100000, serialNumbers: ['TV-0002'] }],
        terms: { cashPrice: 1, downPayment: 0, interestType: 'fixed', interestAmount: 9000, termMonths: 3, frequency: 'monthly', startDate: today },
      })))
      check('second plan → 201', c.status === 201, short(c.body))
      const pid = c.body.id
      const pay = await json(await payPlan(req('POST', `/api/installments/${pid}/payments`, { amount: 33000, paymentMethod: 'cash' }), ctx(pid)))
      check('first installment 33 000 = 3 000 interest + 30 000 principal', pay.status === 201 && Number(pay.body.receipt.interestAmount) === 3000 && Number(pay.body.receipt.principalAmount) === 30000, short(pay.body))
      const sn = (await admin.query(`SELECT status FROM item_serial_numbers WHERE id=$1`, [serial['TV-0002']])).rows[0]
      check('serial sold before repossession', sn.status === 'sold', short(sn))
      const stockBefore = await stockA()
      as(f, 'cashierA')
      const notManager = await json(await patchPlan(req('PATCH', `/api/installments/${pid}`, { action: 'repossess', reason: 'x', returnToStock: true }), ctx(pid)))
      check('cashier cannot repossess (403)', notManager.status === 403, short(notManager.body))
      as(f, 'managerA')
      const toKandy = await json(await patchPlan(req('PATCH', `/api/installments/${pid}`, { action: 'repossess', reason: 'Defaulted 3 months', returnToStock: true, returnWarehouseId: f.whB, condition: 'used' }), ctx(pid)))
      check('Colombo manager cannot return goods into Kandy', denied(toKandy), short(toKandy.body))
      const r = await json(await patchPlan(req('PATCH', `/api/installments/${pid}`, {
        action: 'repossess', reason: 'Defaulted 3 months', returnToStock: true, condition: 'used', recoveredValue: 45000, writeOff: true,
      }), ctx(pid)))
      check('repossess → 200 repossessed', r.status === 200 && r.body.status === 'repossessed', short(r.body))
      check('goods back in Colombo stock (+1)', (await stockA()) === stockBefore + 1, `${stockBefore} → ${await stockA()}`)
      const mv = (await admin.query(`SELECT qty_change::float q, reference_type FROM stock_movements WHERE reference_id=$1`, [pid])).rows
      check('stock movement logged (installment_repossession)', mv.length === 1 && mv[0].q === 1 && mv[0].reference_type === 'installment_repossession', short(mv))
      const sn2 = (await admin.query(`SELECT status, warehouse_id FROM item_serial_numbers WHERE id=$1`, [serial['TV-0002']])).rows[0]
      const snm = (await admin.query(`SELECT from_status, to_status FROM serial_number_movements WHERE serial_number_id=$1 AND reference_type='installment_repossession'`, [serial['TV-0002']])).rows
      check('serial → returned, movement logged', sn2.status === 'returned' && sn2.warehouse_id === f.whA && snm.length === 1 && snm[0].from_status === 'sold', short({ sn2, snm }))
      const gl = await glOf(admin, 'installment_repossession', pid)
      const bad = await accountId(admin, f.tenantId, 'bad_debts')
      check('GL: Dr Stock 45 000 + Dr Bad debts 15 000 / Cr AR 60 000', balanced(gl) && net(gl, f.acc.stock) === 45000 && !!bad && net(gl, bad!) === 15000 && net(gl, f.acc.ar) === -60000, short(gl))
      const p = await planRow(pid)
      const rows = await scheduleOf(pid)
      check('plan: balance 0, written off 15 000, recovered 45 000, open rows waived', Number(p.balance) === 0 && Number(p.written_off_amount) === 15000
        && Number(p.recovered_value) === 45000 && rows.slice(1).every((x) => x.status === 'waived'), short({ p, rows }))
      as(f, 'cashierA')
      const late = await json(await payPlan(req('POST', `/api/installments/${pid}/payments`, { amount: 100, paymentMethod: 'cash' }), ctx(pid)))
      check('no payments on a repossessed plan', late.status === 400, short(late.body))
      const srow = (await admin.query(`SELECT status, paid_amount::float paid, total::float total, flags FROM sales WHERE id=$1`, [sale.id])).rows[0]
      check('sale settled: 10 000 down + 30 000 paid + 60 000 cleared (goods 45 000 + write-off 15 000) → completed, balance 0',
        srow.status === 'completed' && srow.paid === 100000 && srow.flags?.hirePurchaseSettlement?.writtenOff === 15000 && srow.flags?.hirePurchaseSettlement?.cleared === 60000, short(srow))
      const cashPays = (await admin.query(`SELECT COALESCE(SUM(amount),0)::float s FROM payments WHERE sale_id=$1 AND voided_at IS NULL`, [sale.id])).rows[0].s
      check('no cash payment row for the non-cash settlement', cashPays === 40000, String(cashPays))
    })

    // =============================================================== 7b. sale guard
    await step('sale with a plan cannot be voided / fully returned', async () => {
      const ACC = randomUUID()
      await admin.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1,$2,'L2-BR','Wall bracket',1000,5000,true)`, [ACC, f.tenantId])
      await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
        tenantId: f.tenantId, warehouseId: f.whA, itemId: ACC, mode: 'delta', qty: 5, referenceType: 'test_seed', source: 'system', userId: f.users.owner.id,
      }))
      as(f, 'owner')
      const sale = await json(await postSale(req('POST', '/api/sales', {
        warehouseId: f.whA, customerId: f.customerId, discount: 0, tax: 0, creditAmount: 0,
        cartItems: [
          { itemId: X, name: 'Smart TV 55"', quantity: 1, unitPrice: 100000, serialNumberIds: [serial['TV-0003']] },
          { itemId: ACC, name: 'Wall bracket', quantity: 1, unitPrice: 5000 },
        ],
        subtotal: 105000, total: 105000, paymentMethod: 'cash', amountPaid: 25000,
        paymentSplits: [{ method: 'cash', amount: 25000 }, { method: 'credit', amount: 80000 }],
      })))
      check('two-line credit sale', sale.status === 200 || sale.status === 201, short(sale.body))
      const lines = (await admin.query(`SELECT id, item_id FROM sale_items WHERE sale_id=$1`, [sale.body.id])).rows
      const tvLine = lines.find((l) => l.item_id === X).id
      const brLine = lines.find((l) => l.item_id === ACC).id
      const c = await json(await createPlan(req('POST', '/api/installments', {
        saleId: sale.body.id, customerId: f.customerId, customerName: 'Kamal Perera',
        items: [{ itemId: X, saleItemId: tvLine, itemName: 'Smart TV 55"', quantity: 1, unitPrice: 100000, serialNumbers: ['TV-0003'] }],
        terms: { cashPrice: 1, downPayment: 0, interestType: 'flat', interestRate: 12, termMonths: 4, frequency: 'monthly', startDate: today },
      })))
      check('plan on the TV line → 201', c.status === 201, short(c.body))
      const planNo = c.body.planNo
      const v = await json(await voidSale(req('PUT', `/api/sales/${sale.body.id}`, { voidReason: 'test' }), ctx(sale.body.id)))
      check('void the sale → 409 with the plan number', v.status === 409 && v.body.code === 'HP_PLAN_EXISTS' && String(v.body.error).includes(planNo) && String(v.body.error).includes('cancel or settle the plan first'), short(v.body))
      const ret = (lines2: Array<{ id: string; itemId: string; name: string; serials?: string[] }>) => postSale(req('POST', '/api/sales', {
        isReturn: true, returnAgainst: sale.body.id, warehouseId: f.whA, refundMethod: 'cash', subtotal: 0, tax: 0, total: 0, returnReason: 'test',
        cartItems: lines2.map((l) => ({ originalSaleItemId: l.id, itemId: l.itemId, name: l.name, quantity: -1, unitPrice: 0, ...(l.serials ? { serialNumberIds: l.serials } : {}) })),
      })).then(json)
      const rTv = await ret([{ id: tvLine, itemId: X, name: 'Smart TV 55"', serials: [serial['TV-0003']] }])
      check('returning the plan line → 409 HP_PLAN_EXISTS', rTv.status === 409 && rTv.body.code === 'HP_PLAN_EXISTS', short(rTv.body))
      const rAll = await ret([{ id: tvLine, itemId: X, name: 'Smart TV 55"', serials: [serial['TV-0003']] }, { id: brLine, itemId: ACC, name: 'Wall bracket' }])
      check('full return → 409 HP_PLAN_EXISTS', rAll.status === 409 && rAll.body.code === 'HP_PLAN_EXISTS', short(rAll.body))
      const rBr = await ret([{ id: brLine, itemId: ACC, name: 'Wall bracket' }])
      check('partial return of the non-plan line is allowed', rBr.status === 200 || rBr.status === 201, short(rBr.body))
      as(f, 'cashierA')
      const pay = await json(await payPlan(req('POST', `/api/installments/${c.body.id}/payments`, { amount: 1000, paymentMethod: 'cash' }), ctx(c.body.id)))
      check('a receipt on the plan', pay.status === 201, short(pay.body))
      as(f, 'managerA')
      const cancel = await json(await patchPlan(req('PATCH', `/api/installments/${c.body.id}`, { action: 'cancel', reason: 'Customer will pay cash' }), ctx(c.body.id)))
      check('plan cancelled', cancel.status === 200, short(cancel.body))
      as(f, 'owner')
      const v1 = await json(await voidSale(req('PUT', `/api/sales/${sale.body.id}`, { voidReason: 'test' }), ctx(sale.body.id)))
      check('void refused while the cancelled plan has receipts → 409 "void the plan\'s receipts first"', v1.status === 409 && v1.body.code === 'HP_PLAN_EXISTS' && String(v1.body.error).includes("void the plan's receipts first"), short(v1.body))
      const rTv2 = await ret([{ id: tvLine, itemId: X, name: 'Smart TV 55"', serials: [serial['TV-0003']] }])
      check('full return refused too', rTv2.status === 409 && String(rTv2.body.error).includes("void the plan's receipts first"), short(rTv2.body))
      as(f, 'managerA')
      const vr = await json(await receiptAction(req('POST', `/api/installments/${c.body.id}/payments/${pay.body.receipt.id}`, { action: 'void', reason: 'Plan cancelled' }), { params: Promise.resolve({ id: c.body.id, paymentId: pay.body.receipt.id }) }))
      check('receipt of a cancelled plan can be voided', vr.status === 200, short(vr.body))
      as(f, 'owner')
      const v2 = await json(await voidSale(req('PUT', `/api/sales/${sale.body.id}`, { voidReason: 'after plan cancel' }), ctx(sale.body.id)))
      check('void allowed once the plan is cancelled and its receipts voided', v2.status === 200, short(v2.body))
    })

    // =============================================================== 8. hand-registered plans
    await step('hand-registered plan: receivable at creation', async () => {
      as(f, 'cashierA')
      const c = await json(await createPlan(req('POST', '/api/installments', {
        customerId: f.customerId, customerName: 'Kamal Perera',
        items: [{ itemName: 'Refrigerator (old stock)', quantity: 1, unitPrice: 50000 }],
        terms: { cashPrice: 50000, downPayment: 10000, interestType: 'fixed', interestAmount: 4000, termMonths: 2, frequency: 'monthly', startDate: today },
        recordDownPayment: true, downPaymentMethod: 'cash',
      })))
      check('manual plan → 201 at the cashier branch', c.status === 201 && c.body.warehouseId === f.whA, short(c.body))
      const pid = c.body.id
      const rec = await accountId(admin, f.tenantId, 'installment_receivable')
      const glp = await glOf(admin, 'installment_plan', pid)
      check('creation: Dr Installment Receivable 40 000 / Cr Sales 40 000', !!rec && balanced(glp) && net(glp, rec!) === 40000 && net(glp, f.acc.income) === -40000, short(glp))
      const dp = (await admin.query(`SELECT id, gl_mode FROM installment_payments WHERE plan_id=$1 AND kind='down_payment'`, [pid])).rows[0]
      const gld = await glOf(admin, 'installment_payment', dp.id)
      check('down payment: Dr Cash 10 000 / Cr Sales 10 000', dp.gl_mode === 'voucher' && balanced(gld) && net(gld, f.acc.cash) === 10000 && net(gld, f.acc.income) === -10000, short(gld))
      const pay = await json(await payPlan(req('POST', `/api/installments/${pid}/payments`, { amount: 22000, paymentMethod: 'card' }), ctx(pid)))
      const glr = await glOf(admin, 'installment_payment', pay.body.receipt.id)
      check('receipt credits Installment Receivable 20 000 + interest 2 000', pay.status === 201 && balanced(glr) && net(glr, rec!) === -20000 && net(glr, f.acc.interest) === -2000, short(glr))
      as(f, 'managerA')
      const cancel = await json(await patchPlan(req('PATCH', `/api/installments/${pid}`, { action: 'cancel', reason: 'Customer changed mind' }), ctx(pid)))
      check('cancel with installment receipts → 400 HAS_RECEIPTS', cancel.status === 400 && cancel.body.code === 'HAS_RECEIPTS', short(cancel.body))
      const rp = await json(await patchPlan(req('PATCH', `/api/installments/${pid}`, { action: 'repossess', reason: 'Absconded', returnToStock: false, writeOff: true }), ctx(pid)))
      const glw = await glOf(admin, 'installment_repossession', pid)
      const bad = await accountId(admin, f.tenantId, 'bad_debts')
      check('write-off only: Dr Bad debts 20 000 / Cr Installment Receivable 20 000', rp.status === 200 && balanced(glw) && net(glw, bad!) === 20000 && net(glw, rec!) === -20000, short({ b: rp.body, glw }))
      const recBal = (await admin.query(`SELECT COALESCE(SUM(debit-credit),0)::float b FROM gl_entries WHERE account_id=$1`, [rec])).rows[0].b
      check('Installment Receivable back to 0', r2(recBal) === 0, String(recBal))
    })

    await step('hand-registered plan: cancel reverses', async () => {
      as(f, 'cashierA')
      const c = await json(await createPlan(req('POST', '/api/installments', {
        customerName: 'Walk-in Sunil', items: [{ itemName: 'Washing machine', quantity: 1, unitPrice: 30000 }],
        terms: { cashPrice: 30000, downPayment: 5000, interestType: 'flat', interestRate: 12, termMonths: 5, frequency: 'monthly', startDate: today },
        recordDownPayment: true, downPaymentMethod: 'cheque', downPaymentCheque: { chequeNo: '800001', bankName: 'BOC', chequeDate: today },
      })))
      check('manual plan with a cheque down payment → 201', c.status === 201, short(c.body))
      const pid = c.body.id
      const dp = (await admin.query(`SELECT id, cheque_id FROM installment_payments WHERE plan_id=$1`, [pid])).rows[0]
      check('down payment cheque in the register', !!dp?.cheque_id, short(dp))
      as(f, 'managerA')
      const cancel = await json(await patchPlan(req('PATCH', `/api/installments/${pid}`, { action: 'cancel', reason: 'Entered twice' }), ctx(pid)))
      check('cancel → 200 cancelled', cancel.status === 200 && cancel.body.status === 'cancelled', short(cancel.body))
      const glp = await glOf(admin, 'installment_plan', pid)
      const gld = await glOf(admin, 'installment_payment', dp.id)
      check('receivable and down payment journals reversed (net 0)', glp.length === 4 && r2(glp.reduce((s, e) => s + e.d - e.c, 0)) === 0
        && glp.every((e) => true) && [f.acc.chequesInHand, f.acc.income].every((a) => net(gld, a) === 0) && net(glp, f.acc.income) === 0, short({ glp, gld }))
      const ch = (await admin.query(`SELECT status FROM cheques WHERE id=$1`, [dp.cheque_id])).rows[0]
      check('its cheque cancelled in the register', ch.status === 'cancelled', short(ch))
    })

    await step('opening agreement', async () => {
      as(f, 'owner')
      const c = await json(await createPlan(req('POST', '/api/installments', {
        warehouseId: f.whB, customerName: 'Old book customer', items: [{ itemName: 'Sofa set', quantity: 1, unitPrice: 80000 }],
        terms: { cashPrice: 80000, downPayment: 20000, interestType: 'fixed', interestAmount: 6000, termMonths: 6, frequency: 'monthly', startDate: addMonths(today, -2) },
        recordDownPayment: true, downPaymentMethod: 'cash', openingAgreement: true,
      })))
      check('opening agreement → 201', c.status === 201, short(c.body))
      const glp = await glOf(admin, 'installment_plan', c.body.id)
      const re = await accountId(admin, f.tenantId, 'retained_earnings')
      check('receivable 60 000 against Retained Earnings, no sales revenue', !!re && balanced(glp) && net(glp, re!) === -60000 && net(glp, f.acc.income) === 0, short(glp))
      const dp = (await admin.query(`SELECT gl_mode FROM installment_payments WHERE plan_id=$1`, [c.body.id])).rows[0]
      check('historical down payment posts nothing', dp && dp.gl_mode === null, short(dp))
    })

    // =============================================================== 9. whole ledger
    await step('ledger integrity', async () => {
      const vs = (await admin.query(
        `SELECT voucher_type, voucher_id, SUM(debit)::float d, SUM(credit)::float c FROM gl_entries WHERE tenant_id=$1 GROUP BY 1,2`, [f.tenantId])).rows
      const bad = vs.filter((v) => r2(v.d) !== r2(v.c))
      check('every voucher balances (Σ debit = Σ credit)', bad.length === 0, short(bad))
      const t = (await admin.query(`SELECT SUM(debit)::float d, SUM(credit)::float c FROM gl_entries WHERE tenant_id=$1`, [f.tenantId])).rows[0]
      check('whole tenant ledger balances', r2(t.d) === r2(t.c), short(t))
      const coa = (await admin.query(`SELECT a.id FROM chart_of_accounts a WHERE a.tenant_id=$1 AND a.balance::numeric <> COALESCE((SELECT SUM(debit-credit) FROM gl_entries g WHERE g.account_id=a.id),0)`, [f.tenantId])).rows
      check('account running balances match the entries', coa.length === 0, short(coa))
      const tags = (await admin.query(`SELECT count(*)::int n FROM chart_of_accounts WHERE tenant_id=$1 AND description LIKE '%[hp:interest_income]%'`, [f.tenantId])).rows[0].n
      check('existing "Hire Purchase Interest Income" adopted by name (not duplicated)', tags === 0
        && (await admin.query(`SELECT count(*)::int n FROM chart_of_accounts WHERE tenant_id=$1 AND name ILIKE '%interest income%'`, [f.tenantId])).rows[0].n === 1)
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) for (const t of tenants) await cleanup(admin, t)
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
