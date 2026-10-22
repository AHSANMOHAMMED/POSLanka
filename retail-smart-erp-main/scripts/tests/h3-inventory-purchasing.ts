/**
 * H3 procure-to-pay accounting + inventory integrity suite.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_<name> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/h3-inventory-purchasing.ts
 *
 * Covers: GRN → Stock Received But Not Billed, invoice clearing + price difference, legacy GRNs,
 * 3-way match (warn / block), landed cost vouchers, reorder (on order, max stock, warehouse,
 * create POs / requisitions, auto reorder), adjustment reason codes + GL mapping, atomic bulk
 * adjustments, valuation reconciliation / audit, negative-stock policy, purchasing RBAC.
 * Real route handlers (auth mocked via the w8 harness) on throw-away tenants. KEEP_TEST_DATA=1 keeps them.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { allowNegativeStockFor } from '@/lib/inventory/negative-stock-policy'
import { runAutoReorder } from '@/lib/purchasing/reorder'
import { POST as createPurchase, GET as listPurchases } from '@/app/api/purchases/route'
import { PUT as updatePurchase } from '@/app/api/purchases/[id]/route'
import { GET as matchPurchase } from '@/app/api/purchases/[id]/match/route'
import { POST as receivePO } from '@/app/api/purchase-orders/[id]/receive/route'
import { GET as listPOs } from '@/app/api/purchase-orders/route'
import { POST as fromReorder } from '@/app/api/purchase-orders/from-reorder/route'
import { DELETE as cancelReceipt } from '@/app/api/purchase-receipts/[id]/route'
import { GET as listSuppliers } from '@/app/api/suppliers/route'
import { POST as createLCV } from '@/app/api/landed-cost-vouchers/route'
import { DELETE as cancelLCV } from '@/app/api/landed-cost-vouchers/[id]/route'
import { PUT as savePurchasingSettings } from '@/app/api/purchasing/settings/route'
import { GET as reorderSuggestions } from '@/app/api/reports/reorder-suggestions/route'
import { GET as adjustmentsByReason } from '@/app/api/reports/adjustments-by-reason/route'
import { GET as valuationRecon } from '@/app/api/reports/inventory-valuation-reconciliation/route'
import { GET as accountingAudit } from '@/app/api/accounting/audit/route'
import { POST as adjustStock } from '@/app/api/warehouses/[id]/stock/route'
import { POST as bulkAdjust } from '@/app/api/stock-adjustments/bulk/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; wh2: string; userId: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

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
      id: f.userId, accountId: null, email: `${role}-${f.slug}@example.test`, name: role, role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'H3', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, body?: unknown, url = 'http://localhost/api/test'): NextRequest {
  return new NextRequest(url, {
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
  const slug = `h3-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), wh2: randomUUID(), userId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'H3 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Branch', 'BR', false)`, [f.wh2, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
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

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url || '(no DATABASE_URL)'}: needs a local poslanka_<name> database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const A = await makeTenant(admin, 'a')
  setTestSession(session(A))

  // ---- accounting for A ----
  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, A.tenantId, name, no, root, type])
    return id
  }
  const ACC = {
    cash: await acc('Cash', '1110', 'asset', 'cash'),
    stock: await acc('Inventory', '1140', 'asset', 'stock'),
    ap: await acc('Accounts Payable', '2110', 'liability', 'payable'),
    srbnb: await acc('Stock Received But Not Billed', '2190', 'liability', 'current_liability'),
    customs: await acc('Customs Payable', '2195', 'liability', 'current_liability'),
    cogs: await acc('COGS', '5100', 'expense', 'cost_of_goods_sold'),
    adj: await acc('Stock Adjustment', '5500', 'expense', 'expense_account'),
    damage: await acc('Damaged Goods', '5520', 'expense', 'expense_account'),
    ppv: await acc('Price Variance', '5510', 'expense', 'expense_account'),
  }
  const fy = randomUUID()
  const year = new Date().getFullYear()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, A.tenantId, `${year - 1}-01-01`, `${year + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_cash_account_id, default_stock_account_id, default_payable_account_id,
       default_srbnb_account_id, default_cogs_account_id, default_stock_adjustment_account_id, current_fiscal_year_id,
       auto_post_sales, auto_post_purchases, stock_adjustment_reason_accounts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,$9)`,
    [A.tenantId, ACC.cash, ACC.stock, ACC.ap, ACC.srbnb, ACC.cogs, ACC.adj, fy, JSON.stringify({ damage: ACC.damage })])

  const newSupplier = async (name: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, $3)`, [id, A.tenantId, `${name} ${id.slice(0, 6)}`])
    return id
  }
  const newItem = async (name: string, cost: number, stock = 0, supplierId: string | null = null) => {
    const id = randomUUID()
    await admin.query(
      `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, supplier_id) VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
      [id, A.tenantId, `H3-${id.slice(0, 8)}`, name, cost, cost * 2, supplierId])
    if (stock) await move(id, stock)
    return id
  }
  const move = (itemId: string, qty: number, wh = A.wh) => withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
    tenantId: A.tenantId, warehouseId: wh, itemId, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: A.userId, allowNegative: true,
  }))
  const stockOf = async (itemId: string, wh = A.wh) => {
    const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
    return r.rows[0] ? Number(r.rows[0].current_stock) : 0
  }
  const costOf = async (itemId: string) => Number((await admin.query(`SELECT cost_price FROM items WHERE id=$1`, [itemId])).rows[0].cost_price)
  const balanceOf = async (supplierId: string) => Number((await admin.query(`SELECT balance FROM suppliers WHERE id=$1`, [supplierId])).rows[0].balance)
  /** net (debit − credit) per account for a voucher */
  const glOf = async (voucherType: string, voucherId: string) => {
    const r = await admin.query(`SELECT account_id, SUM(debit - credit)::float AS net FROM gl_entries WHERE voucher_type=$1 AND voucher_id=$2 GROUP BY account_id`, [voucherType, voucherId])
    const m: Record<string, number> = {}
    for (const row of r.rows) m[row.account_id] = Math.round(row.net * 100) / 100
    return m
  }
  const accountBalance = async (accountId: string) => Number((await admin.query(
    `SELECT COALESCE(SUM(debit - credit), 0)::float AS b FROM gl_entries WHERE account_id=$1`, [accountId])).rows[0].b)
  const makePO = async (supplierId: string, lines: Array<{ itemId: string; qty: number; price: number }>, wh = A.wh, status = 'confirmed') => {
    const poId = randomUUID()
    await admin.query(`INSERT INTO purchase_orders (id, tenant_id, order_no, supplier_id, warehouse_id, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [poId, A.tenantId, `PO-H3-${poId.slice(0, 8)}`, supplierId, wh, status])
    const lineIds: string[] = []
    for (const l of lines) {
      const lineId = randomUUID()
      await admin.query(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,$4,'Line',$5,$6,$7)`,
        [lineId, A.tenantId, poId, l.itemId, l.qty, l.price, l.qty * l.price])
      lineIds.push(lineId)
    }
    return { poId, lineIds }
  }
  const receive = async (poId: string, lines: Array<{ lineId: string; qty: number }>) =>
    json(await receivePO(req('POST', { items: lines.map(l => ({ itemId: l.lineId, receivedQuantity: l.qty })), updateStock: true }), ctx(poId)))
  const draft = async (supplierId: string, items: J[], extra: J = {}) =>
    json(await createPurchase(req('POST', { supplierId, warehouseId: A.wh, items, ...extra })))
  const submit = async (id: string) => json(await updatePurchase(req('PUT', { status: 'pending' }), ctx(id)))
  const cancel = async (id: string) => json(await updatePurchase(req('PUT', { status: 'cancelled', cancellationReason: 'test' }), ctx(id)))
  const setPurchasing = async (body: J) => json(await savePurchasingSettings(req('PUT', body)))

  try {
    // ============ 1. GRN posts Dr Stock / Cr SRBNB; invoice clears SRBNB ============
    await step('GRN → SRBNB → invoice', async () => {
      const S = await newSupplier('Lanka Foods')
      const X = await newItem('Rice 5kg', 100)
      const { poId, lineIds } = await makePO(S, [{ itemId: X, qty: 10, price: 100 }])
      const grn = await receive(poId, [{ lineId: lineIds[0], qty: 10 }])
      check('GRN 10 × 100 → 200, stock 10', grn.status === 200 && await stockOf(X) === 10, JSON.stringify(grn.body).slice(0, 300))
      const gl = await glOf('purchase_receipt', grn.body.receiptId)
      check('GRN GL: Dr Stock 1000 / Cr SRBNB 1000', gl[ACC.stock] === 1000 && gl[ACC.srbnb] === -1000, JSON.stringify(gl))
      const flag = await admin.query(`SELECT gl_posted FROM purchase_receipts WHERE id=$1`, [grn.body.receiptId])
      check('GRN marked gl_posted', flag.rows[0].gl_posted === true)

      const d = await draft(S, [{ itemId: X, itemName: 'Rice', quantity: 10, unitPrice: 100 }], { purchaseOrderId: poId, supplierInvoiceNo: `LF-${randomUUID().slice(0, 6)}` })
      const sub = await submit(d.body.id)
      check('submit invoice at GRN price → 200, stock still 10', sub.status === 200 && await stockOf(X) === 10, JSON.stringify(sub.body).slice(0, 300))
      const igl = await glOf('purchase', d.body.id)
      check('invoice GL: Dr SRBNB 1000 / Cr AP 1000, no Stock line', igl[ACC.srbnb] === 1000 && igl[ACC.ap] === -1000 && !igl[ACC.stock], JSON.stringify(igl))
      const line = await admin.query(`SELECT srbnb_qty::float q, srbnb_amount::float a FROM purchase_items WHERE purchase_id=$1`, [d.body.id])
      check('invoice line records srbnb 10 / 1000', line.rows[0].q === 10 && line.rows[0].a === 1000, JSON.stringify(line.rows))
      check('3-way match stored: matched', sub.body.matchStatus === 'matched', JSON.stringify(sub.body.matchDetails))

      const blocked = await json(await cancelReceipt(req('DELETE', {}), ctx(grn.body.receiptId)))
      check('GRN cancel while billed → 400', blocked.status === 400)
      const c = await cancel(d.body.id)
      const igl2 = await glOf('purchase', d.body.id)
      check('cancel invoice → its GL nets to 0 (SRBNB re-opened)', c.status === 200 && Object.values(igl2).every(v => v === 0), JSON.stringify(igl2))
      const cg = await json(await cancelReceipt(req('DELETE', {}), ctx(grn.body.receiptId)))
      const gl2 = await glOf('purchase_receipt', grn.body.receiptId)
      check('cancel GRN → GRN GL reversed (nets to 0), stock 0', cg.status === 200 && Object.values(gl2).every(v => v === 0) && await stockOf(X) === 0,
        `${cg.status} ${JSON.stringify(gl2)}`)
    })

    // ============ 2. Price difference (no variance account → item cost / COGS) ============
    await step('invoice dearer than GRN', async () => {
      const S = await newSupplier('Dear Co')
      const X = await newItem('Oil 1L', 100)
      const { poId, lineIds } = await makePO(S, [{ itemId: X, qty: 10, price: 100 }])
      await receive(poId, [{ lineId: lineIds[0], qty: 10 }])
      await move(X, -4) // 4 sold before the bill arrives → 6 on hand
      const d = await draft(S, [{ itemId: X, itemName: 'Oil', quantity: 10, unitPrice: 110 }], { purchaseOrderId: poId })
      const sub = await submit(d.body.id)
      check('submit (warn mode) → 200, match mismatch (price +10%)', sub.status === 200 && sub.body.matchStatus === 'mismatch'
        && sub.body.matchDetails?.issues?.[0]?.type === 'price', JSON.stringify(sub.body.matchDetails).slice(0, 300))
      const gl = await glOf('purchase', d.body.id)
      // diff 100: 6/10 on hand → 60 into stock, 40 to COGS
      check('GL: Dr SRBNB 1000, Dr Stock 60, Dr COGS 40, Cr AP 1100', gl[ACC.srbnb] === 1000 && gl[ACC.stock] === 60 && gl[ACC.cogs] === 40 && gl[ACC.ap] === -1100, JSON.stringify(gl))
      check('cost of the 6 on hand 100 → 110', await costOf(X) === 110, `cost=${await costOf(X)}`)
      const m = await json(await matchPurchase(req('GET'), ctx(d.body.id)))
      check('GET match returns the stored result', m.status === 200 && m.body.status === 'mismatch' && m.body.stored === true, JSON.stringify(m.body).slice(0, 200))
      const c = await cancel(d.body.id)
      check('cancel → price difference taken back out of cost (110 → 100)', c.status === 200 && await costOf(X) === 100, `cost=${await costOf(X)}`)
    })

    // ============ 3. Price variance account ============
    await step('price variance account', async () => {
      await admin.query(`UPDATE accounting_settings SET default_price_variance_account_id=$1 WHERE tenant_id=$2`, [ACC.ppv, A.tenantId])
      const S = await newSupplier('Cheap Co')
      const X = await newItem('Dhal 1kg', 100)
      const { poId, lineIds } = await makePO(S, [{ itemId: X, qty: 10, price: 100 }])
      await receive(poId, [{ lineId: lineIds[0], qty: 10 }])
      const d = await draft(S, [{ itemId: X, itemName: 'Dhal', quantity: 10, unitPrice: 90 }], { purchaseOrderId: poId })
      await submit(d.body.id)
      const gl = await glOf('purchase', d.body.id)
      check('GL: Dr SRBNB 1000, Cr variance 100, Cr AP 900, no stock line', gl[ACC.srbnb] === 1000 && gl[ACC.ppv] === -100 && gl[ACC.ap] === -900 && !gl[ACC.stock], JSON.stringify(gl))
      check('item cost unchanged (100) with a variance account', await costOf(X) === 100)
      await admin.query(`UPDATE accounting_settings SET default_price_variance_account_id=NULL WHERE tenant_id=$1`, [A.tenantId])
    })

    // ============ 4. Legacy GRN (before H3): invoice posts the stock ============
    await step('legacy GRN', async () => {
      const S = await newSupplier('Old Co')
      const X = await newItem('Tea 400g', 100)
      const { poId, lineIds } = await makePO(S, [{ itemId: X, qty: 5, price: 100 }])
      const grn = await receive(poId, [{ lineId: lineIds[0], qty: 5 }])
      // simulate a GRN made before this change: no GL, not flagged
      await admin.query(`DELETE FROM gl_entries WHERE voucher_type='purchase_receipt' AND voucher_id=$1`, [grn.body.receiptId])
      await admin.query(`UPDATE purchase_receipts SET gl_posted=false WHERE id=$1`, [grn.body.receiptId])
      const d = await draft(S, [{ itemId: X, itemName: 'Tea', quantity: 5, unitPrice: 100 }], { purchaseOrderId: poId })
      await submit(d.body.id)
      const gl = await glOf('purchase', d.body.id)
      check('invoice of a legacy GRN: Dr Stock 500 / Cr AP 500 (old behaviour)', gl[ACC.stock] === 500 && gl[ACC.ap] === -500 && !gl[ACC.srbnb], JSON.stringify(gl))
      check('stock still 5 (not received twice)', await stockOf(X) === 5)
    })

    // ============ 5. 3-way match: quantity + block mode ============
    await step('3-way match block', async () => {
      const S = await newSupplier('Match Co')
      const X = await newItem('Soap', 50)
      const { poId, lineIds } = await makePO(S, [{ itemId: X, qty: 10, price: 50 }])
      await receive(poId, [{ lineId: lineIds[0], qty: 10 }])
      const st = await setPurchasing({ matchAction: 'block', matchPriceTolerancePct: 5, matchQtyTolerancePct: 0 })
      check('save purchasing settings → 200', st.status === 200 && st.body.matchAction === 'block', JSON.stringify(st.body))
      const d1 = await draft(S, [{ itemId: X, itemName: 'Soap', quantity: 12, unitPrice: 50 }], { purchaseOrderId: poId })
      const pre = await json(await matchPurchase(req('GET'), ctx(d1.body.id)))
      check('draft preview: qty_over_received', pre.body.status === 'mismatch' && pre.body.issues?.some((i: J) => i.type === 'qty_over_received'), JSON.stringify(pre.body).slice(0, 300))
      const r1 = await submit(d1.body.id)
      check('block mode: billed 12 vs received 10 → 400 THREE_WAY_MATCH_BLOCKED', r1.status === 400 && r1.body.code === 'THREE_WAY_MATCH_BLOCKED', JSON.stringify(r1.body))
      const st1 = await admin.query(`SELECT status FROM purchases WHERE id=$1`, [d1.body.id])
      check('blocked invoice stays draft, no GL', st1.rows[0].status === 'draft' && Object.keys(await glOf('purchase', d1.body.id)).length === 0)
      const d2 = await draft(S, [{ itemId: X, itemName: 'Soap', quantity: 10, unitPrice: 52 }], { purchaseOrderId: poId })
      const r2 = await submit(d2.body.id)
      check('price +4% within 5% tolerance → submitted, matched', r2.status === 200 && r2.body.matchStatus === 'matched', JSON.stringify(r2.body).slice(0, 300))
      await setPurchasing({ matchAction: 'warn', matchPriceTolerancePct: 0 })
    })

    // ============ 6. Landed cost ============
    await step('landed cost', async () => {
      const S = await newSupplier('Goods Co')
      const F = await newSupplier('Freight Co')
      const X = await newItem('Bulb', 100)
      const Y = await newItem('Switch', 50)
      const { poId, lineIds } = await makePO(S, [{ itemId: X, qty: 10, price: 100 }, { itemId: Y, qty: 20, price: 50 }])
      const grn = await receive(poId, [{ lineId: lineIds[0], qty: 10 }, { lineId: lineIds[1], qty: 20 }])
      await move(X, -4) // 6 of 10 bulbs left
      // value basis: X 1000, Y 1000 → freight 300 split 150 / 150; duty 100 split 50 / 50
      const r = await json(await createLCV(req('POST', {
        sources: [{ type: 'grn', id: grn.body.receiptId }], allocationMethod: 'value', submit: true,
        charges: [
          { chargeType: 'freight', amount: 300, supplierId: F },
          { chargeType: 'duty', amount: 100, creditAccountId: ACC.customs },
        ],
      })))
      check('create + submit landed cost voucher → 200', r.status === 200 && r.body.status === 'submitted', JSON.stringify(r.body).slice(0, 300))
      // X: 200 allocated, 6/10 on hand → 120 absorbed (cost +20), 80 expensed; Y: 200 absorbed (cost +10)
      check('bulb cost 100 → 120, switch 50 → 60', await costOf(X) === 120 && await costOf(Y) === 60, `${await costOf(X)} ${await costOf(Y)}`)
      check('voucher absorbed 320 / expensed 80', Number(r.body.absorbedAmount) === 320 && Number(r.body.expensedAmount) === 80, JSON.stringify(r.body).slice(0, 200))
      const gl = await glOf('landed_cost', r.body.id)
      check('GL: Dr Stock 320, Dr COGS 80, Cr AP 300, Cr customs 100',
        gl[ACC.stock] === 320 && gl[ACC.cogs] === 80 && gl[ACC.ap] === -300 && gl[ACC.customs] === -100, JSON.stringify(gl))
      check('freight supplier balance +300', await balanceOf(F) === 300)
      const blocked = await json(await cancelReceipt(req('DELETE', {}), ctx(grn.body.receiptId)))
      check('GRN cancel blocked while a landed cost is allocated → 400 HAS_LANDED_COST', blocked.status === 400 && blocked.body.code === 'HAS_LANDED_COST', JSON.stringify(blocked.body))
      const c = await json(await cancelLCV(req('DELETE', { cancellationReason: 'wrong bill' }), ctx(r.body.id)))
      check('cancel voucher → costs back (100 / 50)', c.status === 200 && await costOf(X) === 100 && await costOf(Y) === 50, `${c.status} ${await costOf(X)} ${await costOf(Y)}`)
      const gl2 = await glOf('landed_cost', r.body.id)
      check('cancel voucher → GL nets to 0, supplier balance 0', Object.values(gl2).every(v => v === 0) && await balanceOf(F) === 0, JSON.stringify(gl2))

      const q = await json(await createLCV(req('POST', {
        sources: [{ type: 'grn', id: grn.body.receiptId }], allocationMethod: 'quantity', submit: true,
        charges: [{ chargeType: 'clearing', amount: 300, creditAccountId: ACC.customs }],
      })))
      // by quantity: X 10 / Y 20 → 100 / 200; X 6 on hand → 60 absorbed (+10), Y +10
      check('allocate by quantity: bulb +10 (60 of 100 absorbed), switch +10', q.status === 200 && await costOf(X) === 110 && await costOf(Y) === 60,
        `${q.status} ${await costOf(X)} ${await costOf(Y)} ${JSON.stringify(q.body).slice(0, 200)}`)
      const bad = await json(await createLCV(req('POST', { sources: [{ type: 'grn', id: randomUUID() }], charges: [{ chargeType: 'other', amount: 10, creditAccountId: ACC.customs }] })))
      check('voucher on unknown GRN → 404', bad.status === 404, JSON.stringify(bad.body))
    })

    // ============ 7. Reorder ============
    await step('reorder', async () => {
      const S = await newSupplier('Reorder Co')
      const X = await newItem('Biscuits', 80, 0, S)
      await move(X, 5, A.wh2)
      await admin.query(`UPDATE warehouse_stock SET min_stock=10, max_stock=30 WHERE warehouse_id=$1 AND item_id=$2`, [A.wh2, X])
      await makePO(S, [{ itemId: X, qty: 3, price: 80 }], A.wh2, 'confirmed') // 3 on order
      const r = await json(await reorderSuggestions(new NextRequest(`http://localhost/api/reports/reorder-suggestions?warehouseId=${A.wh2}`)))
      const row = r.body.data?.find((d: J) => d.itemId === X)
      check('suggestion: on order 3, projected 8, order up to max 30 → 22', !!row && row.onOrder === 3 && row.projectedStock === 8 && row.suggestedQty === 22, JSON.stringify(row))
      check('suggestion carries its own warehouse (Branch)', row?.warehouseId === A.wh2 && row?.warehouseName === 'Branch')
      const grp = r.body.supplierGroups?.find((g: J) => g.supplierId === S)
      check('grouped by supplier + warehouse', grp?.warehouseId === A.wh2)
      const created = await json(await fromReorder(req('POST', { mode: 'purchase_order', lines: [{ itemId: X, warehouseId: row.warehouseId, supplierId: S, quantity: row.suggestedQty }] })))
      const doc = created.body.documents?.[0]
      const po = doc ? (await admin.query(`SELECT warehouse_id, status FROM purchase_orders WHERE id=$1`, [doc.id])).rows[0] : null
      check('create draft PO from suggestion → PO in the suggestion warehouse', created.status === 200 && po?.warehouse_id === A.wh2 && po?.status === 'draft', JSON.stringify(created.body))
      const r2 = await json(await reorderSuggestions(new NextRequest(`http://localhost/api/reports/reorder-suggestions?warehouseId=${A.wh2}`)))
      check('after ordering, item no longer suggested (draft PO counts as on order)', !r2.body.data?.some((d: J) => d.itemId === X), JSON.stringify(r2.body.data))

      const Y = await newItem('Crackers', 60, 0, S)
      await move(Y, 1)
      await admin.query(`UPDATE warehouse_stock SET min_stock=5, reorder_qty=12 WHERE warehouse_id=$1 AND item_id=$2`, [A.wh, Y])
      await setPurchasing({ autoReorder: true })
      const run1 = await runAutoReorder({ tenantIds: [A.tenantId] })
      const reqs = await admin.query(`SELECT r.id, r.source, ri.quantity::float q, ri.warehouse_id FROM purchase_requisitions r JOIN purchase_requisition_items ri ON ri.requisition_id = r.id WHERE r.tenant_id=$1 AND ri.item_id=$2`, [A.tenantId, Y])
      check('auto reorder → draft requisition (reorder_auto), qty 12, main warehouse', run1.requisitions >= 1 && reqs.rows.length === 1 && reqs.rows[0].source === 'reorder_auto'
        && reqs.rows[0].q === 12 && reqs.rows[0].warehouse_id === A.wh, JSON.stringify({ run1, rows: reqs.rows }))
      await runAutoReorder({ tenantIds: [A.tenantId] })
      const reqs2 = await admin.query(`SELECT count(*)::int n FROM purchase_requisition_items WHERE tenant_id=$1 AND item_id=$2`, [A.tenantId, Y])
      check('auto reorder re-run creates nothing new', reqs2.rows[0].n === 1)
      await setPurchasing({ autoReorder: false })
    })

    // ============ 8. Reason codes + GL mapping, bulk atomicity, zero cost ============
    await step('adjustment reasons', async () => {
      const X = await newItem('Glass jar', 40, 10)
      const r = await json(await adjustStock(req('POST', { itemId: X, quantity: 2, type: 'subtract', notes: 'dropped', reasonCode: 'damage' }), ctx(A.wh)))
      const mv = await admin.query(`SELECT id, reason_code FROM stock_movements WHERE item_id=$1 AND reference_type='manual_adjustment'`, [X])
      check('manual adjustment stores reason code damage', r.status === 200 && mv.rows[0]?.reason_code === 'damage', JSON.stringify(r.body))
      const gl = await glOf('stock_adjustment', mv.rows[0].id)
      check('damage → mapped GL account (Dr damage 80 / Cr stock 80)', gl[ACC.damage] === 80 && gl[ACC.stock] === -80, JSON.stringify(gl))

      const Z = await newItem('Free sample', 0, 5)
      const zr = await json(await adjustStock(req('POST', { itemId: Z, quantity: 1, type: 'subtract', reasonCode: 'sample' }), ctx(A.wh)))
      check('zero-cost item adjustment → applied, flagged unvalued', zr.status === 200 && zr.body.unvalued === true, JSON.stringify(zr.body))

      const B1 = await newItem('Bulk A', 10, 10)
      const before = await stockOf(B1)
      const bad = await json(await bulkAdjust(req('POST', { warehouseId: A.wh, reasonCode: 'shrinkage', adjustments: [{ itemId: B1, newQuantity: 7 }, { itemId: randomUUID(), newQuantity: 1 }] })))
      check('bulk with an unknown item → 404, nothing applied (atomic)', bad.status === 404 && await stockOf(B1) === before, `${bad.status} ${await stockOf(B1)} ${JSON.stringify(bad.body)}`)
      const ok = await json(await bulkAdjust(req('POST', { warehouseId: A.wh, reasonCode: 'shrinkage', adjustments: [{ itemId: B1, newQuantity: 7 }, { itemId: Z, newQuantity: 2 }] })))
      check('bulk ok → applied, zero-cost line warned', ok.status === 200 && await stockOf(B1) === 7 && ok.body.warnings?.length === 1 && ok.body.results?.some((x: J) => x.unvalued), JSON.stringify(ok.body).slice(0, 300))
      const mvb = await admin.query(`SELECT reason_code FROM stock_movements WHERE item_id=$1 AND reference_type='bulk_adjustment'`, [B1])
      check('bulk lines carry the reason code', mvb.rows[0]?.reason_code === 'shrinkage')

      const rep = await json(await adjustmentsByReason(new NextRequest('http://localhost/api/reports/adjustments-by-reason')))
      const dmg = rep.body.data?.find((d: J) => d.reasonCode === 'damage')
      const shr = rep.body.data?.find((d: J) => d.reasonCode === 'shrinkage')
      check('report by reason: damage −80, shrinkage −30', dmg?.value === -80 && shr?.value === -30, JSON.stringify(rep.body.data))
    })

    // ============ 9. Valuation reconciliation + audit ============
    await step('valuation reconciliation', async () => {
      const r = await json(await valuationRecon())
      check('reconciliation report → 200 with warehouses and stock account', r.status === 200 && Array.isArray(r.body.warehouses) && r.body.accounts?.some((a: J) => a.accountId === ACC.stock), JSON.stringify(r.body).slice(0, 300))
      const glStock = await accountBalance(ACC.stock)
      check('report GL balance = stock account balance', Math.abs(r.body.summary.glBalance - glStock) < 0.01, `${r.body.summary.glBalance} vs ${glStock}`)
      const a = await json(await accountingAudit())
      const chk = a.body.checks?.find((c: J) => c.name === 'Inventory GL vs Stock Valuation')
      const srb = a.body.checks?.find((c: J) => c.name === 'Stock Received But Not Billed')
      check('audit includes inventory valuation check', !!chk && ['pass', 'warn', 'fail'].includes(chk.status), JSON.stringify(chk))
      check('audit SRBNB check: balance equals open GRNs', srb?.status === 'pass', JSON.stringify(srb))
    })

    // ============ 10. Negative stock policy (restaurant orders follow the POS profile) ============
    await step('negative stock policy', async () => {
      const none = await withTenantTransaction(A.tenantId, (tx) => allowNegativeStockFor(tx, { tenantId: A.tenantId, warehouseId: A.wh }))
      const noneRestaurant = await withTenantTransaction(A.tenantId, (tx) => allowNegativeStockFor(tx, { tenantId: A.tenantId, warehouseId: A.wh, whenNoProfile: true }))
      check('no POS profile for the warehouse → negative stock blocked', none === false)
      check('no POS profile, restaurant fallback (whenNoProfile) → allowed', noneRestaurant === true)
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id, allow_negative_stock, is_default) VALUES ($1,$2,'Bar',$3,true,true)`, [randomUUID(), A.tenantId, A.wh])
      const yes = await withTenantTransaction(A.tenantId, (tx) => allowNegativeStockFor(tx, { tenantId: A.tenantId, warehouseId: A.wh }))
      check('POS profile allows negative stock → allowed', yes === true)
      await admin.query(`UPDATE pos_profiles SET allow_negative_stock=false WHERE tenant_id=$1`, [A.tenantId])
      const no = await withTenantTransaction(A.tenantId, (tx) => allowNegativeStockFor(tx, { tenantId: A.tenantId, warehouseId: A.wh, whenNoProfile: true }))
      check('POS profile forbids negative stock → blocked even with the restaurant fallback', no === false)
    })

    // ============ 11. RBAC ============
    await step('rbac', async () => {
      setTestSession(session(A, 'cashier'))
      const p = await json(await listPurchases(new NextRequest('http://localhost/api/purchases')))
      const o = await json(await listPOs(new NextRequest('http://localhost/api/purchase-orders')))
      const s = await json(await listSuppliers(new NextRequest('http://localhost/api/suppliers?all=true')))
      check('cashier cannot list purchases / POs / suppliers (403)', p.status === 403 && o.status === 403 && s.status === 403, `${p.status} ${o.status} ${s.status}`)
      setTestSession(session(A, 'stock_manager'))
      const s2 = await json(await listSuppliers(new NextRequest('http://localhost/api/suppliers?all=true')))
      check('stock manager can list suppliers (item forms)', s2.status === 200, String(s2.status))
      setTestSession(session(A))
    })
  } finally {
    setTestSession(null)
    if (process.env.KEEP_TEST_DATA !== '1') await cleanup(admin, A.tenantId)
    await admin.end()
  }
}

main()
  .catch((err) => { check('h3-inventory-purchasing', false, err instanceof Error ? err.stack : String(err)) })
  .then(async () => {
    await closeAllPools()
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  })
