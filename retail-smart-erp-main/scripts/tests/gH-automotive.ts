/**
 * Audit H: automotive service & dealership verticals — work orders, insurance estimates,
 * vehicle sales, trade-ins, dealer allocations / payments, warranties, imports.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/audit_h DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/gH-automotive.ts
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
import { POST as createWorkOrder } from '@/app/api/work-orders/route'
import { PUT as updateWorkOrder } from '@/app/api/work-orders/[id]/route'
import { POST as addPart, PUT as updatePart } from '@/app/api/work-orders/[id]/parts/route'
import { POST as woInvoice } from '@/app/api/work-orders/[id]/invoice/route'
import { POST as postSale } from '@/app/api/sales/route'
import { PUT as voidSale } from '@/app/api/sales/[id]/route'
import { POST as addEstimateItem, PUT as updateEstimateItem } from '@/app/api/insurance-estimates/[id]/items/route'
import { POST as convertEstimate } from '@/app/api/insurance-estimates/[id]/convert/route'
import { PUT as updateEstimate } from '@/app/api/insurance-estimates/[id]/route'
import { POST as createDealerPayment } from '@/app/api/dealer-payments/route'
import { PUT as updateDealerPayment } from '@/app/api/dealer-payments/[id]/route'
import { POST as confirmDealerPayment } from '@/app/api/dealer-payments/[id]/confirm/route'
import { GET as dealerStatement } from '@/app/api/dealers/[id]/statement/route'
import { POST as allocate } from '@/app/api/dealer-allocations/route'
import { POST as sellVehicle } from '@/app/api/vehicle-sales/route'
import { PUT as updateVehicleSale } from '@/app/api/vehicle-sales/[id]/route'
import { PUT as updateVehicleInventory } from '@/app/api/vehicle-inventory/[id]/route'
import { PUT as updateTradeIn } from '@/app/api/trade-ins/[id]/route'
import { POST as createWarranty } from '@/app/api/vehicle-warranties/route'
import { POST as calcImportTax } from '@/app/api/vehicle-imports/[id]/calculate-tax/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; customerId: string; vehicleId: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/(poslanka_[a-z0-9_]+|audit_[a-z0-9_]+)$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx, role = 'owner') {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'GH', businessType: 'auto_service',
      aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
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
  const slug = `gh-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID(), vehicleId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'GH test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Kamal Silva')`, [f.customerId, tenantId])
  await admin.query(`INSERT INTO vehicles (id, tenant_id, customer_id, make, model, license_plate) VALUES ($1,$2,$3,'Toyota','Aqua','CAB-1234')`,
    [f.vehicleId, tenantId, f.customerId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, opts: { stock?: number; cost?: number; batches?: boolean } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_batches)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
    [id, f.tenantId, `GH-${id.slice(0, 8)}`, name, opts.cost ?? 0, price, !!opts.batches])
  if (opts.stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: opts.stock!, referenceType: 'test_seed', source: 'system', userId: f.userId,
    }))
  }
  return id
}
async function stockOf(admin: Client, wh: string, itemId: string) {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}
/** A work order inserted directly (status/lines under test control). */
async function rawWorkOrder(admin: Client, f: Fx, status: string, parts: Array<{ itemId: string; qty: number; price: number }>, opts: { customer?: boolean } = {}) {
  const woId = randomUUID()
  const total = parts.reduce((s, p) => s + p.qty * p.price, 0)
  await admin.query(
    `INSERT INTO work_orders (id, tenant_id, order_no, customer_id, warehouse_id, status, subtotal, tax_amount, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7)`,
    [woId, f.tenantId, `WO-GH-${woId.slice(0, 8)}`, opts.customer === false ? null : f.customerId, f.wh, status, total])
  for (const p of parts) {
    await admin.query(`INSERT INTO work_order_parts (tenant_id, work_order_id, item_id, quantity, unit_price, total) VALUES ($1,$2,$3,$4,$5,$6)`,
      [f.tenantId, woId, p.itemId, p.qty, p.price, p.qty * p.price])
  }
  return woId
}
async function newVehicleStock(admin: Client, f: Fx, vin: string, opts: { status?: string } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO vehicle_inventory (id, tenant_id, vin, stock_no, year, status, purchase_price, asking_price)
     VALUES ($1,$2,$3,$4,2022,$5,4000000,5000000)`, [id, f.tenantId, vin, `STK-${id.slice(0, 6)}`, opts.status ?? 'available'])
  return id
}
async function newDealer(admin: Client, f: Fx, code: string, opts: { status?: string } = {}) {
  const id = randomUUID()
  await admin.query(`INSERT INTO dealers (id, tenant_id, name, code, status) VALUES ($1,$2,$3,$4,$5)`,
    [id, f.tenantId, `Dealer ${code}`, code, opts.status ?? 'active'])
  return id
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url || '(no DATABASE_URL)'}: needs a local poslanka_<name> / audit_<name> database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const A = await makeTenant(admin, 'a')
  const T = await makeTenant(admin, 'tax') // default tax template + full accounting
  setTestSession(session(A))

  try {
    // ================= work order part reservations =================
    await step('WO parts: own reservation counted', async () => {
      const item = await newItem(admin, A, 'Brake pad', 2500, { stock: 5 })
      const c = await json(await createWorkOrder(req('POST', '/api/work-orders', {
        customerId: A.customerId, vehicleId: A.vehicleId, odometerIn: 45000, warehouseId: A.wh,
        parts: [{ itemId: item, quantity: 3, unitPrice: 2500 }],
      })))
      check('create WO with 3 of 5 in stock → 200', c.status === 200, JSON.stringify(c.body).slice(0, 300))
      const woId = c.body.id
      const more = await json(await addPart(req('POST', `/api/work-orders/${woId}/parts`, { itemId: item, quantity: 3 }), ctx(woId)))
      check('adding 3 more (6 > 5 in stock) to the same WO → 400', more.status === 400, JSON.stringify(more.body))
      const two = await json(await addPart(req('POST', `/api/work-orders/${woId}/parts`, { itemId: item, quantity: 2 }), ctx(woId)))
      check('adding 2 more (5 of 5) → 200', two.status === 200, JSON.stringify(two.body))
      const partId = two.body.id
      const up = await json(await updatePart(req('PUT', `/api/work-orders/${woId}/parts`, { partId, quantity: 6, unitPrice: 2500 }), ctx(woId)))
      check('raising the line to 6 (> 5 in stock) → 400', up.status === 400, JSON.stringify(up.body))

      const c2 = await json(await createWorkOrder(req('POST', '/api/work-orders', {
        customerId: A.customerId, vehicleId: A.vehicleId, odometerIn: 45010, warehouseId: A.wh,
        parts: [{ itemId: item, quantity: 1, unitPrice: 2500 }],
      })))
      check('second WO cannot reserve stock held by the first (confirmed counts too) → 400', c2.status === 400, JSON.stringify(c2.body))
    })

    // ================= tax on create =================
    await step('WO create computes tax', async () => {
      setTestSession(session(T))
      const tpl = randomUUID()
      await admin.query(`INSERT INTO tax_templates (id, tenant_id, name) VALUES ($1,$2,'VAT 18')`, [tpl, T.tenantId])
      await admin.query(`INSERT INTO tax_template_items (tenant_id, tax_template_id, tax_name, rate, included_in_price) VALUES ($1,$2,'VAT',18,false)`, [T.tenantId, tpl])
      const acc = async (name: string, no: string, root: string, type: string) => {
        const id = randomUUID()
        await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, T.tenantId, name, no, root, type])
        return id
      }
      const cash = await acc('Cash', '1100', 'asset', 'cash')
      const ar = await acc('Receivable', '1300', 'asset', 'receivable')
      const stock = await acc('Stock', '1400', 'asset', 'stock')
      const inc = await acc('Sales', '4000', 'income', 'income_account')
      const cogs = await acc('COGS', '5000', 'expense', 'cost_of_goods_sold')
      const vat = await acc('VAT payable', '2200', 'liability', 'tax')
      await admin.query(`UPDATE tax_template_items SET account_id=$1 WHERE tax_template_id=$2`, [vat, tpl])
      const fy = randomUUID()
      await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
        [fy, T.tenantId, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`])
      // deliberately NO WIP account: the invoice must not need one
      await admin.query(
        `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
           default_stock_account_id, default_cogs_account_id, default_tax_template_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,false)`, [T.tenantId, ar, inc, cash, stock, cogs, tpl, fy])

      const item = await newItem(admin, T, 'Oil filter', 1000, { stock: 10, cost: 400 })
      const c = await json(await createWorkOrder(req('POST', '/api/work-orders', {
        customerId: T.customerId, vehicleId: T.vehicleId, odometerIn: 1000, warehouseId: T.wh,
        parts: [{ itemId: item, quantity: 2, unitPrice: 1000 }],
        services: [{ description: 'Labour', hours: 1, rate: 500 }],
      })))
      check('create WO with lines: tax computed (18% of 2500 = 450, total 2950)',
        c.status === 200 && Number(c.body.taxAmount) === 450 && Number(c.body.total) === 2950, JSON.stringify(c.body).slice(0, 300))
      const row = (await admin.query(`SELECT tax_amount::float t, total::float tot FROM work_orders WHERE id=$1`, [c.body.id])).rows[0]
      check('stored WO totals include tax', row?.t === 450 && row?.tot === 2950, JSON.stringify(row))

      // ---- invoice GL: COGS once, no WIP account needed ----
      const woId = c.body.id
      const inv = await json(await woInvoice(req('POST', `/api/work-orders/${woId}/invoice`, { paymentMethod: 'cash', paidAmount: 5000 }), ctx(woId)))
      check('invoice without a WIP account configured → 200', inv.status === 200, JSON.stringify(inv.body).slice(0, 300))
      const saleId = inv.body.id
      const gl = (await admin.query(`SELECT account_id, debit::float d, credit::float c, voucher_type FROM gl_entries WHERE tenant_id=$1`, [T.tenantId])).rows
      const cogsDr = gl.filter((r) => r.account_id === cogs).reduce((s, r) => s + r.d - r.c, 0)
      check('COGS booked once (2 × 400 = 800, not 1600)', cogsDr === 800, JSON.stringify(gl))
      check('no work_order_invoice WIP voucher', !gl.some((r) => r.voucher_type === 'work_order_invoice'), JSON.stringify(gl))
      const pay = (await admin.query(`SELECT amount::float a FROM payments WHERE sale_id=$1`, [saleId])).rows
      const sale = (await admin.query(`SELECT paid_amount::float p, status FROM sales WHERE id=$1`, [saleId])).rows[0]
      check('cash 5000 on a 2950 invoice: payment recorded 2950 (change not kept), sale paid 2950',
        pay.length === 1 && pay[0].a === 2950 && sale.p === 2950 && sale.status === 'completed', JSON.stringify({ pay, sale }))
      const cashDr = gl.filter((r) => r.account_id === cash).reduce((s, r) => s + r.d - r.c, 0)
      check('GL cash debit 2950 and every voucher balanced', cashDr === 2950 && Math.abs(gl.reduce((s, r) => s + r.d - r.c, 0)) < 0.001, JSON.stringify(gl))
      setTestSession(session(A))
    })

    // ================= invoice payment validation =================
    await step('WO invoice: store credit needs a customer', async () => {
      const item = await newItem(admin, A, 'Wiper', 800, { stock: 4 })
      const woId = await rawWorkOrder(admin, A, 'completed', [{ itemId: item, qty: 1, price: 800 }], { customer: false })
      const r = await json(await woInvoice(req('POST', `/api/work-orders/${woId}/invoice`, { paymentMethod: 'cash', paidAmount: 0, creditAmount: 800 }), ctx(woId)))
      check('walk-in WO paid by "store credit" → 400 (was: marked fully paid for free)', r.status === 400, JSON.stringify(r.body))
      const wo = (await admin.query(`SELECT status, sale_id FROM work_orders WHERE id=$1`, [woId])).rows[0]
      check('work order not invoiced, stock untouched', wo.status === 'completed' && !wo.sale_id && await stockOf(admin, A.wh, item) === 4, JSON.stringify(wo))
    })

    // ================= cancel after the sale was voided =================
    await step('WO cancel after sale void', async () => {
      const item = await newItem(admin, A, 'Spark plug', 100, { stock: 8 })
      const woId = await rawWorkOrder(admin, A, 'completed', [{ itemId: item, qty: 2, price: 100 }])
      const inv = await json(await woInvoice(req('POST', `/api/work-orders/${woId}/invoice`, { paymentMethod: 'cash', paidAmount: 200 }), ctx(woId)))
      check('invoice → 200, stock 8 → 6', inv.status === 200 && await stockOf(admin, A.wh, item) === 6, JSON.stringify(inv.body).slice(0, 200))
      const v = await json(await voidSale(req('PUT', `/api/sales/${inv.body.id}`, { voidReason: 'wrong customer' }), ctx(inv.body.id)))
      check('sale void → 200, stock back to 8', v.status === 200 && await stockOf(admin, A.wh, item) === 8, JSON.stringify(v.body).slice(0, 200))
      const c = await json(await updateWorkOrder(req('PUT', `/api/work-orders/${woId}`, { status: 'cancelled', cancellationReason: 'gh' }), ctx(woId)))
      check('cancel WO → 200 and stock stays 8 (not restored twice to 10)', c.status === 200 && await stockOf(admin, A.wh, item) === 8, `${c.status} stock=${await stockOf(admin, A.wh, item)}`)
    })

    // ================= cancel with a return against the invoice =================
    await step('WO cancel with returns', async () => {
      const item = await newItem(admin, A, 'Bulb', 300, { stock: 5 })
      const woId = await rawWorkOrder(admin, A, 'completed', [{ itemId: item, qty: 2, price: 300 }])
      const inv = await json(await woInvoice(req('POST', `/api/work-orders/${woId}/invoice`, { paymentMethod: 'cash', paidAmount: 600 }), ctx(woId)))
      const line = (await admin.query(`SELECT id FROM sale_items WHERE sale_id=$1 AND item_id=$2`, [inv.body.id, item])).rows[0]
      const ret = await json(await postSale(req('POST', '/api/sales', {
        isReturn: true, returnAgainst: inv.body.id,
        cartItems: [{ originalSaleItemId: line.id, itemId: item, name: 'Bulb', quantity: -1, unitPrice: 0 }],
        subtotal: 0, tax: 0, total: 0, refundMethod: 'cash', warehouseId: A.wh,
      })))
      check('return 1 → 200, stock 3 → 4', ret.status === 200 && await stockOf(admin, A.wh, item) === 4, JSON.stringify(ret.body).slice(0, 300))
      const c = await json(await updateWorkOrder(req('PUT', `/api/work-orders/${woId}`, { status: 'cancelled' }), ctx(woId)))
      check('cancel invoiced WO that has a return → 400, stock stays 4 (was: 6, one unit restored twice)',
        c.status === 400 && await stockOf(admin, A.wh, item) === 4, `${c.status} ${JSON.stringify(c.body)} stock=${await stockOf(admin, A.wh, item)}`)
    })

    // ================= cancel restores batches; technician cannot void =================
    await step('WO cancel: batches + permission', async () => {
      const item = await newItem(admin, A, 'Coolant', 900, { stock: 6, batches: true })
      const b1 = randomUUID()
      await admin.query(`INSERT INTO item_batches (id, tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity)
        VALUES ($1,$2,$3,'C-1',$4,$5,6,6)`, [b1, A.tenantId, item, A.wh, new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)])
      const woId = await rawWorkOrder(admin, A, 'completed', [{ itemId: item, qty: 4, price: 900 }])
      const inv = await json(await woInvoice(req('POST', `/api/work-orders/${woId}/invoice`, { paymentMethod: 'cash', paidAmount: 3600 }), ctx(woId)))
      const bq = async () => Number((await admin.query(`SELECT current_quantity FROM item_batches WHERE id=$1`, [b1])).rows[0].current_quantity)
      check('invoice draws 4 from the batch (6 → 2)', inv.status === 200 && await bq() === 2, JSON.stringify(inv.body).slice(0, 200))

      setTestSession(session(A, 'technician'))
      const t = await json(await updateWorkOrder(req('PUT', `/api/work-orders/${woId}`, { status: 'cancelled' }), ctx(woId)))
      setTestSession(session(A))
      const st = (await admin.query(`SELECT status FROM sales WHERE id=$1`, [inv.body.id])).rows[0].status
      check('technician cancelling an invoiced WO → 403, invoice not voided', t.status === 403 && st !== 'void', `${t.status} ${st}`)

      const c = await json(await updateWorkOrder(req('PUT', `/api/work-orders/${woId}`, { status: 'cancelled' }), ctx(woId)))
      check('owner cancel → 200, stock 2 → 6 and batch back to 6', c.status === 200 && await stockOf(admin, A.wh, item) === 6 && await bq() === 6,
        `${c.status} stock=${await stockOf(admin, A.wh, item)} batch=${await bq()}`)
    })

    // ================= estimate stock holds =================
    await step('estimate holdStock double counting', async () => {
      const item = await newItem(admin, A, 'Bumper', 15000, { stock: 5 })
      const estId = randomUUID()
      await admin.query(`INSERT INTO insurance_estimates (id, tenant_id, estimate_no, estimate_type, customer_id, vehicle_id, warehouse_id, status, hold_stock)
        VALUES ($1,$2,$3,'direct',$4,$5,$6,'draft',true)`, [estId, A.tenantId, `EST-${estId.slice(0, 6)}`, A.customerId, A.vehicleId, A.wh])
      const add = (qty: number) => addEstimateItem(req('POST', `/api/insurance-estimates/${estId}/items`, { itemType: 'part', itemId: item, partName: 'Bumper', quantity: String(qty), unitPrice: '15000' }), ctx(estId)).then(json)
      const l1 = await add(3)
      check('estimate line 3 of 5 → 200', l1.status === 200, JSON.stringify(l1.body).slice(0, 200))
      const l2 = await add(3)
      check('second line of the same part, 3 more (6 > 5) → 400', l2.status === 400, JSON.stringify(l2.body).slice(0, 200))
      const lineId = l1.body.id || l1.body.item?.id
      const up6 = await json(await updateEstimateItem(req('PUT', `/api/insurance-estimates/${estId}/items`, { itemId: lineId, quantity: '6' }), ctx(estId)))
      check('raising the line to 6 (> 5) → 400 (was allowed: own qty counted twice)', up6.status === 400, JSON.stringify(up6.body).slice(0, 200))
      const up5 = await json(await updateEstimateItem(req('PUT', `/api/insurance-estimates/${estId}/items`, { itemId: lineId, quantity: '5' }), ctx(estId)))
      check('raising the line to 5 (= stock) → 200', up5.status === 200, JSON.stringify(up5.body).slice(0, 200))

      const bad = await json(await updateEstimate(req('PUT', `/api/insurance-estimates/${estId}`, { status: 'submitted' }), ctx(estId)))
      void bad
      await admin.query(`UPDATE insurance_estimates SET status='approved', estimate_type='insurance' WHERE id=$1`, [estId])
      const manual = await json(await updateEstimate(req('PUT', `/api/insurance-estimates/${estId}`, { status: 'work_order_created' }), ctx(estId)))
      check('estimate PUT status=work_order_created (no work order) → 400', manual.status === 400, JSON.stringify(manual.body).slice(0, 200))
    })

    // ================= estimate double conversion =================
    await step('estimate concurrent convert', async () => {
      const estId = randomUUID()
      await admin.query(`INSERT INTO insurance_estimates (id, tenant_id, estimate_no, estimate_type, customer_id, vehicle_id, warehouse_id, status)
        VALUES ($1,$2,$3,'direct',$4,$5,$6,'draft')`, [estId, A.tenantId, `EST-${estId.slice(0, 6)}`, A.customerId, A.vehicleId, A.wh])
      await admin.query(`INSERT INTO insurance_estimate_items (tenant_id, estimate_id, item_type, description, hours, rate, original_amount)
        VALUES ($1,$2,'service','Panel beating',2,3000,6000)`, [A.tenantId, estId])
      const out = await Promise.all([1, 2, 3].map(() => convertEstimate(req('POST', `/api/insurance-estimates/${estId}/convert`, {}), ctx(estId)).then(json)))
      const ok = out.filter((o) => o.status === 200).length
      const wos = (await admin.query(`SELECT count(*)::int n FROM work_order_services s JOIN work_orders w ON w.id=s.work_order_id WHERE w.tenant_id=$1 AND s.description='Panel beating'`, [A.tenantId])).rows[0].n
      check('3 concurrent converts → exactly one work order', ok === 1 && wos === 1, `ok=${ok} services=${wos} ${out.map((o) => o.status).join(',')}`)
    })

    // ================= dealer payments =================
    await step('dealer payment balances', async () => {
      const d = await newDealer(admin, A, 'D1')
      const bal = async () => Number((await admin.query(`SELECT current_balance FROM dealers WHERE id=$1`, [d])).rows[0].current_balance)
      const today = new Date().toISOString().slice(0, 10)
      const p1 = await json(await createDealerPayment(req('POST', '/api/dealer-payments', { dealerId: d, type: 'settlement', direction: 'outbound', amount: 100000, paymentDate: today })))
      const p2 = await json(await createDealerPayment(req('POST', '/api/dealer-payments', { dealerId: d, type: 'advance', direction: 'inbound', amount: 30000, paymentDate: today })))
      check('outbound 100000 + inbound 30000 → balance 70000', p1.status === 200 && p2.status === 200 && await bal() === 70000, `${await bal()}`)
      const c = await json(await updateDealerPayment(req('PUT', `/api/dealer-payments/${p2.body.id}`, { cancellationReason: 'bounced cheque' }), ctx(p2.body.id)))
      check('cancelling the inbound 30000 → balance back to 100000 (was: stayed 70000)', c.status === 200 && await bal() === 100000, `${c.status} ${await bal()}`)
      const conf = await json(await confirmDealerPayment(req('POST', `/api/dealer-payments/${p2.body.id}/confirm`), ctx(p2.body.id)))
      check('cancelled payment cannot be confirmed', conf.status >= 400, `${conf.status}`)
      const dir = await json(await updateDealerPayment(req('PUT', `/api/dealer-payments/${p1.body.id}`, { direction: 'inbound' }), ctx(p1.body.id)))
      check('flipping a pending 100000 outbound to inbound → balance -100000', dir.status === 200 && await bal() === -100000, `${dir.status} ${await bal()}`)
      const st = await json(await dealerStatement(req('GET', `/api/dealers/${d}/statement?startDate=${today}`), ctx(d)))
      check('statement from today: opening 0 (same-day entries not double counted), closing = balance -100000 (cancelled ignored)',
        st.status === 200 && Number(st.body.openingBalance) === 0 && Number(st.body.closingBalance) === -100000, JSON.stringify({ o: st.body.openingBalance, c: st.body.closingBalance }))
    })

    // ================= dealer allocations =================
    await step('dealer allocation uniqueness', async () => {
      const d1 = await newDealer(admin, A, 'AL1')
      const d2 = await newDealer(admin, A, 'AL2')
      const veh = await newVehicleStock(admin, A, `VIN-AL-${randomUUID().slice(0, 6)}`)
      const out = await Promise.all([d1, d2, d1, d2].map((dealerId) => allocate(req('POST', '/api/dealer-allocations', { dealerId, vehicleInventoryId: veh })).then(json)))
      const n = (await admin.query(`SELECT count(*)::int n FROM dealer_allocations WHERE vehicle_inventory_id=$1 AND status='allocated'`, [veh])).rows[0].n
      check('4 concurrent allocations of one vehicle → exactly one active allocation', n === 1 && out.filter((o) => o.status === 200).length === 1,
        `${n} ${out.map((o) => o.status).join(',')}`)
      const sold = await newVehicleStock(admin, A, `VIN-SD-${randomUUID().slice(0, 6)}`, { status: 'sold' })
      const s = await json(await allocate(req('POST', '/api/dealer-allocations', { dealerId: d1, vehicleInventoryId: sold })))
      check('allocating a sold vehicle → 400', s.status === 400, JSON.stringify(s.body))
      const susp = await newDealer(admin, A, 'AL3', { status: 'suspended' })
      const v2 = await newVehicleStock(admin, A, `VIN-SU-${randomUUID().slice(0, 6)}`)
      const s2 = await json(await allocate(req('POST', '/api/dealer-allocations', { dealerId: susp, vehicleInventoryId: v2 })))
      check('allocating to a suspended dealer → 400', s2.status === 400, JSON.stringify(s2.body))
    })

    // ================= vehicle sale / cancel =================
    await step('vehicle sale lifecycle', async () => {
      const veh = await newVehicleStock(admin, A, `VIN-VS-${randomUUID().slice(0, 6)}`)
      const big = await json(await sellVehicle(req('POST', '/api/vehicle-sales', { vehicleInventoryId: veh, customerId: A.customerId, askingPrice: 1000000, tradeInAllowance: 1500000 })))
      check('trade-in larger than the price → 400 (was: negative invoice)', big.status === 400, JSON.stringify(big.body))
      const s = await json(await sellVehicle(req('POST', '/api/vehicle-sales', { vehicleInventoryId: veh, customerId: A.customerId, askingPrice: 5000000, tradeInAllowance: 1000000, downPayment: 1000000 })))
      check('sell vehicle → 200, total 4,000,000', s.status === 200 && Number(s.body.sale?.total) === 4000000, JSON.stringify(s.body).slice(0, 300))
      const again = await json(await sellVehicle(req('POST', '/api/vehicle-sales', { vehicleInventoryId: veh, customerId: A.customerId, askingPrice: 5000000 })))
      check('selling it again → 400', again.status === 400, JSON.stringify(again.body))
      const reopen = await json(await updateVehicleInventory(req('PUT', `/api/vehicle-inventory/${veh}`, { status: 'available' }), ctx(veh)))
      check('flipping the sold vehicle back to available by hand → 400', reopen.status === 400, JSON.stringify(reopen.body))

      const w = await json(await createWarranty(req('POST', '/api/vehicle-warranties', {
        saleId: s.body.sale.id, vehicleInventoryId: veh, warrantyType: 'extended', startDate: '2026-10-01', endDate: '2025-10-01',
      })))
      check('warranty ending before it starts → 400', w.status === 400, JSON.stringify(w.body))
      const other = await newVehicleStock(admin, A, `VIN-OT-${randomUUID().slice(0, 6)}`)
      await admin.query(`UPDATE vehicle_inventory SET sale_id=$1, status='sold' WHERE id=$2`, [s.body.sale.id, veh])
      const w2 = await json(await createWarranty(req('POST', '/api/vehicle-warranties', { saleId: s.body.sale.id, vehicleInventoryId: other, warrantyType: 'extended' })))
      void w2
      const otherSale = randomUUID()
      await admin.query(`INSERT INTO sales (id, tenant_id, invoice_no, subtotal, total, status) VALUES ($1,$2,$3,1,1,'completed')`, [otherSale, A.tenantId, `INV-GH-${otherSale.slice(0, 6)}`])
      const w3 = await json(await createWarranty(req('POST', '/api/vehicle-warranties', { saleId: otherSale, vehicleInventoryId: veh, warrantyType: 'extended' })))
      check('warranty on a vehicle against some other invoice → 400', w3.status === 400, JSON.stringify(w3.body))

      const detailId = s.body.vehicleSaleDetails.id
      setTestSession(session(A, 'dealer_sales'))
      const nc = await json(await updateVehicleSale(req('PUT', `/api/vehicle-sales/${detailId}`, { status: 'cancelled', cancellationReason: 'x' }), ctx(detailId)))
      setTestSession(session(A))
      check('salesperson without Void Sales cannot cancel → 403', nc.status === 403, `${nc.status}`)
      const cn = await json(await updateVehicleSale(req('PUT', `/api/vehicle-sales/${detailId}`, { status: 'cancelled', cancellationReason: 'finance declined' }), ctx(detailId)))
      const vrow = (await admin.query(`SELECT status, sale_id FROM vehicle_inventory WHERE id=$1`, [veh])).rows[0]
      const srow = (await admin.query(`SELECT status FROM sales WHERE id=$1`, [s.body.sale.id])).rows[0]
      check('cancel vehicle sale → 200, invoice void, vehicle available again (was: silently ignored)',
        cn.status === 200 && srow.status === 'void' && vrow.status === 'available' && !vrow.sale_id, JSON.stringify({ cn: cn.status, srow, vrow }))
      const resell = await json(await sellVehicle(req('POST', '/api/vehicle-sales', { vehicleInventoryId: veh, customerId: A.customerId, askingPrice: 4800000 })))
      check('vehicle can be sold again after the cancel', resell.status === 200, JSON.stringify(resell.body).slice(0, 200))
    })

    // ================= trade-ins =================
    await step('trade-in to inventory once', async () => {
      const id = randomUUID()
      const vin = `TRD${randomUUID().slice(0, 8).toUpperCase()}`
      await admin.query(`INSERT INTO trade_in_vehicles (id, tenant_id, make, model, year, vin, appraisal_value, trade_in_allowance, status)
        VALUES ($1,$2,'Suzuki','Alto',2015,$3,1800000,1700000,'accepted')`, [id, A.tenantId, vin])
      const r1 = await json(await updateTradeIn(req('PUT', `/api/trade-ins/${id}`, { status: 'added_to_inventory' }), ctx(id)))
      const r2 = await json(await updateTradeIn(req('PUT', `/api/trade-ins/${id}`, { status: 'accepted' }), ctx(id)))
      const r3 = await json(await updateTradeIn(req('PUT', `/api/trade-ins/${id}`, { status: 'added_to_inventory' }), ctx(id)))
      const inv = (await admin.query(`SELECT source, purchase_price::float p FROM vehicle_inventory WHERE vin=$1 AND tenant_id=$2`, [vin, A.tenantId])).rows
      check('trade-in added → one inventory record at the allowance, source trade_in', r1.status === 200 && inv.length === 1 && inv[0].p === 1700000 && inv[0].source === 'trade_in', JSON.stringify(inv))
      check('stocked trade-in cannot be re-opened / re-added (no duplicate vehicle)', r2.status === 400 && inv.length === 1, `${r2.status} ${r3.status}`)
    })

    // ================= import landed cost =================
    await step('import landed cost includes additional costs', async () => {
      const id = randomUUID()
      await admin.query(`INSERT INTO vehicle_imports (id, tenant_id, import_no, fob_value, freight_cost, insurance_cost, exchange_rate, additional_costs)
        VALUES ($1,$2,$3,10000,1000,0,300,250000)`, [id, A.tenantId, `IM-GH-${id.slice(0, 6)}`])
      const r = await json(await calcImportTax(req('POST', `/api/vehicle-imports/${id}/calculate-tax`, { engineCapacityCc: 1000 }), ctx(id)))
      const b = r.body.breakdown || {}
      check('landed cost = CIF(LKR) + taxes + additional costs (250000)',
        r.status === 200 && Math.abs(b.totalLandedCost - (b.cifValueLkr + b.totalTaxes + 250000)) < 0.01 && Number(r.body.import?.totalLandedCost) === b.totalLandedCost,
        JSON.stringify({ s: r.status, l: b.totalLandedCost, c: b.cifValueLkr, t: b.totalTaxes }))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) {
      for (const f of [A, T]) await cleanup(admin, f.tenantId)
    }
    await admin.end()
    await closeAllPools()
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
