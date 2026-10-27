/**
 * L5 — loose ends of the print studio / quotation / shift work:
 *   1. money taken outside the POS sale screen (print-job advances + refunds, print-job and
 *      work-order invoice payments, layaway payments) lands on the cashier's open shift
 *      (expected cash, Z report by source); no open shift → recorded without one (drizzle/0187)
 *   2. print-job walk-in customers found / created by phone (SL local form)
 *   3. POS size-line add-ons folded into the line price (src/components/pos/size-line.ts)
 *   4. quotation → POS sale linkage (quotations.converted_sale_id, one quotation → one sale)
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_le DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l5-loose-ends.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on throw-away tenants, prints
 * PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { POST as postSale } from '@/app/api/sales/route'
import { POST as openShift, } from '@/app/api/pos-opening-entries/route'
import { GET as getShift, PUT as updateShift } from '@/app/api/pos-opening-entries/[id]/route'
import { POST as closeShift } from '@/app/api/pos-opening-entries/[id]/close/route'
import { POST as createPrintJob } from '@/app/api/print-jobs/route'
import { POST as printJobPayment } from '@/app/api/print-jobs/[id]/payments/route'
import { POST as printJobInvoice } from '@/app/api/print-jobs/[id]/invoice/route'
import { POST as printJobStatus } from '@/app/api/print-jobs/[id]/status/route'
import { POST as workOrderInvoice } from '@/app/api/work-orders/[id]/invoice/route'
import { POST as layawayPayment } from '@/app/api/layaways/[id]/payments/route'
import { normalizeSlPhone } from '@/lib/customers/walk-in'
import { foldSizeLine, sizeLineName } from '@/components/pos/size-line'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; ownerId: string; cashierId: string; acc: Record<string, string> }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

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
      id, accountId: null, email: `${who}-${f.slug}@example.test`, name: who, role: who === 'owner' ? 'owner' : 'cashier',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'L5', businessType: 'print_studio',
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
const short = (b: unknown) => JSON.stringify(b).slice(0, 500)

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `l5-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), ownerId: randomUUID(), cashierId: randomUUID(), acc: {} }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'L5 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.ownerId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Cashier', 'cashier')`,
    [f.cashierId, tenantId, `cashier-${slug}@example.test`])
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
  f.acc.expense = await acc('Expenses', '5100', 'expense', 'expense_account')
  f.acc.overShort = await acc('Cash over/short', '5200', 'expense', 'expense_account')
  f.acc.ap = await acc('Payable', '2100', 'liability', 'payable')
  const fy = randomUUID()
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
    [id, f.tenantId, `L5-${id.slice(0, 8)}`, name, price])
  if (stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: f.ownerId,
    }))
  }
  return id
}

const job = (over: Record<string, unknown> = {}) => ({
  customerName: 'Nimal Perera', customerPhone: '077 123 4567', title: 'Banner',
  lines: [{ description: 'Flex banner', pricingMode: 'unit', quantity: 1, rate: 1000 }],
  ...over,
})

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    // ---------- pure: SL phone form, size-line folding
    await step('pure helpers', async () => {
      const forms = ['0771234567', '+94 77 123 4567', '94771234567', '771234567', '0094771234567', '077-123-4567']
      check('SL phone forms normalise to 0771234567', forms.every((p) => normalizeSlPhone(p) === '0771234567'), JSON.stringify(forms.map(normalizeSlPhone)))
      check('too-short phone → null', normalizeSlPhone('123') === null)
      const spec = {
        pricingMode: 'area' as const, areaUnit: 'sqft' as const, width: 6, height: 3, sizeUnit: 'ft' as const, pieces: 2, sides: 1,
        minChargeArea: null, baseName: 'Flex', rate: 120,
        finishing: [{ code: 'eyelets', rate: 10, count: 4 }, { code: 'lamination', rate: 40 }],
      }
      const folded = foldSizeLine(spec, 120)
      // 36 sq ft × 120 = 4320, eyelets 8 × 10 = 80, lamination 36 × 40 = 1440 → 5840
      check('size line keeps the billable area as quantity (36)', folded.billQty === 36, JSON.stringify(folded))
      check('add-ons folded into the price: 36 × 162.22 = 5840', folded.amount === 5840 && Math.abs(folded.total - 5840) <= 0.18 && folded.unitPrice === 162.22, JSON.stringify(folded))
      check('notes carry the add-on breakdown', !!folded.notes && folded.notes.includes('Eyelets 8 × 10.00 = 80.00') && folded.notes.includes('Lamination'), String(folded.notes))
      check('line name lists the add-ons', sizeLineName(spec, 36).endsWith('+ Eyelets, Lamination'), sizeLineName(spec, 36))
      const plain = foldSizeLine({ ...spec, finishing: undefined }, 120)
      check('no add-ons → catalog rate, no notes', plain.unitPrice === 120 && plain.total === 4320 && plain.notes === undefined, JSON.stringify(plain))
      const exact = foldSizeLine({ ...spec, finishing: [{ code: 'design_fee', rate: 500, count: 1 }] }, 120)
      check('fold searches an exact cent price when one exists', Math.abs(exact.unitPrice * 36 - exact.amount) < 0.18, JSON.stringify(exact))
    })

    const f = await makeTenant(admin, 'main')
    tenants.push(f.tenantId)
    const X = await newItem(admin, f, 'Mug print', 1000, 50)
    const P1 = randomUUID()
    const P2 = randomUUID()
    await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Counter 1',$3)`, [P1, f.tenantId, f.wh])
    await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Office',$3)`, [P2, f.tenantId, f.wh])
    await admin.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1,$2,$3,true)`, [f.tenantId, P1, f.cashierId])
    await admin.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1,$2,$3,true)`, [f.tenantId, P2, f.ownerId])

    let shift = ''
    let job1 = ''
    let job2 = ''
    let customerId = ''

    // ---------- 2. walk-in customers + 1. advances on the shift
    await step('print job advances + walk-in customers', async () => {
      setTestSession(session(f, 'cashier'))
      const o = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P1, openingBalances: [{ paymentMethod: 'cash', amount: 1000 }] })))
      check('cashier opens a shift (float 1000)', o.status === 200, short(o.body))
      shift = o.body.id

      const j1 = await json(await createPrintJob(req('POST', '/api/print-jobs', job({ advance: { amount: 500, paymentMethod: 'cash' } }))))
      check('walk-in job with advance 500 → 200', j1.status === 200, short(j1.body))
      job1 = j1.body.id
      customerId = j1.body.customerId
      const c = (await admin.query(`SELECT name, phone FROM customers WHERE id=$1`, [customerId])).rows[0]
      check('walk-in name + phone → customer created (phone 0771234567)', !!customerId && c?.name === 'Nimal Perera' && c?.phone === '0771234567', JSON.stringify(c))
      const adv = (await admin.query(`SELECT pos_opening_entry_id s FROM print_job_payments WHERE print_job_id=$1`, [job1])).rows
      check('booking advance linked to the cashier\'s open shift', adv.length === 1 && adv[0].s === shift, JSON.stringify(adv))

      const j2 = await json(await createPrintJob(req('POST', '/api/print-jobs', job({ customerName: 'N. Perera', customerPhone: '+94 77 123 4567', title: 'Cards' }))))
      check('same phone in +94 form → links the existing customer', j2.status === 200 && j2.body.customerId === customerId, short(j2.body))
      job2 = j2.body.id
      const j3 = await json(await createPrintJob(req('POST', '/api/print-jobs', job({ customerName: 'Sunil', customerPhone: '0719999999', saveCustomer: false }))))
      check('saveCustomer: false → no customer linked', j3.status === 200 && !j3.body.customerId, short(j3.body))
      const n = (await admin.query(`SELECT count(*)::int n FROM customers WHERE tenant_id=$1`, [f.tenantId])).rows[0].n
      check('exactly one customer created', n === 1, String(n))

      const p = await json(await printJobPayment(req('POST', `/api/print-jobs/${job1}/payments`, { amount: 200, paymentMethod: 'cash' }), ctx(job1)))
      check('part payment 200 → 200', p.status === 200, short(p.body))
      const p2 = await json(await printJobPayment(req('POST', `/api/print-jobs/${job2}/payments`, { amount: 300, paymentMethod: 'cash' }), ctx(job2)))
      check('advance 300 on job 2 → 200', p2.status === 200 && p2.body.payment?.posOpeningEntryId === shift, short(p2.body))
      const card = await json(await printJobPayment(req('POST', `/api/print-jobs/${job2}/payments`, { amount: 100, paymentMethod: 'card' }), ctx(job2)))
      check('card advance 100 on job 2 → 200', card.status === 200, short(card.body))
    })

    await step('print job cancel refund + invoice on the shift', async () => {
      setTestSession(session(f, 'cashier'))
      const cancel = await json(await printJobStatus(req('POST', `/api/print-jobs/${job2}/status`, { status: 'cancelled', refundAdvances: true, cancellationReason: 'Customer changed mind' }), ctx(job2)))
      check('cancel job 2 with refund → 200', cancel.status === 200, short(cancel.body))
      const ref = (await admin.query(`SELECT refund_pos_opening_entry_id s FROM print_job_payments WHERE print_job_id=$1`, [job2])).rows
      check('refunds linked to the refunding shift', ref.length === 2 && ref.every((r) => r.s === shift), JSON.stringify(ref))

      const inv = await json(await printJobInvoice(req('POST', `/api/print-jobs/${job1}/invoice`, { paymentMethod: 'cash', paidAmount: 300 }), ctx(job1)))
      check('deliver & invoice job 1 collecting 300 → 200', inv.status === 200 && inv.body.sale?.id, short(inv.body))
      const pays = (await admin.query(`SELECT amount::float a, pos_opening_entry_id s, reference r FROM payments WHERE sale_id=$1 ORDER BY created_at, amount`, [inv.body.sale?.id])).rows
      const collected = pays.filter((x) => !String(x.r || '').startsWith('Advance'))
      const carried = pays.filter((x) => String(x.r || '').startsWith('Advance'))
      check('balance collected on the shift; carried-over advances not re-linked',
        collected.length === 1 && collected[0].a === 300 && collected[0].s === shift && carried.length === 2 && carried.every((x) => x.s === null), JSON.stringify(pays))
    })

    await step('layaway + work-order payments on the shift', async () => {
      setTestSession(session(f, 'cashier'))
      const lw = randomUUID()
      await admin.query(
        `INSERT INTO layaways (id, tenant_id, layaway_no, customer_id, status, subtotal, tax_amount, total, deposit_amount, paid_amount, balance_due, created_by)
         VALUES ($1,$2,'LAY-L5',$3,'active',1000,0,1000,0,0,1000,$4)`, [lw, f.tenantId, customerId, f.ownerId])
      const lp = await json(await layawayPayment(req('POST', `/api/layaways/${lw}/payments`, { amount: 250, paymentMethod: 'cash' }), ctx(lw)))
      check('layaway payment 250 → 200', lp.status === 200 || lp.status === 201, short(lp.body))
      const lrow = (await admin.query(`SELECT pos_opening_entry_id s FROM layaway_payments WHERE layaway_id=$1`, [lw])).rows
      check('layaway payment linked to the shift', lrow.length === 1 && lrow[0].s === shift, JSON.stringify(lrow))

      // work order invoiced by the owner, who has no open shift yet → recorded without a shift
      setTestSession(session(f, 'owner'))
      const wo = randomUUID()
      await admin.query(`INSERT INTO work_orders (id, tenant_id, order_no, warehouse_id, status, subtotal, tax_amount, total) VALUES ($1,$2,'WO-L5',$3,'completed',600,0,600)`, [wo, f.tenantId, f.wh])
      await admin.query(`INSERT INTO work_order_services (tenant_id, work_order_id, description, hours, rate, amount) VALUES ($1,$2,'Labour',1,600,600)`, [f.tenantId, wo])
      const wi = await json(await workOrderInvoice(req('POST', `/api/work-orders/${wo}/invoice`, { paymentMethod: 'cash', paidAmount: 600 }), ctx(wo)))
      check('owner without a shift invoices a work order → 200 (no error)', wi.status === 200, short(wi.body))
      const saleId = wi.body.sale?.id || wi.body.id || wi.body.saleId
      const wp = (await admin.query(`SELECT p.pos_opening_entry_id s FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.work_order_id=$1`, [wo])).rows
      check('…its payment has no shift', wp.length === 1 && wp[0].s === null, `${saleId} ${JSON.stringify(wp)}`)

      // with an owner shift open, the next work order payment goes to it
      const o = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: P2, openingBalances: [{ paymentMethod: 'cash', amount: 0 }] })))
      const wo2 = randomUUID()
      await admin.query(`INSERT INTO work_orders (id, tenant_id, order_no, warehouse_id, status, subtotal, tax_amount, total) VALUES ($1,$2,'WO-L5B',$3,'completed',400,0,400)`, [wo2, f.tenantId, f.wh])
      await admin.query(`INSERT INTO work_order_services (tenant_id, work_order_id, description, hours, rate, amount) VALUES ($1,$2,'Labour',1,400,400)`, [f.tenantId, wo2])
      const wi2 = await json(await workOrderInvoice(req('POST', `/api/work-orders/${wo2}/invoice`, { paymentMethod: 'cash', paidAmount: 400 }), ctx(wo2)))
      const wp2 = (await admin.query(`SELECT p.pos_opening_entry_id s FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.work_order_id=$1`, [wo2])).rows
      check('work order payment with an open owner shift → linked to it', wi2.status === 200 && wp2.length === 1 && wp2[0].s === o.body.id, `${short(wi2.body)} ${JSON.stringify(wp2)}`)
      const g = await json(await getShift(req('GET', `/api/pos-opening-entries/${o.body.id}`), ctx(o.body.id)))
      check('owner shift expected cash 0 + 400 = 400 (work order invoice)', g.body.paymentMethodBreakdown?.expectedAmounts?.cash === 400
        && g.body.outsideCollections?.bySource?.work_order_invoice === 400, short(g.body.outsideCollections))
      const cancel = await json(await updateShift(req('PUT', `/api/pos-opening-entries/${o.body.id}`, { status: 'cancelled', cancellationReason: 'test' }), ctx(o.body.id)))
      check('a shift that received outside payments cannot be cancelled', cancel.status === 400, short(cancel.body))
    })

    await step('shift expected cash + close report', async () => {
      setTestSession(session(f, 'cashier'))
      const s = await json(await postSale(req('POST', '/api/sales', {
        warehouseId: f.wh, posOpeningEntryId: shift, cartItems: [{ itemId: X, name: 'Mug print', quantity: 1, unitPrice: 1000 }],
        paymentMethod: 'cash', subtotal: 1000, discount: 0, tax: 0, total: 1000, amountPaid: 1000, creditAmount: 0,
      })))
      check('POS cash sale 1000 on the shift → 200', s.status === 200, short(s.body))
      // float 1000 + sale 1000 + advances 500 + 200 + 300 − refunds 300 + invoice 300 + layaway 250 = 3250 cash; card 100 − 100 = 0
      const g = await json(await getShift(req('GET', `/api/pos-opening-entries/${shift}`), ctx(shift)))
      const exp = g.body.paymentMethodBreakdown?.expectedAmounts || {}
      check('expected cash = 3250', exp.cash === 3250, short(exp))
      check('expected card = 0 (advance taken and refunded)', (exp.card || 0) === 0, short(exp))
      const by = g.body.outsideCollections?.bySource || {}
      check('outside collections by source', by.print_job_advance === 1100 && by.print_job_refund === -400 && by.print_job_invoice === 300 && by.layaway_payment === 250,
        short(by))
      const c = await json(await closeShift(req('POST', `/api/pos-opening-entries/${shift}/close`, { actualAmounts: [{ paymentMethod: 'cash', amount: 3250 }] }), ctx(shift)))
      check('close counted 3250 → no variance', c.status === 200 && c.body.summary?.totalVariance === 0, short(c.body.summary || c.body))
      check('Z report lists the outside collections', c.body.zReport?.outsideCollections?.total === 1250 && c.body.zReport?.outsideCollections?.count >= 7, short(c.body.zReport?.outsideCollections))
      check('ledger tie-out of the POS vouchers still OK', c.body.zReport?.ledger?.tiesOut === true, short(c.body.zReport?.ledger))
      const rec = (await admin.query(`SELECT expected_amount::float e FROM pos_closing_reconciliation WHERE closing_entry_id=$1 AND payment_method='cash'`, [c.body.closingEntry?.id])).rows[0]
      check('reconciliation row stores expected cash 3250', rec?.e === 3250, JSON.stringify(rec))
    })

    // ---------- 4. quotation → POS sale
    await step('quotation conversion linkage', async () => {
      setTestSession(session(f, 'owner'))
      const q = randomUUID()
      await admin.query(`INSERT INTO quotations (id, tenant_id, quotation_no, status, subtotal, total) VALUES ($1,$2,'QT-L5','converted',1000,1000)`, [q, f.tenantId])
      const body = (extra: Record<string, unknown>) => ({
        warehouseId: f.wh, cartItems: [{ itemId: X, name: 'Mug print', quantity: 1, unitPrice: 1000 }],
        paymentMethod: 'cash', subtotal: 1000, discount: 0, tax: 0, total: 1000, amountPaid: 1000, creditAmount: 0, ...extra,
      })
      const s = await json(await postSale(req('POST', '/api/sales', body({ quotationId: q }))))
      const row = (await admin.query(`SELECT status, converted_sale_id c FROM quotations WHERE id=$1`, [q])).rows[0]
      check('sale from a quotation → converted_sale_id = sale, status converted', s.status === 200 && row?.c === s.body.id && row?.status === 'converted', `${short(s.body)} ${JSON.stringify(row)}`)
      const before = (await admin.query(`SELECT count(*)::int n FROM sales WHERE tenant_id=$1`, [f.tenantId])).rows[0].n
      const again = await json(await postSale(req('POST', '/api/sales', body({ quotationId: q }))))
      const after = (await admin.query(`SELECT count(*)::int n FROM sales WHERE tenant_id=$1`, [f.tenantId])).rows[0].n
      check('second sale from the same quotation → 409, no sale created', again.status === 409 && again.body.code === 'QUOTATION_ALREADY_CONVERTED' && before === after, `${short(again.body)} ${before}/${after}`)

      const g = await makeTenant(admin, 'other')
      tenants.push(g.tenantId)
      const foreign = randomUUID()
      await admin.query(`INSERT INTO quotations (id, tenant_id, quotation_no, status) VALUES ($1,$2,'QT-OTHER','sent')`, [foreign, g.tenantId])
      const x = await json(await postSale(req('POST', '/api/sales', body({ quotationId: foreign }))))
      const fr = (await admin.query(`SELECT converted_sale_id c FROM quotations WHERE id=$1`, [foreign])).rows[0]
      check('another tenant\'s quotation → 400 QUOTATION_NOT_FOUND, left untouched', x.status === 400 && x.body.code === 'QUOTATION_NOT_FOUND' && fr?.c === null, `${short(x.body)} ${JSON.stringify(fr)}`)
      const cq = randomUUID()
      await admin.query(`INSERT INTO quotations (id, tenant_id, quotation_no, status) VALUES ($1,$2,'QT-CXL','cancelled')`, [cq, f.tenantId])
      const cx = await json(await postSale(req('POST', '/api/sales', body({ quotationId: cq }))))
      check('cancelled quotation → 400 QUOTATION_NOT_CONVERTIBLE', cx.status === 400 && cx.body.code === 'QUOTATION_NOT_CONVERTIBLE', short(cx.body))
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
