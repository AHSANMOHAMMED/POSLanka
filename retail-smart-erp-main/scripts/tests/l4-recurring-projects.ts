/**
 * L4 — recurring invoices, payments received, projects & time tracking (drizzle/0185).
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_rec DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l4-recurring-projects.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness, which also honours the request
 * principal system runs install) on throw-away tenants. Covers: schedule math (month end, every 3
 * months, leap day, end after N / on date, catch-up), generation through POST /api/sales and its
 * idempotency (parallel cron calls, double "Run now", re-runs), drafts, payments allocated over
 * several invoices (+ overpayment to credit, advances, store credit), timesheet → invoice amounts,
 * the timer, fixed-price billing and tenant isolation. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import {
  addMonths, dueOccurrences, firstOccurrenceFrom, nextRunDate, occurrenceDate, upcomingDates, type RecurringSchedule,
} from '@/lib/recurring-invoices/schedule'
import { recurringToday, runRecurringInvoices } from '@/lib/recurring-invoices/generate'
import { previewProjectInvoice } from '@/lib/projects/billing'
import { GET as listRecurring, POST as createRecurring } from '@/app/api/recurring-invoices/route'
import { GET as getRecurring, PATCH as patchRecurring, DELETE as deleteRecurring } from '@/app/api/recurring-invoices/[id]/route'
import { POST as runNow } from '@/app/api/recurring-invoices/[id]/run/route'
import { POST as postDraft } from '@/app/api/recurring-invoices/[id]/runs/[runId]/post/route'
import { POST as cronRecurring } from '@/app/api/cron/recurring-invoices/route'
import { GET as listPayments, POST as recordPayment } from '@/app/api/payments-received/route'
import { GET as unpaidRoute } from '@/app/api/payments-received/unpaid/route'
import { GET as getReceipt } from '@/app/api/payments-received/[id]/route'
import { POST as createProject } from '@/app/api/projects/route'
import { GET as getProject } from '@/app/api/projects/[id]/route'
import { GET as previewInvoice, POST as invoiceProject } from '@/app/api/projects/[id]/invoice/route'
import { GET as projectReports } from '@/app/api/projects/reports/route'
import { POST as logTime } from '@/app/api/time-entries/route'
import { DELETE as deleteTime } from '@/app/api/time-entries/[id]/route'
import { GET as getTimer, POST as timer } from '@/app/api/time-entries/timer/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; ownerId: string; staffId: string; customerId: string; customer2Id: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}
function session(f: Fx, who: 'owner' | 'staff') {
  const id = who === 'owner' ? f.ownerId : f.staffId
  return {
    user: {
      id, accountId: null, email: `${who}-${f.slug}@example.test`, name: who === 'owner' ? 'Owner' : 'Staff', role: who === 'owner' ? 'owner' : 'cashier',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'L4', businessType: 'office',
      aiEnabled: false, isSuperAdmin: false, isOwner: who === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
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
const short = (b: unknown) => JSON.stringify(b).slice(0, 600)

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `l4-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), ownerId: randomUUID(), staffId: randomUUID(), customerId: randomUUID(), customer2Id: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, 'L4 test', $2, $3, 'office')`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`, [f.ownerId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Nimali Staff', 'cashier')`, [f.staffId, tenantId, `staff-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Acme Lanka')`, [f.customerId, tenantId])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Beta Holdings')`, [f.customer2Id, tenantId])
  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`, [id, tenantId, name, no, root, type])
    return id
  }
  const a = {
    cash: await acc('Cash', '1100', 'asset', 'cash'), bank: await acc('Bank', '1200', 'asset', 'bank'),
    ar: await acc('Receivable', '1300', 'asset', 'receivable'), stock: await acc('Stock', '1400', 'asset', 'stock'),
    income: await acc('Sales', '4000', 'income', 'income_account'), cogs: await acc('COGS', '5000', 'expense', 'cost_of_goods_sold'),
    expense: await acc('Expenses', '5100', 'expense', 'expense_account'), ap: await acc('Payable', '2100', 'liability', 'payable'),
    advance: await acc('Customer advances', '2200', 'liability', 'payable'),
  }
  const fy = randomUUID()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, tenantId, `${new Date().getFullYear() - 2}-01-01`, `${new Date().getFullYear() + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
       default_bank_account_id, default_expense_account_id, default_payable_account_id, default_cogs_account_id, default_stock_account_id,
       default_advance_received_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,true)`,
    [tenantId, a.ar, a.income, a.cash, a.bank, a.expense, a.ap, a.cogs, a.stock, a.advance, fy])
  return f
}

async function newItem(admin: Client, f: Fx, name: string, price: number, stock: number | null) {
  const id = randomUUID()
  await admin.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, f.tenantId, `L4-${id.slice(0, 8)}`, name, Math.round(price / 2), price, stock !== null])
  if (stock !== null) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: f.ownerId,
    }))
  }
  return id
}

async function cleanup(admin: Client, tenantId: string) {
  await admin.query(`SET session_replication_role = replica`)
  const tables = await admin.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='tenant_id'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)
  for (const t of tables.rows) await admin.query(`DELETE FROM "${t.table_name}" WHERE tenant_id=$1`, [tenantId]).catch(() => undefined)
  await admin.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch((e) => console.warn('cleanup tenant:', e.message))
  await admin.query(`SET session_replication_role = origin`)
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  process.env.CRON_SECRET = process.env.CRON_SECRET || 'l4-cron-secret'
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    // ================================================================ 1. schedule math (pure)
    await step('schedule math', async () => {
      const monthEnd: RecurringSchedule = { frequency: 'monthly', intervalCount: 1, startDate: '2026-01-31', endType: 'never' }
      const m = [0, 1, 2, 3, 12, 13].map((k) => occurrenceDate(monthEnd, k))
      check('monthly from 31 Jan: 31 Jan, 28 Feb, 31 Mar, 30 Apr (no drift), 31 Jan 27, 28 Feb 27',
        m.join(',') === '2026-01-31,2026-02-28,2026-03-31,2026-04-30,2027-01-31,2027-02-28', m.join(','))
      const leapMonth: RecurringSchedule = { frequency: 'monthly', intervalCount: 1, startDate: '2028-01-30', endType: 'never' }
      check('monthly from 30 Jan 2028 → 29 Feb (leap year) → 30 Mar', [1, 2].map((k) => occurrenceDate(leapMonth, k)).join(',') === '2028-02-29,2028-03-30')
      const q: RecurringSchedule = { frequency: 'monthly', intervalCount: 3, startDate: '2026-11-30', endType: 'never' }
      const qd = [0, 1, 2, 3, 4].map((k) => occurrenceDate(q, k))
      check('every 3 months from 30 Nov: 30 Nov, 28 Feb, 30 May, 30 Aug, 30 Nov', qd.join(',') === '2026-11-30,2027-02-28,2027-05-30,2027-08-30,2027-11-30', qd.join(','))
      const y: RecurringSchedule = { frequency: 'yearly', intervalCount: 1, startDate: '2028-02-29', endType: 'never' }
      check('yearly from 29 Feb 2028: 28 Feb 2029 … 29 Feb 2032', occurrenceDate(y, 1) === '2029-02-28' && occurrenceDate(y, 4) === '2032-02-29')
      const w: RecurringSchedule = { frequency: 'weekly', intervalCount: 2, startDate: '2026-12-28', endType: 'never' }
      check('every 2 weeks across the year end', occurrenceDate(w, 1) === '2027-01-11' && occurrenceDate(w, 2) === '2027-01-25')
      const after: RecurringSchedule = { ...monthEnd, endType: 'after', endAfterCount: 3 }
      check('end after 3: occurrence 2 runs, occurrence 3 does not', nextRunDate(after, 2) === '2026-03-31' && nextRunDate(after, 3) === null)
      const onDate: RecurringSchedule = { ...monthEnd, endType: 'on_date', endDate: '2026-03-31' }
      check('end on 31 Mar: inclusive, then null', nextRunDate(onDate, 2) === '2026-03-31' && nextRunDate(onDate, 3) === null)
      check('upcoming dates stop at the end', upcomingDates(after, 0, 10).length === 3)
      const due = dueOccurrences(monthEnd, 0, '2026-03-30', 12)
      check('due on 30 Mar: Jan + Feb (catch-up)', due.map((d) => d.date).join(',') === '2026-01-31,2026-02-28', short(due))
      check('first occurrence after 28 Feb (strict) = index 2', firstOccurrenceFrom(monthEnd, '2026-02-28', true) === 2)
      check('first occurrence from 1 Mar = index 2; from 2026-01-31 = 0', firstOccurrenceFrom(monthEnd, '2026-03-01') === 2 && firstOccurrenceFrom(monthEnd, '2026-01-31') === 0)
      check('first occurrence far ahead (every 3 months)', occurrenceDate(q, firstOccurrenceFrom(q, '2030-06-01')) === '2030-08-30')
    })

    const f = await makeTenant(admin, 'a')
    tenants.push(f.tenantId)
    const g = await makeTenant(admin, 'b')
    tenants.push(g.tenantId)
    const today = recurringToday()
    setTestSession(session(f, 'owner'))
    const goods = await newItem(admin, f, 'Monthly cleaning kit', 1000, 100)
    const saleCount = async (where = '') => Number((await admin.query(`SELECT count(*)::int n FROM sales WHERE tenant_id=$1 ${where}`, [f.tenantId])).rows[0].n)

    // ================================================================ 2. recurring invoices
    let profileId = ''
    let expected = 0
    await step('recurring generation', async () => {
      const startDate = addMonths(today, -2)
      const sched: RecurringSchedule = { frequency: 'monthly', intervalCount: 1, startDate, endType: 'never' }
      expected = dueOccurrences(sched, 0, today, 12).length
      const bad = await json(await createRecurring(req('POST', '/api/recurring-invoices', {
        profileName: 'Bad', customerId: f.customerId, frequency: 'monthly', startDate, endType: 'after', lines: [{ itemId: goods, itemName: 'x', quantity: 1, unitPrice: 1 }],
      })))
      check('end "after" without a count → 400', bad.status === 400, short(bad.body))
      const created = await json(await createRecurring(req('POST', '/api/recurring-invoices', {
        profileName: 'Monthly supplies', customerId: f.customerId, warehouseId: f.wh, frequency: 'monthly', intervalCount: 1, startDate,
        endType: 'never', invoiceAction: 'final', paymentTermsDays: 14, notes: 'Thank you', terms: 'Pay within 14 days',
        lines: [{ itemId: goods, itemName: 'Monthly cleaning kit', quantity: 2, unitPrice: 1000 }],
      })))
      check('create profile → 201', created.status === 201, short(created.body))
      profileId = created.body.id
      const before = await saleCount()
      // two cron calls at the same time: each due date is invoiced exactly once
      const unauth = await cronRecurring(req('POST', '/api/cron/recurring-invoices'))
      check('cron without the secret → 401', unauth.status === 401)
      const [c1, c2] = await Promise.all([
        runRecurringInvoices({ tenantIds: [f.tenantId] }), runRecurringInvoices({ tenantIds: [f.tenantId] }),
      ])
      const after1 = await saleCount()
      check(`parallel cron calls → ${expected} invoices (one per due month), not ${expected * 2}`,
        after1 - before === expected && c1.generated + c2.generated === expected, `sales +${after1 - before}; ${c1.generated}/${c2.generated} ${short([c1.outcomes, c2.outcomes])}`)
      const runs = (await admin.query(`SELECT run_date::text d, status, sale_id, due_date::text due, total::float total FROM recurring_invoice_runs WHERE recurring_invoice_id=$1 ORDER BY run_date`, [profileId])).rows
      check('one generated run per scheduled date', runs.length === expected && runs.every((r) => r.status === 'generated' && r.sale_id) && new Set(runs.map((r) => r.d)).size === expected, short(runs))
      check('due date = run date + 14 days', runs.every((r) => r.due === new Date(Date.parse(`${r.d}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10)), short(runs))
      const cronHttp = await json(await cronRecurring(req('POST', '/api/cron/recurring-invoices', undefined, { authorization: `Bearer ${process.env.CRON_SECRET}` })))
      check('cron route again → 200, nothing new', cronHttp.status === 200 && (await saleCount()) === after1, short(cronHttp.body))
      const sale = (await admin.query(`SELECT s.total::float total, s.paid_amount::float paid, s.status, s.customer_id, s.notes, s.client_sale_id,
          (SELECT sum(quantity)::float FROM sale_items WHERE sale_id = s.id) qty
        FROM sales s WHERE s.id=$1`, [runs[0].sale_id])).rows[0]
      check('invoice: 2 × 1000 on account (pending, unpaid), customer set, notes + terms', sale.total === 2000 && sale.paid === 0 && sale.status === 'pending'
        && sale.customer_id === f.customerId && /Pay within 14 days/.test(sale.notes) && !!sale.client_sale_id, short(sale))
      const stock = (await admin.query(`SELECT current_stock::float q FROM warehouse_stock WHERE item_id=$1 AND warehouse_id=$2`, [goods, f.wh])).rows[0]
      check('stock moved through the sale path (100 − 2 per invoice)', stock.q === 100 - 2 * expected, short(stock))
      const gl = (await admin.query(`SELECT count(*)::int n FROM gl_entries WHERE tenant_id=$1 AND voucher_id=$2`, [f.tenantId, runs[0].sale_id])).rows[0]
      check('invoice posted to the GL', gl.n > 0, short(gl))
      const prof = (await admin.query(`SELECT occurrences_generated k, next_run_date::text nx FROM recurring_invoices WHERE id=$1`, [profileId])).rows[0]
      check('profile moved to the next future occurrence', prof.k === expected && prof.nx > today, short(prof))

      // "Run now" double click: the next occurrence once
      const beforeRun = await saleCount()
      const seen = prof.nx
      const click = async () => json(await runNow(req('POST', `/api/recurring-invoices/${profileId}/run`, { runDate: seen }), ctx(profileId)))
      const [r1, r2] = await Promise.all([click(), click()])
      const r3 = await click()
      const kinds = [r1.body.kind, r2.body.kind].sort()
      check('double / triple "Run now" → one invoice (generated + in progress/duplicate)', (await saleCount()) === beforeRun + 1 && kinds.includes('generated')
        && r3.status === 200 && r3.body.kind === 'duplicate' && r3.body.runDate === seen, short([r1, r2, r3]))
      const detail = await json(await getRecurring(req('GET', `/api/recurring-invoices/${profileId}`), ctx(profileId)))
      check('history lists every generated invoice', detail.status === 200 && detail.body.runs.length === expected + 1 && detail.body.runs.every((r: J) => r.invoiceNo), short(detail.body.runs))

      // pause → cron skips; resume skips missed periods
      const paused = await json(await patchRecurring(req('PATCH', `/api/recurring-invoices/${profileId}`, { action: 'pause' }), ctx(profileId)))
      await admin.query(`UPDATE recurring_invoices SET next_run_date = $2 WHERE id=$1`, [profileId, addMonths(today, -1)])
      const pc = await runRecurringInvoices({ tenantIds: [f.tenantId] })
      check('paused profile is not invoiced by the cron', paused.status === 200 && pc.generated === 0, short(pc))
      await admin.query(`UPDATE recurring_invoices SET next_run_date = $2 WHERE id=$1`, [profileId, detail.body.nextRunDate])
      const resumed = await json(await patchRecurring(req('PATCH', `/api/recurring-invoices/${profileId}`, { action: 'resume' }), ctx(profileId)))
      check('resume → active', resumed.status === 200 && resumed.body.status === 'active', short(resumed.body))
      const list = await json(await listRecurring(req('GET', '/api/recurring-invoices')))
      check('list shows the profile with amount 2000', list.status === 200 && list.body.data.some((r: J) => r.id === profileId && Number(r.amount) === 2000), short(list.body))
    })

    await step('recurring drafts', async () => {
      const created = await json(await createRecurring(req('POST', '/api/recurring-invoices', {
        profileName: 'Retainer (review first)', customerId: f.customer2Id, frequency: 'weekly', startDate: today, endType: 'after', endAfterCount: 2,
        invoiceAction: 'draft', lines: [{ itemId: goods, itemName: 'Retainer kit', quantity: 1, unitPrice: 750 }],
      })))
      const id = created.body.id
      const before = await saleCount()
      const c = await runRecurringInvoices({ tenantIds: [f.tenantId] })
      const run = (await admin.query(`SELECT id, status, sale_id, total::float total FROM recurring_invoice_runs WHERE recurring_invoice_id=$1`, [id])).rows
      check('draft profile → draft run, no invoice yet, amount shown', c.drafts === 1 && run.length === 1 && run[0].status === 'draft' && !run[0].sale_id && run[0].total === 750 && (await saleCount()) === before, short([c, run]))
      const posted = await json(await postDraft(req('POST', `/api/recurring-invoices/${id}/runs/${run[0].id}/post`), { params: Promise.resolve({ id, runId: run[0].id }) }))
      const again = await json(await postDraft(req('POST', `/api/recurring-invoices/${id}/runs/${run[0].id}/post`), { params: Promise.resolve({ id, runId: run[0].id }) }))
      check('post draft → invoice; posting again → 409', posted.status === 200 && posted.body.kind === 'generated' && again.status === 409 && (await saleCount()) === before + 1, short([posted, again]))
      const end = await json(await runNow(req('POST', `/api/recurring-invoices/${id}/run`), ctx(id)))
      const done = await json(await runNow(req('POST', `/api/recurring-invoices/${id}/run`), ctx(id)))
      check('end after 2: second run ok, then the profile is completed', end.status === 200 && done.status === 400 && /completed/.test(done.body.error), short([end, done]))
      const del = await json(await deleteRecurring(req('DELETE', `/api/recurring-invoices/${id}`), ctx(id)))
      const bin = (await admin.query(`SELECT count(*)::int n FROM recycle_bin WHERE entity_id=$1 AND entity_type='recurring_invoice'`, [id])).rows[0]
      check('delete → recycle bin (archived), gone from the list', del.status === 200 && bin.n === 1, short(del))
    })

    // ================================================================ 3. payments received
    await step('payments received', async () => {
      const empty = await json(await listPayments(req('GET', '/api/payments-received')))
      check('nothing received yet → anyEver false (empty state)', empty.status === 200 && empty.body.anyEver === false && empty.body.data.length === 0, short(empty.body))
      const unpaid = await json(await unpaidRoute(req('GET', `/api/payments-received/unpaid?customerId=${f.customerId}`)))
      const inv = unpaid.body.invoices as J[]
      check(`customer has ${expected + 1} unpaid invoices of 2000, oldest first`, unpaid.status === 200 && inv.length === expected + 1 && inv.every((i) => i.balance === 2000)
        && unpaid.body.outstanding === 2000 * (expected + 1), short(unpaid.body))
      const [a, b, c, d] = inv
      const over = await json(await recordPayment(req('POST', '/api/payments-received', {
        customerId: f.customerId, amountReceived: 1000, method: 'cash', allocations: [{ saleId: a.id, amount: 1500 }],
      })))
      check('allocating more than received → 400', over.status === 400, short(over.body))
      const unalloc = await json(await recordPayment(req('POST', '/api/payments-received', {
        customerId: f.customerId, amountReceived: 3000, method: 'cash', allocations: [{ saleId: a.id, amount: 2000 }],
      })))
      check('money left unallocated without "keep as credit" → 400 UNALLOCATED_AMOUNT', unalloc.status === 400 && unalloc.body.code === 'UNALLOCATED_AMOUNT', short(unalloc.body))
      const r1 = await json(await recordPayment(req('POST', '/api/payments-received', {
        customerId: f.customerId, amountReceived: 5000, method: 'bank_transfer', reference: 'TRX-881',
        allocations: [{ saleId: a.id, amount: 2000 }, { saleId: b.id, amount: 2000 }, { saleId: c.id, amount: 1000 }],
      })))
      const st = async (id: string) => (await admin.query(`SELECT status, paid_amount::float p FROM sales WHERE id=$1`, [id])).rows[0]
      const [sa, sb, sc] = [await st(a.id), await st(b.id), await st(c.id)]
      check('5000 over three invoices → paid, paid, partial (1000)', r1.status === 201 && sa.status === 'completed' && sb.status === 'completed' && sc.status === 'partial' && sc.p === 1000, short([r1.body, sa, sb, sc]))
      const allocs = (await admin.query(`SELECT a.amount::float amt, a.payment_id, p.amount::float pamt, p.method FROM payment_receipt_allocations a LEFT JOIN payments p ON p.id = a.payment_id WHERE a.receipt_id=$1`, [r1.body.id])).rows
      check('receipt links each payment row (bank transfer)', allocs.length === 3 && allocs.every((x) => x.payment_id && x.pamt === x.amt && x.method === 'bank_transfer'), short(allocs))
      // overpayment → customer credit
      const r2 = await json(await recordPayment(req('POST', '/api/payments-received', {
        customerId: f.customerId, amountReceived: 1500, method: 'cash', allocations: [{ saleId: c.id, amount: 1000 }], excessToCredit: true,
      })))
      const bal = async () => Number((await admin.query(`SELECT balance::float b FROM customers WHERE id=$1`, [f.customerId])).rows[0].b)
      check('1500 for a 1000 balance, excess kept → invoice paid, credit 500', r2.status === 201 && (await st(c.id)).status === 'completed' && (await bal()) === 500 && r2.body.excessToCredit === 500, short(r2.body))
      // advance with no invoice
      const r3 = await json(await recordPayment(req('POST', '/api/payments-received', { customerId: f.customerId, amountReceived: 300, method: 'cash', allocations: [], excessToCredit: true })))
      check('advance 300 with nothing allocated → customer credit 800', r3.status === 201 && (await bal()) === 800, short(r3.body))
      // store credit + money on the last invoice
      const r4 = await json(await recordPayment(req('POST', '/api/payments-received', {
        customerId: f.customerId, amountReceived: 1200, method: 'card', allocations: [{ saleId: d.id, amount: 1200, creditAmount: 800 }],
      })))
      check('1200 card + 800 store credit settle 2000 → paid, credit 0', r4.status === 201 && (await st(d.id)).status === 'completed' && (await bal()) === 0, short(r4.body))
      const list = await json(await listPayments(req('GET', '/api/payments-received')))
      check('list: 6 invoice payments + 1 advance; received 8000, credit applied 800',
        list.status === 200 && list.body.totals.count === 7 && list.body.totals.amount === 8000 && list.body.totals.creditApplied === 800 && list.body.anyEver === true,
        short(list.body.totals))
      check('rows carry their receipt number', list.body.data.filter((r: J) => r.receiptNo).length === 7, short(list.body.data))
      const bank = await json(await listPayments(req('GET', '/api/payments-received?method=bank_transfer')))
      check('filter by method (bank transfer: 3 rows, 5000)', bank.body.totals.count === 3 && bank.body.totals.amount === 5000, short(bank.body.totals))
      const dep = await json(await listPayments(req('GET', `/api/payments-received?kind=credit_deposit&fromDate=${today}&toDate=${today}`)))
      check('filter advances today → 300', dep.body.totals.count === 1 && dep.body.totals.amount === 300, short(dep.body.totals))
      const receipt = await json(await getReceipt(req('GET', `/api/payments-received/${r1.body.id}`), ctx(r1.body.id)))
      check('printable receipt: number, customer, 3 allocations', receipt.status === 200 && /^RCPT-/.test(receipt.body.receiptNo) && receipt.body.customerName === 'Acme Lanka' && receipt.body.allocations.length === 3, short(receipt.body))
      const none = await json(await unpaidRoute(req('GET', `/api/payments-received/unpaid?customerId=${f.customerId}`)))
      check('no unpaid invoices left', none.body.invoices.length === 0, short(none.body))
    })

    // ================================================================ 4. projects & time
    let projectId = ''
    await step('projects & timesheets', async () => {
      const p = await json(await createProject(req('POST', '/api/projects', {
        name: 'Website revamp', customerId: f.customer2Id, billingMethod: 'task_hourly', budgetType: 'hours', budgetHours: 40,
        tasks: [{ name: 'Design', rate: 1000, billable: true }, { name: 'Internal meeting', rate: 2000, billable: false }],
        members: [{ userId: f.staffId, rate: 1200 }, { userId: f.ownerId, rate: 3000 }],
      })))
      check('create project → 201 PRJ-…', p.status === 201 && /^PRJ-/.test(p.body.projectNo), short(p.body))
      projectId = p.body.id
      const detail = await json(await getProject(req('GET', `/api/projects/${projectId}`), ctx(projectId)))
      const design = detail.body.tasks.find((t: J) => t.name === 'Design').id
      const meeting = detail.body.tasks.find((t: J) => t.name === 'Internal meeting').id
      setTestSession(session(f, 'staff'))
      const t1 = await json(await logTime(req('POST', '/api/time-entries', { projectId, taskId: design, entryDate: today, startTime: '09:00', endTime: '10:30', notes: 'Wireframes' })))
      const t2 = await json(await logTime(req('POST', '/api/time-entries', { projectId, taskId: design, entryDate: today, durationMinutes: 30, billable: false })))
      const t3 = await json(await logTime(req('POST', '/api/time-entries', { projectId, taskId: meeting, entryDate: today, durationMinutes: 45 })))
      const t4 = await json(await logTime(req('POST', '/api/time-entries', { projectId, taskId: design, entryDate: today, durationMinutes: 50 })))
      const foreign = await json(await logTime(req('POST', '/api/time-entries', { projectId, entryDate: today, durationMinutes: 10, userId: f.ownerId })))
      check('member logs time (start/end and duration); cannot log for others', [t1, t2, t3, t4].every((t) => t.status === 201) && foreign.status === 403, short([t1, t2, t3, t4, foreign]))
      const start = await json(await timer(req('POST', '/api/time-entries/timer', { action: 'start', projectId, taskId: design })))
      const twice = await json(await timer(req('POST', '/api/time-entries/timer', { action: 'start', projectId })))
      const running = await json(await getTimer())
      check('timer: start → 201, second start → 409, server keeps it', start.status === 201 && twice.status === 409 && twice.body.code === 'TIMER_RUNNING' && running.body.timer?.id === start.body.timer.id, short([start, twice, running]))
      setTestSession(session(f, 'owner'))
      const pv = await json(await previewInvoice(req('GET', `/api/projects/${projectId}/invoice`), ctx(projectId)))
      // Design: 90 + 50 = 140 min (the 30 min non-billable entry, the non-billable task and the running timer are excluded)
      check('preview: Design 140 min = 2.333 h × 1000 = 2333.00', pv.status === 200 && pv.body.lines.length === 1 && pv.body.lines[0].minutes === 140
        && pv.body.lines[0].hours === 2.333 && pv.body.totalAmount === 2333, short(pv.body))
      const before = await saleCount()
      const inv = await json(await invoiceProject(req('POST', `/api/projects/${projectId}/invoice`, {}), ctx(projectId)))
      const sale = inv.body.saleId ? (await admin.query(`SELECT s.total::float total, s.status, s.customer_id, (SELECT json_agg(json_build_object('q', quantity::float, 'p', unit_price::float, 'n', item_name)) FROM sale_items WHERE sale_id=s.id) lines FROM sales s WHERE id=$1`, [inv.body.saleId])).rows[0] : null
      check('create invoice → sale 2333 on account for the project customer (service line 2.333 h @ 1000)', inv.status === 201 && (await saleCount()) === before + 1 && sale?.total === 2333
        && sale.customer_id === f.customer2Id && sale.lines.length === 1 && sale.lines[0].q === 2.333 && sale.lines[0].p === 1000, short([inv.body, sale]))
      const marked = (await admin.query(`SELECT id, invoiced, sale_id, invoiced_amount::float amt FROM project_time_entries WHERE project_id=$1 ORDER BY created_at`, [projectId])).rows
      check('billed entries marked invoiced with the sale (others untouched)', marked.filter((m) => m.invoiced).length === 2 && marked.filter((m) => m.invoiced).every((m) => m.sale_id === inv.body.saleId)
        && marked.find((m) => m.id === t1.body.id)?.amt === 1500, short(marked))
      const again = await json(await invoiceProject(req('POST', `/api/projects/${projectId}/invoice`, {}), ctx(projectId)))
      check('invoice again → 400 NOTHING_TO_INVOICE', again.status === 400 && again.body.code === 'NOTHING_TO_INVOICE', short(again.body))
      const delInvoiced = await json(await deleteTime(req('DELETE', `/api/time-entries/${t1.body.id}`), ctx(t1.body.id)))
      check('invoiced time cannot be deleted (409)', delInvoiced.status === 409, short(delInvoiced.body))
      setTestSession(session(f, 'staff'))
      const stop = await json(await timer(req('POST', '/api/time-entries/timer', { action: 'stop', notes: 'Logo' })))
      check('stop timer → entry ≥ 1 min, no timer left', stop.status === 200 && stop.body.entry.durationMinutes >= 1 && !stop.body.entry.isRunning && (await json(await getTimer())).body.timer === null, short(stop.body))
      const delOwn = await json(await deleteTime(req('DELETE', `/api/time-entries/${t2.body.id}`), ctx(t2.body.id)))
      check('own uninvoiced entry → deleted (recycle bin)', delOwn.status === 200, short(delOwn.body))
      setTestSession(session(f, 'owner'))
      const rep = await json(await projectReports(req('GET', `/api/projects/reports?fromDate=${today}&toDate=${today}`)))
      const byUser = rep.body.byUser.find((u: J) => u.id === f.staffId)
      check('reports: hours by project / user, unbilled list', rep.status === 200 && rep.body.byProject.some((r: J) => r.id === projectId) && byUser?.minutes >= 90 + 45 + 50 + 1
        && rep.body.unbilled.some((u: J) => u.projectId === projectId), short(rep.body))
      // staff_hourly / project_hourly preview math (pure)
      const entries = [
        { id: 'e1', taskId: 't1', userId: 'u1', durationMinutes: 90, billable: true, invoiced: false, isRunning: false },
        { id: 'e2', taskId: 't1', userId: 'u2', durationMinutes: 45, billable: true, invoiced: false, isRunning: false },
        { id: 'e3', taskId: null, userId: 'u2', durationMinutes: 15, billable: true, invoiced: false, isRunning: false },
      ]
      const tasks = [{ id: 't1', name: 'Build', rate: 999, billable: true }]
      const members = [{ userId: 'u1', name: 'A', rate: 2000 }, { userId: 'u2', name: 'B', rate: 1000 }]
      const staff = previewProjectInvoice({ name: 'P', billingMethod: 'staff_hourly', projectRate: 0, fixedAmount: 0, fixedInvoiced: 0 }, tasks, members, entries)
      check('staff hourly: 1.5 h × 2000 + 1 h × 1000 = 4000', staff.totalAmount === 4000 && staff.lines.length === 2, short(staff))
      const proj = previewProjectInvoice({ name: 'P', billingMethod: 'project_hourly', projectRate: 1500, fixedAmount: 0, fixedInvoiced: 0 }, tasks, members, entries)
      check('project hourly: 2.5 h × 1500 = 3750 (Build + General lines)', proj.totalAmount === 3750 && proj.lines.length === 2, short(proj))
    })

    await step('fixed-price project', async () => {
      const p = await json(await createProject(req('POST', '/api/projects', { name: 'Audit 2026', customerId: f.customerId, billingMethod: 'fixed', fixedAmount: 50000 })))
      const id = p.body.id
      const first = await json(await invoiceProject(req('POST', `/api/projects/${id}/invoice`, { fixedAmount: 20000 }), ctx(id)))
      const tooMuch = await json(await invoiceProject(req('POST', `/api/projects/${id}/invoice`, { fixedAmount: 40000 }), ctx(id)))
      const rest = await json(await invoiceProject(req('POST', `/api/projects/${id}/invoice`, {}), ctx(id)))
      const done = await json(await invoiceProject(req('POST', `/api/projects/${id}/invoice`, {}), ctx(id)))
      check('fixed 50000: bill 20000, 40000 refused, the remaining 30000, then nothing', first.status === 201 && first.body.amount === 20000
        && tooMuch.status === 400 && tooMuch.body.code === 'FIXED_PRICE_EXCEEDED' && rest.status === 201 && rest.body.amount === 30000 && done.status === 400, short([first.body, tooMuch.body, rest.body, done.body]))
      const svc = (await admin.query(`SELECT track_stock FROM items WHERE tenant_id=$1 AND name='Professional services'`, [f.tenantId])).rows
      check('service lines use one non-stock service item', svc.length === 1 && svc[0].track_stock === false, short(svc))
    })

    // ================================================================ 5. tenant isolation
    await step('tenant isolation', async () => {
      setTestSession(session(g, 'owner'))
      const r = await json(await getRecurring(req('GET', `/api/recurring-invoices/${profileId}`), ctx(profileId)))
      const l = await json(await listRecurring(req('GET', '/api/recurring-invoices')))
      const run = await json(await runNow(req('POST', `/api/recurring-invoices/${profileId}/run`), ctx(profileId)))
      check('tenant B: A\'s profile 404, list empty, run refused', r.status === 404 && l.body.data.length === 0 && run.status === 404, short([r, l.body, run]))
      const pr = await json(await getProject(req('GET', `/api/projects/${projectId}`), ctx(projectId)))
      const tm = await json(await logTime(req('POST', '/api/time-entries', { projectId, entryDate: today, durationMinutes: 30 })))
      const iv = await json(await invoiceProject(req('POST', `/api/projects/${projectId}/invoice`, {}), ctx(projectId)))
      check('tenant B: A\'s project 404 (view, time, invoice)', pr.status === 404 && tm.status === 404 && iv.status === 404, short([pr, tm, iv]))
      const pay = await json(await listPayments(req('GET', '/api/payments-received')))
      const up = await json(await unpaidRoute(req('GET', `/api/payments-received/unpaid?customerId=${f.customerId}`)))
      const rec = await json(await recordPayment(req('POST', '/api/payments-received', { customerId: f.customerId, amountReceived: 10, allocations: [], excessToCredit: true })))
      check('tenant B: sees no payments; A\'s customer unknown', pay.body.totals.count === 0 && up.status === 404 && rec.status === 400, short([pay.body.totals, up, rec]))
      const before = Number((await admin.query(`SELECT count(*)::int n FROM sales WHERE tenant_id=$1`, [f.tenantId])).rows[0].n)
      await admin.query(`UPDATE recurring_invoices SET next_run_date = $2 WHERE id=$1`, [profileId, today])
      const c = await runRecurringInvoices({ tenantIds: [g.tenantId] })
      check('cron for tenant B does not touch tenant A', c.profiles === 0 && Number((await admin.query(`SELECT count(*)::int n FROM sales WHERE tenant_id=$1`, [f.tenantId])).rows[0].n) === before, short(c))
      // RLS: as tenant B the app role sees none of A's rows
      const leaked = await withTenantTransaction(g.tenantId, async (_tx, client) => {
        const res = await client.query(`SELECT (SELECT count(*) FROM recurring_invoices) + (SELECT count(*) FROM recurring_invoice_runs) + (SELECT count(*) FROM payment_receipts)
          + (SELECT count(*) FROM projects) + (SELECT count(*) FROM project_time_entries) AS n`)
        return Number(res.rows[0].n)
      })
      check('RLS: tenant B context reads 0 rows of the new tables', leaked === 0, String(leaked))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) for (const t of tenants) await cleanup(admin, t)
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
