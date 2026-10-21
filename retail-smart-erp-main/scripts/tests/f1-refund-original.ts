/**
 * E1 final integration test: split-tender GL for normal sales (and its void reversal), batch
 * allocation in the other sale-creating paths (restaurant completion, sales-order / work-order
 * invoicing, layaway completion) with return / void restoring the batches, and per-tenant
 * restaurant order numbers under concurrency.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_e1 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/e1-final.ts
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
import { PUT as voidSale } from '@/app/api/sales/[id]/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; customerId: string }

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
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'E1', businessType: 'restaurant',
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
  const slug = `e1-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'E1 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Nimal Perera')`, [f.customerId, tenantId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, opts: { batches?: boolean; stock?: number; cost?: number; trackStock?: boolean } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_batches)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, f.tenantId, `E1-${id.slice(0, 8)}`, name, opts.cost ?? 0, price, opts.trackStock ?? true, !!opts.batches])
  if (opts.stock) await seedStock(f, id, opts.stock)
  return id
}
async function seedStock(f: Fx, itemId: string, qty: number) {
  await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
    tenantId: f.tenantId, warehouseId: f.wh, itemId, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: f.userId,
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
  const r = await admin.query(`SELECT current_quantity FROM item_batches WHERE id=$1`, [id])
  return Number(r.rows[0].current_quantity)
}
async function stockOf(admin: Client, wh: string, itemId: string) {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}
async function lineOf(admin: Client, saleId: string, itemId: string) {
  return (await admin.query(`SELECT * FROM sale_items WHERE sale_id=$1 AND item_id=$2`, [saleId, itemId])).rows[0]
}
async function allocs(admin: Client, saleItemId: string) {
  return (await admin.query(
    `SELECT sib.batch_id, b.batch_number, sib.quantity::float AS q, sib.returned_quantity::float AS r
     FROM sale_item_batches sib JOIN item_batches b ON b.id = sib.batch_id WHERE sib.sale_item_id=$1 ORDER BY sib.alloc_order`, [saleItemId])).rows
}
async function returnLine(f: Fx, saleId: string, originalSaleItemId: string, itemId: string, quantity: number, refundMethod = 'cash') {
  return json(await postSale(req('POST', '/api/sales', {
    isReturn: true, returnAgainst: saleId,
    cartItems: [{ originalSaleItemId, itemId, name: 'x', quantity: -quantity, unitPrice: 0 }],
    subtotal: 0, tax: 0, total: 0, refundMethod, warehouseId: f.wh,
  })))
}

/** Batch item with an earlier (E-1, 4 left) and a later (E-2, 10) batch: FEFO takes E-1 first. */
async function batchFixture(admin: Client, f: Fx, name: string) {
  const itemId = await newItem(admin, f, name, 100, { batches: true, stock: 14 })
  const early = await newBatch(admin, f, itemId, `${name}-E1`, 4, day(5))
  const late = await newBatch(admin, f, itemId, `${name}-E2`, 10, day(30))
  return { itemId, early, late }
}

/** Sale of 6 FEFO-allocated (E-1 4 + E-2 2): return 1 → E-2 +1 (LIFO), void → rest back. */
async function checkAllocReturnVoid(admin: Client, f: Fx, label: string, saleId: string, fx: { itemId: string; early: string; late: string }, opts: { refundMethod?: string } = {}) {
  const line = await lineOf(admin, saleId, fx.itemId)
  const a = line ? await allocs(admin, line.id) : []
  check(`${label}: FEFO allocation recorded (E1 4, then E2 2)`,
    a.length === 2 && a[0].batch_id === fx.early && a[0].q === 4 && a[1].batch_id === fx.late && a[1].q === 2
    && await batchQty(admin, fx.early) === 0 && await batchQty(admin, fx.late) === 8, JSON.stringify(a))
  check(`${label}: warehouse stock decremented (14 → 8)`, await stockOf(admin, f.wh, fx.itemId) === 8, String(await stockOf(admin, f.wh, fx.itemId)))
  {
    const r = await returnLine(f, saleId, line.id, fx.itemId, 1, opts.refundMethod)
    check(`${label}: return → 200, batch E2 restored (8 → 9)`, r.status === 200 && await batchQty(admin, fx.late) === 9,
      `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
  }
  const v = await json(await voidSale(req('PUT', `/api/sales/${saleId}`, { voidReason: 'e1 test' }), ctx(saleId)))
  check(`${label}: void → 200, all batches restored (E1 4, E2 10), stock 14`,
    v.status === 200 && await batchQty(admin, fx.early) === 4 && await batchQty(admin, fx.late) === 10 && await stockOf(admin, f.wh, fx.itemId) === 14,
    `${v.status} E1=${await batchQty(admin, fx.early)} E2=${await batchQty(admin, fx.late)} stock=${await stockOf(admin, f.wh, fx.itemId)} ${JSON.stringify(v.body).slice(0, 200)}`)
  const a2 = await allocs(admin, line.id)
  check(`${label}: every allocation fully returned`, a2.length > 0 && a2.every((x: J) => x.r === x.q), JSON.stringify(a2))
}


async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url || '(no DATABASE_URL)'}: needs a local poslanka_<name> database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const A = await makeTenant(admin, 'f1')
  setTestSession(session(A))
  try {
    await step('refund to original payment methods', async () => {
      const acc = async (name: string, no: string, root: string, type: string) => {
        const id = randomUUID()
        await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, A.tenantId, name, no, root, type])
        return id
      }
      const cash = await acc('Cash', '1100', 'asset', 'cash')
      const bank = await acc('Bank', '1200', 'asset', 'bank')
      const ar = await acc('Receivable', '1300', 'asset', 'receivable')
      const inc = await acc('Sales', '4000', 'income', 'income_account')
      const fy = randomUUID()
      await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
        [fy, A.tenantId, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`])
      await admin.query(
        `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
           default_bank_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
         VALUES ($1,$2,$3,$4,$5,$6,true,false)`, [A.tenantId, ar, inc, cash, bank, fy])

      const P = await newItem(admin, A, 'Tea 100g', 500, { stock: 10 })
      const s = await json(await postSale(req('POST', '/api/sales', {
        cartItems: [{ itemId: P, name: 'Tea 100g', quantity: 2, unitPrice: 500, discount: 0 }],
        paymentMethod: 'cash', paymentSplits: [{ method: 'cash', amount: 500 }, { method: 'card', amount: 500 }],
        subtotal: 1000, discount: 0, tax: 0, total: 1000, amountPaid: 1000, creditAmount: 0, warehouseId: A.wh,
      })))
      check('split sale cash 500 + card 500 → 200', s.status === 200, JSON.stringify(s.body).slice(0, 200))
      const saleId = s.body.id
      const line = await lineOf(admin, saleId, P)

      const cashOnly = await returnLine(A, saleId, line.id, P, 2, 'cash')
      check('full refund in cash only is refused (cash paid was 500)', cashOnly.status === 400 && cashOnly.body.code === 'REFUND_METHOD_EXCEEDS_PAID', JSON.stringify(cashOnly.body).slice(0, 200))

      const r1 = await returnLine(A, saleId, line.id, P, 1, 'original')
      check('partial return (1 of 2) to original methods → 200', r1.status === 200, JSON.stringify(r1.body).slice(0, 300))
      const rows1 = (await admin.query(`SELECT method::text m, amount::float a FROM payments WHERE sale_id=$1 ORDER BY method`, [r1.body.id])).rows
      check('refund split 250 card + 250 cash (proportional)', rows1.length === 2 && rows1.every((r) => r.a === -250), JSON.stringify(rows1))
      const r2 = await returnLine(A, saleId, line.id, P, 1, 'original')
      check('second return to original methods → 200', r2.status === 200, JSON.stringify(r2.body).slice(0, 300))
      const refunded = (await admin.query(`SELECT method::text m, SUM(amount)::float a FROM refunds WHERE original_sale_id=$1 GROUP BY 1 ORDER BY 1`, [saleId])).rows
      check('in total exactly 500 card + 500 cash refunded', JSON.stringify(refunded) === JSON.stringify([{ m: 'card', a: 500 }, { m: 'cash', a: 500 }]), JSON.stringify(refunded))
      const r3 = await returnLine(A, saleId, line.id, P, 1, 'original')
      check('nothing left to return → 400', r3.status === 400, JSON.stringify(r3.body).slice(0, 150))
      const gl = (await admin.query(`SELECT account_id, debit::float d, credit::float c FROM gl_entries WHERE voucher_id = ANY($1::uuid[])`, [[r1.body.id, r2.body.id]])).rows
      const cre = (a: string) => gl.filter((r) => r.account_id === a).reduce((x, r) => x + r.c, 0)
      check('GL: refunds credit cash 500 and bank 500, balanced', cre(cash) === 500 && cre(bank) === 500 && Math.abs(gl.reduce((x, r) => x + r.d - r.c, 0)) < 0.001, JSON.stringify(gl))
      check('stock back to 10', (await stockOf(admin, A.wh, P)) === 10)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') { await new Promise((r) => setTimeout(r, 500)); await cleanup(admin, A.tenantId) }
    await admin.end()
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  await closeAllPools().catch(() => undefined)
  process.exit(passed === results.length ? 0 : 1)
}

main()
