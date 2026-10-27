/**
 * L3 — document line units (drizzle/0184): sales orders, purchase orders, purchase invoices and
 * GRNs keep the unit a line was entered in; stock / reservations / costing use qty × factor.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_<name> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l3-document-units.ts
 *
 * Real route handlers (auth mocked via the w8 harness) on a throw-away tenant. KEEP_TEST_DATA=1 keeps it.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { POST as createPO } from '@/app/api/purchase-orders/route'
import { PUT as updatePO, GET as getPO } from '@/app/api/purchase-orders/[id]/route'
import { POST as addPOItem, PUT as updatePOItem } from '@/app/api/purchase-orders/[id]/items/route'
import { POST as receivePO } from '@/app/api/purchase-orders/[id]/receive/route'
import { POST as createInvoiceFromPO } from '@/app/api/purchase-orders/[id]/create-invoice/route'
import { DELETE as cancelReceipt } from '@/app/api/purchase-receipts/[id]/route'
import { POST as createPurchase } from '@/app/api/purchases/route'
import { PUT as updatePurchase } from '@/app/api/purchases/[id]/route'
import { POST as addPurchaseItem } from '@/app/api/purchases/[id]/items/route'
import { POST as returnPurchase } from '@/app/api/purchases/[id]/return/route'
import { POST as createSO } from '@/app/api/sales-orders/route'
import { PUT as updateSO, GET as getSO } from '@/app/api/sales-orders/[id]/route'
import { POST as invoiceSO } from '@/app/api/sales-orders/[id]/create-invoice/route'

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
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'L3', businessType: 'retail',
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
const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps

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

  const tenantId = randomUUID()
  const A: Fx = { tenantId, slug: `l3-${tenantId.slice(0, 8)}`, wh: randomUUID(), userId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'L3 test', $2, $3)`, [tenantId, A.slug, `${A.slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [A.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [A.userId, tenantId, `owner-${A.slug}@example.test`])
  setTestSession(session(A))

  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, name, no, root, type])
    return id
  }
  const ACC = {
    cash: await acc('Cash', '1110', 'asset', 'cash'),
    ar: await acc('Receivable', '1130', 'asset', 'receivable'),
    stock: await acc('Inventory', '1140', 'asset', 'stock'),
    ap: await acc('Accounts Payable', '2110', 'liability', 'payable'),
    srbnb: await acc('SRBNB', '2190', 'liability', 'current_liability'),
    inc: await acc('Sales', '4000', 'income', 'income_account'),
    cogs: await acc('COGS', '5100', 'expense', 'cost_of_goods_sold'),
  }
  const fy = randomUUID()
  const year = new Date().getFullYear()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, tenantId, `${year - 1}-01-01`, `${year + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_cash_account_id, default_receivable_account_id, default_stock_account_id,
       default_payable_account_id, default_srbnb_account_id, default_income_account_id, default_cogs_account_id,
       current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true)`,
    [tenantId, ACC.cash, ACC.ar, ACC.stock, ACC.ap, ACC.srbnb, ACC.inc, ACC.cogs, fy])

  const supplierId = randomUUID()
  await admin.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, 'Box Supplier')`, [supplierId, tenantId])
  const newItem = async (name: string, unit: string, cost: number, selling: number, opts: { serial?: boolean } = {}) => {
    const id = randomUUID()
    await admin.query(
      `INSERT INTO items (id, tenant_id, item_code, name, unit, cost_price, selling_price, track_stock, track_serial_numbers)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
      [id, tenantId, `L3-${id.slice(0, 8)}`, name, unit, cost, selling, !!opts.serial])
    return id
  }
  const move = (itemId: string, qty: number) => withTenantTransaction(tenantId, (tx) => applyStockChange(tx, {
    tenantId, warehouseId: A.wh, itemId, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: A.userId, allowNegative: true,
  }))
  const stockOf = async (itemId: string) => {
    const r = await admin.query(`SELECT current_stock, reserved_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [A.wh, itemId])
    return { on: r.rows[0] ? Number(r.rows[0].current_stock) : 0, reserved: r.rows[0] ? Number(r.rows[0].reserved_stock) : 0 }
  }
  const costOf = async (itemId: string) => Number((await admin.query(`SELECT cost_price FROM items WHERE id=$1`, [itemId])).rows[0].cost_price)

  // Widget: stocked in pieces, bought in boxes of 12
  const widget = await newItem('Widget', 'pcs', 0, 20)
  await admin.query(`INSERT INTO item_uoms (tenant_id, item_id, uom, factor) VALUES ($1,$2,'box',12)`, [tenantId, widget])
  // Rice: stocked in kg, sold in g
  const rice = await newItem('Rice', 'kg', 1000, 1500)

  try {
    // ================= purchase order in boxes → GRN → invoice =================
    await step('PO in box(12)', async () => {
      const bad = await json(await createPO(req('POST', {
        supplierId, warehouseId: A.wh, items: [{ itemId: widget, itemName: 'Widget', quantity: 1, unitPrice: 120, uom: 'crate' }],
      })))
      check('PO line in an unknown unit → 400 UOM_NOT_FOUND', bad.status === 400 && bad.body.code === 'UOM_NOT_FOUND', JSON.stringify(bad.body))
      const nPO = Number((await admin.query(`SELECT count(*) FROM purchase_orders WHERE tenant_id=$1`, [tenantId])).rows[0].count)
      check('rejected PO left nothing behind', nPO === 0, String(nPO))

      const po = await json(await createPO(req('POST', {
        supplierId, warehouseId: A.wh,
        // client factor is ignored: the server resolves box = 12 from item_uoms
        items: [{ itemId: widget, itemName: 'Widget', quantity: 3, unitPrice: 120, uom: 'box', uomFactor: 99 }],
      })))
      check('PO with a box line → 200', po.status === 200, JSON.stringify(po.body).slice(0, 300))
      const poId = po.body.id as string
      const line = (await admin.query(`SELECT id, uom, uom_factor::float f, quantity::float q, unit_price::float p FROM purchase_order_items WHERE purchase_order_id=$1`, [poId])).rows[0]
      check('PO line keeps uom box, factor 12 (server), qty 3 @ 120', line.uom === 'box' && line.f === 12 && line.q === 3 && line.p === 120, JSON.stringify(line))

      // add-item with a standard unit that does not fit pieces → 400; editing the unit back to base works
      const badAdd = await json(await addPOItem(req('POST', { itemId: widget, itemName: 'Widget', quantity: 1, unitPrice: 1, uom: 'kg' }), ctx(poId)))
      check('add PO item in kg on a pcs item → 400', badAdd.status === 400, JSON.stringify(badAdd.body))
      const add = await json(await addPOItem(req('POST', { itemId: widget, itemName: 'Widget', quantity: 6, unitPrice: 10, uom: 'pcs' }), ctx(poId)))
      check('add PO item in base unit → 200 (stored uom null)', add.status === 200
        && (await admin.query(`SELECT count(*) FROM purchase_order_items WHERE purchase_order_id=$1 AND uom IS NULL AND uom_factor=1`, [poId])).rows[0].count === '1', JSON.stringify(add.body))
      const pcsLine = (await admin.query(`SELECT id FROM purchase_order_items WHERE purchase_order_id=$1 AND uom IS NULL`, [poId])).rows[0].id
      const upd = await json(await updatePOItem(req('PUT', { itemId: pcsLine, uom: 'box', quantity: 1, unitPrice: 120 }), ctx(poId)))
      const after = (await admin.query(`SELECT uom, uom_factor::float f FROM purchase_order_items WHERE id=$1`, [pcsLine])).rows[0]
      check('PO item unit changed to box via PUT → factor 12', upd.status === 200 && after.uom === 'box' && after.f === 12, JSON.stringify([upd.body, after]))

      const g = await json(await getPO(req('GET'), ctx(poId)))
      check('GET PO returns uom / uomFactor / baseUnit per line',
        g.status === 200 && g.body.items.every((i: J) => i.uom === 'box' && Number(i.uomFactor) === 12 && i.baseUnit === 'pcs'), JSON.stringify(g.body.items))

      for (const status of ['submitted', 'confirmed']) {
        const r = await json(await updatePO(req('PUT', { status }), ctx(poId)))
        check(`PO → ${status}`, r.status === 200, JSON.stringify(r.body).slice(0, 200))
      }
      // PO now: line A 3 box @120, line B 1 box @120 = 4 boxes = 48 pcs
      const before = await stockOf(widget)
      const rec = await json(await receivePO(req('POST', { items: [{ itemId: line.id, receivedQuantity: 2 }], updateStock: true }), ctx(poId)))
      check('receive 2 box → 200', rec.status === 200, JSON.stringify(rec.body).slice(0, 300))
      const s1 = await stockOf(widget)
      check('stock +24 pcs (2 box × 12)', near(s1.on - before.on, 24), JSON.stringify([before, s1]))
      check('cost per piece = 120 / 12 = 10', near(await costOf(widget), 10), String(await costOf(widget)))
      const recQty = Number((await admin.query(`SELECT received_quantity FROM purchase_order_items WHERE id=$1`, [line.id])).rows[0].received_quantity)
      check('PO received_quantity tracked in boxes (2)', recQty === 2, String(recQty))
      const gri = (await admin.query(`SELECT uom, uom_factor::float f, quantity_received::float q, unit_cost::float c FROM purchase_receipt_items WHERE receipt_id=$1`, [rec.body.receiptId])).rows[0]
      check('GRN line carries box / 12, qty 2 @ 120', gri?.uom === 'box' && gri.f === 12 && gri.q === 2 && gri.c === 120, JSON.stringify(gri))
      const grnGl = (await admin.query(`SELECT COALESCE(SUM(debit),0)::float d FROM gl_entries WHERE voucher_type='purchase_receipt' AND voucher_id=$1 AND account_id=$2`, [rec.body.receiptId, ACC.stock])).rows[0].d
      check('GRN posts Dr Stock 240 (2 box × 120)', near(grnGl, 240), String(grnGl))

      const over = await json(await receivePO(req('POST', { items: [{ itemId: line.id, receivedQuantity: 2 }], updateStock: true }), ctx(poId)))
      check('over-receive (2 more box of 1 remaining) → 400', over.status === 400, JSON.stringify(over.body))

      // cancel the GRN: stock and cost come back
      const cr = await json(await cancelReceipt(req('DELETE', { reason: 'test' }), ctx(rec.body.receiptId)))
      const s2 = await stockOf(widget)
      check('cancel GRN → stock back (−24), received 0', cr.status === 200 && near(s2.on, before.on)
        && Number((await admin.query(`SELECT received_quantity FROM purchase_order_items WHERE id=$1`, [line.id])).rows[0].received_quantity) === 0,
        JSON.stringify([cr.body, s2]))

      // receive everything again, then invoice the PO
      const rec2 = await json(await receivePO(req('POST', { items: [{ itemId: line.id, receivedQuantity: 3 }, { itemId: pcsLine, receivedQuantity: 1 }], updateStock: true }), ctx(poId)))
      const s3 = await stockOf(widget)
      check('receive 3 box + 1 box → +48 pcs, PO fully_received', rec2.status === 200 && near(s3.on - before.on, 48) && rec2.body.status === 'fully_received',
        JSON.stringify([rec2.body.status, s3]))
      const inv = await json(await createInvoiceFromPO(req('POST', {}), ctx(poId)))
      check('PO → invoice → 200', inv.status === 200, JSON.stringify(inv.body).slice(0, 300))
      const pid = inv.body.purchase.id
      const pis = (await admin.query(`SELECT uom, uom_factor::float f, quantity::float q, unit_price::float p, srbnb_qty::float sq FROM purchase_items WHERE purchase_id=$1 ORDER BY quantity`, [pid])).rows
      check('invoice lines carry box / 12 in boxes (1 and 3 @ 120)', pis.length === 2 && pis.every((p: J) => p.uom === 'box' && p.f === 12 && p.p === 120)
        && pis[0].q === 1 && pis[1].q === 3, JSON.stringify(pis))
      check('invoice clears SRBNB for 48 pcs (base units)', near(pis.reduce((s: number, p: J) => s + p.sq, 0), 48), JSON.stringify(pis))
      const s4 = await stockOf(widget)
      check('invoicing received goods does not add stock again', near(s4.on, s3.on), JSON.stringify([s3, s4]))
    })

    // ================= direct purchase invoice in boxes =================
    await step('purchase invoice in box', async () => {
      const gadget = await newItem('Gadget', 'pcs', 0, 30, { serial: true })
      await admin.query(`INSERT INTO item_uoms (tenant_id, item_id, uom, factor) VALUES ($1,$2,'Box',12)`, [tenantId, gadget])
      const p = await json(await createPurchase(req('POST', {
        supplierId, warehouseId: A.wh, items: [{ itemId: gadget, itemName: 'Gadget', quantity: 1, unitPrice: 240, uom: 'box' }],
      })))
      check('purchase invoice with Box line → 200', p.status === 200, JSON.stringify(p.body).slice(0, 300))
      const pid = p.body.id
      const add = await json(await addPurchaseItem(req('POST', { itemId: widget, itemName: 'Widget', quantity: 2, unitPrice: 25 }), ctx(pid)))
      check('add base-unit line → 200', add.status === 200, JSON.stringify(add.body))
      const rows = (await admin.query(`SELECT uom, uom_factor::float f FROM purchase_items WHERE purchase_id=$1 ORDER BY uom NULLS LAST`, [pid])).rows
      const widgetBefore = await stockOf(widget)
      const widgetCost = await costOf(widget)
      check('invoice lines: Box/12 (case of the item_uoms row) + base', rows[0].uom === 'Box' && rows[0].f === 12 && rows[1].uom === null && rows[1].f === 1, JSON.stringify(rows))
      const serials = Array.from({ length: 12 }, (_, i) => `GD-${tenantId.slice(0, 4)}-${i}`).join('\n')
      const sub = await json(await updatePurchase(req('PUT', { status: 'pending', itemSerials: { [gadget]: serials } }), ctx(pid)))
      check('submit invoice → 200', sub.status === 200, JSON.stringify(sub.body).slice(0, 300))
      const s = await stockOf(gadget)
      check('stock +12 pcs (1 box × 12)', near(s.on, 12), JSON.stringify(s))
      check('cost per piece = 240 / 12 = 20', near(await costOf(gadget), 20), String(await costOf(gadget)))
      const w = await stockOf(widget)
      const expected = Math.round(((widgetCost * widgetBefore.on + 50) / (widgetBefore.on + 2)) * 100) / 100
      check('base-unit line: +2 pcs at 25 into the weighted cost', near(w.on - widgetBefore.on, 2) && near(await costOf(widget), expected), JSON.stringify([w, await costOf(widget), expected]))
      const serialCount = Number((await admin.query(`SELECT count(*) FROM item_serial_numbers WHERE item_id=$1`, [gadget])).rows[0].count)
      check('12 serials registered for the box', serialCount === 12, String(serialCount))

      // return half a box → needs 6 serials, stock −6
      const boxLine = (await admin.query(`SELECT id FROM purchase_items WHERE purchase_id=$1 AND uom='Box'`, [pid])).rows[0].id
      const sids = (await admin.query(`SELECT id FROM item_serial_numbers WHERE item_id=$1 ORDER BY serial_number LIMIT 6`, [gadget])).rows.map((r: J) => r.id)
      const bad = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: boxLine, returnQuantity: 0.5, serialNumberIds: sids.slice(0, 1) }] }), ctx(pid)))
      check('return 0.5 box with 1 serial → 400 (needs 6)', bad.status === 400 && /6 serial/.test(bad.body.error), JSON.stringify(bad.body))
      const ret = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: boxLine, returnQuantity: 0.5, serialNumberIds: sids }] }), ctx(pid)))
      const s2 = await stockOf(gadget)
      check('return 0.5 box with 6 serials → 201, stock −6', ret.status === 201 && near(s2.on, 6), JSON.stringify([ret.status, s2]))
      const rl = (await admin.query(`SELECT uom, uom_factor::float f, quantity::float q FROM purchase_items WHERE purchase_id=$1`, [ret.body.id])).rows[0]
      check('return line keeps Box / 12, qty −0.5', rl?.uom === 'Box' && rl.f === 12 && rl.q === -0.5, JSON.stringify(rl))
      const tooMuch = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: boxLine, returnQuantity: 1 }] }), ctx(pid)))
      check('return 1 more box (only 0.5 box left) → 400', tooMuch.status === 400, JSON.stringify(tooMuch.body))
    })

    // ================= serials per purchase line =================
    await step('serials per line', async () => {
      const phone = await newItem('Phone', 'pcs', 0, 500, { serial: true })
      const tag = tenantId.slice(0, 4)
      const twoLines = async () => {
        const p = await json(await createPurchase(req('POST', {
          supplierId, warehouseId: A.wh, items: [
            { itemId: phone, itemName: 'Phone', quantity: 2, unitPrice: 100 },
            { itemId: phone, itemName: 'Phone', quantity: 3, unitPrice: 110 },
          ],
        })))
        const lines = (await admin.query(`SELECT id, quantity::float q FROM purchase_items WHERE purchase_id=$1 ORDER BY quantity`, [p.body.id])).rows
        return { id: p.body.id as string, l2: lines[0].id as string, l3: lines[1].id as string }
      }
      const serialCount = async () => Number((await admin.query(`SELECT count(*) FROM item_serial_numbers WHERE item_id=$1`, [phone])).rows[0].count)
      const statusOf = async (id: string) => (await admin.query(`SELECT status::text s FROM purchases WHERE id=$1`, [id])).rows[0].s

      const a = await twoLines()
      const ok = await json(await updatePurchase(req('PUT', { status: 'pending', itemSerials: {
        [a.l2]: `PH-${tag}-1, PH-${tag}-2`, [a.l3]: `PH-${tag}-3\nPH-${tag}-4\nPH-${tag}-5`,
      } }), ctx(a.id)))
      check('two lines of one serial item, different serials (keyed by line) → submits', ok.status === 200 && await statusOf(a.id) !== 'draft', JSON.stringify(ok.body).slice(0, 300))
      check('5 serials registered, stock 5', await serialCount() === 5 && near((await stockOf(phone)).on, 5), String(await serialCount()))

      const b = await twoLines()
      const dup = await json(await updatePurchase(req('PUT', { status: 'pending', itemSerials: {
        [b.l2]: `PH-${tag}-6, PH-${tag}-7`, [b.l3]: `PH-${tag}-7, PH-${tag}-8, PH-${tag}-9`,
      } }), ctx(b.id)))
      check('same serial on both lines → 400, invoice stays draft, nothing added',
        dup.status === 400 && /PH-.*-7/.test(dup.body.error) && await statusOf(b.id) === 'draft' && await serialCount() === 5 && near((await stockOf(phone)).on, 5),
        JSON.stringify([dup.status, dup.body.error]))

      const inStock = await json(await updatePurchase(req('PUT', { status: 'pending', itemSerials: {
        [b.l2]: `PH-${tag}-6, PH-${tag}-1`, [b.l3]: `PH-${tag}-7, PH-${tag}-8, PH-${tag}-9`,
      } }), ctx(b.id)))
      check('serial already registered for the item → 400, stays draft', inStock.status === 400 && /PH-.*-1/.test(inStock.body.error) && await statusOf(b.id) === 'draft',
        JSON.stringify([inStock.status, inStock.body.error]))

      // legacy: serials keyed by item id are split over the item's lines (2 + 3)
      const legacy = await json(await updatePurchase(req('PUT', { status: 'pending', itemSerials: { [phone]: `PH-${tag}-10, PH-${tag}-11, PH-${tag}-12, PH-${tag}-13, PH-${tag}-14` } }), ctx(b.id)))
      check('legacy item-keyed serials over two lines → submits, 10 serials, stock 10',
        legacy.status === 200 && await serialCount() === 10 && near((await stockOf(phone)).on, 10), JSON.stringify(legacy.body).slice(0, 300))
    })

    // ================= sales order in g on a kg item → invoice =================
    await step('sales order in g', async () => {
      await move(rice, 10)
      const bad = await json(await createSO(req('POST', {
        warehouseId: A.wh, items: [{ itemId: rice, itemName: 'Rice', quantity: 2, unitPrice: 10, uom: 'yard' }],
      })))
      check('SO line in yard on a kg item → 400', bad.status === 400 && bad.body.code === 'UOM_NOT_FOUND', JSON.stringify(bad.body))
      const so = await json(await createSO(req('POST', {
        warehouseId: A.wh, items: [{ itemId: rice, itemName: 'Rice', quantity: 500, unitPrice: 1.5, uom: 'grams', uomFactor: 1 }],
      })))
      check('SO with 500 g @ 1.50 → 200', so.status === 200, JSON.stringify(so.body).slice(0, 300))
      const soId = so.body.id
      const line = (await admin.query(`SELECT id, uom, uom_factor::float f, quantity::float q, total::float t FROM sales_order_items WHERE sales_order_id=$1`, [soId])).rows[0]
      check('SO line keeps uom g (normalised), factor 0.001, qty 500, total 750', line.uom === 'g' && line.f === 0.001 && line.q === 500 && line.t === 750, JSON.stringify(line))

      // edit (draft): resend the line in g → still g
      const ed = await json(await updateSO(req('PUT', {
        items: [{ itemId: rice, itemName: 'Rice', quantity: 600, unitPrice: 1.5, uom: 'g' }],
      }), ctx(soId)))
      const line2 = (await admin.query(`SELECT id, uom, uom_factor::float f, quantity::float q FROM sales_order_items WHERE sales_order_id=$1`, [soId])).rows[0]
      check('SO edit keeps g (600 g)', ed.status === 200 && line2.uom === 'g' && line2.q === 600, JSON.stringify([ed.body, line2]).slice(0, 300))
      const gso = await json(await getSO(req('GET'), ctx(soId)))
      check('GET SO returns uom g + baseUnit kg', gso.body.items?.[0]?.uom === 'g' && gso.body.items[0].baseUnit === 'kg', JSON.stringify(gso.body.items))

      const conf = await json(await updateSO(req('PUT', { status: 'confirmed' }), ctx(soId)))
      const s1 = await stockOf(rice)
      check('confirm reserves 0.6 kg', conf.status === 200 && near(s1.reserved, 0.6), JSON.stringify([conf.body, s1]).slice(0, 300))

      // partial fulfilment in the line's unit: 250 g
      const inv1 = await json(await invoiceSO(req('POST', { fulfilledQuantities: { [line2.id]: 250 } }), ctx(soId)))
      check('invoice 250 g → 200', inv1.status === 200, JSON.stringify(inv1.body).slice(0, 300))
      const si = (await admin.query(`SELECT uom, uom_factor::float f, quantity::float q, unit_price::float p, unit_cost::float c FROM sale_items WHERE sale_id=$1`, [inv1.body.sale.id])).rows[0]
      check('invoice line carries uom g / 0.001, qty 250 @ 1.50', si.uom === 'g' && si.f === 0.001 && si.q === 250 && si.p === 1.5, JSON.stringify(si))
      const s2 = await stockOf(rice)
      check('stock −0.25 kg, reservation −0.25 kg', near(s2.on, 9.75) && near(s2.reserved, 0.35), JSON.stringify(s2))
      const cogs = (await admin.query(`SELECT COALESCE(SUM(debit),0)::float d FROM gl_entries WHERE voucher_type='sale' AND voucher_id=$1 AND account_id=$2`, [inv1.body.sale.id, ACC.cogs])).rows[0].d
      check('COGS = 0.25 kg × 1000 = 250', near(cogs, 250), String(cogs))
      const ful = Number((await admin.query(`SELECT fulfilled_quantity FROM sales_order_items WHERE id=$1`, [line2.id])).rows[0].fulfilled_quantity)
      check('fulfilled quantity tracked in g (250)', ful === 250, String(ful))

      const inv2 = await json(await invoiceSO(req('POST', {}), ctx(soId)))
      const s3 = await stockOf(rice)
      const st = (await admin.query(`SELECT status FROM sales_orders WHERE id=$1`, [soId])).rows[0].status
      check('invoice remaining 350 g → stock 9.4 kg, reserved 0, SO fulfilled', inv2.status === 200 && near(s3.on, 9.4) && near(s3.reserved, 0) && st === 'fulfilled',
        JSON.stringify([inv2.body, s3, st]).slice(0, 300))
    })
  } finally {
    await closeAllPools().catch(() => undefined)
    if (!process.env.KEEP_TEST_DATA) await cleanup(admin, tenantId)
    await admin.end()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
