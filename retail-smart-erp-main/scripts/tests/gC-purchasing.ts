/**
 * GC purchasing & suppliers audit suite.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_<name> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/gC-purchasing.ts
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
import { POST as createPurchase } from '@/app/api/purchases/route'
import { PUT as updatePurchase, DELETE as deletePurchase } from '@/app/api/purchases/[id]/route'
import { POST as payPurchase } from '@/app/api/purchases/[id]/payments/route'
import { POST as returnPurchase } from '@/app/api/purchases/[id]/return/route'
import { POST as receivePO } from '@/app/api/purchase-orders/[id]/receive/route'
import { POST as createInvoiceFromPO } from '@/app/api/purchase-orders/[id]/create-invoice/route'
import { PUT as updatePO } from '@/app/api/purchase-orders/[id]/route'
import { DELETE as cancelReceipt } from '@/app/api/purchase-receipts/[id]/route'
import { DELETE as deleteSupplier } from '@/app/api/suppliers/[id]/route'
import { POST as convertRequisition } from '@/app/api/purchase-requisitions/[id]/convert-to-po/route'
import { POST as convertQuotation } from '@/app/api/supplier-quotations/[id]/convert-to-po/route'
import { POST as postSale } from '@/app/api/sales/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string }

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
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'GC', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
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
  const slug = `gc-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'GC test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
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
  const B = await makeTenant(admin, 'b')
  setTestSession(session(A))

  const newSupplier = async (name: string, f: Fx = A) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, $3)`, [id, f.tenantId, `${name} ${id.slice(0, 6)}`])
    return id
  }
  const newItem = async (name: string, cost: number, stock = 0) => {
    const id = randomUUID()
    await admin.query(
      `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [id, A.tenantId, `GC-${id.slice(0, 8)}`, name, cost, cost * 2])
    if (stock) {
      await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.wh, itemId: id, mode: 'delta', qty: stock, referenceType: 'test_seed', source: 'system', userId: A.userId,
      }))
    }
    return id
  }
  const stockOf = async (itemId: string) => {
    const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [A.wh, itemId])
    return r.rows[0] ? Number(r.rows[0].current_stock) : 0
  }
  const costOf = async (itemId: string) => Number((await admin.query(`SELECT cost_price FROM items WHERE id=$1`, [itemId])).rows[0].cost_price)
  const balanceOf = async (supplierId: string) => Number((await admin.query(`SELECT balance FROM suppliers WHERE id=$1`, [supplierId])).rows[0].balance)
  const lastAudit = async (supplierId: string) => {
    const r = await admin.query(`SELECT new_balance FROM supplier_balance_audit WHERE supplier_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [supplierId])
    return r.rows[0] ? Number(r.rows[0].new_balance) : null
  }
  const auditSum = async (supplierId: string) => Number((await admin.query(
    `SELECT COALESCE(SUM(amount),0) s FROM supplier_balance_audit WHERE supplier_id=$1`, [supplierId])).rows[0].s)
  const makePO = async (supplierId: string, itemId: string, qty: number, price: number) => {
    const poId = randomUUID(); const lineId = randomUUID()
    await admin.query(`INSERT INTO purchase_orders (id, tenant_id, order_no, supplier_id, warehouse_id, status) VALUES ($1,$2,$3,$4,$5,'confirmed')`,
      [poId, A.tenantId, `PO-GC-${poId.slice(0, 8)}`, supplierId, A.wh])
    await admin.query(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,$4,'Line',$5,$6,$7)`,
      [lineId, A.tenantId, poId, itemId, qty, price, qty * price])
    return { poId, lineId }
  }
  const poState = async (poId: string) => {
    const r = await admin.query(`SELECT po.status, SUM(poi.received_quantity)::float rq FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id WHERE po.id=$1 GROUP BY po.status`, [poId])
    return r.rows[0] as { status: string; rq: number }
  }
  const draft = async (supplierId: string, items: J[], extra: J = {}) =>
    json(await createPurchase(req('POST', { supplierId, warehouseId: A.wh, items, ...extra })))
  const submit = async (id: string, extra: J = {}) => json(await updatePurchase(req('PUT', { status: 'pending', ...extra }), ctx(id)))
  const cancel = async (id: string) => json(await updatePurchase(req('PUT', { status: 'cancelled', cancellationReason: 'test' }), ctx(id)))

  try {
    // ============ 1. GRN (updateStock) + invoice from the PO page: no double stock ============
    await step('GRN + PO invoice stock', async () => {
      const S = await newSupplier('Ceylon Traders')
      const X = await newItem('Sugar 1kg', 50)
      const { poId, lineId } = await makePO(S, X, 10, 100)
      const grn = await json(await receivePO(req('POST', { items: [{ itemId: lineId, receivedQuantity: 10 }], updateStock: true }), ctx(poId)))
      check('GRN receive 10 (updateStock) → stock 10, cost 100', grn.status === 200 && await stockOf(X) === 10 && await costOf(X) === 100,
        `${grn.status} ${JSON.stringify(grn.body).slice(0, 200)} stock=${await stockOf(X)}`)
      // what the PO page does next: POST /api/purchases linked to the PO, then submit
      const d = await draft(S, [{ itemId: X, itemName: 'Sugar 1kg', quantity: 10, unitPrice: 100 }], { purchaseOrderId: poId, supplierInvoiceNo: 'CT-1001' })
      check('draft invoice linked to PO → 200', d.status === 200, JSON.stringify(d.body).slice(0, 200))
      const sub = await submit(d.body.id)
      check('submit invoice for already-received goods → stock stays 10 (not 20)', sub.status === 200 && await stockOf(X) === 10,
        `${sub.status} stock=${await stockOf(X)} ${JSON.stringify(sub.body).slice(0, 200)}`)
      check('cost not applied twice (still 100)', await costOf(X) === 100, `cost=${await costOf(X)}`)
      check('supplier balance 1000 after submit', await balanceOf(S) === 1000)

      const blocked = await json(await cancelReceipt(req('DELETE', {}), ctx(grn.body.receiptId)))
      check('cancel GRN already billed on a submitted invoice → 400 RECEIPT_ALREADY_INVOICED, stock untouched',
        blocked.status === 400 && blocked.body.code === 'RECEIPT_ALREADY_INVOICED' && await stockOf(X) === 10, JSON.stringify(blocked.body))
      check('blocked GRN cancel wrote nothing (PO received still 10)', (await poState(poId)).rq === 10)

      const c = await cancel(d.body.id)
      check('cancel invoice → stock still 10 (GRN goods stay), PO received still 10', c.status === 200 && await stockOf(X) === 10
        && (await poState(poId)).rq === 10, `${c.status} stock=${await stockOf(X)} ${JSON.stringify(await poState(poId))}`)
      check('cancel invoice → cost unchanged (invoice applied none)', await costOf(X) === 100)

      const ok = await json(await cancelReceipt(req('DELETE', {}), ctx(grn.body.receiptId)))
      check('cancel GRN after invoice cancelled → 200, stock 0, PO received 0', ok.status === 200 && await stockOf(X) === 0
        && (await poState(poId)).rq === 0, `${ok.status} ${JSON.stringify(ok.body)}`)
      check('cancel GRN → weighted-average cost restored (100 → 50)', await costOf(X) === 50, `cost=${await costOf(X)}`)
    })

    await step('partial GRN coverage', async () => {
      const S = await newSupplier('Partial Co')
      const X = await newItem('Flour 1kg', 100)
      const { poId, lineId } = await makePO(S, X, 10, 100)
      await json(await receivePO(req('POST', { items: [{ itemId: lineId, receivedQuantity: 6 }], updateStock: true }), ctx(poId)))
      const d = await draft(S, [{ itemId: X, itemName: 'Flour', quantity: 10, unitPrice: 100 }], { purchaseOrderId: poId })
      const sub = await submit(d.body.id)
      check('GRN 6 + invoice 10 → only the 4 not yet received are added (stock 10)', sub.status === 200 && await stockOf(X) === 10, `stock=${await stockOf(X)}`)
      const d2 = await draft(S, [{ itemId: X, itemName: 'Flour', quantity: 2, unitPrice: 100 }], { purchaseOrderId: poId })
      await submit(d2.body.id)
      check('second invoice on the same PO: GRN stock already billed → adds its own 2 (stock 12)', await stockOf(X) === 12, `stock=${await stockOf(X)}`)
      const c = await cancel(d.body.id)
      check('cancel first invoice → only the 4 it received go out (stock 8)', c.status === 200 && await stockOf(X) === 8, `${c.status} stock=${await stockOf(X)}`)
    })

    await step('PO-linked invoice validation', async () => {
      const S = await newSupplier('Link A'); const S2 = await newSupplier('Link B')
      const X = await newItem('Salt', 10)
      const { poId } = await makePO(S, X, 5, 10)
      const r = await draft(S2, [{ itemId: X, itemName: 'Salt', quantity: 1, unitPrice: 10 }], { purchaseOrderId: poId })
      check('invoice linked to a PO of another supplier → 400', r.status === 400, JSON.stringify(r.body))
      const r2 = await draft(S, [{ itemId: X, itemName: 'Salt', quantity: 1, unitPrice: 10 }], { purchaseOrderId: randomUUID() })
      check('invoice linked to an unknown PO → 404', r2.status === 404, JSON.stringify(r2.body))
    })

    // ============ 2. PO status integrity ============
    await step('PO status', async () => {
      const S = await newSupplier('Status Co')
      const X = await newItem('Tea 100g', 100, 0)
      const { poId, lineId } = await makePO(S, X, 5, 100)
      const manual = await json(await updatePO(req('PUT', { status: 'invoice_created' }), ctx(poId)))
      check('PUT status invoice_created by hand (no invoice) → 400', manual.status === 400 && (await poState(poId)).status === 'confirmed', JSON.stringify(manual.body))

      const inv = await json(await createInvoiceFromPO(req('POST', { updateStock: true, receivedQuantities: { [lineId]: '5' } }), ctx(poId)))
      check('create-invoice → 200, PO invoice_created', inv.status === 200 && (await poState(poId)).status === 'invoice_created', JSON.stringify(inv.body).slice(0, 200))
      check('create-invoice writes the supplier balance audit row (balance 500 = last audit = sum of audit)',
        await balanceOf(S) === 500 && await lastAudit(S) === 500 && await auditSum(S) === 500, `bal=${await balanceOf(S)} audit=${await lastAudit(S)}`)
      const can = await json(await updatePO(req('PUT', { status: 'cancelled' }), ctx(poId)))
      check('cancel PO → cancelled', can.status === 200 && (await poState(poId)).status === 'cancelled')
      const ci = await cancel(inv.body.purchase.id)
      check('cancel its invoice → PO stays cancelled (not re-opened)', ci.status === 200 && (await poState(poId)).status === 'cancelled',
        `${ci.status} ${JSON.stringify(await poState(poId))}`)
      const rcv = await json(await receivePO(req('POST', { items: [{ itemId: lineId, receivedQuantity: 1 }] }), ctx(poId)))
      check('cancelled PO cannot be received', rcv.status === 400)

      const p2 = await makePO(S, X, 5, 100)
      const zero = await json(await receivePO(req('POST', { items: [{ itemId: p2.lineId, receivedQuantity: 0 }] }), ctx(p2.poId)))
      const n = await admin.query(`SELECT count(*)::int n FROM purchase_receipts WHERE purchase_order_id=$1`, [p2.poId])
      check('receive with all quantities 0 → 400, no empty GRN', zero.status === 400 && n.rows[0].n === 0, JSON.stringify(zero.body))
    })

    // ============ 3. supplier balance: returns, cancels, paid purchases ============
    await step('return cancel restores balance', async () => {
      const S = await newSupplier('Return Co')
      const X = await newItem('Soap', 100)
      const d = await draft(S, [{ itemId: X, itemName: 'Soap', quantity: 10, unitPrice: 100 }])
      await submit(d.body.id)
      const lineId = (await admin.query(`SELECT id FROM purchase_items WHERE purchase_id=$1`, [d.body.id])).rows[0].id
      const ret = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineId, returnQuantity: 3 }] }), ctx(d.body.id)))
      check('return 3 → balance 1000 → 700, stock 7', ret.status === 201 && await balanceOf(S) === 700 && await stockOf(X) === 7, `${ret.status} bal=${await balanceOf(S)}`)

      const blocked = await cancel(d.body.id)
      check('cancel purchase with active return → 400 HAS_ACTIVE_RETURNS', blocked.status === 400 && blocked.body.code === 'HAS_ACTIVE_RETURNS')
      check('…and the refused cancel did NOT touch the supplier balance (700) or write an audit row',
        await balanceOf(S) === 700 && await lastAudit(S) === 700, `bal=${await balanceOf(S)} audit=${await lastAudit(S)}`)

      const cr = await cancel(ret.body.id)
      check('cancel the return → balance restored to 1000, stock back to 10', cr.status === 200 && await balanceOf(S) === 1000 && await stockOf(X) === 10,
        `${cr.status} bal=${await balanceOf(S)} stock=${await stockOf(X)}`)
      check('balance = last audit row = sum of audit rows', await lastAudit(S) === 1000 && await auditSum(S) === 1000)

      const ret2 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineId, returnQuantity: 2 }] }), ctx(d.body.id)))
      check('return 2 again after the cancelled return → balance 800', ret2.status === 201 && await balanceOf(S) === 800)
      // Pending documents are cancelled, not deleted (recycle-bin rule); same reversal
      const refused = await json(await deletePurchase(req('DELETE'), ctx(ret2.body.id)))
      check('delete of a pending return is refused (cancel instead)', refused.status === 400, JSON.stringify(refused.body))
      const del = await cancel(ret2.body.id)
      check('cancel the (pending) return → balance restored to 1000, stock 10', del.status === 200 && await balanceOf(S) === 1000 && await stockOf(X) === 10,
        `${del.status} ${JSON.stringify(del.body)} bal=${await balanceOf(S)}`)
      const rr = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineId, returnQuantity: 1 }] }), ctx(ret.body.id)))
      check('return against a purchase return → 400', rr.status === 400)
    })

    await step('cancel paid purchase', async () => {
      const S = await newSupplier('Paid Co')
      const X = await newItem('Oil 1L', 100)
      const d = await draft(S, [{ itemId: X, itemName: 'Oil', quantity: 10, unitPrice: 100 }])
      await submit(d.body.id)
      const pay = await json(await payPurchase(req('POST', { amount: 400, paymentMethod: 'cash' }), ctx(d.body.id)))
      check('pay 400 of 1000 → balance 600', pay.status === 200 && await balanceOf(S) === 600, JSON.stringify(pay.body).slice(0, 200))
      const c = await cancel(d.body.id)
      check('cancel partly-paid purchase → whole bill reversed: balance −400 (supplier owes us the 400 paid)',
        c.status === 200 && await balanceOf(S) === -400, `${c.status} bal=${await balanceOf(S)}`)
      check('balance = last audit row = sum of audit rows', await lastAudit(S) === -400 && await auditSum(S) === -400)
    })

    await step('return keeps manual line tax', async () => {
      const S = await newSupplier('Tax Co')
      const X = await newItem('Biscuits', 100)
      const d = await draft(S, [{ itemId: X, itemName: 'Biscuits', quantity: 10, unitPrice: 100, tax: 180 }])
      await submit(d.body.id)
      check('purchase 1000 + manual tax 180 → balance 1180', await balanceOf(S) === 1180, `bal=${await balanceOf(S)}`)
      const lineId = (await admin.query(`SELECT id FROM purchase_items WHERE purchase_id=$1`, [d.body.id])).rows[0].id
      const ret = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineId, returnQuantity: 5 }] }), ctx(d.body.id)))
      const r = (await admin.query(`SELECT total::float t, tax_amount::float x FROM purchases WHERE id=$1`, [ret.body.id])).rows[0]
      check('return half → return total −590 (500 + tax 90), balance 590', ret.status === 201 && r.t === -590 && r.x === -90 && await balanceOf(S) === 590,
        `${ret.status} ${JSON.stringify(r)} bal=${await balanceOf(S)}`)
    })

    // ============ 4. duplicate supplier bill numbers ============
    await step('duplicate supplier invoice', async () => {
      const S = await newSupplier('Bill Co'); const S2 = await newSupplier('Other Co')
      const line = [{ itemName: 'Service', quantity: 1, unitPrice: 100 }]
      const a = await draft(S, line, { supplierInvoiceNo: 'INV-77' })
      check('first bill INV-77 → 200', a.status === 200)
      const b = await draft(S, line, { supplierInvoiceNo: ' inv-77 ' })
      check('same supplier, same bill number (case/space variant) → 409 DUPLICATE_SUPPLIER_INVOICE', b.status === 409 && b.body.code === 'DUPLICATE_SUPPLIER_INVOICE', JSON.stringify(b.body))
      const c = await draft(S2, line, { supplierInvoiceNo: 'INV-77' })
      check('other supplier may use the same number → 200', c.status === 200)
      const e = await draft(S, line, { supplierInvoiceNo: 'INV-78' })
      const ed = await json(await updatePurchase(req('PUT', { supplierInvoiceNo: 'INV-77' }), ctx(e.body.id)))
      check('editing a draft to a used bill number → 409', ed.status === 409, JSON.stringify(ed.body))
      await cancel(a.body.id)
      const f = await draft(S, line, { supplierInvoiceNo: 'INV-77' })
      check('after the first bill is cancelled the number can be re-entered → 200', f.status === 200)
    })

    // ============ 5. batches (lots) from purchasing ============
    await step('batches', async () => {
      const S = await newSupplier('Pharma Co')
      const X = randomUUID()
      await admin.query(
        `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_batches) VALUES ($1,$2,$3,'Syrup',100,200,true,true)`,
        [X, A.tenantId, `GC-${X.slice(0, 8)}`])
      const batches = async () => (await admin.query(
        `SELECT batch_number, expiry_date::text AS e, current_quantity::float AS q, purchase_receipt_id FROM item_batches WHERE item_id=$1 ORDER BY batch_number`, [X])).rows
      const qtyOf = async (no: string) => (await batches()).filter((b) => b.batch_number === no).reduce((a, b) => a + b.q, 0)
      const { poId, lineId } = await makePO(S, X, 20, 100)
      const g1 = await json(await receivePO(req('POST', { updateStock: true, items: [
        { itemId: lineId, receivedQuantity: 6, batchNumber: 'LOT-A', expiryDate: '2027-12-31' },
        { itemId: lineId, receivedQuantity: 4 },
      ] }), ctx(poId)))
      const b1 = await batches()
      check('GRN with batch info → batch LOT-A 6 (expiry kept) + auto batch named after the GRN 4',
        g1.status === 200 && b1.length === 2 && await qtyOf('LOT-A') === 6 && b1.find((b) => b.batch_number === 'LOT-A')?.e === '2027-12-31'
        && await qtyOf(g1.body.receiptNo) === 4 && b1.every((b) => b.purchase_receipt_id === g1.body.receiptId) && await stockOf(X) === 10,
        `${g1.status} ${JSON.stringify(b1)} ${JSON.stringify(g1.body).slice(0, 200)}`)
      const g2 = await json(await receivePO(req('POST', { updateStock: true, items: [{ itemId: lineId, receivedQuantity: 2, batchNumber: 'lot-a', expiryDate: '2027-12-31' }] }), ctx(poId)))
      check('second GRN with the same lot + expiry merges into LOT-A (8), no new batch row',
        g2.status === 200 && (await batches()).length === 2 && await qtyOf('LOT-A') === 8, JSON.stringify(await batches()))
      const sale = await json(await postSale(req('POST', {
        cartItems: [{ itemId: X, name: 'Syrup', quantity: 5, unitPrice: 200, discount: 0 }],
        paymentMethod: 'cash', subtotal: 1000, discount: 0, tax: 0, total: 1000, amountPaid: 1000, creditAmount: 0, warehouseId: A.wh,
      })))
      check('batch item received through purchasing can be sold online (no INSUFFICIENT_BATCH_STOCK)', sale.status === 200, JSON.stringify(sale.body).slice(0, 300))
      const c2 = await json(await cancelReceipt(req('DELETE', {}), ctx(g2.body.receiptId)))
      const total = (await batches()).reduce((a, b) => a + b.q, 0)
      check('cancel GRN → its 2 come out of the batches (batch total = stock = 5)', c2.status === 200 && total === 5 && await stockOf(X) === 5,
        `${c2.status} ${JSON.stringify(await batches())} stock=${await stockOf(X)}`)

      // purchase invoice (no PO) with a batch given at submit, then return / cancel return / cancel
      const Y = randomUUID()
      await admin.query(
        `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_batches) VALUES ($1,$2,$3,'Tablets',10,20,true,true)`,
        [Y, A.tenantId, `GC-${Y.slice(0, 8)}`])
      const yb = async () => (await admin.query(`SELECT batch_number, current_quantity::float q FROM item_batches WHERE item_id=$1`, [Y])).rows
      const d = await draft(S, [{ itemId: Y, itemName: 'Tablets', quantity: 10, unitPrice: 10 }])
      const line = (await admin.query(`SELECT id FROM purchase_items WHERE purchase_id=$1`, [d.body.id])).rows[0].id
      const sub = await submit(d.body.id, { itemBatches: { [line]: { batchNumber: 'TB-9', expiryDate: '2027-06-30' } } })
      check('purchase submit with batch → batch TB-9 10', sub.status === 200 && JSON.stringify(await yb()) === JSON.stringify([{ batch_number: 'TB-9', q: 10 }]), JSON.stringify(await yb()))
      const d2 = await draft(S, [{ itemId: Y, itemName: 'Tablets', quantity: 5, unitPrice: 10 }])
      const s2 = await submit(d2.body.id)
      check('purchase submit without batch → auto batch named after the invoice', s2.status === 200
        && (await yb()).some((b) => b.batch_number === s2.body.purchaseNo && b.q === 5), JSON.stringify(await yb()))
      const ret = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: line, returnQuantity: 3 }] }), ctx(d.body.id)))
      const tb = async () => (await yb()).find((b) => b.batch_number === 'TB-9')?.q
      check('return 3 of the first invoice → taken from its own batch TB-9 (7), other batch untouched',
        ret.status === 201 && await tb() === 7 && (await yb()).find((b) => b.batch_number === s2.body.purchaseNo)?.q === 5, JSON.stringify(await yb()))
      const cr = await cancel(ret.body.id)
      check('cancel the return → TB-9 back to 10', cr.status === 200 && await tb() === 10, JSON.stringify(await yb()))
      const ci = await cancel(d.body.id)
      check('cancel the invoice → TB-9 emptied (0), stock 5', ci.status === 200 && await tb() === 0 && await stockOf(Y) === 5, `${ci.status} ${JSON.stringify(await yb())}`)
      const ci2 = await cancel(d2.body.id)
      check('cancel the second invoice → its auto batch emptied, batch total 0 = stock 0',
        ci2.status === 200 && (await yb()).every((b) => b.q === 0) && await stockOf(Y) === 0, JSON.stringify(await yb()))
    })

    // ============ 6. suppliers / conversions ============
    await step('supplier delete', async () => {
      const S = await newSupplier('History Co')
      const d = await draft(S, [{ itemName: 'Service', quantity: 1, unitPrice: 100 }])
      await cancel(d.body.id)
      const r = await json(await deleteSupplier(req('DELETE'), ctx(S)))
      // Recycle bin: a supplier with history is archived (restorable by the super admin), never a 500
      check('delete supplier with (cancelled) purchase history → archived', r.status === 200 && r.body.archived === true, `${r.status} ${JSON.stringify(r.body)}`)
      const S2 = await newSupplier('Fresh Co')
      const r2 = await json(await deleteSupplier(req('DELETE'), ctx(S2)))
      check('delete unused supplier → 200', r2.status === 200, JSON.stringify(r2.body))
    })

    await step('conversions validate warehouse', async () => {
      const S = await newSupplier('Conv Co')
      const reqId = randomUUID()
      await admin.query(`INSERT INTO purchase_requisitions (id, tenant_id, requisition_no, status) VALUES ($1,$2,$3,'approved')`, [reqId, A.tenantId, `PR-GC-${reqId.slice(0, 6)}`])
      await admin.query(`INSERT INTO purchase_requisition_items (tenant_id, requisition_id, item_name, quantity, estimated_unit_price) VALUES ($1,$2,'Paper',3,10)`, [A.tenantId, reqId])
      const bad = await json(await convertRequisition(req('POST', { supplierId: S, warehouseId: B.wh }), ctx(reqId)))
      const n = await admin.query(`SELECT count(*)::int n FROM purchase_orders WHERE tenant_id=$1 AND warehouse_id=$2`, [A.tenantId, B.wh])
      check('requisition → PO with another tenant\'s warehouse → 404, no PO', bad.status === 404 && n.rows[0].n === 0, JSON.stringify(bad.body))
      const good = await json(await convertRequisition(req('POST', { supplierId: S, warehouseId: A.wh }), ctx(reqId)))
      check('requisition → PO with own warehouse → 201', good.status === 201, JSON.stringify(good.body))

      const qId = randomUUID()
      await admin.query(`INSERT INTO supplier_quotations (id, tenant_id, quotation_no, supplier_id, status) VALUES ($1,$2,$3,$4,'received')`, [qId, A.tenantId, `SQ-GC-${qId.slice(0, 6)}`, S])
      await admin.query(`INSERT INTO supplier_quotation_items (tenant_id, quotation_id, item_name, quantity, unit_price, total) VALUES ($1,$2,'Ink',2,50,100)`, [A.tenantId, qId])
      const qbad = await json(await convertQuotation(req('POST', { warehouseId: B.wh }), ctx(qId)))
      check('quotation → PO with another tenant\'s warehouse → 404', qbad.status === 404, JSON.stringify(qbad.body))
      const qgood = await json(await convertQuotation(req('POST', { warehouseId: A.wh }), ctx(qId)))
      check('quotation → PO with own warehouse → 201', qgood.status === 201, JSON.stringify(qgood.body))
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
  .catch((err) => check('gC suite', false, err instanceof Error ? err.stack : String(err)))
  .finally(async () => {
    await closeAllPools()
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  })
