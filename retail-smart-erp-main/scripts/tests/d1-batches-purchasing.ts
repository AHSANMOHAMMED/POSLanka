/**
 * D1 integration test: batch allocation on sales / returns / voids, quarantine returns,
 * exchange GL with split payments, purchasing cost + PO reversal, per-tenant document numbers.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_d1 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/d1-batches-purchasing.ts
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
import { DOCUMENT_SERIES, nextDocNo, type DocumentSeries } from '@/lib/documents/numbering'
import { POST as postSale } from '@/app/api/sales/route'
import { GET as getSale, PUT as voidSale } from '@/app/api/sales/[id]/route'
import { GET as lookupSale } from '@/app/api/sales/lookup/route'
import { POST as postExchange } from '@/app/api/sales/exchange/route'
import { GET as getTenant, PUT as putTenant } from '@/app/api/tenant/route'
import { POST as createInvoiceFromPO } from '@/app/api/purchase-orders/[id]/create-invoice/route'
import { PUT as updatePurchase, DELETE as deletePurchase } from '@/app/api/purchases/[id]/route'
import { POST as createRequisition } from '@/app/api/purchase-requisitions/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; supplierId: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx) {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'D1', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
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

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `d1-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), supplierId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'D1 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, 'Lanka Supplies')`, [f.supplierId, tenantId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, opts: { batches?: boolean; serial?: boolean; stock?: number; cost?: number } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_batches, track_serial_numbers)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
    [id, f.tenantId, `D1-${id.slice(0, 8)}`, name, opts.cost ?? Math.round(price * 0.6), price, !!opts.batches, !!opts.serial])
  if (opts.stock) await seedStock(f, id, opts.stock)
  return id
}
async function seedStock(f: Fx, itemId: string, qty: number, wh = f.wh) {
  await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
    tenantId: f.tenantId, warehouseId: wh, itemId, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: f.userId,
  }))
}
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
async function newBatch(admin: Client, f: Fx, itemId: string, no: string, qty: number, expiry: string | null) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`, [id, f.tenantId, itemId, no, f.wh, expiry, qty])
  return id
}
async function batchQty(admin: Client, id: string) {
  const r = await admin.query(`SELECT current_quantity, status FROM item_batches WHERE id=$1`, [id])
  return Number(r.rows[0].current_quantity)
}
async function stockOf(admin: Client, wh: string, itemId: string) {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}
async function sell(f: Fx, lines: Array<{ itemId: string; name: string; quantity: number; unitPrice: number; batchId?: string; batchNumber?: string; serialNumberIds?: string[] }>, opts: { offlineRef?: string; method?: string } = {}) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  return json(await postSale(req('POST', '/api/sales', {
    cartItems: lines.map((l) => ({ ...l, discount: 0 })),
    paymentMethod: opts.method || 'cash', subtotal, discount: 0, tax: 0, total: subtotal, amountPaid: subtotal, creditAmount: 0,
    warehouseId: f.wh, offlineRef: opts.offlineRef,
  })))
}
async function lineOf(admin: Client, saleId: string, itemId: string) {
  return (await admin.query(`SELECT * FROM sale_items WHERE sale_id=$1 AND item_id=$2`, [saleId, itemId])).rows[0]
}
async function allocs(admin: Client, saleItemId: string) {
  return (await admin.query(
    `SELECT sib.batch_id, b.batch_number, sib.quantity::float AS q, sib.returned_quantity::float AS r
     FROM sale_item_batches sib JOIN item_batches b ON b.id = sib.batch_id WHERE sib.sale_item_id=$1 ORDER BY sib.alloc_order`, [saleItemId])).rows
}
async function returnLine(f: Fx, saleId: string, originalSaleItemId: string, itemId: string, quantity: number) {
  return json(await postSale(req('POST', '/api/sales', {
    isReturn: true, returnAgainst: saleId,
    cartItems: [{ originalSaleItemId, itemId, name: 'x', quantity: -quantity, unitPrice: 0 }],
    subtotal: 0, tax: 0, total: 0, refundMethod: 'cash', warehouseId: f.wh,
  })))
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url || '(no DATABASE_URL)'}: needs a local poslanka_<name> database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')
  const C = await makeTenant(admin, 'c')
  setTestSession(session(A))

  try {
    // ================= batches =================
    const M = await newItem(admin, A, 'Milk 1L', 100, { batches: true, stock: 30 })
    const b1 = await newBatch(admin, A, M, 'LOT-B1', 10, day(10))
    const b2 = await newBatch(admin, A, M, 'LOT-B2', 10, day(5))
    const b3 = await newBatch(admin, A, M, 'LOT-B3', 5, null)
    const bx = await newBatch(admin, A, M, 'LOT-BX', 5, day(-2)) // expired
    let s1: J = {}
    let s1Line = ''

    await step('FEFO', async () => {
      const r = await sell(A, [{ itemId: M, name: 'Milk 1L', quantity: 12, unitPrice: 100 }])
      check('sale of batch item → 200', r.status === 200, JSON.stringify(r.body).slice(0, 300))
      s1 = r.body
      s1Line = (await lineOf(admin, s1.id, M)).id
      const a = await allocs(admin, s1Line)
      check('FEFO picks earliest expiry first (B2 10, then B1 2), expired BX skipped',
        a.length === 2 && a[0].batch_number === 'LOT-B2' && a[0].q === 10 && a[1].batch_number === 'LOT-B1' && a[1].q === 2, JSON.stringify(a))
      check('batch quantities decremented (B2 0 consumed, B1 8, BX 5)',
        await batchQty(admin, b2) === 0 && await batchQty(admin, b1) === 8 && await batchQty(admin, bx) === 5)
      const st = await admin.query(`SELECT status FROM item_batches WHERE id=$1`, [b2])
      check('empty batch → status consumed (no expiry alert)', st.rows[0].status === 'consumed')
      const g = await json(await getSale(req('GET', `/api/sales/${s1.id}`), ctx(s1.id)))
      const gl = (g.body.items || []).find((i: J) => i.itemId === M)
      check('GET /api/sales/[id] exposes items[].batches', g.status === 200 && gl?.batches?.length === 2
        && gl.batches[0].batchNumber === 'LOT-B2' && gl.batches[0].quantity === 10 && 'expiryDate' in gl.batches[0] && gl.batches[0].returnedQuantity === 0,
        JSON.stringify(gl?.batches))
    })

    await step('explicit batch', async () => {
      const r = await sell(A, [{ itemId: M, name: 'Milk 1L', quantity: 3, unitPrice: 100, batchId: b1 }])
      const a = r.status === 200 ? await allocs(admin, (await lineOf(admin, r.body.id, M)).id) : []
      check('explicit batchId respected (B1 −3)', r.status === 200 && a.length === 1 && a[0].batch_id === b1 && await batchQty(admin, b1) === 5,
        `${r.status} ${JSON.stringify(a)} ${JSON.stringify(r.body).slice(0, 200)}`)
      const r2 = await sell(A, [{ itemId: M, name: 'Milk 1L', quantity: 1, unitPrice: 100, batchNumber: 'lot-b3' }])
      const a2 = r2.status === 200 ? await allocs(admin, (await lineOf(admin, r2.body.id, M)).id) : []
      check('scanned batch number resolved to the batch (B3 −1)', r2.status === 200 && a2[0]?.batch_id === b3 && await batchQty(admin, b3) === 4, JSON.stringify(a2))
      const r3 = await sell(A, [{ itemId: M, name: 'Milk 1L', quantity: 1, unitPrice: 100, batchId: bx }])
      check('expired batch rejected (BATCH_EXPIRED)', r3.status === 400 && r3.body.code === 'BATCH_EXPIRED', JSON.stringify(r3.body))
    })

    await step('insufficient batch stock', async () => {
      // warehouse stock 14 (incl. 5 in the expired batch); sellable batch quantity B1 5 + B3 4 = 9
      const before = await stockOf(admin, A.wh, M)
      const r = await sell(A, [{ itemId: M, name: 'Milk 1L', quantity: 12, unitPrice: 100 }])
      check('online: batch quantity short → 400 INSUFFICIENT_BATCH_STOCK, nothing written',
        r.status === 400 && r.body.code === 'INSUFFICIENT_BATCH_STOCK' && await stockOf(admin, A.wh, M) === before && await batchQty(admin, b1) === 5,
        `${before} ${JSON.stringify(r.body)}`)

      const O = await newItem(admin, A, 'Yoghurt', 50, { batches: true, stock: 10 })
      const ob = await newBatch(admin, A, O, 'Y-1', 4, day(3))
      const off = await sell(A, [{ itemId: O, name: 'Yoghurt', quantity: 6, unitPrice: 50 }], { offlineRef: `OFF-D1-${Date.now()}` })
      const fl = off.body.flags?.batchShortfall
      check('offline: allocates what exists and records the shortfall in sale flags',
        off.status === 200 && Array.isArray(fl) && fl[0]?.allocated === 4 && fl[0]?.quantity === 6 && await batchQty(admin, ob) === 0,
        JSON.stringify(off.body).slice(0, 400))
    })

    await step('return + void restore batches', async () => {
      // s1 drew B2 10 + B1 2; return 3 → LIFO: B1 +2, B2 +1
      const b1Before = await batchQty(admin, b1)
      const r = await returnLine(A, s1.id, s1Line, M, 3)
      check('return → 200', r.status === 200, JSON.stringify(r.body).slice(0, 300))
      check('return restores the same batches LIFO (B1 +2, B2 +1)', await batchQty(admin, b1) === b1Before + 2 && await batchQty(admin, b2) === 1)
      const a = await allocs(admin, s1Line)
      check('sale_item_batches.returned_quantity tracked', a[0].r === 1 && a[1].r === 2, JSON.stringify(a))
      const retLine = (r.body.lines || [])[0]
      const ra = retLine ? await allocs(admin, retLine.id) : []
      check('return line records the batches it went back into', ra.length === 2 && ra.reduce((s: number, x: J) => s + x.q, 0) === 3, JSON.stringify(ra))
      const st = await admin.query(`SELECT status FROM item_batches WHERE id=$1`, [b2])
      check('restored consumed batch is active again', st.rows[0].status === 'active')

      const lk = await json(await lookupSale(req('GET', `/api/sales/lookup?code=${encodeURIComponent(s1.invoiceNo)}`)))
      const ll = (lk.body.sale?.items || []).find((i: J) => i.id === s1Line)
      check('lookup exposes items[].batches with returnedQuantity', lk.status === 200 && ll?.batches?.length === 2 && ll.batches[0].returnedQuantity === 1, JSON.stringify(ll?.batches))

      const stockBefore = await stockOf(admin, A.wh, M)
      const v = await json(await voidSale(req('PUT', `/api/sales/${s1.id}`, { voidReason: 'test' }), ctx(s1.id)))
      check('void restores the remaining 9 to B2 (10) and stock +9', v.status === 200 && await batchQty(admin, b2) === 10
        && await stockOf(admin, A.wh, M) === stockBefore + 9, `${v.status} B2=${await batchQty(admin, b2)} ${JSON.stringify(v.body).slice(0, 200)}`)
      const a2 = await allocs(admin, s1Line)
      check('after void every allocation is fully returned', a2.every((x: J) => x.r === x.q), JSON.stringify(a2))
    })

    // ================= quarantine / serial settings =================
    await step('return settings', async () => {
      const g0 = await json(await getTenant())
      check('GET /api/tenant: default returnSettings stock/available',
        g0.body.returnSettings?.restockMode === 'stock' && g0.body.returnSettings?.serialReturnStatus === 'available' && g0.body.batchSettings?.allowExpiredSale === false,
        JSON.stringify(g0.body.returnSettings))
      const p = await json(await putTenant(req('PUT', '/api/tenant', { returnSettings: { restockMode: 'quarantine', serialReturnStatus: 'defective' } })))
      const g1 = await json(await getTenant())
      check('PUT /api/tenant stores returns settings', p.status === 200 && g1.body.returnSettings?.restockMode === 'quarantine'
        && g1.body.returnSettings?.serialReturnStatus === 'defective', JSON.stringify(p.body).slice(0, 200))

      const N = await newItem(admin, A, 'Kettle', 200, { stock: 5 })
      const s = await sell(A, [{ itemId: N, name: 'Kettle', quantity: 2, unitPrice: 200 }])
      const line = await lineOf(admin, s.body.id, N)
      const sellable = await stockOf(admin, A.wh, N)
      const r = await returnLine(A, s.body.id, line.id, N, 1)
      const q = await admin.query(`SELECT id FROM warehouses WHERE tenant_id=$1 AND code='QUARANTINE'`, [A.tenantId])
      const qwh = q.rows[0]?.id
      check('quarantine: quarantine warehouse created on demand', r.status === 200 && q.rows.length === 1, JSON.stringify(r.body).slice(0, 200))
      check('quarantine: sellable stock unchanged, quarantine +1', await stockOf(admin, A.wh, N) === sellable && qwh && await stockOf(admin, qwh, N) === 1)
      const mv = await admin.query(`SELECT reference_type, warehouse_id FROM stock_movements WHERE reference_id=$1`, [r.body.id])
      check('quarantine movement referenceType return_quarantine', mv.rows.length === 1 && mv.rows[0].reference_type === 'return_quarantine' && mv.rows[0].warehouse_id === qwh)

      // batch item into quarantine: batch with the same number, status quarantine; original batch untouched
      const sb = await sell(A, [{ itemId: M, name: 'Milk 1L', quantity: 2, unitPrice: 100, batchId: b1 }])
      const sbl = await lineOf(admin, sb.body.id, M)
      const b1After = await batchQty(admin, b1)
      const rb = await returnLine(A, sb.body.id, sbl.id, M, 2)
      const qb = await admin.query(`SELECT current_quantity::float q, status FROM item_batches WHERE tenant_id=$1 AND warehouse_id=$2 AND batch_number='LOT-B1'`, [A.tenantId, qwh])
      check('quarantine: batch restored into the quarantine warehouse (status quarantine), original batch unchanged',
        rb.status === 200 && qb.rows.length === 1 && qb.rows[0].q === 2 && qb.rows[0].status === 'quarantine' && await batchQty(admin, b1) === b1After,
        JSON.stringify(qb.rows))

      // serial 'defective'
      const S = await newItem(admin, A, 'Phone', 1000, { serial: true, stock: 1 })
      const sid = randomUUID()
      await admin.query(`INSERT INTO item_serial_numbers (id, tenant_id, item_id, warehouse_id, serial_number, status) VALUES ($1, $2, $3, $4, 'SN-D1-1', 'available')`,
        [sid, A.tenantId, S, A.wh])
      const ss = await sell(A, [{ itemId: S, name: 'Phone', quantity: 1, unitPrice: 1000, serialNumberIds: [sid] }])
      const ssl = await lineOf(admin, ss.body.id, S)
      const rs = await returnLine(A, ss.body.id, ssl.id, S, 1)
      const sr = await admin.query(`SELECT status, warehouse_id FROM item_serial_numbers WHERE id=$1`, [sid])
      check("serial 'defective' mode: returned serial is defective (in quarantine)", rs.status === 200 && sr.rows[0].status === 'defective' && sr.rows[0].warehouse_id === qwh,
        `${rs.status} ${JSON.stringify(sr.rows)} ${JSON.stringify(rs.body).slice(0, 200)}`)

      const qs = await sell(A, [{ itemId: N, name: 'Kettle', quantity: 1, unitPrice: 200 }].map((l) => l), {})
      check('normal selling still works after quarantine', qs.status === 200)
      const qsale = await json(await postSale(req('POST', '/api/sales', {
        cartItems: [{ itemId: N, name: 'Kettle', quantity: 1, unitPrice: 200, discount: 0 }], paymentMethod: 'cash',
        subtotal: 200, discount: 0, tax: 0, total: 200, amountPaid: 200, creditAmount: 0, warehouseId: qwh,
      })))
      check('quarantine warehouse cannot be used for sales', qsale.status === 400 && qsale.body.code === 'QUARANTINE_WAREHOUSE', JSON.stringify(qsale.body))

      await putTenant(req('PUT', '/api/tenant', { returnSettings: { restockMode: 'stock', serialReturnStatus: 'available' } }))
      const N2 = await newItem(admin, A, 'Toaster', 150, { stock: 3 })
      const s2 = await sell(A, [{ itemId: N2, name: 'Toaster', quantity: 1, unitPrice: 150 }])
      const l2 = await lineOf(admin, s2.body.id, N2)
      await returnLine(A, s2.body.id, l2.id, N2, 1)
      check("'stock' mode returns to sellable stock", await stockOf(admin, A.wh, N2) === 3)
    })

    // ================= exchange GL with split payment (tenant C, accounting on) =================
    await step('exchange GL', async () => {
      setTestSession(session(C))
      const acc = async (name: string, no: string, root: string, type: string) => {
        const id = randomUUID()
        await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, C.tenantId, name, no, root, type])
        return id
      }
      const cash = await acc('Cash', '1100', 'asset', 'cash')
      const bank = await acc('Bank', '1200', 'asset', 'bank')
      const ar = await acc('Receivable', '1300', 'asset', 'receivable')
      const inc = await acc('Sales', '4000', 'income', 'income_account')
      const fy = randomUUID()
      await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
        [fy, C.tenantId, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`])
      await admin.query(
        `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
           default_bank_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
         VALUES ($1,$2,$3,$4,$5,$6,true,false)`, [C.tenantId, ar, inc, cash, bank, fy])
      const P = await newItem(admin, C, 'Shirt S', 100, { stock: 5, cost: 0 })
      const Q = await newItem(admin, C, 'Shirt L', 300, { stock: 5, cost: 0 })
      const s = await sell(C, [{ itemId: P, name: 'Shirt S', quantity: 1, unitPrice: 100 }])
      check('tenant C sale with GL → 200', s.status === 200, JSON.stringify(s.body).slice(0, 300))
      const pl = await lineOf(admin, s.body.id, P)
      const ex = await json(await postExchange(req('POST', '/api/sales/exchange', {
        originalSaleId: s.body.id,
        returnLines: [{ originalSaleItemId: pl.id, quantity: 1 }],
        newCartItems: [{ itemId: Q, name: 'Shirt L', quantity: 1, unitPrice: 300 }],
        paymentSplits: [{ method: 'card', amount: 150 }, { method: 'cash', amount: 50 }],
        warehouseId: C.wh,
      })))
      check('exchange with split payment → 200', ex.status === 200, JSON.stringify(ex.body).slice(0, 300))
      const saleId = ex.body.sale?.id
      const gl = await admin.query(`SELECT account_id, debit::float d, credit::float c FROM gl_entries WHERE voucher_id=$1 AND voucher_type='sale'`, [saleId])
      const deb = (a: string) => gl.rows.filter((r) => r.account_id === a).reduce((s, r) => s + r.d, 0)
      const cre = (a: string) => gl.rows.filter((r) => r.account_id === a).reduce((s, r) => s + r.c, 0)
      check('exchange GL: one debit per method (cash 100 offset + 50 = 150, card → bank 150)',
        deb(cash) === 150 && deb(bank) === 150, JSON.stringify(gl.rows))
      check('exchange GL balanced, receivable settled (AR Dr 300 / Cr 300), revenue 300',
        deb(ar) === 300 && cre(ar) === 300 && cre(inc) === 300
        && Math.abs(gl.rows.reduce((s, r) => s + r.d - r.c, 0)) < 0.001, JSON.stringify(gl.rows))
      setTestSession(session(A))
    })

    // ================= purchasing =================
    const makePO = async (itemId: string, qty: number, price: number) => {
      const poId = randomUUID(); const lineId = randomUUID()
      await admin.query(`INSERT INTO purchase_orders (id, tenant_id, order_no, supplier_id, warehouse_id, status) VALUES ($1,$2,$3,$4,$5,'confirmed')`,
        [poId, A.tenantId, `PO-T-${poId.slice(0, 8)}`, A.supplierId, A.wh])
      await admin.query(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,$4,'Line',$5,$6,$7)`,
        [lineId, A.tenantId, poId, itemId, qty, price, qty * price])
      return { poId, lineId }
    }
    const costOf = async (itemId: string) => Number((await admin.query(`SELECT cost_price FROM items WHERE id=$1`, [itemId])).rows[0].cost_price)
    const poState = async (poId: string, lineId: string) => {
      const r = await admin.query(`SELECT po.status, poi.received_quantity::float rq FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id WHERE poi.id=$1`, [lineId])
      return r.rows[0] as { status: string; rq: number }
    }

    await step('create-invoice cost + delete reversal', async () => {
      const Z = await newItem(admin, A, 'Rice 5kg', 150, { stock: 10, cost: 100 })
      const { poId, lineId } = await makePO(Z, 10, 200)
      const inv = await json(await createInvoiceFromPO(req('POST', '/x', { updateStock: true, receivedQuantities: { [lineId]: '10' } }), ctx(poId)))
      check('create-invoice (updateStock) → 200', inv.status === 200, JSON.stringify(inv.body).slice(0, 300))
      check('create-invoice updates weighted-average cost (10@100 + 10@200 → 150) and stock', await costOf(Z) === 150 && await stockOf(admin, A.wh, Z) === 20)
      const pid = inv.body.purchase?.id
      const h = await admin.query(`SELECT count(*)::int n FROM item_cost_history WHERE reference_id=$1 AND source='purchase'`, [pid])
      check('create-invoice writes item_cost_history', h.rows[0].n === 1)
      const pi = await admin.query(`SELECT purchase_order_item_id, po_received_qty::float q FROM purchase_items WHERE purchase_id=$1`, [pid])
      check('purchase line linked to PO line with po_received_qty', pi.rows[0].purchase_order_item_id === lineId && pi.rows[0].q === 10)
      check('PO received 10', (await poState(poId, lineId)).rq === 10)

      // A posted purchase is no longer deletable (recycle-bin rule); cancelling reverses it all
      const refused = await json(await deletePurchase(req('DELETE', '/x'), ctx(pid)))
      check('delete of a posted purchase is refused (cancel instead)', refused.status === 400, JSON.stringify(refused.body))
      const del = await json(await updatePurchase(req('PUT', '/x', { status: 'cancelled' }), ctx(pid)))
      check('cancel purchase → 200', del.status === 200, JSON.stringify(del.body))
      check('cancel: cost restored exactly (150 → 100), stock back to 10', await costOf(Z) === 100 && await stockOf(admin, A.wh, Z) === 10, `cost=${await costOf(Z)}`)
      const ps = await poState(poId, lineId)
      check('cancel: PO received quantity reversed (0) and status confirmed', ps.rq === 0 && ps.status === 'confirmed', JSON.stringify(ps))
      const rev = await admin.query(`SELECT notes FROM item_cost_history WHERE reference_id=$1 AND source='purchase_cancellation'`, [pid])
      check('cancel: reversal logged (restore rule)', rev.rows.length === 1 && /restored previous cost/.test(rev.rows[0].notes), JSON.stringify(rev.rows))
    })

    await step('cancel with later purchase → weighted average', async () => {
      const Z = await newItem(admin, A, 'Dhal 1kg', 150, { stock: 10, cost: 100 })
      const p1 = await makePO(Z, 10, 200)
      const i1 = await json(await createInvoiceFromPO(req('POST', '/x', { updateStock: true, receivedQuantities: { [p1.lineId]: '10' } }), ctx(p1.poId)))
      const p2 = await makePO(Z, 10, 300)
      const i2 = await json(await createInvoiceFromPO(req('POST', '/x', { updateStock: true, receivedQuantities: { [p2.lineId]: '10' } }), ctx(p2.poId)))
      check('two invoices: cost 100 → 150 → 200', i1.status === 200 && i2.status === 200 && await costOf(Z) === 200, `${i2.status} ${JSON.stringify(i2.body).slice(0, 200)} cost=${await costOf(Z)}`)
      const can = await json(await updatePurchase(req('PUT', '/x', { status: 'cancelled' }), ctx(i1.body.purchase.id)))
      // weighted removal: (200×30 − 200×10) / 20 = 200
      check('cancel first purchase (later purchase exists) → weighted-average removal (200)', can.status === 200 && await costOf(Z) === 200
        && await stockOf(admin, A.wh, Z) === 20, `${can.status} cost=${await costOf(Z)} ${JSON.stringify(can.body).slice(0, 200)}`)
      const rev = await admin.query(`SELECT notes FROM item_cost_history WHERE reference_id=$1 AND source='purchase_cancellation'`, [i1.body.purchase.id])
      check('cancel: reversal logged (weighted-average rule)', /weighted average/.test(rev.rows[0]?.notes || ''), JSON.stringify(rev.rows))
      check('cancel: PO received reversed', (await poState(p1.poId, p1.lineId)).rq === 0)
    })

    // ================= numbering =================
    await step('numbering', async () => {
      // seeding from the NUMERIC max (QT-1000 > QT-00099 although lexicographically smaller)
      await admin.query(`INSERT INTO quotations (tenant_id, quotation_no) VALUES ($1, 'QT-00099'), ($1, 'QT-1000')`, [A.tenantId])
      const seriesList = Object.keys(DOCUMENT_SERIES) as DocumentSeries[]
      const badSeries: string[] = []
      for (const series of seriesList) {
        const opts = DOCUMENT_SERIES[series].period === 'explicit' ? { period: '2026-10' } : {}
        const run = (f: Fx) => Promise.all(Array.from({ length: 30 }, () =>
          withTenantTransaction(f.tenantId, (tx) => nextDocNo(tx, f.tenantId, series, opts))))
        const [na, nb] = await Promise.all([run(A), run(B)])
        const counter = (n: string) => Number((series === 'stock_transfer' ? n.match(/^ST\d{4}(\d+)$/) : n.match(/(\d+)$/))![1])
        // tenant B is fresh → starts at 1; tenant A may already have documents of this series
        // from earlier steps (continuity from its first number), quotations seeded from QT-1000
        for (const [label, list, expectedStart] of [['A', na, series === 'quotation' ? 1001 : null], ['B', nb, 1]] as const) {
          const nums = list.map(counter).sort((x, y) => x - y)
          const start = expectedStart ?? nums[0]
          const unique = new Set(list).size === 30
          const continuous = nums.every((n, i) => n === start + i)
          if (!unique || !continuous) badSeries.push(`${series}/${label}: ${list.slice(0, 3).join(',')}… ${nums[0]}-${nums[29]}`)
        }
      }
      check(`30 concurrent numbers per series (${seriesList.length} series) unique + continuous, tenants independent`, badSeries.length === 0, badSeries.join('; '))
      const sample = await withTenantTransaction(A.tenantId, (tx) => nextDocNo(tx, A.tenantId, 'grn'))
      check('formats kept (GRN-YYYYMMDD-###)', /^GRN-\d{8}-\d{3,}$/.test(sample), sample)
      const tr = await withTenantTransaction(A.tenantId, (tx) => nextDocNo(tx, A.tenantId, 'stock_transfer'))
      check('formats kept (ST<year><5 digits>)', new RegExp(`^ST${new Date().getFullYear()}\\d{5}$`).test(tr), tr)

      // route level: 30 concurrent purchase requisitions
      const res = await Promise.all(Array.from({ length: 30 }, () => createRequisition(req('POST', '/api/purchase-requisitions', { purpose: 'd1' }))))
      const bodies = await Promise.all(res.map((r) => json(r)))
      const nos = bodies.map((b) => String(b.body.requisitionNo || b.body.data?.requisitionNo || ''))
      const nums = nos.map((n) => Number((n.match(/(\d+)$/) || ['', 'NaN'])[1])).sort((x, y) => x - y)
      check('30 concurrent POST /api/purchase-requisitions: all 2xx, unique, continuous PR-YYYYMMDD-###',
        bodies.every((b) => b.status < 300) && new Set(nos).size === 30 && nums.every((n, i) => n === nums[0] + i) && nos.every((n) => /^PR-\d{8}-\d{3,}$/.test(n)),
        `${bodies.map((b) => b.status).join(',')} ${nos.slice(0, 5).join(',')}`)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await new Promise((r) => setTimeout(r, 500))
      for (const f of [A, B, C]) await cleanup(admin, f.tenantId)
    }
    await admin.end()
  }
}

main()
  .catch((err) => check('d1 suite', false, err instanceof Error ? err.stack : String(err)))
  .finally(async () => {
    await closeAllPools()
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  })
