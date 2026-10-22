/**
 * H2 — Sri Lanka VAT compliance integration test: country tax seeding + compliance fix, tax
 * categories, tax invoices (receipt model), credit / debit notes with GL, VAT schedules + GL
 * reconciliation, e-invoice outbox.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_r8 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/h2-tax.ts
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
import { getTaxSuggestionForCountryCode, getCountryTaxTemplatesForCode } from '@/lib/setup/country-wise-tax'
import { seedCountryTaxTemplates } from '@/lib/setup/seed-tax-templates'
import { buildReceiptModel, SAMPLE_RECEIPT_SALE, SAMPLE_TAX_INVOICE_SALE, type ReceiptSaleSource } from '@/lib/print/receipt-model'
import { buildReceiptEscPosFromModel } from '@/lib/print/escpos/receipt-from-model'
import { renderReceiptHtmlSync } from '@/lib/print/receipt-html'
import { renderDocumentHtml } from '@/lib/pdf/documents'
import { runEinvoiceSync, backoffMs } from '@/lib/einvoice/outbox'
import { disabledTransmitter, type EInvoiceTransmitter } from '@/lib/einvoice/transmitter'
import { POST as postSale } from '@/app/api/sales/route'
import { GET as getSale } from '@/app/api/sales/[id]/route'
import { GET as getCompliance, POST as postCompliance } from '@/app/api/accounting/tax-templates/compliance/route'
import { POST as postTemplate } from '@/app/api/accounting/tax-templates/route'
import { PUT as putTemplate } from '@/app/api/accounting/tax-templates/[id]/route'
import { GET as listCreditNotes, POST as postCreditNote } from '@/app/api/credit-notes/route'
import { GET as getCreditNote, PATCH as patchCreditNote } from '@/app/api/credit-notes/[id]/route'
import { POST as postDebitNote } from '@/app/api/debit-notes/route'
import { GET as vatSchedule } from '@/app/api/reports/tax-vat-schedule/route'
import { GET as taxReport } from '@/app/api/reports/tax-report/route'
import { GET as getEinvoice, PUT as putEinvoice } from '@/app/api/einvoice/settings/route'
import { POST as cronEinvoice } from '@/app/api/cron/einvoice-sync/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx {
  tenantId: string; slug: string; wh: string; userId: string; customerId: string
  acct: { cash: string; bank: string; ar: string; income: string; vat: string }
  tpl: { std: string; zero: string; exempt: string }
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

function session(f: { tenantId: string; slug: string; userId: string }) {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'H2', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response | undefined): Promise<{ status: number; body: J; text: string; headers: Headers | null }> {
  if (!res) return { status: 0, body: { error: 'no response' }, text: '', headers: null }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body, text, headers: res.headers }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 400)
const close = (a: number, b: number) => Math.abs(a - b) < 0.006
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))
function contains(hay: Uint8Array, s: string) {
  const needle = ascii(s)
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

async function makeTenant(admin: Client, label: string, opts: { taxId?: string | null; accounting?: boolean } = {}): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `h2-${label}-${tenantId.slice(0, 8)}`
  const f = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() } as Fx
  await admin.query(`INSERT INTO tenants (id, name, slug, email, country, tax_id, address) VALUES ($1, 'H2 Traders', $2, $3, 'LK', $4, '1 Galle Rd, Colombo 03')`,
    [tenantId, slug, `${slug}@example.test`, opts.taxId === undefined ? '134567890-7000' : opts.taxId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name, tax_id, address) VALUES ($1, $2, 'Lanka Hardware (Pvt) Ltd', '114999888-7000', '5 Kandy Rd, Kurunegala')`,
    [f.customerId, tenantId])
  if (opts.accounting !== false) {
    const acc = async (name: string, no: string, root: string, type: string) => {
      const id = randomUUID()
      await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, tenantId, name, no, root, type])
      return id
    }
    f.acct = {
      cash: await acc('Cash', '1100', 'asset', 'cash'),
      bank: await acc('Bank', '1200', 'asset', 'bank'),
      ar: await acc('Receivable', '1300', 'asset', 'receivable'),
      income: await acc('Sales', '4000', 'income', 'income_account'),
      vat: await acc('VAT Payable', '2120', 'liability', 'tax'),
    }
    const fy = randomUUID()
    await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
      [fy, tenantId, `${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() + 1}-12-31`])
    await admin.query(
      `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
         default_bank_account_id, default_tax_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,false)`, [tenantId, f.acct.ar, f.acct.income, f.acct.cash, f.acct.bank, f.acct.vat, fy])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, taxTemplateId: string | null, stock = 50) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, tax_template_id)
     VALUES ($1, $2, $3, $4, 0, $5, true, $6)`,
    [id, f.tenantId, `H2-${id.slice(0, 8)}`, name, price, taxTemplateId])
  await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
    tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: f.userId,
  }))
  return id
}

async function glFor(admin: Client, voucherId: string) {
  return (await admin.query(`SELECT account_id, debit::float d, credit::float c, party_id FROM gl_entries WHERE voucher_id=$1`, [voucherId])).rows as Array<{ account_id: string; d: number; c: number; party_id: string | null }>
}
const net = (rows: Array<{ account_id: string; d: number; c: number }>, acct: string) =>
  Math.round(rows.filter((r) => r.account_id === acct).reduce((s, r) => s + r.d - r.c, 0) * 100) / 100

function localToday() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return d
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    // ---------- 1. country tax data
    await step('country tax data', async () => {
      const lk = getTaxSuggestionForCountryCode('LK')
      check('Sri Lanka default VAT suggestion is 18%', lk.taxRate === 18, String(lk.taxRate))
      const defs = getCountryTaxTemplatesForCode('LK')
      check('LK templates: VAT 18% (default, standard), VAT 0% Zero-rated, VAT Exempt; no NBT',
        defs.length === 3 && defs[0].templateName === 'VAT 18%' && defs[0].isDefault === true && defs[0].taxCategory === 'standard'
        && defs.some((d) => d.templateName === 'VAT 0% Zero-rated' && d.taxCategory === 'zero_rated')
        && defs.some((d) => d.templateName === 'VAT Exempt' && d.taxCategory === 'exempt')
        && !defs.some((d) => /NBT/i.test(d.taxName)), short(defs))
      const withOpt = getCountryTaxTemplatesForCode('LK', true)
      check('SSCL 2.5% available as an optional, non-default template', withOpt.some((d) => d.taxName === 'SSCL' && d.taxRate === 2.5 && !d.isDefault), short(withOpt))
    })

    // ---------- 2. compliance warning + one-click fix (existing tenant on VAT 15% + NBT)
    const legacy = await makeTenant(admin, 'legacy', { accounting: false })
    tenants.push(legacy.tenantId)
    await step('compliance', async () => {
      setTestSession(session(legacy))
      await admin.query(`UPDATE tenants SET tax_rate = 15 WHERE id=$1`, [legacy.tenantId])
      const vat = randomUUID(), nbt = randomUUID()
      await admin.query(`INSERT INTO tax_templates (id, tenant_id, name) VALUES ($1,$3,'VAT 15%'), ($2,$3,'NBT 2%')`, [vat, nbt, legacy.tenantId])
      await admin.query(`INSERT INTO tax_template_items (tenant_id, tax_template_id, tax_name, rate) VALUES ($1,$2,'VAT',15), ($1,$3,'NBT',2)`, [legacy.tenantId, vat, nbt])
      const g = await json(await getCompliance())
      const codes = (g.body.issues || []).map((i: J) => i.code).sort()
      check('LK tenant on VAT 15% + NBT gets warnings', g.status === 200 && JSON.stringify(codes) === JSON.stringify(['legacy_tax_rate', 'missing_zero_rated_exempt', 'nbt_abolished', 'vat_rate_outdated']), short(g.body))
      const still = (await admin.query(`SELECT rate::float r FROM tax_template_items WHERE tax_template_id=$1`, [vat])).rows[0].r
      check('checking does not change the configured rate', still === 15)
      const fix = await json(await postCompliance(req('POST', '/x', { action: 'fix' })))
      check('one-click fix → 200 without remaining issues', fix.status === 200 && (fix.body.issues || []).length === 0, short(fix.body))
      const t = (await admin.query(`SELECT t.name, t.is_active, t.tax_category, i.tax_name, i.rate::float r FROM tax_templates t LEFT JOIN tax_template_items i ON i.tax_template_id=t.id WHERE t.tenant_id=$1 ORDER BY t.name`, [legacy.tenantId])).rows
      const v = t.find((r) => r.name === 'VAT 18%')
      check('VAT 15% template moved to 18% and renamed', !!v && v.r === 18 && v.is_active, short(t))
      check('NBT template deactivated', t.some((r) => r.name === 'NBT 2%' && !r.is_active), short(t))
      check('zero-rated and exempt templates seeded', t.some((r) => r.tax_category === 'zero_rated') && t.some((r) => r.tax_category === 'exempt'), short(t))
      const tr = Number((await admin.query(`SELECT tax_rate FROM tenants WHERE id=$1`, [legacy.tenantId])).rows[0].tax_rate)
      check('legacy flat tax rate 15 → 18', tr === 18, String(tr))
      const seed = await json(await postCompliance(req('POST', '/x', { action: 'seed' })))
      check('seeding again is idempotent (nothing created)', seed.status === 200 && seed.body.created.length === 0, short(seed.body))
    })

    // ---------- 3. main VAT-registered tenant
    const f = await makeTenant(admin, 'main')
    tenants.push(f.tenantId)
    setTestSession(session(f))
    await step('template seeding + category API', async () => {
      const seeded = await withTenantTransaction(f.tenantId, (tx) => seedCountryTaxTemplates(tx, f.tenantId, 'LK'))
      check('seed creates the 3 LK templates and sets the default', seeded.created.length === 3 && !!seeded.defaultTemplateId, short(seeded))
      const rows = (await admin.query(`SELECT t.id, t.name, t.tax_category, i.account_id FROM tax_templates t JOIN tax_template_items i ON i.tax_template_id=t.id WHERE t.tenant_id=$1`, [f.tenantId])).rows
      f.tpl = {
        std: rows.find((r) => r.name === 'VAT 18%').id,
        zero: rows.find((r) => r.name === 'VAT 0% Zero-rated').id,
        exempt: rows.find((r) => r.name === 'VAT Exempt').id,
      }
      check('seeded template items post to the default tax account', rows.every((r) => r.account_id === f.acct.vat), short(rows))
      const def = (await admin.query(`SELECT default_tax_template_id FROM accounting_settings WHERE tenant_id=$1`, [f.tenantId])).rows[0]
      check('default sales tax template = VAT 18%', def.default_tax_template_id === f.tpl.std)
      const c = await json(await postTemplate(req('POST', '/api/accounting/tax-templates', { name: 'Exports', taxCategory: 'zero_rated', items: [{ taxName: 'VAT', rate: 0 }] })))
      check('POST tax template stores taxCategory', c.status === 200 && c.body.taxCategory === 'zero_rated', short(c.body))
      const u = await json(await putTemplate(req('PUT', '/x', { taxCategory: 'out_of_scope' }), ctx(c.body.id)))
      check('PUT tax template updates taxCategory', u.status === 200 && u.body.taxCategory === 'out_of_scope', short(u.body))
      const bad = await json(await postTemplate(req('POST', '/api/accounting/tax-templates', { name: 'Bad', taxCategory: 'reduced' })))
      check('unknown taxCategory → 400', bad.status === 400, short(bad.body))
    })

    const A = await newItem(admin, f, 'Office Chair', 1000, null)
    const Z = await newItem(admin, f, 'Export Tea', 500, null)
    const E = await newItem(admin, f, 'Rice 5kg', 300, null)
    await admin.query(`UPDATE items SET tax_template_id = CASE id WHEN $1::uuid THEN $4::uuid WHEN $2::uuid THEN $5::uuid ELSE $6::uuid END WHERE id IN ($1,$2,$3)`,
      [A, Z, E, f.tpl.std, f.tpl.zero, f.tpl.exempt])

    let saleId = ''
    let invoiceNo = ''
    let saleBody: J = {}
    await step('VAT sale', async () => {
      const r = await json(await postSale(req('POST', '/api/sales', {
        warehouseId: f.wh, customerId: f.customerId, discount: 0, creditAmount: 0,
        cartItems: [
          { itemId: A, name: 'Office Chair', quantity: 1, unitPrice: 1000 },
          { itemId: Z, name: 'Export Tea', quantity: 1, unitPrice: 500 },
          { itemId: E, name: 'Rice 5kg', quantity: 1, unitPrice: 300 },
        ],
        paymentMethod: 'cash', subtotal: 1800, tax: 180, total: 1980, amountPaid: 1980,
      })))
      check('sale with 18% / zero-rated / exempt lines → 200', r.status === 200, short(r.body))
      saleId = r.body.id
      invoiceNo = r.body.invoiceNo
      const g = await json(await getSale(req('GET', `/api/sales/${saleId}`), ctx(saleId)))
      saleBody = g.body
      check('sale tax 180', g.status === 200 && Number(g.body.taxAmount) === 180, short(g.body))
    })

    // ---------- 4. tax invoice receipt
    await step('tax invoice receipt', async () => {
      const tenantInfo = { name: 'H2 Traders', address: '1 Galle Rd, Colombo 03', taxId: '134567890-7000', currency: 'LKR' }
      const model = buildReceiptModel({ sale: saleBody as unknown as ReceiptSaleSource, tenant: tenantInfo, settings: { ...(await import('@/lib/print/receipt-settings')).DEFAULT_RECEIPT_SETTINGS, showTaxId: false, showAddress: false } })
      check('title TAX INVOICE', model.title === 'TAX INVOICE', String(model.title))
      check('supplier address and VAT reg no printed even when toggled off',
        model.business.lines.includes('1 Galle Rd, Colombo 03') && model.business.lines.includes('VAT Reg No: 134567890-7000'), short(model.business))
      const meta = Object.fromEntries(model.meta.map((m) => [m.label, m.value]))
      check('invoice no, buyer name, address, VAT no in meta',
        meta['Invoice No'] === invoiceNo && meta['Buyer'] === 'Lanka Hardware (Pvt) Ltd' && meta['Buyer VAT No'] === '114999888-7000' && meta['Address'] === '5 Kandy Rd, Kurunegala', short(model.meta))
      const chair = model.items.find((i) => i.name === 'Office Chair')
      check('per-line VAT (18% / 180 on the standard-rated line)', !!chair && chair.vatRate === 18 && chair.vatAmount === 180, short(model.items))
      check('totals excl. / VAT / incl.', !!model.taxInvoice && model.taxInvoice.totalExclVat === 1800 && model.taxInvoice.totalVat === 180 && model.taxInvoice.totalInclVat === 1980, short(model.taxInvoice))
      for (const w of [58, 80] as const) {
        const bytes = buildReceiptEscPosFromModel(model, { paperWidth: w })
        check(`ESC/POS ${w}mm: TAX INVOICE, VAT Reg No, line VAT and excl./incl. totals`,
          contains(bytes, 'TAX INVOICE') && contains(bytes, 'VAT Reg No') && contains(bytes, 'VAT 18%') && contains(bytes, 'Total excl. VAT') && contains(bytes, 'Total incl. VAT'))
      }
      const html = renderReceiptHtmlSync(model, 80)
      check('HTML receipt has the tax invoice block', html.includes('TAX INVOICE') && html.includes('Total excl. VAT') && html.includes('Buyer VAT No'))
      const plain = buildReceiptModel({ sale: SAMPLE_RECEIPT_SALE, tenant: tenantInfo })
      check('no VAT on the sale → ordinary receipt (no tax invoice block)', plain.title === null && plain.taxInvoice === null && plain.meta[0].label === 'Receipt')
      const unregistered = buildReceiptModel({ sale: SAMPLE_TAX_INVOICE_SALE, tenant: { name: 'Small Shop' } })
      check('seller without VAT number → not a tax invoice', unregistered.taxInvoice === null && unregistered.title === null)
      const ret = buildReceiptModel({ sale: { ...SAMPLE_TAX_INVOICE_SALE, isReturn: true, invoiceNo: 'RTN-1', originalInvoiceNo: 'INV-000124', total: -2360, taxAmount: -360 }, tenant: tenantInfo })
      check('VAT return → CREDIT NOTE referencing the original invoice',
        ret.title === 'CREDIT NOTE' && ret.meta.some((m) => m.label === 'Against Invoice' && m.value === 'INV-000124') && ret.meta[0].label === 'Credit Note No', short(ret.meta))
      const pdf = renderDocumentHtml({ type: 'tax_invoice', number: invoiceNo, shopName: 'H2 Traders', supplierVatNo: '134567890-7000', customerName: 'Lanka Hardware', customerVatNo: '114999888-7000', date: '2026-10-22',
        lines: [{ name: 'Chair', quantity: 1, unitPrice: 1000, total: 1000, vatRate: 18, vatAmount: 180 }], subtotal: 1000, tax: 180, total: 1180 })
      check('PDF tax invoice: VAT Reg No, buyer VAT No, date, per-line VAT, excl./incl. totals',
        pdf.includes('VAT Reg No: 134567890-7000') && pdf.includes('Buyer VAT No: 114999888-7000') && pdf.includes('Date: 2026-10-22') && pdf.includes('Total excl. VAT') && pdf.includes('180.00'))
    })

    // ---------- 5. return (credit note in VAT terms)
    let returnNo = ''
    await step('VAT return', async () => {
      const line = (await admin.query(`SELECT id FROM sale_items WHERE sale_id=$1 AND item_id=$2`, [saleId, A])).rows[0]
      const r = await json(await postSale(req('POST', '/api/sales', {
        isReturn: true, returnAgainst: saleId, warehouseId: f.wh, customerId: f.customerId,
        cartItems: [{ originalSaleItemId: line.id, itemId: A, name: 'x', quantity: -1, unitPrice: 0 }],
        subtotal: 0, tax: 0, total: 0, refundMethod: 'cash',
      })))
      check('return of the 18% line → 200', r.status === 200, short(r.body))
      returnNo = r.body.invoiceNo
      const rt = (await admin.query(`SELECT tax_amount::float t, total::float tot FROM sales WHERE id=$1`, [r.body.id])).rows[0]
      check('return reverses 180 VAT', rt && Math.abs(rt.t) === 180 && Math.abs(rt.tot) === 1180, short(rt))
    })

    // ---------- 6. credit notes
    let cnId = ''
    await step('credit note', async () => {
      const r = await json(await postCreditNote(req('POST', '/api/credit-notes', {
        saleId, reason: 'Price adjustment', items: [{ itemName: 'Price adjustment — chair', quantity: 1, unitPrice: 100, taxTemplateId: f.tpl.std }],
      })))
      check('credit note with VAT template → 201, 100 + 18 VAT', r.status === 201 && Number(r.body.subtotal) === 100 && Number(r.body.tax) === 18 && Number(r.body.total) === 118, short(r.body))
      cnId = r.body.id
      check('credit note takes the invoice customer, settles the receivable, GL posted', r.body.customerId === f.customerId && r.body.settlement === 'receivable' && r.body.glPosted === true, short(r.body))
      const gl = await glFor(admin, cnId)
      check('GL: Dr revenue 100, Dr output VAT 18, Cr AR 118 (customer)',
        net(gl, f.acct.income) === 100 && net(gl, f.acct.vat) === 18 && net(gl, f.acct.ar) === -118 && gl.some((e) => e.account_id === f.acct.ar && e.party_id === f.customerId), short(gl))
      const items = (await admin.query(`SELECT tax_template_id, tax_rate::float r, tax::float t, total::float v FROM credit_note_items WHERE credit_note_id=$1`, [cnId])).rows
      check('line stores template, rate 18, VAT 18, value 100', items.length === 1 && items[0].tax_template_id === f.tpl.std && items[0].r === 18 && items[0].t === 18 && items[0].v === 100, short(items))

      const over = await json(await postCreditNote(req('POST', '/api/credit-notes', { saleId, items: [{ itemName: 'Too much', quantity: 1, unitPrice: 5000, taxTemplateId: f.tpl.std }] })))
      check('credit note beyond the invoice balance (after return + earlier note) → 400', over.status === 400, short(over.body))

      const legacyUi = await json(await postCreditNote(req('POST', '/api/credit-notes', {
        customerName: 'Walk-in', reason: 'goodwill', subtotal: 50, tax: 0, total: 50, status: 'issued',
        items: [{ itemName: 'Goodwill', quantity: 1, unitPrice: 50, tax: 0, total: 50 }],
      })))
      check('legacy flat-tax body (credit-notes UI) still works → refund settlement', legacyUi.status === 201 && legacyUi.body.settlement === 'refund' && legacyUi.body.glPosted === true, short(legacyUi.body))
      const lgl = await glFor(admin, legacyUi.body.id)
      check('refund credit note: Dr revenue 50, Cr cash 50', net(lgl, f.acct.income) === 50 && net(lgl, f.acct.cash) === -50, short(lgl))
      const badSum = await json(await postCreditNote(req('POST', '/api/credit-notes', { subtotal: 50, tax: 0, total: 70, items: [{ itemName: 'x', quantity: 1, unitPrice: 50, total: 50 }] })))
      check('legacy totals that do not add up → 400', badSum.status === 400, short(badSum.body))

      const draft = await json(await postCreditNote(req('POST', '/api/credit-notes', { saleId, status: 'draft', items: [{ itemName: 'Draft adj', quantity: 1, unitPrice: 10, taxTemplateId: f.tpl.std }] })))
      check('draft credit note → no GL', draft.status === 201 && (await glFor(admin, draft.body.id)).length === 0, short(draft.body))
      const issued = await json(await patchCreditNote(req('PATCH', '/x', { action: 'issue' }), ctx(draft.body.id)))
      check('issue draft → GL posted', issued.status === 200 && issued.body.status === 'issued' && (await glFor(admin, draft.body.id)).length > 0, short(issued.body))
      const cancel = await json(await patchCreditNote(req('PATCH', '/x', { action: 'cancel' }), ctx(draft.body.id)))
      const cgl = await glFor(admin, draft.body.id)
      check('cancel → GL reversed (net zero on every account)', cancel.status === 200 && cancel.body.status === 'cancelled'
        && [f.acct.income, f.acct.vat, f.acct.ar].every((a) => net(cgl, a) === 0), short(cgl))
      const list = await json(await listCreditNotes(req('GET', `/api/credit-notes?saleId=${saleId}`)))
      check('GET /api/credit-notes?saleId lists the invoice notes', list.status === 200 && list.body.creditNotes.length === 2, short(list.body).slice(0, 200))
    })

    // ---------- 7. debit note
    let dnId = ''
    await step('debit note', async () => {
      const r = await json(await postDebitNote(req('POST', '/api/debit-notes', {
        saleId, reason: 'Delivery charge omitted', items: [{ itemName: 'Delivery', quantity: 1, unitPrice: 200, taxTemplateId: f.tpl.std }],
      })))
      check('debit note → 201, 200 + 36 VAT', r.status === 201 && Number(r.body.total) === 236 && Number(r.body.tax) === 36 && r.body.debitNoteNo?.startsWith('DN-'), short(r.body))
      dnId = r.body.id
      const gl = await glFor(admin, dnId)
      check('GL: Dr AR 236, Cr revenue 200, Cr output VAT 36', net(gl, f.acct.ar) === 236 && net(gl, f.acct.income) === -200 && net(gl, f.acct.vat) === -36, short(gl))
      const noCust = await json(await postDebitNote(req('POST', '/api/debit-notes', { items: [{ itemName: 'x', quantity: 1, unitPrice: 10 }] })))
      check('debit note without a customer → 400', noCust.status === 400, short(noCust.body))
    })

    // ---------- 8. VAT schedules
    await step('VAT schedules', async () => {
      const today = localToday()
      const supplier = randomUUID()
      await admin.query(`INSERT INTO suppliers (id, tenant_id, name, tax_id) VALUES ($1,$2,'Ceylon Supplies','109876543-7000')`, [supplier, f.tenantId])
      await admin.query(`INSERT INTO purchases (tenant_id, purchase_no, supplier_id, supplier_invoice_no, supplier_bill_date, subtotal, tax_amount, total, status)
        VALUES ($1,'PI-H2-1',$2,'SUP-778',$3,500,90,590,'pending')`, [f.tenantId, supplier, today])
      const q = (type: string, extra = '') => `/api/reports/tax-vat-schedule?type=${type}&fromDate=${today}&toDate=${today}${extra}`
      const out = await json(await vatSchedule(req('GET', q('output'))))
      check('output schedule → 200', out.status === 200, short(out.body))
      const rows: J[] = out.body.rows || []
      const inv = rows.find((r) => r.docNo === invoiceNo)
      check('invoice row: taxable 1000, VAT 180, zero-rated 500, exempt 300, buyer TIN',
        !!inv && inv.taxableValue === 1000 && inv.vat === 180 && inv.zeroRatedValue === 500 && inv.exemptValue === 300 && inv.buyerTin === '114999888-7000', short(inv))
      const ret = rows.find((r) => r.docNo === returnNo)
      check('return row negative and references the invoice', !!ret && ret.docType === 'return' && ret.taxableValue === -1000 && ret.vat === -180 && ret.refDocNo === invoiceNo, short(ret))
      const cn = rows.find((r) => r.docType === 'credit_note' && r.vat === -18)
      check('credit note row −100 / −18 referencing the invoice', !!cn && cn.taxableValue === -100 && cn.refDocNo === invoiceNo, short(rows.filter((r) => r.docType === 'credit_note')))
      check('cancelled credit note not in the schedule', !rows.some((r) => r.docType === 'credit_note' && r.vat === -1.8))
      const dn = rows.find((r) => r.docType === 'debit_note')
      check('debit note row +200 / +36', !!dn && dn.taxableValue === 200 && dn.vat === 36, short(dn))
      check('totals: VAT 180 − 180 − 18 + 36 = 18', close(out.body.totals.vat, 18), short(out.body.totals))

      const inp = await json(await vatSchedule(req('GET', q('input'))))
      const pr = (inp.body.rows || [])[0]
      check('input schedule: supplier invoice date/no, TIN, value 500, VAT 90',
        inp.status === 200 && !!pr && pr.supplierInvoiceNo === 'SUP-778' && pr.supplierTin === '109876543-7000' && pr.value === 500 && pr.vat === 90 && pr.date === today, short(inp.body))

      const sum = await json(await vatSchedule(req('GET', q('summary'))))
      check('summary: output VAT reconciles to the GL (difference 0)', sum.status === 200 && sum.body.gl && close(sum.body.gl.outputVat, 18) && close(sum.body.differences.outputVat, 0), short(sum.body))
      check('summary: input VAT without GL posting shows the difference (90)', close(sum.body.differences.inputVat, 90) && close(sum.body.netVatPayable, 18 - 90), short(sum.body))

      const csv = await json(await vatSchedule(req('GET', q('output', '&format=csv'))))
      const lines = csv.text.trim().split(/\r\n/)
      check('CSV export: text/csv, header + one line per document', csv.status === 200 && (csv.headers?.get('content-type') || '').startsWith('text/csv')
        && lines[0].startsWith('Date,Document Type,Invoice / Note No') && lines.length === rows.length + 1, csv.text.slice(0, 300))
      const monthly = await json(await taxReport(req('GET', `/api/reports/tax-report?fromDate=${today}&toDate=${today}`)))
      check('monthly tax report includes credit / debit notes (output VAT 18 = schedule)', monthly.status === 200 && close(monthly.body.totals.totalTaxCollected, 18), short(monthly.body))
      const badRange = await json(await vatSchedule(req('GET', `/api/reports/tax-vat-schedule?type=output&fromDate=${today}&toDate=2000-01-01`)))
      check('inverted period → 400', badRange.status === 400)
    })

    // ---------- 8b. setup seeding for a tenant that is not VAT-registered
    await step('setup seeding without default', async () => {
      const t = await makeTenant(admin, 'novat', { taxId: null })
      tenants.push(t.tenantId)
      const r = await withTenantTransaction(t.tenantId, (tx) => seedCountryTaxTemplates(tx, t.tenantId, 'LK', { setDefault: false }))
      const def = (await admin.query(`SELECT default_tax_template_id FROM accounting_settings WHERE tenant_id=$1`, [t.tenantId])).rows[0]
      check('templates seeded but no default sales template (sales stay untaxed)', r.created.length === 3 && def.default_tax_template_id === null, short({ r, def }))
    })

    // ---------- 9. tenant isolation
    const other = await makeTenant(admin, 'other', { accounting: false })
    tenants.push(other.tenantId)
    await step('isolation', async () => {
      setTestSession(session(other))
      const g = await json(await getCreditNote(req('GET', '/x'), ctx(cnId)))
      check("another tenant cannot read the credit note → 404", g.status === 404, short(g.body))
      const cross = await json(await postCreditNote(req('POST', '/api/credit-notes', { saleId, items: [{ itemName: 'x', quantity: 1, unitPrice: 1, taxTemplateId: f.tpl.std }] })))
      check("another tenant cannot credit this tenant's invoice → 400", cross.status === 400, short(cross.body))
      const today = localToday()
      const s = await json(await vatSchedule(req('GET', `/api/reports/tax-vat-schedule?type=output&fromDate=${today}&toDate=${today}`)))
      check("another tenant's VAT schedule is empty", s.status === 200 && s.body.rows.length === 0, short(s.body))
      setTestSession(session(f))
    })

    // ---------- 10. e-invoice outbox
    await step('e-invoice outbox', async () => {
      const unreg = await makeTenant(admin, 'unreg', { taxId: null, accounting: false })
      tenants.push(unreg.tenantId)
      setTestSession(session(unreg))
      const refused = await json(await putEinvoice(req('PUT', '/x', { enabled: true })))
      check('enable e-invoicing without a VAT/TIN → 400', refused.status === 400, short(refused.body))
      setTestSession(session(f))

      // enable "before" the documents so the back-fill picks them up
      const en = await json(await putEinvoice(req('PUT', '/x', { enabled: true })))
      check('enable e-invoicing → 200', en.status === 200 && en.body.enabled === true && en.body.transmitter === 'disabled', short(en.body))
      await admin.query(`UPDATE tenants SET einvoice_enabled_at = now() - interval '1 day' WHERE id=$1`, [f.tenantId])

      const s1 = await runEinvoiceSync({ tenantIds: [f.tenantId], transmitter: disabledTransmitter })
      const ob = (await admin.query(`SELECT source_type, document_type, document_no, status, attempts, payload FROM einvoice_outbox WHERE tenant_id=$1 ORDER BY document_no`, [f.tenantId])).rows
      // sale, return, 2 issued credit notes (adjustment + legacy), 1 debit note; cancelled credit note excluded
      check('back-fill queues one row per document (cancelled notes excluded)', s1.queued === 5 && ob.length === 5 && ob.every((r) => r.status === 'pending' && r.attempts === 0), `${s1.queued} ${short(ob.map((r) => [r.source_type, r.document_no, r.status]))}`)
      const s2 = await runEinvoiceSync({ tenantIds: [f.tenantId], transmitter: disabledTransmitter })
      check('second run queues nothing (unique per document); disabled transmitter sends nothing', s2.queued === 0 && s2.skipped === 5 && s2.sent === 0)

      const invP = ob.find((r) => r.document_no === invoiceNo)?.payload
      check('invoice payload: supplier TIN, B2B buyer TIN, VAT categories, totals',
        !!invP && invP.documentType === 'invoice' && invP.supplier.tin === '134567890-7000' && invP.isB2B && invP.buyer.tin === '114999888-7000'
        && invP.totals.vatAmount === 180 && invP.totals.netAmount === 1800 && invP.totals.grossAmount === 1980
        && invP.lines.find((l: J) => l.description === 'Export Tea')?.vatCategory === 'zero_rated'
        && invP.lines.find((l: J) => l.description === 'Rice 5kg')?.vatCategory === 'exempt'
        && invP.lines.find((l: J) => l.description === 'Office Chair')?.vatAmount === 180, short(invP))
      const retP = ob.find((r) => r.source_type === 'sale_return')?.payload
      check('return payload is a credit note referencing the invoice', !!retP && retP.documentType === 'credit_note' && retP.originalDocument?.documentNo === invoiceNo, short(retP))
      const dnP = ob.find((r) => r.source_type === 'debit_note')?.payload
      check('debit note payload references the invoice', !!dnP && dnP.documentType === 'debit_note' && dnP.originalDocument?.documentNo === invoiceNo && dnP.totals.vatAmount === 36, short(dnP))

      let calls = 0
      const flaky: EInvoiceTransmitter = {
        name: 'test-flaky', enabled: true,
        async transmit(p) {
          calls++
          if (p.documentNo === invoiceNo && calls <= 1) return { ok: false, retryable: true, error: 'IRD timeout' }
          return { ok: true, acknowledged: true, irn: `IRN-${p.documentNo}` }
        },
      }
      const now = new Date()
      const s3 = await runEinvoiceSync({ tenantIds: [f.tenantId], transmitter: flaky, now })
      const inv1 = (await admin.query(`SELECT status, attempts, last_error, EXTRACT(EPOCH FROM next_attempt_at - updated_at)::float AS wait FROM einvoice_outbox WHERE tenant_id=$1 AND document_no=$2`, [f.tenantId, invoiceNo])).rows[0]
      check('failure → stays pending with attempts 1, error and backoff', inv1.status === 'pending' && inv1.attempts === 1 && inv1.last_error === 'IRD timeout'
        && Math.abs(inv1.wait * 1000 - backoffMs(1)) < 5, short(inv1))
      check('other documents acknowledged with an IRN', s3.acknowledged === 4, short(s3))
      const s4 = await runEinvoiceSync({ tenantIds: [f.tenantId], transmitter: flaky, now })
      check('not retried before the backoff elapses', s4.acknowledged === 0 && s4.retried === 0, short(s4))
      const s5 = await runEinvoiceSync({ tenantIds: [f.tenantId], transmitter: flaky, now: new Date(now.getTime() + backoffMs(1) + 5000) })
      const inv2 = (await admin.query(`SELECT status, attempts, irn FROM einvoice_outbox WHERE tenant_id=$1 AND document_no=$2`, [f.tenantId, invoiceNo])).rows[0]
      check('retry after backoff → acknowledged', s5.acknowledged === 1 && inv2.status === 'acknowledged' && inv2.attempts === 2 && inv2.irn === `IRN-${invoiceNo}`, short(inv2))

      const blocked = await json(await patchCreditNote(req('PATCH', '/x', { action: 'cancel' }), ctx(cnId)))
      check('a credit note already transmitted cannot be cancelled → 409', blocked.status === 409, short(blocked.body))
      const st = await json(await getEinvoice())
      check('settings show outbox counts and recent rows', st.status === 200 && st.body.outbox.acknowledged === 5 && st.body.recent.length === 5 && st.body.recent.every((r: J) => r.irn), short(st.body))
      const noAuth = await json(await cronEinvoice(req('POST', '/api/cron/einvoice-sync')))
      check('cron route without CRON_SECRET → 401', noAuth.status === 401)
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
