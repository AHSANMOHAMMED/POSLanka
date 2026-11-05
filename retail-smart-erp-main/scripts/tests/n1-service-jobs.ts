/**
 * N1 — textile business type, service jobs (repair jobs / tailoring orders / service tickets) and
 * electronics warranty by IMEI (drizzle/0192, 0193):
 *   1. a textile vendor created through the super-admin vendors API gets its preset switches
 *      (variants, service jobs on; installments, warranty, serials off), textile words
 *   2. repair job: walk-in booked with an advance → parts (stock item) + labour → status flow →
 *      convert to invoice: sale + lines, stock deducted, advance applied, balance due, GL balanced,
 *      repair warranty on the invoice lines; no double invoicing; passcode hidden from cashiers
 *   3. warranty check by IMEI / IMEI 2 against the shop's own sale (in / out of warranty) and the
 *      job booked on that IMEI flagged "under warranty"; IMEI Luhn helper
 *   4. branch isolation: staff of branch B neither list nor open branch A's job
 *   5. office service ticket and textile tailoring order (measurements, fabric by the metre)
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/n1-service-jobs.ts
 *
 * Calls the real route handlers (auth mocked) on throw-away vendors; removed at the end unless
 * KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { clearBranchScopeCache } from '@/lib/auth/branch-access'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as listJobs, POST as createJob } from '@/app/api/service-jobs/route'
import { GET as getJob, PUT as updateJob } from '@/app/api/service-jobs/[id]/route'
import { POST as jobStatus } from '@/app/api/service-jobs/[id]/status/route'
import { POST as jobPayment } from '@/app/api/service-jobs/[id]/payments/route'
import { POST as jobInvoice } from '@/app/api/service-jobs/[id]/invoice/route'
import { GET as warrantyCheck } from '@/app/api/service-jobs/warranty-check/route'
import { GET as warrantyCard } from '@/app/api/warranty-card/route'
import { GET as serialSearch } from '@/app/api/serial-numbers/search/route'
import { getTerms } from '@/lib/terminology'
import { isFeatureEnabled, type FeatureFlagsMap } from '@/lib/features/flags'
import { getModuleSidebar } from '@/lib/navigation/module-sidebar'
import { getRolesForBusinessType } from '@/lib/auth/roles'
import { imeiWarning, luhnValid } from '@/lib/utils/imei'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.43.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
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

const VALID_IMEI = '490154203237518' // Luhn-valid test IMEI
const VALID_IMEI2 = '356938035643809'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const adminId = randomUUID()
  const token = randomBytes(32).toString('hex')
  await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'N1 Admin', 'owner')`, [adminId, `n1-owner-${tag}@example.test`])
  await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [adminId, token])

  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const tier = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-')) ?? tiers[0]

  const makeVendor = async (n: number, businessType: string) => {
    setTestCookie('admin_session', token)
    const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
      name: `N1 Shop ${n} ${tag}`, slug: `n1-shop-${n}-${tag}`, email: `n1-shop-${n}-${tag}@example.test`,
      phone: `+9477${String(Date.now() + n).slice(-7)}`, address: 'Colombo', businessType,
      ...(tier ? { tierId: tier.id } : {}), billingCycle: 'monthly', ownerName: 'N1 Owner', ownerEmail: `n1-owner-${n}-${tag}@example.test`, ownerPassword: 'Owner@12345',
    })))
    if (res.status !== 200) throw new Error(`create vendor (${businessType}) failed: ${JSON.stringify(res.body)}`)
    const tenantId = res.body.vendor.id as string
    tenantIds.push(tenantId)
    const owner = (await pg.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' LIMIT 1`, [tenantId])).rows[0].id as string
    const wh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY is_default DESC LIMIT 1`, [tenantId])).rows[0].id as string
    return { tenantId, owner, wh, slug: `n1-shop-${n}-${tag}`, businessType }
  }
  type Shop = Awaited<ReturnType<typeof makeVendor>>
  const asUser = (s: Shop, userId: string, role: string) => {
    clearBranchScopeCache(s.tenantId)
    setTestSession({
      user: {
        id: userId, accountId: null, email: `${role}-${userId.slice(0, 6)}-${s.slug}@example.test`, name: role, role,
        tenantId: s.tenantId, tenantSlug: s.slug, tenantName: 'N1', businessType: s.businessType,
        aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
      },
    } as unknown as Parameters<typeof setTestSession>[0])
  }
  const addUser = async (s: Shop, role: string, branch?: string) => {
    const id = randomUUID()
    await pg.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, $5)`,
      [id, s.tenantId, `${role}-${id.slice(0, 6)}-${tag}@example.test`, `${role} ${id.slice(0, 4)}`, role])
    if (branch) await pg.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1,$2,$3,true)`, [s.tenantId, id, branch])
    return id
  }
  /** Chart of accounts + auto-posting with a Customer Advance account (the setup wizard's job) */
  const setupAccounts = async (s: Shop) => {
    const acc = async (name: string, no: string, root: string, type: string) => {
      const id = randomUUID()
      await pg.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, s.tenantId, name, no, root, type])
      return id
    }
    const a = {
      cash: await acc('Cash', '1100', 'asset', 'cash'), bank: await acc('Bank', '1200', 'asset', 'bank'),
      ar: await acc('Receivable', '1300', 'asset', 'receivable'), stock: await acc('Stock', '1400', 'asset', 'stock'),
      advance: await acc('Customer Advances', '2140', 'liability', 'current_liability'), ap: await acc('Payable', '2100', 'liability', 'payable'),
      income: await acc('Sales', '4000', 'income', 'income_account'), cogs: await acc('COGS', '5000', 'expense', 'cost_of_goods_sold'),
      expense: await acc('Expenses', '5100', 'expense', 'expense_account'),
    }
    const fy = randomUUID()
    const y = new Date().getFullYear()
    await pg.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`, [fy, s.tenantId, `${y}-01-01`, `${y}-12-31`])
    await pg.query(`DELETE FROM accounting_settings WHERE tenant_id = $1`, [s.tenantId])
    await pg.query(
      `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
         default_bank_account_id, default_expense_account_id, default_payable_account_id, default_stock_account_id, default_cogs_account_id,
         default_advance_received_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,false)`,
      [s.tenantId, a.ar, a.income, a.cash, a.bank, a.expense, a.ap, a.stock, a.cogs, a.advance, fy])
    return a
  }
  const newItem = async (s: Shop, name: string, price: number, cost: number, stock: number, extra: { unit?: string; serial?: boolean } = {}) => {
    const id = randomUUID()
    await pg.query(
      `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, unit, track_serial_numbers) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)`,
      [id, s.tenantId, `N1-${id.slice(0, 8)}`, name, cost, price, extra.unit || 'pcs', !!extra.serial])
    if (stock) {
      await withTenantTransaction(s.tenantId, (tx) => applyStockChange(tx, {
        tenantId: s.tenantId, warehouseId: s.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: s.owner,
      }))
    }
    return id
  }
  const stockOf = async (itemId: string, wh: string) =>
    Number((await pg.query(`SELECT current_stock FROM warehouse_stock WHERE item_id = $1 AND warehouse_id = $2`, [itemId, wh])).rows[0]?.current_stock ?? 0)

  try {
    // ---------- pure helpers
    await step('IMEI helper + terminology + roles', async () => {
      check('Luhn: valid test IMEI passes, one digit off fails', luhnValid(VALID_IMEI) && !luhnValid('490154203237519'))
      check('imeiWarning: 15 valid digits → null; dashes allowed', imeiWarning(VALID_IMEI) === null && imeiWarning('49-015420-323751-8') === null)
      check('imeiWarning: wrong length / check digit → warning', !!imeiWarning('12345') && !!imeiWarning('490154203237519'))
      check('terminology: Repair Jobs / Tailoring & Alterations / Service Tickets',
        getTerms('electronics').serviceJobs === 'Repair Jobs' && getTerms('textile').serviceJobs === 'Tailoring & Alterations' && getTerms('office').serviceJobs === 'Service Tickets')
      const sideFor = (bt: string) => getModuleSidebar('selling', bt, 'owner').flatMap((s) => s.items)
      const tx = sideFor('textile').find((i) => i.href === '/service-jobs')
      check('selling menu: textile shows "Tailoring & Alterations", electronics "Repair Jobs", supermarket none',
        tx?.label === 'Tailoring & Alterations' && sideFor('electronics').find((i) => i.href === '/service-jobs')?.label === 'Repair Jobs'
          && !sideFor('supermarket').some((i) => i.href === '/service-jobs'), sideFor('textile').map((i) => i.label))
      check('reports menu: Warranty Tracker shown to electronics',
        getModuleSidebar('reports', 'electronics', 'owner').flatMap((s) => s.items).some((i) => i.href === '/accounting/reports/warranty-tracker'))
      check('technician role offered to electronics and textile shops', getRolesForBusinessType('electronics').includes('technician') && getRolesForBusinessType('textile').includes('technician'))
    })

    // ---------- 1. textile vendor through the super-admin API
    let textile: Shop | null = null
    await step('textile vendor via sys-control', async () => {
      textile = await makeVendor(1, 'textile')
      const t = (await pg.query(`SELECT business_type::text bt, settings FROM tenants WHERE id = $1`, [textile.tenantId])).rows[0]
      const flags = (t?.settings?.featureFlags || {}) as Partial<FeatureFlagsMap>
      check('tenant saved with business_type textile', t?.bt === 'textile', t)
      check('preset: variants, service jobs, barcode labels, layaways on',
        isFeatureEnabled(flags, 'variants') && isFeatureEnabled(flags, 'service_jobs') && isFeatureEnabled(flags, 'barcode_labels') && isFeatureEnabled(flags, 'layaways'), flags)
      check('preset: installments, warranty claims, serials, print jobs, weighing scale off',
        !isFeatureEnabled(flags, 'installments') && !isFeatureEnabled(flags, 'warranty_claims') && !isFeatureEnabled(flags, 'serial_numbers')
          && !isFeatureEnabled(flags, 'print_jobs') && !isFeatureEnabled(flags, 'weighing_scale'), flags)
    })

    // ---------- 2. repair job end to end (electronics)
    const shop = await makeVendor(2, 'electronics')
    const acc = await setupAccounts(shop)
    const cashier = await addUser(shop, 'cashier')
    const tech = await addUser(shop, 'technician')
    const screen = await newItem(shop, `Screen A52 ${tag}`, 8000, 5000, 5)
    let jobId = ''
    let saleId = ''

    await step('repair job: book with advance, parts, status flow', async () => {
      asUser(shop, cashier, 'cashier')
      const c = await json(await createJob(req('POST', '/api/service-jobs', {
        customerName: 'Kamal Silva', customerPhone: '0771112233', title: 'Screen broken',
        deviceType: 'Mobile phone', brand: 'Samsung', model: 'A52', imei: '35-693803-564380-9', passcode: '1-5-9-6',
        faultReported: 'Dropped, screen cracked', accessoriesReceived: 'Charger', conditionChecklist: [{ label: 'Powers on', ok: true }],
        estimateAmount: 12000, repairWarrantyDays: 30,
        advance: { amount: 3000, paymentMethod: 'cash' },
      })))
      check('booked by a cashier → 200, job no SJ-…, received', c.status === 200 && /^SJ-\d{6}$/.test(c.body.jobNo || '') && c.body.status === 'received', c)
      jobId = c.body.id
      check('IMEI stored as digits; passcode not echoed', c.body.imei === VALID_IMEI2 && c.body.passcode === undefined && c.body.hasPasscode === true, c.body)
      check('jobType defaults to repair for electronics; estimate pending', c.body.jobType === 'repair' && c.body.estimateStatus === 'pending', c.body)
      const pay = (await pg.query(`SELECT amount::float a FROM service_job_payments WHERE service_job_id = $1`, [jobId])).rows
      check('advance 3000 recorded', pay.length === 1 && pay[0].a === 3000, pay)
      const adv = (await pg.query(`SELECT SUM(debit)::float d, SUM(credit)::float c FROM gl_entries WHERE voucher_type = 'service_job_advance' AND tenant_id = $1`, [shop.tenantId])).rows[0]
      const advCr = (await pg.query(`SELECT SUM(credit)::float c FROM gl_entries WHERE voucher_type = 'service_job_advance' AND account_id = $1`, [acc.advance])).rows[0]
      check('advance posted: Dr Cash 3000 / Cr Customer Advance 3000', adv?.d === 3000 && adv?.c === 3000 && advCr?.c === 3000, { adv, advCr })

      const g = await json(await getJob(req('GET', `/api/service-jobs/${jobId}`), ctx(jobId)))
      check('cashier opens the job but cannot see the passcode', g.status === 200 && g.body.passcode === null && g.body.hasPasscode === true && g.body.canSeePasscode === false, g.body)
      asUser(shop, tech, 'technician')
      const gt = await json(await getJob(req('GET', `/api/service-jobs/${jobId}`), ctx(jobId)))
      check('technician sees the passcode', gt.status === 200 && gt.body.passcode === '1-5-9-6', gt.body)

      const s1 = await json(await jobStatus(req('POST', `/api/service-jobs/${jobId}/status`, { status: 'diagnosing' }), ctx(jobId)))
      const s2 = await json(await jobStatus(req('POST', `/api/service-jobs/${jobId}/status`, { status: 'awaiting_approval' }), ctx(jobId)))
      const s3 = await json(await jobStatus(req('POST', `/api/service-jobs/${jobId}/status`, { status: 'in_progress', estimateStatus: 'approved' }), ctx(jobId)))
      check('technician moves received → diagnosing → awaiting approval → in progress (estimate approved)',
        s1.status === 200 && s2.status === 200 && s3.status === 200 && s3.body.status === 'in_progress' && s3.body.estimateStatus === 'approved', [s1.status, s2.status, s3.body])
      const tp = await json(await jobPayment(req('POST', `/api/service-jobs/${jobId}/payments`, { amount: 100 }), ctx(jobId)))
      check('technician cannot take money → 403', tp.status === 403, tp)

      // parts + labour added by the technician (full header replace)
      const u = await json(await updateJob(req('PUT', `/api/service-jobs/${jobId}`, {
        customerName: 'Kamal Silva', customerPhone: '0771112233', title: 'Screen broken', deviceType: 'Mobile phone', brand: 'Samsung', model: 'A52',
        imei: VALID_IMEI2, estimateAmount: 12000, repairWarrantyDays: 30, diagnosis: 'LCD + digitizer',
        lines: [
          { lineType: 'part', itemId: screen, description: 'A52 screen', quantity: 1, unitPrice: 8000 },
          { lineType: 'labour', description: 'Screen replacement', quantity: 1, unitPrice: 2500 },
        ],
      }), ctx(jobId)))
      check('lines saved → total 10500, balance 7500; passcode kept', u.status === 200 && Number(u.body.total) === 10500 && Number(u.body.balanceDue) === 7500 && u.body.hasPasscode === true, u.body)
      const kept = (await pg.query(`SELECT passcode FROM service_jobs WHERE id = $1`, [jobId])).rows[0]?.passcode
      check('passcode still stored after an edit that did not send it', kept === '1-5-9-6', kept)
      const r = await json(await jobStatus(req('POST', `/api/service-jobs/${jobId}/status`, { status: 'ready', note: 'Tested OK' }), ctx(jobId)))
      check('→ ready', r.status === 200 && r.body.status === 'ready', r)
      const hist = (await pg.query(`SELECT from_status f, to_status t FROM service_job_history WHERE service_job_id = $1 ORDER BY created_at`, [jobId])).rows
      check('history: received + 4 moves', hist.length >= 5 && hist[0].t === 'received' && hist[hist.length - 1].t === 'ready', hist)
      asUser(shop, cashier, 'cashier')
      const bad = await json(await jobPayment(req('POST', `/api/service-jobs/${jobId}/payments`, { amount: 99999 }), ctx(jobId)))
      check('payment above the balance → 400', bad.status === 400, bad)
    })

    await step('convert to invoice', async () => {
      asUser(shop, cashier, 'cashier')
      const before = await stockOf(screen, shop.wh)
      const inv = await json(await jobInvoice(req('POST', `/api/service-jobs/${jobId}/invoice`, { paymentMethod: 'cash', paidAmount: 5000 }), ctx(jobId)))
      check('deliver & invoice collecting 5000 → 200', inv.status === 200 && !!inv.body.sale?.id, inv)
      saleId = inv.body.sale?.id
      const sale = (await pg.query(`SELECT total::float t, paid_amount::float p, status::text s, warehouse_id w FROM sales WHERE id = $1`, [saleId])).rows[0]
      check('sale: total 10500, paid 8000 (advance 3000 + 5000), partial, in the job branch', sale?.t === 10500 && sale?.p === 8000 && sale?.s === 'partial' && sale?.w === shop.wh, sale)
      const lines = (await pg.query(`SELECT item_id, quantity::float q, total::float t, warranty_until::text wu FROM sale_items WHERE sale_id = $1 ORDER BY total DESC`, [saleId])).rows
      check('sale lines: part (item) 8000 + labour 2500, repair warranty stamped', lines.length === 2 && lines[0].item_id === screen && lines[0].t === 8000 && lines[1].item_id === null && lines[1].t === 2500 && !!lines[0].wu, lines)
      const after = await stockOf(screen, shop.wh)
      check('stock of the part 5 → 4', before === 5 && after === 4, { before, after })
      const pays = (await pg.query(`SELECT amount::float a, reference r FROM payments WHERE sale_id = $1 ORDER BY amount`, [saleId])).rows
      check('payments: advance 3000 + 5000 collected', pays.length === 2 && pays.some((p) => p.a === 3000 && String(p.r).startsWith('Advance')) && pays.some((p) => p.a === 5000), pays)
      const job = (await pg.query(`SELECT status, sale_id, balance_due::float b, repair_warranty_until::text wu FROM service_jobs WHERE id = $1`, [jobId])).rows[0]
      check('job delivered, linked, balance due 2500, warranty until set', job?.status === 'delivered' && job?.sale_id === saleId && job?.b === 2500 && !!job?.wu, job)
      const gl = (await pg.query(`SELECT SUM(debit)::numeric d, SUM(credit)::numeric c FROM gl_entries WHERE tenant_id = $1`, [shop.tenantId])).rows[0]
      check('GL balanced overall (debits = credits)', Number(gl.d) > 0 && Number(gl.d) === Number(gl.c), gl)
      const saleGl = (await pg.query(
        `SELECT g.account_id, a.account_type t, SUM(g.debit)::float d, SUM(g.credit)::float c
           FROM gl_entries g JOIN chart_of_accounts a ON a.id = g.account_id WHERE g.voucher_id = $1 GROUP BY g.account_id, a.account_type`, [saleId])).rows
      const by = (id: string) => saleGl.find((r) => r.account_id === id) || { d: 0, c: 0 }
      // the cash collected goes to the Cash mode of payment's ledger (seeded with the vendor)
      const cashDr = saleGl.filter((r) => r.t === 'cash' || r.t === 'bank').reduce((x, r) => x + r.d, 0)
      check('sale GL: income 10500 Cr, AR balance 2500 Dr, advance account settled 3000 Dr, cash 5000 Dr, COGS 5000',
        by(acc.income).c === 10500 && by(acc.advance).d === 3000 && cashDr === 5000 && by(acc.ar).d - by(acc.ar).c === 2500 && by(acc.cogs).d === 5000,
        saleGl)
      const again = await json(await jobInvoice(req('POST', `/api/service-jobs/${jobId}/invoice`, { paymentMethod: 'cash' }), ctx(jobId)))
      check('second invoice refused (400)', again.status === 400, again)
    })

    // ---------- 3. warranty by IMEI
    await step('warranty check by IMEI', async () => {
      const phone = await newItem(shop, `Phone X ${tag}`, 60000, 50000, 0, { serial: true })
      const sn = randomUUID()
      await pg.query(`INSERT INTO item_serial_numbers (id, tenant_id, item_id, warehouse_id, serial_number, imei, imei2, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'sold')`,
        [sn, shop.tenantId, phone, shop.wh, `SN-${tag}`, VALID_IMEI, '356938035643817'])
      const sid = randomUUID()
      await pg.query(`INSERT INTO sales (id, tenant_id, invoice_no, warehouse_id, customer_name, subtotal, total, paid_amount, status) VALUES ($1,$2,$3,$4,'Nimal',60000,60000,60000,'completed')`,
        [sid, shop.tenantId, `N1-INV-${tag}`, shop.wh])
      const until = new Date(Date.now() + 200 * 86400_000).toISOString().slice(0, 10)
      await pg.query(`INSERT INTO sale_items (tenant_id, sale_id, item_id, item_name, quantity, unit_price, total, serial_number_ids, warranty_months, warranty_until)
        VALUES ($1,$2,$3,'Phone X',1,60000,60000,$4::jsonb,12,$5)`, [shop.tenantId, sid, phone, JSON.stringify([sn]), until])

      asUser(shop, cashier, 'cashier')
      const w = await json(await warrantyCheck(req('GET', `/api/service-jobs/warranty-check?q=${VALID_IMEI}`)))
      check('IMEI → found, in warranty, sale + until', w.status === 200 && w.body.found && w.body.inWarranty && w.body.saleId === sid && w.body.warrantyUntil === until, w)
      const w2 = await json(await warrantyCheck(req('GET', '/api/service-jobs/warranty-check?q=35-693803-564381-7')))
      check('IMEI 2 typed with dashes → same unit', w2.status === 200 && w2.body.found && w2.body.serialNumberId === sn, w2)
      const none = await json(await warrantyCheck(req('GET', `/api/service-jobs/warranty-check?q=111111111111116`)))
      check('unknown IMEI → not found', none.status === 200 && none.body.found === false, none)
      const j = await json(await createJob(req('POST', '/api/service-jobs', { customerName: 'Nimal', title: 'No sound', imei: VALID_IMEI })))
      check('job on that IMEI → under warranty, linked to the unit and sale', j.status === 200 && j.body.underWarranty === true && j.body.serialNumberId === sn && j.body.warrantySaleId === sid, j)
      await pg.query(`UPDATE sale_items SET warranty_until = '2020-01-01' WHERE sale_id = $1`, [sid])
      const exp = await json(await warrantyCheck(req('GET', `/api/service-jobs/warranty-check?q=SN-${tag}`)))
      check('expired → found, not in warranty (by serial)', exp.status === 200 && exp.body.found && !exp.body.inWarranty, exp)
      const card = await json(await warrantyCard(req('GET', `/api/warranty-card?serialNumberId=${sn}`)))
      check('warranty card from the unit: one line with IMEI', card.status === 200 && card.body.lines?.length === 1 && card.body.lines[0].units?.[0]?.imei === VALID_IMEI, card)
      asUser(shop, shop.owner, 'owner')
      const ss = await json(await serialSearch(req('GET', `/api/serial-numbers/search?search=${VALID_IMEI.slice(0, 9)}`)))
      check('serial-number search finds the unit by IMEI', ss.status === 200 && (ss.body.data || []).some((r: J) => r.id === sn && r.imei === VALID_IMEI), ss)
    })

    // ---------- 4. branch isolation
    await step('branch isolation', async () => {
      const whB = randomUUID()
      await pg.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1,$2,'Kandy','KDY',false)`, [whB, shop.tenantId])
      const staffB = await addUser(shop, 'cashier', whB)
      const staffA = await addUser(shop, 'cashier', shop.wh)
      asUser(shop, staffA, 'cashier')
      const a = await json(await createJob(req('POST', '/api/service-jobs', { customerName: 'Branch A customer', title: 'Fan noisy', warehouseId: shop.wh })))
      check('branch A staff books in branch A', a.status === 200 && a.body.warehouseId === shop.wh, a)
      asUser(shop, staffB, 'cashier')
      const g = await json(await getJob(req('GET', `/api/service-jobs/${a.body.id}`), ctx(a.body.id)))
      check('branch B staff cannot open it (403)', g.status === 403, g)
      const st = await json(await jobStatus(req('POST', `/api/service-jobs/${a.body.id}/status`, { status: 'diagnosing' }), ctx(a.body.id)))
      check('branch B staff cannot move it (403)', st.status === 403, st)
      const l = await json(await listJobs(req('GET', '/api/service-jobs?status=all')))
      check('branch B list excludes branch A jobs', l.status === 200 && !(l.body.data || []).some((r: J) => r.id === a.body.id), (l.body.data || []).map((r: J) => r.jobNo))
      const wrong = await json(await createJob(req('POST', '/api/service-jobs', { customerName: 'X', title: 'Y', warehouseId: shop.wh })))
      check('branch B staff cannot book into branch A (403)', wrong.status === 403, wrong)
      asUser(shop, shop.owner, 'owner')
      const lo = await json(await listJobs(req('GET', `/api/service-jobs?status=all&search=${encodeURIComponent('Branch A customer')}`)))
      check('owner sees it', lo.status === 200 && (lo.body.data || []).some((r: J) => r.id === a.body.id), lo.body)
    })

    // ---------- 5. office ticket + textile tailoring order
    await step('office service ticket', async () => {
      const office = await makeVendor(3, 'office')
      const t = (await pg.query(`SELECT settings FROM tenants WHERE id = $1`, [office.tenantId])).rows[0]
      check('office preset: service jobs on', isFeatureEnabled(t?.settings?.featureFlags, 'service_jobs'), t?.settings?.featureFlags)
      asUser(office, office.owner, 'owner')
      const due = new Date(Date.now() + 3 * 86400_000).toISOString()
      const j = await json(await createJob(req('POST', '/api/service-jobs', {
        customerName: 'ABC Holdings', title: 'Quarterly VAT return', assignedTo: office.owner, promisedAt: due,
        lines: [{ lineType: 'labour', description: 'VAT return filing', quantity: 1, unitPrice: 15000 }],
      })))
      check('ticket created as jobType service, assigned, due', j.status === 200 && j.body.jobType === 'service' && j.body.assignedTo === office.owner && !!j.body.promisedAt && Number(j.body.total) === 15000, j)
      const mine = await json(await listJobs(req('GET', '/api/service-jobs?mine=true&status=open')))
      check('"mine" list shows it', mine.status === 200 && (mine.body.data || []).some((r: J) => r.id === j.body.id), mine.body)
      const done = await json(await jobStatus(req('POST', `/api/service-jobs/${j.body.id}/status`, { status: 'ready' }), ctx(j.body.id)))
      const inv = await json(await jobInvoice(req('POST', `/api/service-jobs/${j.body.id}/invoice`, { paymentMethod: 'cash', paidAmount: 15000 }), ctx(j.body.id)))
      check('done → invoiced (no accounting set up: still works, sale completed)', done.status === 200 && inv.status === 200 && inv.body.sale?.status === 'completed', inv)
    })

    await step('textile tailoring order', async () => {
      if (!textile) throw new Error('no textile vendor')
      const tx: Shop = textile
      const fabric = await newItem(tx, `Linen fabric ${tag}`, 1200, 700, 50, { unit: 'm' })
      asUser(tx, tx.owner, 'owner')
      const j = await json(await createJob(req('POST', '/api/service-jobs', {
        customerName: 'Sita', customerPhone: '0712223344', title: 'Shirt stitching', garment: 'Shirt',
        measurements: { Chest: '38', Sleeve: '24.5' }, fabricSupplied: false, fittingDate: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10),
        lines: [
          { lineType: 'part', itemId: fabric, description: 'Linen fabric', quantity: 2.35, unitPrice: 1200 },
          { lineType: 'labour', description: 'Stitching', quantity: 1, unitPrice: 1800 },
        ],
        advance: { amount: 2000, paymentMethod: 'cash' },
      })))
      check('tailoring order: jobType tailoring, measurements kept, 2.35 m × 1200 + 1800 = 4620', j.status === 200 && j.body.jobType === 'tailoring'
        && j.body.measurements?.Chest === '38' && Number(j.body.total) === 4620, j)
      const inv = await json(await jobInvoice(req('POST', `/api/service-jobs/${j.body.id}/invoice`, { paymentMethod: 'cash', paidAmount: 2620 }), ctx(j.body.id)))
      check('invoiced, paid in full', inv.status === 200 && inv.body.sale?.status === 'completed', inv)
      const left = await stockOf(fabric, tx.wh)
      check('fabric stock 50 → 47.65 m (4 dp)', Math.abs(left - 47.65) < 0.0001, left)
      const tz = (await pg.query(`SELECT count(*)::int n FROM service_jobs WHERE tenant_id = $1`, [tx.tenantId])).rows[0].n
      check('jobs stay in their own tenant', tz === 1, tz)
    })
  } finally {
    await closeAllPools().catch(() => undefined)
    if (!process.env.KEEP_TEST_DATA) await cleanup(pg, tenantIds)
    await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [adminId]).catch(() => undefined)
    await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [adminId]).catch(() => undefined)
    await pg.query(`DELETE FROM super_admins WHERE id = $1`, [adminId]).catch(() => undefined)
    await pg.end()
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

async function cleanup(pg: Client, tenantIds: string[]) {
  if (!tenantIds.length) return
  const tables = (await pg.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
  )).rows.map((r) => r.table_name as string)
  const accountIds = (await pg.query(`SELECT DISTINCT account_id FROM account_tenants WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])).rows.map((r) => r.account_id)
  let pending = tables
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: string[] = []
    for (const t of pending) {
      try { await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]) } catch { next.push(t) }
    }
    pending = next
  }
  await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds]).catch((e) => console.error('tenants cleanup:', e.message))
  if (accountIds.length) {
    await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
    await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
  }
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
