/**
 * Audit E: customers, stored value & hospitality — regression checks for the fixes.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_audit_e DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/gE-customers-hospitality.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on a throw-away tenant, prints
 * PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenant.
 */
// Recurrence dates must not depend on the server timezone: run as a Sri Lankan server would.
process.env.TZ = 'Asia/Colombo'

import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { setTenantFeatureFlags } from '@/lib/features/check'
import { localParts } from '@/lib/notifications/alert-settings'
import { PUT as putGiftCard } from '@/app/api/gift-cards/[id]/route'
import { POST as redeemGiftCard } from '@/app/api/gift-cards/[id]/redeem/route'
import { POST as createLayaway } from '@/app/api/layaways/route'
import { PUT as putLayaway, DELETE as deleteLayaway } from '@/app/api/layaways/[id]/route'
import { POST as payLayaway } from '@/app/api/layaways/[id]/payments/route'
import { POST as forfeitLayaway } from '@/app/api/layaways/[id]/forfeit/route'
import { POST as completeLayaway } from '@/app/api/layaways/[id]/complete/route'
import { POST as customerCredit } from '@/app/api/customers/[id]/credit/route'
import { DELETE as deleteCustomer } from '@/app/api/customers/[id]/route'
import { POST as createQuotation } from '@/app/api/quotations/route'
import { POST as convertQuotation } from '@/app/api/quotations/[id]/convert/route'
import { POST as createSO } from '@/app/api/sales-orders/route'
import { PUT as putSO } from '@/app/api/sales-orders/[id]/route'
import { POST as invoiceSO } from '@/app/api/sales-orders/[id]/create-invoice/route'
import { POST as createRO } from '@/app/api/restaurant-orders/route'
import { PUT as putRO } from '@/app/api/restaurant-orders/[id]/route'
import { POST as addROItem } from '@/app/api/restaurant-orders/[id]/items/route'
import { PUT as putKitchenItem } from '@/app/api/kitchen-orders/[id]/items/[itemId]/route'
import { POST as postSale } from '@/app/api/sales/route'
import { POST as createReservation } from '@/app/api/reservations/route'
import { PUT as putReservation } from '@/app/api/reservations/[id]/route'
import { POST as createAppointment } from '@/app/api/appointments/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; customerId: string }
interface Acc { cash: string; bank: string; ar: string; adv: string; inc: string; gcl: string; cogs: string; stock: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/(poslanka|audit)_[a-z0-9_]+$/i

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
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'GE', businessType: 'restaurant',
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
const ctx2 = (id: string, itemId: string) => ({ params: Promise.resolve({ id, itemId }) })
async function json(resP: Response | undefined | Promise<Response | undefined>): Promise<{ status: number; body: J }> {
  const res = await resP
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}
const short = (r: { status: number; body: J }) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `ge-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, 'GE test', $2, $3, 'restaurant')`, [tenantId, slug, `${slug}@example.test`])
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
async function setupAccounting(admin: Client, f: Fx): Promise<Acc> {
  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, f.tenantId, name, no, root, type])
    return id
  }
  const a: Acc = {
    cash: await acc('Cash', '1100', 'asset', 'cash'),
    bank: await acc('Bank', '1200', 'asset', 'bank'),
    ar: await acc('Receivable', '1300', 'asset', 'receivable'),
    stock: await acc('Stock', '1400', 'asset', 'stock'),
    adv: await acc('Customer Advances', '2300', 'liability', 'payable'),
    gcl: await acc('Gift Card Liability', '2400', 'liability', 'payable'),
    inc: await acc('Sales', '4000', 'income', 'income_account'),
    cogs: await acc('COGS', '5000', 'expense', 'cost_of_goods_sold'),
  }
  const y = new Date().getFullYear()
  const fy = randomUUID()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, f.tenantId, `${y - 1}-01-01`, `${y + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
       default_bank_account_id, default_advance_received_account_id, default_gift_card_liability_account_id,
       default_cogs_account_id, default_stock_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,false)`,
    [f.tenantId, a.ar, a.inc, a.cash, a.bank, a.adv, a.gcl, a.cogs, a.stock, fy])
  return a
}
/** Net debit - credit on an account, optionally limited to one voucher id. */
async function net(admin: Client, f: Fx, accountId: string, voucherId?: string) {
  const r = await admin.query(
    `SELECT COALESCE(SUM(debit::numeric - credit::numeric), 0)::float AS n FROM gl_entries
     WHERE tenant_id=$1 AND account_id=$2 AND ($3::uuid IS NULL OR voucher_id=$3::uuid)`, [f.tenantId, accountId, voucherId ?? null])
  return Math.round(Number(r.rows[0].n) * 100) / 100
}
async function newItem(admin: Client, f: Fx, name: string, price: number, stock = 0, cost = 0) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [id, f.tenantId, `GE-${id.slice(0, 8)}`, name, cost, price])
  if (stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: f.userId,
    }))
  }
  return id
}
async function one(admin: Client, sql: string, params: unknown[]) {
  return (await admin.query(sql, params)).rows[0]
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url || '(no DATABASE_URL)'}: needs a local poslanka_/audit_ database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const F = await makeTenant(admin)
  setTestSession(session(F))
  const today = localParts(new Date(), 'Asia/Colombo').date
  const A = await setupAccounting(admin, F)

  try {
    // ================= gift cards =================
    await step('gift card breakage', async () => {
      const card = randomUUID()
      await admin.query(`INSERT INTO gift_cards (id, tenant_id, card_number, initial_balance, current_balance, status)
        VALUES ($1,$2,$3,500,500,'active')`, [card, F.tenantId, `GC-${card.slice(0, 6)}`])
      const put = (status: string) => json(putGiftCard(req('PUT', `/api/gift-cards/${card}`, { status }), ctx(card)))
      const b1 = await put('blocked')
      check('gift card: block with 500 balance → 200, breakage 500 recognised', b1.status === 200 && await net(admin, F, A.inc, card) === -500, short(b1))
      const u1 = await put('active')
      check('gift card: unblock → breakage reversed (income and liability net 0)',
        u1.status === 200 && await net(admin, F, A.inc, card) === 0 && await net(admin, F, A.gcl, card) === 0, short(u1))
      await put('blocked')
      const e1 = await put('expired')
      check('gift card: block again then expire → breakage counted once (500, not 1000)',
        e1.status === 200 && await net(admin, F, A.inc, card) === -500, `${short(e1)} inc=${await net(admin, F, A.inc, card)}`)
      const card2 = randomUUID()
      await admin.query(`INSERT INTO gift_cards (id, tenant_id, card_number, initial_balance, current_balance, status, expiry_date)
        VALUES ($1,$2,$3,200,200,'active',$4)`, [card2, F.tenantId, `GC-${card2.slice(0, 6)}`, today])
      const used = await json(putGiftCard(req('PUT', `/api/gift-cards/${card2}`, { status: 'used' }), ctx(card2)))
      check('gift card: cannot mark "used" while it has a balance → 400', used.status === 400, short(used))
      const inactive = await json(putGiftCard(req('PUT', `/api/gift-cards/${card2}`, { status: 'inactive' }), ctx(card2)))
      check('gift card: active card cannot go back to inactive → 400', inactive.status === 400, short(inactive))
      const r = await json(redeemGiftCard(req('POST', `/api/gift-cards/${card2}/redeem`, { amount: 50 }), ctx(card2)))
      check('gift card: valid on its expiry date (Asia/Colombo) → redeem 200, balance 150',
        r.status === 200 && Number(r.body.newBalance) === 150, short(r))
      await admin.query(`UPDATE gift_cards SET expiry_date = ($2::date - 1) WHERE id=$1`, [card2, today])
      const r2 = await json(redeemGiftCard(req('POST', `/api/gift-cards/${card2}/redeem`, { amount: 10 }), ctx(card2)))
      check('gift card: expired yesterday → redeem 400', r2.status === 400, short(r2))
    })

    // ================= layaways =================
    const P = await newItem(admin, F, 'Saree', 1000, 10, 600)
    const mkLayaway = async (deposit: number) => json(createLayaway(req('POST', '/api/layaways', {
      customerId: F.customerId, items: [{ itemId: P, itemName: 'Saree', quantity: 1, unitPrice: 1000 }], depositAmount: deposit, taxAmount: 0,
    })))

    await step('layaway payment methods', async () => {
      const l = await mkLayaway(200)
      check('layaway: created with 200 deposit', l.status === 200, short(l))
      const g = await json(payLayaway(req('POST', `/api/layaways/${l.body.id}/payments`, { amount: 100, paymentMethod: 'gift_card' }), ctx(l.body.id)))
      check('layaway: gift_card payment rejected (would post as cash) → 400', g.status === 400, short(g))
      const c = await json(payLayaway(req('POST', `/api/layaways/${l.body.id}/payments`, { amount: 100, paymentMethod: 'credit' }), ctx(l.body.id)))
      check('layaway: store-credit payment rejected → 400', c.status === 400, short(c))
      const del = await json(deleteLayaway(req('DELETE', `/api/layaways/${l.body.id}`), ctx(l.body.id)))
      // A layaway with money on it is cancelled (deposit → store credit), never deleted
      check('layaway: delete with a deposit → 400, GL untouched (cash 200 still booked)',
        del.status === 400 && await net(admin, F, A.cash, l.body.id) === 200,
        `${short(del)} cash=${await net(admin, F, A.cash, l.body.id)}`)
    })

    await step('layaway cancel', async () => {
      const before = Number((await one(admin, `SELECT balance FROM customers WHERE id=$1`, [F.customerId])).balance)
      const l = await mkLayaway(300)
      const c = await json(putLayaway(req('PUT', `/api/layaways/${l.body.id}`, { status: 'cancelled', cancellationReason: 'changed mind' }), ctx(l.body.id)))
      const after = Number((await one(admin, `SELECT balance FROM customers WHERE id=$1`, [F.customerId])).balance)
      check('layaway cancel: deposit moved to store credit (+300)', c.status === 200 && after - before === 300, `${short(c)} ${before}->${after}`)
      check('layaway cancel: cash kept in GL (Dr 300) and advance still owed (Cr 300)',
        await net(admin, F, A.cash, l.body.id) === 300 && await net(admin, F, A.adv, l.body.id) === -300,
        `cash=${await net(admin, F, A.cash, l.body.id)} adv=${await net(admin, F, A.adv, l.body.id)}`)
    })

    await step('layaway forfeit', async () => {
      const l = await mkLayaway(400)
      const f = await json(forfeitLayaway(req('POST', `/api/layaways/${l.body.id}/forfeit`, { refundPercentage: 25, refundToCredit: true }), ctx(l.body.id)))
      check('layaway forfeit 25% to credit: cash stays 400, advance 100 owed, income 300',
        f.status === 200 && await net(admin, F, A.cash, l.body.id) === 400 && await net(admin, F, A.adv, l.body.id) === -100
        && await net(admin, F, A.inc, l.body.id) === -300,
        `${short(f)} cash=${await net(admin, F, A.cash, l.body.id)} adv=${await net(admin, F, A.adv, l.body.id)} inc=${await net(admin, F, A.inc, l.body.id)}`)
      const l2 = await mkLayaway(400)
      const f2 = await json(forfeitLayaway(req('POST', `/api/layaways/${l2.body.id}/forfeit`, { refundPercentage: 25, refundToCredit: false }), ctx(l2.body.id)))
      check('layaway forfeit 25% cash refund: cash 300, advance 0, income 300',
        f2.status === 200 && await net(admin, F, A.cash, l2.body.id) === 300 && await net(admin, F, A.adv, l2.body.id) === 0
        && await net(admin, F, A.inc, l2.body.id) === -300,
        `${short(f2)} cash=${await net(admin, F, A.cash, l2.body.id)} adv=${await net(admin, F, A.adv, l2.body.id)}`)
    })

    await step('layaway complete', async () => {
      const l = await mkLayaway(400)
      await json(payLayaway(req('POST', `/api/layaways/${l.body.id}/payments`, { amount: 600, paymentMethod: 'cash' }), ctx(l.body.id)))
      const c = await json(completeLayaway(req('POST', `/api/layaways/${l.body.id}/complete`, {}), ctx(l.body.id)))
      const saleId = c.body.sale?.id
      const cashTotal = await net(admin, F, A.cash, l.body.id) + (saleId ? await net(admin, F, A.cash, saleId) : 0)
      const advTotal = await net(admin, F, A.adv, l.body.id) + (saleId ? await net(admin, F, A.adv, saleId) : 0)
      check('layaway complete: cash counted once (1000), advance released (0), AR settled, revenue 1000',
        c.status === 200 && cashTotal === 1000 && advTotal === 0 && await net(admin, F, A.ar, saleId) === 0 && await net(admin, F, A.inc, saleId) === -1000,
        `${short(c)} cash=${cashTotal} adv=${advTotal} ar=${saleId && await net(admin, F, A.ar, saleId)}`)
    })

    // ================= customer credit =================
    await step('customer credit', async () => {
      const cust = randomUUID()
      await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1,$2,'Kamala')`, [cust, F.tenantId])
      await json(customerCredit(req('POST', `/api/customers/${cust}/credit`, { amount: 0.1, type: 'add' }), ctx(cust)))
      const r = await json(customerCredit(req('POST', `/api/customers/${cust}/credit`, { amount: 0.2, type: 'add' }), ctx(cust)))
      check('customer credit: 0.1 + 0.2 stored as 0.30 (rounded)', r.status === 200 && r.body.newBalance === '0.3', short(r))
      const neg = await json(customerCredit(req('POST', `/api/customers/${cust}/credit`, { amount: -5, type: 'adjustment' }), ctx(cust)))
      check('customer credit: negative adjustment below zero → 400', neg.status === 400, short(neg))
      const del = await json(deleteCustomer(req('DELETE', `/api/customers/${cust}`), ctx(cust)))
      check('customer delete: blocked while store credit is owed → 400', del.status === 400 && /store credit/.test(String(del.body.error)), short(del))
      const cust2 = randomUUID()
      await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1,$2,'Sunil')`, [cust2, F.tenantId])
      await admin.query(`INSERT INTO quotations (tenant_id, quotation_no, customer_id, subtotal, discount, tax, total, status)
        VALUES ($1,'QT-X',$2,0,0,0,0,'draft')`, [F.tenantId, cust2])
      const del2 = await json(deleteCustomer(req('DELETE', `/api/customers/${cust2}`), ctx(cust2)))
      check('customer delete: other history (quotation) → archived to the recycle bin, not a 500', del2.status === 200 && del2.body.archived === true, short(del2))
    })

    // ================= quotations =================
    await step('quotations', async () => {
      await setTenantFeatureFlags(F.tenantId, { quotation: true })
      const q = await json(createQuotation(req('POST', '/api/quotations', {
        customerId: F.customerId, validUntil: today, subtotal: 1000, total: 1000,
        items: [{ itemId: P, itemName: 'Saree', quantity: 1, unitPrice: 1000, total: 1000 }],
      })))
      check('quotation: created', q.status === 201, short(q))
      const [a, b] = await Promise.all([
        json(convertQuotation(req('POST', `/api/quotations/${q.body.id}/convert`), ctx(q.body.id))),
        json(convertQuotation(req('POST', `/api/quotations/${q.body.id}/convert`), ctx(q.body.id))),
      ])
      check('quotation: valid on its "valid until" day and converted exactly once under concurrency',
        [a.status, b.status].sort().join(',') === '200,400', `${short(a)} | ${short(b)}`)
    })

    // ================= sales orders =================
    await step('sales orders', async () => {
      const X = await newItem(admin, F, 'Kettle', 2500, 5, 1500)
      const Y = await newItem(admin, F, 'Toaster', 4000, 1, 2500)
      const bad = await json(createSO(req('POST', '/api/sales-orders', {
        warehouseId: F.wh, items: [{ itemId: X, itemName: 'Kettle', quantity: 1, unitPrice: 2500, discount: 3000 }],
      })))
      check('sales order: discount larger than the line → 400', bad.status === 400, short(bad))
      const so = await json(createSO(req('POST', '/api/sales-orders', {
        warehouseId: F.wh, customerId: F.customerId,
        items: [{ itemId: X, itemName: 'Kettle', quantity: 2, unitPrice: 2500 }, { itemId: Y, itemName: 'Toaster', quantity: 3, unitPrice: 4000 }],
      })))
      const conf = await json(putSO(req('PUT', `/api/sales-orders/${so.body.id}`, { status: 'confirmed' }), ctx(so.body.id)))
      const resX = Number((await one(admin, `SELECT reserved_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [F.wh, X])).reserved_stock)
      const st = (await one(admin, `SELECT status FROM sales_orders WHERE id=$1`, [so.body.id])).status
      check('sales order: confirm fails on 2nd line → 400 and the 1st line reservation is rolled back',
        conf.status === 400 && resX === 0 && st === 'draft', `${short(conf)} reservedX=${resX} status=${st}`)

      const so2 = await json(createSO(req('POST', '/api/sales-orders', {
        warehouseId: F.wh, customerId: F.customerId, items: [{ itemId: X, itemName: 'Kettle', quantity: 4, unitPrice: 2500 }],
      })))
      await json(putSO(req('PUT', `/api/sales-orders/${so2.body.id}`, { status: 'confirmed' }), ctx(so2.body.id)))
      const lines = await admin.query(`SELECT id FROM sales_order_items WHERE sales_order_id=$1`, [so2.body.id])
      const inv = await json(invoiceSO(req('POST', `/api/sales-orders/${so2.body.id}/create-invoice`, {
        fulfilledQuantities: { [lines.rows[0].id]: 1 },
      }), ctx(so2.body.id)))
      const saleId = inv.body.sale?.id
      check('sales order invoice: posted to GL (AR Dr 2500, revenue Cr 2500, COGS 1500)',
        inv.status === 200 && await net(admin, F, A.ar, saleId) === 2500 && await net(admin, F, A.inc, saleId) === -2500
        && await net(admin, F, A.cogs, saleId) === 1500, `${short(inv)} ar=${saleId && await net(admin, F, A.ar, saleId)}`)
      const close = await json(putSO(req('PUT', `/api/sales-orders/${so2.body.id}`, { status: 'fulfilled' }), ctx(so2.body.id)))
      const res2 = Number((await one(admin, `SELECT reserved_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [F.wh, X])).reserved_stock)
      check('sales order: closing as fulfilled releases the unfulfilled reservation (3 → 0)', close.status === 200 && res2 === 0, `${short(close)} reserved=${res2}`)
    })

    // ================= restaurant =================
    await step('restaurant', async () => {
      const t1 = randomUUID()
      await admin.query(`INSERT INTO restaurant_tables (id, tenant_id, name, capacity) VALUES ($1,$2,'T1',4)`, [t1, F.tenantId])
      const [o1, o2] = await Promise.all([
        json(createRO(req('POST', '/api/restaurant-orders', { tableId: t1, orderType: 'dine_in' }))),
        json(createRO(req('POST', '/api/restaurant-orders', { tableId: t1, orderType: 'dine_in' }))),
      ])
      check('restaurant: two waiters opening the same table at once → only one order', [o1.status, o2.status].sort().join(',') === '200,400',
        `${short(o1)} | ${short(o2)}`)
      const order = o1.status === 200 ? o1.body : o2.body

      const Kottu = await newItem(admin, F, 'Kottu', 800)
      await admin.query(`UPDATE items SET track_stock=false WHERE id=$1`, [Kottu])
      const i1 = await json(addROItem(req('POST', `/api/restaurant-orders/${order.id}/items`, { itemId: Kottu, itemName: 'Kottu', quantity: 2, unitPrice: 800 }), ctx(order.id)))
      const i2 = await json(addROItem(req('POST', `/api/restaurant-orders/${order.id}/items`, { itemId: Kottu, itemName: 'Kottu', quantity: 1, unitPrice: 800 }), ctx(order.id)))
      const k = await json(putKitchenItem(req('PUT', `/api/kitchen-orders/${i2.body.kitchenItem.kitchenOrderId}/items/${i2.body.kitchenItem.id}`, { status: 'cancelled' }),
        ctx2(i2.body.kitchenItem.kitchenOrderId, i2.body.kitchenItem.id)))
      const tot = Number((await one(admin, `SELECT total FROM restaurant_orders WHERE id=$1`, [order.id])).total)
      check('restaurant: line cancelled in the kitchen is removed from the bill (2400 → 1600)', i1.status === 200 && k.status === 200 && tot === 1600, `${short(k)} total=${tot}`)
      await json(putRO(req('PUT', `/api/restaurant-orders/${order.id}`, { status: 'closed' }), ctx(order.id)))
      const done = await json(putRO(req('PUT', `/api/restaurant-orders/${order.id}`, { status: 'completed' }), ctx(order.id)))
      const sale = done.body.saleId ? await one(admin, `SELECT total FROM sales WHERE id=$1`, [done.body.saleId]) : null
      check('restaurant: completed sale bills only live lines (1600) and is posted to GL (cash Dr 1600, revenue Cr 1600)',
        done.status === 200 && Number(sale?.total) === 1600 && await net(admin, F, A.cash, done.body.saleId) === 1600
        && await net(admin, F, A.inc, done.body.saleId) === -1600, `${short(done)} sale=${JSON.stringify(sale)}`)

      // POS flow: order still 'open' when the POS sale settles it
      const t2 = randomUUID()
      await admin.query(`INSERT INTO restaurant_tables (id, tenant_id, name, capacity) VALUES ($1,$2,'T2',4)`, [t2, F.tenantId])
      const po = await json(createRO(req('POST', '/api/restaurant-orders', { tableId: t2, orderType: 'dine_in' })))
      await json(addROItem(req('POST', `/api/restaurant-orders/${po.body.id}/items`, { itemId: Kottu, itemName: 'Kottu', quantity: 1, unitPrice: 800 }), ctx(po.body.id)))
      const bogus = await json(putRO(req('PUT', `/api/restaurant-orders/${po.body.id}`, { status: 'completed', skipSaleCreation: true, saleId: randomUUID() }), ctx(po.body.id)))
      check('restaurant POS flow: unknown sale id → 400', bogus.status === 400, short(bogus))
      const s = await json(postSale(req('POST', '/api/sales', {
        cartItems: [{ itemId: Kottu, name: 'Kottu', quantity: 1, unitPrice: 800, discount: 0 }],
        paymentMethod: 'cash', subtotal: 800, discount: 0, tax: 0, total: 800, amountPaid: 800, creditAmount: 0, warehouseId: F.wh,
        restaurantOrderId: po.body.id,
      })))
      const pos = await json(putRO(req('PUT', `/api/restaurant-orders/${po.body.id}`, { status: 'completed', skipSaleCreation: true, saleId: s.body.id }), ctx(po.body.id)))
      const t2s = (await one(admin, `SELECT status FROM restaurant_tables WHERE id=$1`, [t2])).status
      check('restaurant POS flow: open order completed by the POS sale → 200, table freed',
        s.status === 200 && pos.status === 200 && pos.body.status === 'completed' && t2s === 'available', `${short(s)} | ${short(pos)} table=${t2s}`)
    })

    // ================= reservations =================
    await step('reservations', async () => {
      const t = randomUUID()
      await admin.query(`INSERT INTO restaurant_tables (id, tenant_id, name, capacity) VALUES ($1,$2,'R1',4)`, [t, F.tenantId])
      const mk = (time: string, date = '2031-03-10', duration = 90) => json(createReservation(req('POST', '/api/reservations', {
        customerName: 'Ruwan', tableId: t, reservationDate: date, reservationTime: time, partySize: 2, estimatedDuration: duration,
      })))
      const a = await mk('19:00')
      const b = await mk('20:00')
      const c = await mk('20:30')
      check('reservation: overlapping booking on the same table → 409, adjacent slot → 200',
        a.status === 200 && b.status === 409 && c.status === 200, `${a.status} ${b.status} ${c.status} ${JSON.stringify(b.body)}`)
      const late = await mk('23:30', '2031-03-11', 120)
      const early = await mk('00:30', '2031-03-12', 60)
      check('reservation: booking running past midnight blocks the next day\'s early slot → 409', late.status === 200 && early.status === 409,
        `${short(late)} | ${short(early)}`)
      const move = await json(putReservation(req('PUT', `/api/reservations/${c.body.id}`, { reservationTime: '19:30' }), ctx(c.body.id)))
      check('reservation: moving into an occupied slot → 409', move.status === 409, short(move))
    })

    // ================= appointments =================
    await step('appointments', async () => {
      const veh = randomUUID()
      await admin.query(`INSERT INTO vehicles (id, tenant_id, customer_id, make, model) VALUES ($1,$2,$3,'Toyota','Axio')`, [veh, F.tenantId, F.customerId])
      const svc = randomUUID()
      await admin.query(`INSERT INTO service_types (id, tenant_id, name) VALUES ($1,$2,'Full service')`, [svc, F.tenantId])
      const w = await json(createAppointment(req('POST', '/api/appointments', {
        customerId: F.customerId, vehicleId: veh, serviceTypeId: svc, scheduledDate: '2031-11-03', scheduledTime: '09:00',
        recurrencePattern: 'weekly', recurrenceEndDate: '2031-11-24',
      })))
      const wd = (await admin.query(`SELECT scheduled_date::text d FROM appointments WHERE tenant_id=$1 AND (id=$2 OR parent_appointment_id=$2) ORDER BY 1`,
        [F.tenantId, w.body.appointment?.id])).rows.map((r) => r.d).join(',')
      check('appointment weekly recurrence on an Asia/Colombo server keeps the weekday',
        w.status === 200 && wd === '2031-11-03,2031-11-10,2031-11-17,2031-11-24', `${short(w)} ${wd}`)
      const m = await json(createAppointment(req('POST', '/api/appointments', {
        customerId: F.customerId, vehicleId: veh, serviceTypeId: svc, scheduledDate: '2031-01-31', scheduledTime: '10:00',
        recurrencePattern: 'monthly', recurrenceEndDate: '2031-04-30',
      })))
      const md = (await admin.query(`SELECT scheduled_date::text d FROM appointments WHERE tenant_id=$1 AND (id=$2 OR parent_appointment_id=$2) ORDER BY 1`,
        [F.tenantId, m.body.appointment?.id])).rows.map((r) => r.d).join(',')
      check('appointment monthly recurrence from the 31st clamps to month end (no skipped month)',
        m.status === 200 && md === '2031-01-31,2031-02-28,2031-03-31,2031-04-30', `${short(m)} ${md}`)
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) await cleanup(admin, F.tenantId)
    await admin.end()
    await closeAllPools()
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
