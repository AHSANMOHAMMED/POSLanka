/**
 * P1 — DB performance fixes (batched allocation sums, bounded lists, SQL-side search).
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/p1-perf-queries.ts
 *
 * Seeds a throw-away tenant with sales/purchases, party journal entries and partial
 * payment_entry_references allocations (both reference_id and source_je_item_id), then calls the
 * real route handlers (auth mocked via the w8 harness) and checks the exact outstanding amounts,
 * aging buckets, party names and response shapes of:
 *   AR / AP aging reports, getAgedPayables, outstanding-invoices, payment-reconciliation,
 * plus appointments search/pagination in SQL, kitchen-orders history limit, the general-ledger
 * 5000-row cap and the stock-movements count. Exits non-zero on failure. KEEP_TEST_DATA=1 keeps it.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenant } from '@/lib/db'
import { GET as arReport } from '@/app/api/accounting/reports/accounts-receivable/route'
import { GET as apReport } from '@/app/api/accounting/reports/accounts-payable/route'
import { GET as outstandingInvoices } from '@/app/api/accounting/payment-entries/outstanding-invoices/route'
import { GET as reconciliation } from '@/app/api/accounting/payment-reconciliation/route'
import { GET as listAppointments } from '@/app/api/appointments/route'
import { GET as listKitchen } from '@/app/api/kitchen-orders/route'
import { GET as generalLedger } from '@/app/api/reports/general-ledger/route'
import { GET as listMovements } from '@/app/api/stock-movements/route'
import { getAgedPayables } from '@/lib/reports/inventory'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}
function req(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' })
}
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 600)
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }
const ago = (days: number) => new Date(Date.now() - days * 86400000)

interface Fx {
  tenantId: string; slug: string; ownerId: string
  c1: string; c2: string; c3: string; s1: string; s2: string
  sale1: string; sale2: string; pur1: string
  jeAR: string; jeARpay: string; jeAR2: string; jeAP: string; jeAPpay: string; jeAP2: string
  pe1: string; acctAR: string; acctGL: string; item1: string; item2: string
}

async function seed(admin: Client): Promise<Fx> {
  const id = () => randomUUID()
  const f: Fx = {
    tenantId: id(), slug: '', ownerId: id(), c1: id(), c2: id(), c3: id(), s1: id(), s2: id(),
    sale1: id(), sale2: id(), pur1: id(), jeAR: id(), jeARpay: id(), jeAR2: id(), jeAP: id(), jeAPpay: id(), jeAP2: id(),
    pe1: id(), acctAR: id(), acctGL: id(), item1: id(), item2: id(),
  }
  f.slug = `p1-${f.tenantId.slice(0, 8)}`
  const q = (text: string, params: unknown[]) => admin.query(text, params)
  const t = f.tenantId
  await q(`INSERT INTO tenants (id, name, slug, email) VALUES ($1,'P1 test',$2,$3)`, [t, f.slug, `${f.slug}@example.test`])
  await q(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,'x','Owner','owner')`, [f.ownerId, t, `owner-${f.slug}@example.test`])
  for (const [cid, name] of [[f.c1, 'Perera Traders'], [f.c2, 'Kamal Stores'], [f.c3, 'Silva Stores']]) {
    await q(`INSERT INTO customers (id, tenant_id, name) VALUES ($1,$2,$3)`, [cid, t, name])
  }
  for (const [sid, name] of [[f.s1, 'Lanka Wholesale'], [f.s2, 'Ceylon Imports']]) {
    await q(`INSERT INTO suppliers (id, tenant_id, name, balance) VALUES ($1,$2,$3,0)`, [sid, t, name])
  }
  await q(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,'Receivable','1300','asset','receivable')`, [f.acctAR, t])
  await q(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,'Busy bank','1210','asset','bank')`, [f.acctGL, t])

  // Sales: 1000 paid 400 (today) and 500 unpaid (45 days old)
  await q(`INSERT INTO sales (id, tenant_id, invoice_no, customer_id, customer_name, total, paid_amount, status, created_at) VALUES ($1,$2,'INV-P1-1',$3,'Perera Traders',1000,400,'pending',$4)`, [f.sale1, t, f.c1, ago(0)])
  await q(`INSERT INTO sales (id, tenant_id, invoice_no, customer_id, customer_name, total, paid_amount, status, created_at) VALUES ($1,$2,'INV-P1-2',$3,'Perera Traders',500,0,'pending',$4)`, [f.sale2, t, f.c1, ago(45)])
  // Purchase: 2000 paid 500
  await q(`INSERT INTO purchases (id, tenant_id, purchase_no, supplier_id, total, paid_amount, status, created_at) VALUES ($1,$2,'PUR-P1-1',$3,2000,500,'pending',$4)`, [f.pur1, t, f.s1, ago(0)])

  // Journal entries (submitted, 10 days ago) with party lines
  const je = id()
  await q(`INSERT INTO journal_entries (id, tenant_id, entry_number, posting_date, status, created_by) VALUES ($1,$2,'JE-P1-1',$3,'submitted',$4)`, [je, t, day(-10), f.ownerId])
  const line = (lid: string, debit: number, credit: number, pt: string, pid: string) =>
    q(`INSERT INTO journal_entry_items (id, tenant_id, journal_entry_id, account_id, debit, credit, party_type, party_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [lid, t, je, f.acctAR, debit, credit, pt, pid])
  await line(f.jeAR, 300, 0, 'customer', f.c1) // receivable 300, 100 allocated → 200
  await line(f.jeARpay, 0, 200, 'customer', f.c1) // JE payment 200, 50 used → 150 unallocated
  await line(f.jeAR2, 80, 0, 'customer', f.c2) // receivable only (name via JE path)
  await line(f.jeAP, 0, 400, 'supplier', f.s1) // payable 400, 150 allocated → 250
  await line(f.jeAPpay, 300, 0, 'supplier', f.s1) // JE payment 300, 100 used → 200 unallocated
  await line(f.jeAP2, 0, 60, 'supplier', f.s2) // payable only (name via JE path)

  const ref = (type: string, refId: string, alloc: number, source: string | null) =>
    q(`INSERT INTO payment_entry_references (tenant_id, reference_type, reference_id, total_amount, outstanding_amount, allocated_amount, source_je_item_id) VALUES ($1,$2,$3,$4,$4,$5,$6)`, [t, type, refId, alloc, alloc, source])
  await ref('journal_entry', f.jeAR, 60, null)
  await ref('journal_entry', f.jeAR, 40, null) // two rows: the grouped SUM must add them
  await ref('sale', f.sale1, 50, f.jeARpay)
  await ref('journal_entry', f.jeAP, 150, null)
  await ref('purchase', f.pur1, 100, f.jeAPpay)

  // Unallocated customer payment (party name snapshot differs from the customer record)
  await q(`INSERT INTO payment_entries (id, tenant_id, entry_number, payment_type, posting_date, party_type, party_id, party_name, received_amount, unallocated_amount, status, created_by)
           VALUES ($1,$2,'PE-P1-1','receive',$3,'customer',$4,'Old Name',70,70,'submitted',$5)`, [f.pe1, t, day(-5), f.c3, f.ownerId])

  // Items + stock movements (count with/without search)
  await q(`INSERT INTO items (id, tenant_id, item_code, name) VALUES ($1,$2,'P1A','Zebra widget'),($3,$2,'P1B','Plain bolt')`, [f.item1, t, f.item2])
  for (const it of [f.item1, f.item2, f.item2]) {
    await q(`INSERT INTO stock_movements (tenant_id, item_id, type, quantity, qty_change) VALUES ($1,$2,'in',1,1)`, [t, it])
  }
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

const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.005

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const f = await seed(admin)
  setTestSession({
    user: {
      id: f.ownerId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'P1', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
  const asOf = day(1)

  try {
    await step('AR report', async () => {
      const r = await json(await arReport(req(`/api/accounting/reports/accounts-receivable?asOfDate=${asOf}`)))
      check('AR: 200 with data/totals/filters', r.status === 200 && Array.isArray(r.body.data) && !!r.body.totals && r.body.filters?.asOfDate === asOf, short(r.body))
      const rows: J[] = r.body.data || []
      const c1 = rows.find((x) => x.customerId === f.c1)
      const c2 = rows.find((x) => x.customerId === f.c2)
      const c3 = rows.find((x) => x.customerId === f.c3)
      check('AR: row keys unchanged', !!c1 && ['customerId', 'customerName', 'current', 'days31to60', 'days61to90', 'over90', 'total', 'invoices', 'payments'].every((k) => k in c1), short(c1))
      check('AR: Perera total 1150 (600 + 500 + JE 200 − JE payment 150)', near(c1?.total, 1150) && near(c1?.current, 650) && near(c1?.days31to60, 500), short(c1))
      const jeInv = c1?.invoices.find((i: J) => i.id === f.jeAR)
      check('AR: JE receivable paid 100 (two allocation rows summed), outstanding 200', near(jeInv?.paidAmount, 100) && near(jeInv?.outstanding, 200), short(jeInv))
      const jePay = c1?.payments.find((p: J) => p.id === f.jeARpay)
      check('AR: JE payment allocated 50, unallocated 150', near(jePay?.allocatedAmount, 50) && near(jePay?.unallocated, 150) && jePay?.sourceType === 'journal_entry', short(jePay))
      check('AR: JE-only customer named from the customers table', c2?.customerName === 'Kamal Stores' && near(c2?.total, 80), short(c2))
      check('AR: payment-only customer named from the customers table, −70', c3?.customerName === 'Silva Stores' && near(c3?.total, -70), short(c3))
      check('AR: grand total 1160', near(r.body.totals?.total, 1160), short(r.body.totals))
    })

    await step('AP report', async () => {
      const r = await json(await apReport(req(`/api/accounting/reports/accounts-payable?asOfDate=${asOf}`)))
      check('AP: 200 with data/totals/filters', r.status === 200 && Array.isArray(r.body.data) && !!r.body.totals, short(r.body))
      const rows: J[] = r.body.data || []
      const s1 = rows.find((x) => x.supplierId === f.s1)
      const s2 = rows.find((x) => x.supplierId === f.s2)
      check('AP: row keys unchanged', !!s1 && ['supplierId', 'supplierName', 'current', 'days31to60', 'days61to90', 'over90', 'total', 'invoices', 'payments'].every((k) => k in s1), short(s1))
      check('AP: Lanka Wholesale total 1550 (1500 + JE 250 − JE payment 200)', near(s1?.total, 1550) && s1?.supplierName === 'Lanka Wholesale', short(s1))
      const jeInv = s1?.invoices.find((i: J) => i.id === f.jeAP)
      check('AP: JE payable paid 150, outstanding 250', near(jeInv?.paidAmount, 150) && near(jeInv?.outstanding, 250), short(jeInv))
      const jePay = s1?.payments.find((p: J) => p.id === f.jeAPpay)
      check('AP: JE payment allocated 100, unallocated 200', near(jePay?.allocatedAmount, 100) && near(jePay?.unallocated, 200), short(jePay))
      check('AP: JE-only supplier named from the suppliers table', s2?.supplierName === 'Ceylon Imports' && near(s2?.total, 60), short(s2))
    })

    await step('getAgedPayables', async () => {
      const out = await withTenant(f.tenantId, (db) => getAgedPayables(db, f.tenantId, { asOfDate: asOf }))
      const rows = (out as J).data || out
      const list: J[] = Array.isArray(rows) ? rows : (rows as J).results || []
      const s1 = list.find((x) => x.supplierId === f.s1)
      const s2 = list.find((x) => x.supplierId === f.s2)
      check('aged payables: Lanka Wholesale 1750 (1500 + JE 250)', near(s1?.total, 1750), short(out))
      check('aged payables: JE-only supplier named Ceylon Imports, 60', s2?.supplierName === 'Ceylon Imports' && near(s2?.total, 60), short(s2))
    })

    await step('outstanding invoices', async () => {
      const c = await json(await outstandingInvoices(req(`/api/accounting/payment-entries/outstanding-invoices?partyType=customer&partyId=${f.c1}`)))
      const list: J[] = Array.isArray(c.body) ? c.body as unknown as J[] : []
      const je = list.find((i) => i.referenceId === f.jeAR)
      check('outstanding (customer): 3 docs, JE paid 100 / outstanding 200', c.status === 200 && list.length === 3 && near(je?.paidAmount, 100) && near(je?.outstandingAmount, 200), short(c.body))
      const s = await json(await outstandingInvoices(req(`/api/accounting/payment-entries/outstanding-invoices?partyType=supplier&partyId=${f.s1}`)))
      const sl: J[] = Array.isArray(s.body) ? s.body as unknown as J[] : []
      const sje = sl.find((i) => i.referenceId === f.jeAP)
      check('outstanding (supplier): purchase 1500 + JE 250', s.status === 200 && sl.length === 2 && near(sje?.outstandingAmount, 250) && near(sl.find((i) => i.referenceId === f.pur1)?.outstandingAmount, 1500), short(s.body))
    })

    await step('payment reconciliation', async () => {
      const c = await json(await reconciliation(req(`/api/accounting/payment-reconciliation?partyType=customer&partyId=${f.c1}`)))
      const pay = (c.body.payments || []).find((p: J) => p.id === f.jeARpay)
      const inv = (c.body.invoices || []).find((i: J) => i.referenceId === f.jeAR)
      check('reconciliation (customer): JE payment unallocated "150", JE invoice outstanding 200', c.status === 200 && pay?.unallocatedAmount === '150' && pay?.sourceType === 'journal_entry_item' && near(inv?.outstandingAmount, 200) && c.body.invoices.length === 3, short(c.body))
      const s = await json(await reconciliation(req(`/api/accounting/payment-reconciliation?partyType=supplier&partyId=${f.s1}`)))
      const spay = (s.body.payments || []).find((p: J) => p.id === f.jeAPpay)
      const sinv = (s.body.invoices || []).find((i: J) => i.referenceId === f.jeAP)
      check('reconciliation (supplier): JE payment unallocated "200", JE invoice outstanding 250', s.status === 200 && spay?.unallocatedAmount === '200' && near(sinv?.outstandingAmount, 250), short(s.body))
    })

    await step('appointments search in SQL', async () => {
      const t = f.tenantId
      const veh = randomUUID(); const st = randomUUID()
      await admin.query(`INSERT INTO vehicles (id, tenant_id, customer_id, make, model, license_plate) VALUES ($1,$2,$3,'Toyota','Axio','WP-CAB-1234')`, [veh, t, f.c2])
      await admin.query(`INSERT INTO service_types (id, tenant_id, name) VALUES ($1,$2,'Oil change')`, [st, t])
      const ins = (cust: string | null, vehicle: string | null, svc: string | null, notes: string | null, d: number) =>
        admin.query(`INSERT INTO appointments (tenant_id, customer_id, vehicle_id, service_type_id, notes, scheduled_date, scheduled_time) VALUES ($1,$2,$3,$4,$5,$6,'10:00')`, [t, cust, vehicle, svc, notes, day(d)])
      await ins(f.c1, null, null, null, 1)
      await ins(f.c2, veh, null, null, 2)
      await ins(f.c3, null, st, null, 3)
      await ins(null, null, null, 'Brake noise 100%', 4)
      await ins(f.c3, null, null, 'nothing', 5)
      const s = async (term: string, extra = '') => json(await listAppointments(req(`/api/appointments?search=${encodeURIComponent(term)}${extra}`)))
      const byCust = await s('perera')
      check('appointments: customer-name search → 1, same shape', byCust.status === 200 && byCust.body.data?.length === 1 && byCust.body.pagination?.total === 1 && byCust.body.pagination?.totalPages === 1, short(byCust.body))
      const byPlate = await s('cab-12')
      check('appointments: plate search → 1', byPlate.body.pagination?.total === 1, short(byPlate.body.pagination))
      const byMake = await s('toyo')
      check('appointments: vehicle make search → 1', byMake.body.pagination?.total === 1, short(byMake.body.pagination))
      const bySvc = await s('OIL')
      check('appointments: service type search (case-insensitive) → 1', bySvc.body.pagination?.total === 1, short(bySvc.body.pagination))
      const byNote = await s('100%')
      check('appointments: notes search with % treated literally → 1', byNote.body.pagination?.total === 1, short(byNote.body.pagination))
      const paged = await s('stores', '&pageSize=1&page=2')
      check('appointments: search paginated in SQL (3 "stores" matches, page 2 of 3 has 1)', paged.body.pagination?.total === 3 && paged.body.pagination?.totalPages === 3 && paged.body.data?.length === 1, short(paged.body.pagination))
      const all = await json(await listAppointments(req('/api/appointments')))
      check('appointments: no search → all 5', all.body.pagination?.total === 5 && all.body.data?.length === 5, short(all.body.pagination))
      const allFlag = await json(await listAppointments(req('/api/appointments?all=true&search=stores')))
      check('appointments: all=true still returns a plain array', Array.isArray(allFlag.body) && (allFlag.body as unknown as J[]).length === 3, short(allFlag.body))
    })

    await step('kitchen orders history limit', async () => {
      const ro = randomUUID()
      await admin.query(`INSERT INTO restaurant_orders (id, tenant_id, order_no, created_by) VALUES ($1,$2,'RO-P1',$3)`, [ro, f.tenantId, f.ownerId])
      for (let i = 0; i < 4; i++) {
        await admin.query(`INSERT INTO kitchen_orders (tenant_id, restaurant_order_id, status, created_at) VALUES ($1,$2,$3,$4)`,
          [f.tenantId, ro, i === 0 ? 'served' : 'pending', ago(4 - i)])
      }
      const lim = await json(await listKitchen(req('/api/kitchen-orders?limit=2')))
      const rows: J[] = Array.isArray(lim.body) ? lim.body as unknown as J[] : []
      const asc = rows.length === 2 && new Date(rows[0].createdAt).getTime() < new Date(rows[1].createdAt).getTime()
      const newest = rows.every((r) => new Date(r.createdAt).getTime() > ago(2.5).getTime())
      check('kitchen: limit=2 → the 2 newest, returned in the requested (asc) order', lim.status === 200 && asc && newest, short(rows.map((r) => r.createdAt)))
      const def = await json(await listKitchen(req('/api/kitchen-orders')))
      check('kitchen: default limit returns all 4', Array.isArray(def.body) && (def.body as unknown as J[]).length === 4, short(def.body))
      const act = await json(await listKitchen(req('/api/kitchen-orders?activeOnly=true&limit=1')))
      check('kitchen: activeOnly is not limited (3 active)', Array.isArray(act.body) && (act.body as unknown as J[]).length === 3, short(act.body))
    })

    await step('general ledger cap', async () => {
      await admin.query(
        `INSERT INTO gl_entries (tenant_id, account_id, posting_date, voucher_type, voucher_id, debit, credit)
         SELECT $1, $2, $3::date, 'journal_entry', gen_random_uuid(), 1, 0 FROM generate_series(1, 5003)`, [f.tenantId, f.acctGL, day(-1)])
      const r = await json(await generalLedger(req(`/api/reports/general-ledger?fromDate=${day(-30)}&toDate=${day(0)}&accountId=${f.acctGL}`)))
      check('GL: capped at 5000 rows, truncated: true, totals cover all 5003', r.status === 200 && r.body.data?.length === 5000 && r.body.truncated === true && near(r.body.summary?.totalDebit, 5003) && near(r.body.summary?.closingBalance, 5003), short({ ...r.body, data: r.body.data?.length }))
      const small = await json(await generalLedger(req(`/api/reports/general-ledger?fromDate=${day(-30)}&toDate=${day(0)}&accountId=${f.acctAR}`)))
      check('GL: small account → no truncated flag', small.status === 200 && Array.isArray(small.body.data) && !('truncated' in small.body), short(small.body))
    })

    await step('stock movements count', async () => {
      const all = await json(await listMovements(req('/api/stock-movements')))
      check('stock movements: total 3 without search', all.status === 200 && all.body.pagination?.total === 3, short(all.body.pagination))
      const s = await json(await listMovements(req('/api/stock-movements?search=zebra')))
      check('stock movements: search joins items → total 1', s.status === 200 && s.body.pagination?.total === 1, short(s.body.pagination))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) await cleanup(admin, f.tenantId)
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
