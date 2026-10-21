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
import { POST as createRestaurantOrder } from '@/app/api/restaurant-orders/route'
import { PUT as updateRestaurantOrder } from '@/app/api/restaurant-orders/[id]/route'
import { POST as soCreateInvoice } from '@/app/api/sales-orders/[id]/create-invoice/route'
import { POST as woInvoice } from '@/app/api/work-orders/[id]/invoice/route'
import { POST as layawayComplete } from '@/app/api/layaways/[id]/complete/route'

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
  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')
  setTestSession(session(A))

  try {
    // ================= split-tender GL =================
    await step('split tender GL', async () => {
      const acc = async (name: string, no: string, root: string, type: string) => {
        const id = randomUUID()
        await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, A.tenantId, name, no, root, type])
        return id
      }
      const cash = await acc('Cash', '1100', 'asset', 'cash')
      const bank = await acc('Bank', '1200', 'asset', 'bank')
      const ar = await acc('Receivable', '1300', 'asset', 'receivable')
      const adv = await acc('Customer Advances', '2300', 'liability', 'payable')
      const inc = await acc('Sales', '4000', 'income', 'income_account')
      const fy = randomUUID()
      await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
        [fy, A.tenantId, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`])
      await admin.query(
        `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
           default_bank_account_id, default_advance_received_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,false)`, [A.tenantId, ar, inc, cash, bank, adv, fy])

      const P = await newItem(admin, A, 'Rice 5kg', 300, { stock: 10 })
      const s = await json(await postSale(req('POST', '/api/sales', {
        cartItems: [{ itemId: P, name: 'Rice 5kg', quantity: 1, unitPrice: 300, discount: 0 }],
        paymentMethod: 'cash', paymentSplits: [{ method: 'cash', amount: 120 }, { method: 'card', amount: 180 }],
        subtotal: 300, discount: 0, tax: 0, total: 300, amountPaid: 300, creditAmount: 0, warehouseId: A.wh,
      })))
      check('split cash 120 + card 180 sale → 200', s.status === 200, JSON.stringify(s.body).slice(0, 300))
      const saleId = s.body.id
      const pay = await admin.query(`SELECT method::text m, amount::float a FROM payments WHERE sale_id=$1 ORDER BY amount`, [saleId])
      check('payment rows per method (cash 120, card 180)', pay.rows.length === 2 && pay.rows[0].m === 'cash' && pay.rows[0].a === 120 && pay.rows[1].m === 'card' && pay.rows[1].a === 180, JSON.stringify(pay.rows))
      const glOf = async (id: string) => (await admin.query(`SELECT account_id, debit::float d, credit::float c, voucher_number FROM gl_entries WHERE voucher_id=$1 AND voucher_type='sale'`, [id])).rows
      const gl = await glOf(saleId)
      const deb = (rows: J[], a: string) => rows.filter((r) => r.account_id === a).reduce((x, r) => x + r.d, 0)
      const cre = (rows: J[], a: string) => rows.filter((r) => r.account_id === a).reduce((x, r) => x + r.c, 0)
      check('GL: cash debit 120 and card → bank debit 180', deb(gl, cash) === 120 && deb(gl, bank) === 180, JSON.stringify(gl))
      check('GL balanced: AR Dr 300 / Cr 300, revenue 300', deb(gl, ar) === 300 && cre(gl, ar) === 300 && cre(gl, inc) === 300
        && Math.abs(gl.reduce((x, r) => x + r.d - r.c, 0)) < 0.001, JSON.stringify(gl))

      const v = await json(await voidSale(req('PUT', `/api/sales/${saleId}`, { voidReason: 'e1 split void' }), ctx(saleId)))
      const gl2 = await glOf(saleId)
      const rev = gl2.filter((r) => String(r.voucher_number || '').startsWith('REV-'))
      check('void → 200, reversal credits cash 120 and bank 180 (per method)',
        v.status === 200 && cre(rev, cash) === 120 && cre(rev, bank) === 180 && deb(rev, ar) === 300 && deb(rev, inc) === 300, JSON.stringify(rev))
      check('after void every account nets to zero', [cash, bank, ar, inc].every((a) => Math.abs(deb(gl2, a) - cre(gl2, a)) < 0.001), JSON.stringify(gl2))

      // split + customer store credit: credit row recorded, GL Dr advance 50, cash 100, bank 150
      await admin.query(`UPDATE customers SET balance = 50 WHERE id=$1`, [A.customerId])
      const s2 = await json(await postSale(req('POST', '/api/sales', {
        customerId: A.customerId,
        cartItems: [{ itemId: P, name: 'Rice 5kg', quantity: 1, unitPrice: 300, discount: 0 }],
        paymentMethod: 'cash', paymentSplits: [{ method: 'cash', amount: 100 }, { method: 'card', amount: 150 }],
        subtotal: 300, discount: 0, tax: 0, total: 300, amountPaid: 250, creditAmount: 50, warehouseId: A.wh,
      })))
      const gl3 = s2.status === 200 ? await glOf(s2.body.id) : []
      const pay2 = s2.status === 200 ? await admin.query(`SELECT method::text m, amount::float a FROM payments WHERE sale_id=$1`, [s2.body.id]) : { rows: [] }
      check('split + store credit: credit payment row recorded', s2.status === 200 && pay2.rows.some((p: J) => p.m === 'credit' && p.a === 50), `${s2.status} ${JSON.stringify(pay2.rows)} ${JSON.stringify(s2.body).slice(0, 200)}`)
      check('split + store credit GL: cash 100, bank 150, advance 50, balanced',
        deb(gl3, cash) === 100 && deb(gl3, bank) === 150 && deb(gl3, adv) === 50 && cre(gl3, ar) === 300
        && Math.abs(gl3.reduce((x, r) => x + r.d - r.c, 0)) < 0.001, JSON.stringify(gl3))
      const cust = await admin.query(`SELECT balance::float b FROM customers WHERE id=$1`, [A.customerId])
      check('store credit deducted (50 → 0)', cust.rows[0].b === 0)

      // single-method cash sale with change: GL debits what stays in the drawer (the sale total)
      const s3 = await json(await postSale(req('POST', '/api/sales', {
        cartItems: [{ itemId: P, name: 'Rice 5kg', quantity: 1, unitPrice: 300, discount: 0 }],
        paymentMethod: 'cash', subtotal: 300, discount: 0, tax: 0, total: 300, amountPaid: 500, creditAmount: 0, warehouseId: A.wh,
      })))
      const gl4 = s3.status === 200 ? await glOf(s3.body.id) : []
      check('cash sale with change: cash debit 300 (change not posted), AR settled', deb(gl4, cash) === 300 && cre(gl4, ar) === 300, JSON.stringify(gl4))
      // remove accounting for the rest (keeps batch paths independent of GL accounts)
      await admin.query(`UPDATE accounting_settings SET auto_post_sales=false WHERE tenant_id=$1`, [A.tenantId])
    })

    // ================= restaurant completion =================
    await step('restaurant completion batches', async () => {
      const fx = await batchFixture(admin, A, 'Juice')
      const ing = await newItem(admin, A, 'Coffee beans', 0, { batches: true, stock: 1 })
      const ingBatch = await newBatch(admin, A, ing, 'CB-1', 1, day(20))
      const menu = await newItem(admin, A, 'Latte', 400, { trackStock: false })
      const recipeId = randomUUID()
      await admin.query(`INSERT INTO recipes (id, tenant_id, item_id, name) VALUES ($1,$2,$3,'Latte')`, [recipeId, A.tenantId, menu])
      await admin.query(`INSERT INTO recipe_ingredients (tenant_id, recipe_id, ingredient_item_id, quantity) VALUES ($1,$2,$3,3)`, [A.tenantId, recipeId, ing])

      const o = await json(await createRestaurantOrder(req('POST', '/api/restaurant-orders', { orderType: 'takeaway' })))
      check('restaurant order created', o.status < 300 && !!o.body.id, JSON.stringify(o.body).slice(0, 300))
      const orderId = o.body.id
      await admin.query(`INSERT INTO restaurant_order_items (tenant_id, order_id, item_id, item_name, quantity, unit_price) VALUES ($1,$2,$3,'Juice',6,100),($1,$2,$4,'Latte',1,400)`,
        [A.tenantId, orderId, fx.itemId, menu])
      const c1 = await json(await updateRestaurantOrder(req('PUT', `/api/restaurant-orders/${orderId}`, { status: 'closed' }), ctx(orderId)))
      const c2 = await json(await updateRestaurantOrder(req('PUT', `/api/restaurant-orders/${orderId}`, { status: 'completed' }), ctx(orderId)))
      check('restaurant order closed + completed → 200', c1.status === 200 && c2.status === 200 && !!c2.body.saleId, `${c1.status} ${c2.status} ${JSON.stringify(c2.body).slice(0, 300)}`)
      const saleId = c2.body.saleId
      const sale = (await admin.query(`SELECT warehouse_id, flags FROM sales WHERE id=$1`, [saleId])).rows[0]
      check('restaurant sale has the warehouse', sale?.warehouse_id === A.wh)
      check('ingredient batch allocated what exists (CB-1 0), shortfall flagged on the sale',
        await batchQty(admin, ingBatch) === 0 && sale?.flags?.ingredientBatchShortfall?.[0]?.allocated === 1 && sale.flags.ingredientBatchShortfall[0].quantity === 3,
        JSON.stringify(sale?.flags))
      check('ingredient stock may run negative (1 → -2)', await stockOf(admin, A.wh, ing) === -2)
      await checkAllocReturnVoid(admin, A, 'restaurant', saleId, fx)
    })

    await step('restaurant shortfall does not block', async () => {
      const it = await newItem(admin, A, 'Soda', 50, { batches: true, stock: 2 })
      const b = await newBatch(admin, A, it, 'SODA-1', 2, day(10))
      const o = await json(await createRestaurantOrder(req('POST', '/api/restaurant-orders', { orderType: 'takeaway' })))
      await admin.query(`INSERT INTO restaurant_order_items (tenant_id, order_id, item_id, item_name, quantity, unit_price) VALUES ($1,$2,$3,'Soda',5,50)`, [A.tenantId, o.body.id, it])
      await updateRestaurantOrder(req('PUT', `/api/restaurant-orders/${o.body.id}`, { status: 'closed' }), ctx(o.body.id))
      const c = await json(await updateRestaurantOrder(req('PUT', `/api/restaurant-orders/${o.body.id}`, { status: 'completed' }), ctx(o.body.id)))
      const flags = c.status === 200 ? (await admin.query(`SELECT flags FROM sales WHERE id=$1`, [c.body.saleId])).rows[0]?.flags : null
      check('restaurant: short batch item completes, allocates 2, flags batch + stock shortfall',
        c.status === 200 && await batchQty(admin, b) === 0 && flags?.batchShortfall?.[0]?.allocated === 2 && flags?.stockShortfall?.length === 1
        && await stockOf(admin, A.wh, it) === -3, `${c.status} ${JSON.stringify(flags)} ${JSON.stringify(c.body).slice(0, 200)}`)
    })

    // ================= sales order invoicing =================
    await step('sales order invoice batches', async () => {
      const fx = await batchFixture(admin, A, 'Paint')
      const soId = randomUUID()
      await admin.query(`INSERT INTO sales_orders (id, tenant_id, order_no, customer_id, warehouse_id, subtotal, total, status)
        VALUES ($1,$2,$3,$4,$5,600,600,'confirmed')`, [soId, A.tenantId, `SO-E1-${soId.slice(0, 6)}`, A.customerId, A.wh])
      await admin.query(`INSERT INTO sales_order_items (tenant_id, sales_order_id, item_id, item_name, quantity, unit_price, total)
        VALUES ($1,$2,$3,'Paint',6,100,600)`, [A.tenantId, soId, fx.itemId])
      const r = await json(await soCreateInvoice(req('POST', `/api/sales-orders/${soId}/create-invoice`, {}), ctx(soId)))
      check('SO invoice → 200', r.status === 200 && !!r.body.sale?.id, JSON.stringify(r.body).slice(0, 300))
      // unpaid invoice: refund to the customer's store credit
      await checkAllocReturnVoid(admin, A, 'sales order', r.body.sale.id, fx, { refundMethod: 'credit' })

      // insufficient batch quantity rejects the invoice (non-negative policy)
      const it = await newItem(admin, A, 'Glue', 10, { batches: true, stock: 5 })
      await newBatch(admin, A, it, 'G-1', 2, day(10))
      const so2 = randomUUID()
      await admin.query(`INSERT INTO sales_orders (id, tenant_id, order_no, warehouse_id, subtotal, total, status) VALUES ($1,$2,$3,$4,50,50,'confirmed')`,
        [so2, A.tenantId, `SO-E1-${so2.slice(0, 6)}`, A.wh])
      await admin.query(`INSERT INTO sales_order_items (tenant_id, sales_order_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,'Glue',5,10,50)`, [A.tenantId, so2, it])
      const r2 = await json(await soCreateInvoice(req('POST', `/api/sales-orders/${so2}/create-invoice`, {}), ctx(so2)))
      check('SO invoice short of batch quantity → 400 INSUFFICIENT_BATCH_STOCK, stock untouched',
        r2.status === 400 && r2.body.code === 'INSUFFICIENT_BATCH_STOCK' && await stockOf(admin, A.wh, it) === 5, JSON.stringify(r2.body))
    })

    // ================= work order invoicing =================
    await step('work order invoice batches', async () => {
      const fx = await batchFixture(admin, A, 'OilFilter')
      const woId = randomUUID()
      await admin.query(`INSERT INTO work_orders (id, tenant_id, order_no, customer_id, warehouse_id, status, subtotal, total)
        VALUES ($1,$2,$3,$4,$5,'completed',600,600)`, [woId, A.tenantId, `WO-E1-${woId.slice(0, 6)}`, A.customerId, A.wh])
      await admin.query(`INSERT INTO work_order_parts (tenant_id, work_order_id, item_id, quantity, unit_price, total) VALUES ($1,$2,$3,6,100,600)`,
        [A.tenantId, woId, fx.itemId])
      const r = await json(await woInvoice(req('POST', `/api/work-orders/${woId}/invoice`, { paymentMethod: 'cash', paidAmount: 600 }), ctx(woId)))
      check('WO invoice → 200', r.status === 200 && !!r.body.id, JSON.stringify(r.body).slice(0, 300))
      await checkAllocReturnVoid(admin, A, 'work order', r.body.id, fx)
    })

    // ================= layaway completion =================
    await step('layaway completion batches', async () => {
      const fx = await batchFixture(admin, A, 'Formula')
      const layId = randomUUID()
      await admin.query(`INSERT INTO layaways (id, tenant_id, layaway_no, customer_id, subtotal, total, deposit_amount, paid_amount, balance_due, status)
        VALUES ($1,$2,$3,$4,600,600,100,600,0,'fully_paid')`, [layId, A.tenantId, `LAY-E1-${layId.slice(0, 6)}`, A.customerId])
      await admin.query(`INSERT INTO layaway_items (tenant_id, layaway_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,'Formula',6,100,600)`,
        [A.tenantId, layId, fx.itemId])
      const r = await json(await layawayComplete(req('POST', `/api/layaways/${layId}/complete`, { warehouseId: A.wh }), ctx(layId)))
      check('layaway complete → 200', r.status === 200 && !!r.body.sale?.id, JSON.stringify(r.body).slice(0, 300))
      await checkAllocReturnVoid(admin, A, 'layaway', r.body.sale.id, fx)
    })

    // ================= restaurant order numbering =================
    await step('restaurant order numbers', async () => {
      // tenant B already has RO-000007 (lazy seed from the numeric max)
      await admin.query(`INSERT INTO restaurant_orders (tenant_id, order_no, order_type, status) VALUES ($1,'RO-000007','takeaway','completed')`, [B.tenantId])
      const before = await admin.query(`SELECT count(*)::int n FROM restaurant_orders WHERE tenant_id=$1`, [A.tenantId])
      const startA = (await admin.query(
        `SELECT COALESCE(MAX(substring(order_no from 4)::int), 0) m FROM restaurant_orders WHERE tenant_id=$1`, [A.tenantId])).rows[0].m as number
      const calls: Array<Promise<{ status: number; body: J }>> = []
      for (let i = 0; i < 20; i++) {
        for (const f of [A, B]) {
          setTestSession(session(f)) // read synchronously by the handler's first statement
          calls.push(createRestaurantOrder(req('POST', '/api/restaurant-orders', { orderType: 'takeaway' })).then(json))
        }
      }
      const out = await Promise.all(calls)
      setTestSession(session(A))
      const ok = out.every((x) => x.status < 300)
      check('40 concurrent restaurant order creations → all 2xx', ok, out.filter((x) => x.status >= 300).map((x) => JSON.stringify(x.body)).slice(0, 3).join(' | '))
      const nums = async (f: Fx) => (await admin.query(
        `SELECT substring(order_no from 4)::int n FROM restaurant_orders WHERE tenant_id=$1 AND order_no ~ '^RO-\\d+$' ORDER BY 1`, [f.tenantId])).rows.map((r) => r.n as number)
      const a = (await nums(A)).filter((n) => n > startA)
      const b = (await nums(B)).filter((n) => n > 7)
      const contiguous = (xs: number[], first: number) => xs.length === 20 && new Set(xs).size === 20 && xs.every((n, i) => n === first + i)
      check('tenant A: 20 unique, continuous numbers after the existing ones', contiguous(a, startA + 1), `${before.rows[0].n} ${a.join(',')}`)
      check('tenant B: seeded from RO-000007 → RO-000008..RO-000027', contiguous(b, 8), b.join(','))
      const fmt = await admin.query(`SELECT order_no FROM restaurant_orders WHERE tenant_id=$1 ORDER BY order_no DESC LIMIT 1`, [B.tenantId])
      check('format kept (RO-000027)', fmt.rows[0]?.order_no === 'RO-000027', fmt.rows[0]?.order_no)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await new Promise((r) => setTimeout(r, 500))
      for (const f of [A, B]) await cleanup(admin, f.tenantId)
    }
    await admin.end()
  }
}

main()
  .catch((err) => check('e1 suite', false, err instanceof Error ? err.stack : String(err)))
  .finally(async () => {
    await closeAllPools()
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  })
