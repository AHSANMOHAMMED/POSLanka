/**
 * W8 purchasing / transfers / credit notes integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w8 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/w8-purchasing.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) against a
 * throw-away tenant, checks stock / ledger / cost consistency, then removes the
 * tenant (unless KEEP_TEST_DATA=1).
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { POST as receivePO } from '@/app/api/purchase-orders/[id]/receive/route'
import { POST as createInvoiceFromPO } from '@/app/api/purchase-orders/[id]/create-invoice/route'
import { DELETE as cancelReceipt } from '@/app/api/purchase-receipts/[id]/route'
import { PUT as updatePurchase } from '@/app/api/purchases/[id]/route'
import { POST as returnPurchase } from '@/app/api/purchases/[id]/return/route'
import { PUT as updateTransfer } from '@/app/api/stock-transfers/[id]/route'
import { POST as createCreditNote } from '@/app/api/credit-notes/route'

type Check = (name: string, ok: boolean, detail?: string) => void

interface Fx {
  tenantId: string
  slug: string
  wh1: string
  wh2: string
  userId: string
  cashierId: string
  supplierId: string
}

const ROOT = join(__dirname, '..', '..')

function session(f: Fx, role: 'owner' | 'cashier' = 'owner') {
  return {
    user: {
      id: role === 'owner' ? f.userId : f.cashierId,
      accountId: null,
      email: `${role}-${f.slug}@example.test`,
      name: role,
      role,
      tenantId: f.tenantId,
      tenantSlug: f.slug,
      tenantName: 'W8 purchasing',
      businessType: 'retail',
      aiEnabled: false,
      isSuperAdmin: false,
      isOwner: role === 'owner',
      mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function json(res: Response | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `w8p-${tenantId.slice(0, 8)}`
  const f: Fx = {
    tenantId, slug,
    wh1: randomUUID(), wh2: randomUUID(), userId: randomUUID(), cashierId: randomUUID(), supplierId: randomUUID(),
  }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'W8 purchasing', $2, $3)`,
    [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true), ($3, $2, 'Branch', 'BR', false)`,
    [f.wh1, tenantId, f.wh2])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner'), ($4, $2, $5, 'x', 'Cashier', 'cashier')`,
    [f.userId, tenantId, `owner-${slug}@example.test`, f.cashierId, `cashier-${slug}@example.test`])
  await admin.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, 'Lanka Supplies')`, [f.supplierId, tenantId])
  return f
}

async function newItem(admin: Client, f: Fx, name: string, cost = 0, extra: { serial?: boolean } = {}): Promise<string> {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_serial_numbers)
     VALUES ($1, $2, $3, $4, $5, 100, true, $6)`,
    [id, f.tenantId, `W8-${id.slice(0, 8)}`, name, cost, !!extra.serial])
  return id
}

async function stockOf(admin: Client, wh: string, itemId: string): Promise<number> {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}

async function ledgerSum(admin: Client, wh: string, itemId: string): Promise<number> {
  const r = await admin.query(`SELECT COALESCE(SUM(qty_change),0) AS s FROM stock_movements WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return Number(r.rows[0].s)
}

/** Every movement's before/after chains onto the previous one and the last equals current stock. */
async function ledgerConsistent(admin: Client, wh: string, itemId: string): Promise<{ ok: boolean; detail: string }> {
  const r = await admin.query(
    `SELECT qty_change, stock_before, stock_after FROM stock_movements WHERE warehouse_id=$1 AND item_id=$2 ORDER BY created_at, stock_before NULLS FIRST`,
    [wh, itemId])
  let prev = 0
  for (const m of r.rows) {
    if (m.stock_before === null) return { ok: false, detail: 'movement without stock_before' }
    if (Number(m.stock_before) !== prev) return { ok: false, detail: `chain break: before=${m.stock_before} prev=${prev}` }
    prev = Number(m.stock_after)
  }
  const cur = await stockOf(admin, wh, itemId)
  return { ok: prev === cur, detail: `last after=${prev}, stock=${cur}, rows=${r.rows.length}` }
}

async function makePO(admin: Client, f: Fx, lines: Array<{ itemId: string | null; qty: number; price: number; name?: string }>) {
  const poId = randomUUID()
  await admin.query(
    `INSERT INTO purchase_orders (id, tenant_id, order_no, supplier_id, warehouse_id, status) VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
    [poId, f.tenantId, `PO-${poId.slice(0, 8)}`, f.supplierId, f.wh1])
  const lineIds: string[] = []
  for (const l of lines) {
    const lid = randomUUID()
    lineIds.push(lid)
    await admin.query(
      `INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, item_id, item_name, quantity, unit_price, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [lid, f.tenantId, poId, l.itemId, l.name || 'Line', l.qty, l.price, l.qty * l.price])
  }
  return { poId, lineIds }
}

async function makeDraftPurchase(admin: Client, f: Fx, lines: Array<{ itemId: string | null; qty: number; price: number; name?: string }>) {
  const pid = randomUUID()
  await admin.query(
    `INSERT INTO purchases (id, tenant_id, purchase_no, supplier_id, warehouse_id, status) VALUES ($1, $2, $3, $4, $5, 'draft')`,
    [pid, f.tenantId, `PI-${pid.slice(0, 8)}`, f.supplierId, f.wh1])
  const lineIds: string[] = []
  for (const l of lines) {
    const lid = randomUUID()
    lineIds.push(lid)
    await admin.query(
      `INSERT INTO purchase_items (id, tenant_id, purchase_id, item_id, item_name, quantity, unit_price, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [lid, f.tenantId, pid, l.itemId, l.name || 'Line', l.qty, l.price, l.qty * l.price])
  }
  return { pid, lineIds }
}

async function cleanup(admin: Client, tenantId: string) {
  await new Promise((r) => setTimeout(r, 500)) // let fire-and-forget activity logs land first
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

export async function runPurchasingTests(check: Check): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  const f = await makeTenant(admin)
  setTestSession(session(f))

  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack || err.message : String(err)) }
  }

  try {
    // 1. PO receive with duplicate lines + weighted-average cost
    await step('po receive', async () => {
      const item = await newItem(admin, f, 'Rice 5kg', 100)
      // existing stock spread over two warehouses: 10 @ wh1 + 10 @ wh2 = 20 units @ 100
      await admin.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1,$2,$4,10), ($1,$3,$4,10)`,
        [f.tenantId, f.wh1, f.wh2, item])
      await admin.query(
        `INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity, qty_change, stock_before, stock_after, reference_type, source, sign_source)
         VALUES ($1,$2,$4,'in',10,10,0,10,'opening','system','native'), ($1,$3,$4,'in',10,10,0,10,'opening','system','native')`,
        [f.tenantId, f.wh1, f.wh2, item])
      const { poId, lineIds } = await makePO(admin, f, [{ itemId: item, qty: 10, price: 200, name: 'Rice 5kg' }])

      // over-receipt via duplicates (6 + 6 > 10) is rejected
      const over = await json(await receivePO(req('POST', {
        updateStock: true, items: [{ itemId: lineIds[0], receivedQuantity: 6 }, { itemId: lineIds[0], receivedQuantity: 6 }],
      }), ctx(poId)))
      check('PO receive: duplicate lines exceeding ordered qty rejected (400)', over.status === 400, JSON.stringify(over.body))
      check('PO receive: rejected receive left stock untouched', await stockOf(admin, f.wh1, item) === 10)

      // 3 + 2 on the same line → +5 stock, received 5
      const ok = await json(await receivePO(req('POST', {
        updateStock: true, items: [{ itemId: lineIds[0], receivedQuantity: 3 }, { itemId: lineIds[0], receivedQuantity: 2 }],
      }), ctx(poId)))
      check('PO receive: duplicate lines accepted (200)', ok.status === 200, JSON.stringify(ok.body))
      const stock = await stockOf(admin, f.wh1, item)
      check('PO receive: duplicate lines add stock once in total (10 → 15)', stock === 15, `stock=${stock}`)
      const rec = await admin.query(`SELECT received_quantity FROM purchase_order_items WHERE id=$1`, [lineIds[0]])
      check('PO receive: cumulative received = 5', Number(rec.rows[0].received_quantity) === 5, `received=${rec.rows[0].received_quantity}`)
      const mv = await admin.query(`SELECT count(*)::int n, SUM(qty_change) s FROM stock_movements WHERE item_id=$1 AND reference_type='purchase_order_receive'`, [item])
      check('PO receive: one ledger row (+5) for the aggregated line', mv.rows[0].n === 1 && Number(mv.rows[0].s) === 5, JSON.stringify(mv.rows[0]))

      // weighted average over TOTAL stock (20 @ 100 + 5 @ 200) / 25 = 120
      const cost = await admin.query(`SELECT cost_price FROM items WHERE id=$1`, [item])
      check('PO receive: cost = weighted avg over all warehouses (120.00)', Number(cost.rows[0].cost_price) === 120, `cost=${cost.rows[0].cost_price}`)
      const hist = await admin.query(`SELECT source, previous_cost_price, new_cost_price, stock_before, stock_after FROM item_cost_history WHERE item_id=$1`, [item])
      check('PO receive: item_cost_history row (source purchase, 100 → 120, stock 20 → 25)',
        hist.rows.length === 1 && hist.rows[0].source === 'purchase' && Number(hist.rows[0].new_cost_price) === 120
        && Number(hist.rows[0].stock_before) === 20 && Number(hist.rows[0].stock_after) === 25, JSON.stringify(hist.rows))

      // more over-receipt: 5 remaining, 4 + 2 → rejected
      const over2 = await json(await receivePO(req('POST', {
        updateStock: true, items: [{ itemId: lineIds[0], receivedQuantity: 4 }, { itemId: lineIds[0], receivedQuantity: 2 }],
      }), ctx(poId)))
      check('PO receive: cumulative over-receipt across receipts rejected', over2.status === 400, JSON.stringify(over2.body))

      // cancel the updateStock=true receipt → reversed exactly once
      const receiptId = ok.body.receiptId as string
      const c1 = await json(await cancelReceipt(req('DELETE', { cancellationReason: 'test' }), ctx(receiptId)))
      check('Receipt cancel (updateStock=true): 200', c1.status === 200, JSON.stringify(c1.body))
      const afterCancel = await stockOf(admin, f.wh1, item)
      check('Receipt cancel (updateStock=true): stock back to 10', afterCancel === 10, `stock=${afterCancel}`)
      const c2 = await json(await cancelReceipt(req('DELETE', {}), ctx(receiptId)))
      check('Receipt cancel: second cancel rejected, stock unchanged', c2.status === 400 && await stockOf(admin, f.wh1, item) === 10)
      const rev = await admin.query(`SELECT count(*)::int n FROM stock_movements WHERE item_id=$1 AND idempotency_key LIKE 'po-receive-cancel:%'`, [item])
      check('Receipt cancel: exactly one reversal movement', rev.rows[0].n === 1, `n=${rev.rows[0].n}`)
      const lc = await ledgerConsistent(admin, f.wh1, item)
      check('Receipt cancel: ledger before/after chain consistent with stock', lc.ok, lc.detail)
      const rec2 = await admin.query(`SELECT received_quantity FROM purchase_order_items WHERE id=$1`, [lineIds[0]])
      check('Receipt cancel: PO line received back to 0', Number(rec2.rows[0].received_quantity) === 0)

      // receive with updateStock=false, then cancel → stock untouched
      const ns = await json(await receivePO(req('POST', { updateStock: false, items: [{ itemId: lineIds[0], receivedQuantity: 4 }] }), ctx(poId)))
      check('PO receive (updateStock=false): 200 and stock unchanged', ns.status === 200 && await stockOf(admin, f.wh1, item) === 10, JSON.stringify(ns.body))
      const movesBefore = (await admin.query(`SELECT count(*)::int n FROM stock_movements WHERE item_id=$1`, [item])).rows[0].n
      const c3 = await json(await cancelReceipt(req('DELETE', {}), ctx(ns.body.receiptId as string)))
      const movesAfter = (await admin.query(`SELECT count(*)::int n FROM stock_movements WHERE item_id=$1`, [item])).rows[0].n
      check('Receipt cancel (updateStock=false): does not touch stock or ledger',
        c3.status === 200 && await stockOf(admin, f.wh1, item) === 10 && movesBefore === movesAfter,
        `status=${c3.status} stock=${await stockOf(admin, f.wh1, item)} moves ${movesBefore}->${movesAfter}`)

      // insufficient stock to reverse a receipt → 400, nothing changed
      const r3 = await json(await receivePO(req('POST', { updateStock: true, items: [{ itemId: lineIds[0], receivedQuantity: 5 }] }), ctx(poId)))
      await admin.query(`SET session_replication_role = replica`)
      await admin.query(`UPDATE warehouse_stock SET current_stock = 2 WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])
      await admin.query(`SET session_replication_role = origin`)
      const c4 = await json(await cancelReceipt(req('DELETE', {}), ctx(r3.body.receiptId as string)))
      check('Receipt cancel: insufficient stock → 400 INSUFFICIENT_STOCK, no clamping',
        c4.status === 400 && c4.body.code === 'INSUFFICIENT_STOCK' && await stockOf(admin, f.wh1, item) === 2, JSON.stringify(c4.body))
      const rs = await admin.query(`SELECT status FROM purchase_receipts WHERE id=$1`, [r3.body.receiptId])
      check('Receipt cancel: failed cancel rolled back (receipt still completed)', rs.rows[0].status === 'completed')
    })

    // 1b. legacy receipt (movement without idempotency key, written in the same transaction)
    await step('legacy receipt cancel', async () => {
      const item = await newItem(admin, f, 'Legacy Tea', 10)
      const { poId, lineIds } = await makePO(admin, f, [{ itemId: item, qty: 5, price: 10, name: 'Legacy Tea' }])
      const rid = randomUUID()
      await admin.query('BEGIN')
      await admin.query(`INSERT INTO purchase_receipts (id, tenant_id, receipt_no, purchase_order_id, warehouse_id, supplier_id, receipt_date, status)
        VALUES ($1,$2,$3,$4,$5,$6,current_date,'completed')`, [rid, f.tenantId, `GRN-L-${rid.slice(0, 6)}`, poId, f.wh1, f.supplierId])
      await admin.query(`INSERT INTO purchase_receipt_items (tenant_id, receipt_id, purchase_order_item_id, item_id, item_name, quantity_received, quantity_accepted, quantity_rejected)
        VALUES ($1,$2,$3,$4,'Legacy Tea',5,5,0)`, [f.tenantId, rid, lineIds[0], item])
      await admin.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1,$2,$3,5)`, [f.tenantId, f.wh1, item])
      await admin.query(`INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity, qty_change, stock_before, stock_after, reference_type, reference_id, source, sign_source)
        VALUES ($1,$2,$3,'in',5,5,0,5,'purchase_order_receive',$4,'system','native')`, [f.tenantId, f.wh1, item, poId])
      await admin.query(`UPDATE purchase_order_items SET received_quantity = 5 WHERE id=$1`, [lineIds[0]])
      await admin.query('COMMIT')
      const c = await json(await cancelReceipt(req('DELETE', {}), ctx(rid)))
      check('Legacy receipt cancel: reverses the unkeyed same-transaction movement (5 → 0)',
        c.status === 200 && await stockOf(admin, f.wh1, item) === 0 && await ledgerSum(admin, f.wh1, item) === 0, JSON.stringify(c.body))
    })

    // 2. PO → invoice with updateStock is blocked only while a receive is active
    await step('po create-invoice', async () => {
      const item = await newItem(admin, f, 'Dhal 1kg', 50)
      const { poId, lineIds } = await makePO(admin, f, [{ itemId: item, qty: 4, price: 60, name: 'Dhal 1kg' }])
      const inv = await json(await createInvoiceFromPO(req('POST', { updateStock: true, receivedQuantities: { [lineIds[0]]: '4' } }), ctx(poId)))
      check('PO create-invoice (updateStock): 200 and stock +4 with ledger', inv.status === 200
        && await stockOf(admin, f.wh1, item) === 4 && await ledgerSum(admin, f.wh1, item) === 4, JSON.stringify(inv.body).slice(0, 300))
    })

    // 3. purchase submit + cancel
    await step('purchase submit/cancel', async () => {
      const item = await newItem(admin, f, 'Sugar 1kg', 0)
      const { pid } = await makeDraftPurchase(admin, f, [{ itemId: item, qty: 8, price: 250, name: 'Sugar 1kg' }])
      const sub = await json(await updatePurchase(req('PUT', { status: 'pending' }), ctx(pid)))
      check('Purchase submit: 200', sub.status === 200, JSON.stringify(sub.body).slice(0, 300))
      check('Purchase submit: stock +8', await stockOf(admin, f.wh1, item) === 8)
      const mv = await admin.query(`SELECT qty_change, stock_before, stock_after, source, idempotency_key FROM stock_movements WHERE item_id=$1 AND reference_id=$2`, [item, pid])
      check('Purchase submit: ledger row +8 (0 → 8, source purchase, keyed)', mv.rows.length === 1 && Number(mv.rows[0].qty_change) === 8
        && Number(mv.rows[0].stock_before) === 0 && Number(mv.rows[0].stock_after) === 8 && mv.rows[0].source === 'purchase'
        && String(mv.rows[0].idempotency_key).startsWith('purchase-in:'), JSON.stringify(mv.rows))
      const cost = await admin.query(`SELECT cost_price FROM items WHERE id=$1`, [item])
      check('Purchase submit: cost = 250 (no prior stock)', Number(cost.rows[0].cost_price) === 250, `cost=${cost.rows[0].cost_price}`)

      // cancel with insufficient stock → 400
      await admin.query(`SET session_replication_role = replica`)
      await admin.query(`UPDATE warehouse_stock SET current_stock = 3 WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])
      await admin.query(`SET session_replication_role = origin`)
      const bad = await json(await updatePurchase(req('PUT', { status: 'cancelled' }), ctx(pid)))
      check('Purchase cancel: insufficient stock → 400 (no GREATEST clamp)', bad.status === 400 && bad.body.code === 'INSUFFICIENT_STOCK'
        && await stockOf(admin, f.wh1, item) === 3, JSON.stringify(bad.body))
      await admin.query(`SET session_replication_role = replica`)
      await admin.query(`UPDATE warehouse_stock SET current_stock = 8 WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])
      await admin.query(`SET session_replication_role = origin`)
      const can = await json(await updatePurchase(req('PUT', { status: 'cancelled' }), ctx(pid)))
      check('Purchase cancel: 200, stock back to 0, ledger sum 0', can.status === 200 && await stockOf(admin, f.wh1, item) === 0
        && await ledgerSum(admin, f.wh1, item) === 0, JSON.stringify(can.body).slice(0, 300))
    })

    // 4. purchase returns
    await step('purchase return', async () => {
      const item = await newItem(admin, f, 'Flour 1kg', 0)
      const { pid, lineIds } = await makeDraftPurchase(admin, f, [
        { itemId: item, qty: 10, price: 100, name: 'Flour 1kg' },
        { itemId: null, qty: 2, price: 500, name: 'Delivery pallet' },
      ])
      const sub = await json(await updatePurchase(req('PUT', { status: 'pending' }), ctx(pid)))
      check('Return setup: purchase submitted', sub.status === 200, JSON.stringify(sub.body).slice(0, 200))
      const before = await stockOf(admin, f.wh1, item)

      const r1 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 6 }] }), ctx(pid)))
      check('Purchase return #1 (6): 201', r1.status === 201, JSON.stringify(r1.body).slice(0, 300))
      const after = await stockOf(admin, f.wh1, item)
      const retSum = await admin.query(`SELECT COALESCE(SUM(qty_change),0) s FROM stock_movements WHERE item_id=$1 AND reference_id=$2`, [item, r1.body.id])
      check('Purchase return: stock reduced by 6 and ledger qty_change sum == stock change',
        before - after === 6 && Number(retSum.rows[0].s) === after - before, `before=${before} after=${after} ledger=${retSum.rows[0].s}`)
      const r2 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 5 }] }), ctx(pid)))
      check('Purchase return #2 (5 > 4 remaining) rejected across returns', r2.status === 400, JSON.stringify(r2.body))
      const r3 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 4 }] }), ctx(pid)))
      check('Purchase return #2 (4 = remaining) accepted', r3.status === 201, JSON.stringify(r3.body).slice(0, 200))
      check('Purchase returns: stock 0 and ledger consistent', await stockOf(admin, f.wh1, item) === 0
        && (await ledgerConsistent(admin, f.wh1, item)).ok)

      // non-inventory line validated against prior returns too
      const n1 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[1], returnQuantity: 2 }] }), ctx(pid)))
      const n2 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[1], returnQuantity: 1 }] }), ctx(pid)))
      check('Purchase return: line without itemId validated against prior returns', n1.status === 201 && n2.status === 400,
        `first=${n1.status} second=${n2.status} ${JSON.stringify(n2.body)}`)

      // cancelling the original while returns exist is refused
      const cancelOrig = await json(await updatePurchase(req('PUT', { status: 'cancelled' }), ctx(pid)))
      check('Purchase cancel with active returns refused', cancelOrig.status === 400, JSON.stringify(cancelOrig.body))

      // cancelling a return restores its stock exactly
      const cr = await json(await updatePurchase(req('PUT', { status: 'cancelled' }), ctx(r3.body.id as string)))
      check('Purchase return cancel: stock restored (+4)', cr.status === 200 && await stockOf(admin, f.wh1, item) === 4,
        `status=${cr.status} stock=${await stockOf(admin, f.wh1, item)}`)

      // insufficient stock for a return → 400, no clamp
      await admin.query(`SET session_replication_role = replica`)
      await admin.query(`UPDATE warehouse_stock SET current_stock = 1 WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])
      await admin.query(`SET session_replication_role = origin`)
      const r4 = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 3 }] }), ctx(pid)))
      check('Purchase return: insufficient stock → 400 INSUFFICIENT_STOCK', r4.status === 400 && r4.body.code === 'INSUFFICIENT_STOCK'
        && await stockOf(admin, f.wh1, item) === 1, JSON.stringify(r4.body))
    })

    // 5. purchase return with serials
    await step('purchase return serials', async () => {
      const item = await newItem(admin, f, 'Phone X', 0, { serial: true })
      const { pid, lineIds } = await makeDraftPurchase(admin, f, [{ itemId: item, qty: 3, price: 30000, name: 'Phone X' }])
      const sub = await json(await updatePurchase(req('PUT', { status: 'pending', itemSerials: { [item]: 'SNX001-SNX003' } }), ctx(pid)))
      check('Serial return setup: submit with 3 serials', sub.status === 200, JSON.stringify(sub.body).slice(0, 200))
      const serials = (await admin.query(`SELECT id, serial_number FROM item_serial_numbers WHERE item_id=$1 ORDER BY serial_number`, [item])).rows
      const missing = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 1 }] }), ctx(pid)))
      check('Serial return: serials required for serial-tracked item', missing.status === 400, JSON.stringify(missing.body))
      const ok = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 1, serialNumberIds: [serials[0].id] }] }), ctx(pid)))
      const st = (await admin.query(`SELECT status FROM item_serial_numbers WHERE id=$1`, [serials[0].id])).rows[0].status
      const smv = (await admin.query(`SELECT count(*)::int n FROM serial_number_movements WHERE serial_number_id=$1 AND to_status='returned' AND reference_type='purchase_return'`, [serials[0].id])).rows[0].n
      check('Serial return: serial → returned with movement, stock 3 → 2',
        ok.status === 201 && st === 'returned' && smv === 1 && await stockOf(admin, f.wh1, item) === 2, `status=${ok.status} serial=${st} mv=${smv}`)
      const again = await json(await returnPurchase(req('POST', { items: [{ purchaseItemId: lineIds[0], returnQuantity: 1, serialNumberIds: [serials[0].id] }] }), ctx(pid)))
      check('Serial return: already-returned serial rejected', again.status === 400, JSON.stringify(again.body))
    })

    // 6. stock transfer ship + receive
    await step('stock transfer', async () => {
      const item = await newItem(admin, f, 'Soap', 40)
      await admin.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock, reserved_stock) VALUES ($1,$2,$3,20,7)`, [f.tenantId, f.wh1, item])
      await admin.query(
        `INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity, qty_change, stock_before, stock_after, reference_type, source, sign_source)
         VALUES ($1,$2,$3,'in',20,20,0,20,'opening','system','native')`, [f.tenantId, f.wh1, item])
      const tid = randomUUID()
      await admin.query(`INSERT INTO stock_transfers (id, tenant_id, transfer_no, from_warehouse_id, to_warehouse_id, status) VALUES ($1,$2,$3,$4,$5,'approved')`,
        [tid, f.tenantId, `TR-${tid.slice(0, 8)}`, f.wh1, f.wh2])
      await admin.query(`INSERT INTO stock_transfer_items (tenant_id, transfer_id, item_id, quantity) VALUES ($1,$2,$3,7)`, [f.tenantId, tid, item])

      const ship = await json(await updateTransfer(req('PUT', { action: 'ship' }), ctx(tid)))
      check('Transfer ship: 200, source 20 → 13, reservation released', ship.status === 200 && await stockOf(admin, f.wh1, item) === 13
        && Number((await admin.query(`SELECT reserved_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])).rows[0].reserved_stock) === 0,
        JSON.stringify(ship.body).slice(0, 300))
      const ship2 = await json(await updateTransfer(req('PUT', { action: 'ship' }), ctx(tid)))
      check('Transfer ship twice rejected, no double deduction', ship2.status === 400 && await stockOf(admin, f.wh1, item) === 13)
      const recv = await json(await updateTransfer(req('PUT', { action: 'receive' }), ctx(tid)))
      check('Transfer receive: 200, destination +7', recv.status === 200 && await stockOf(admin, f.wh2, item) === 7, JSON.stringify(recv.body).slice(0, 300))
      const mv = await admin.query(
        `SELECT warehouse_id, qty_change, source FROM stock_movements WHERE reference_id=$1 AND reference_type='stock_transfer' ORDER BY qty_change`, [tid])
      check('Transfer: paired movements (−7 at source, +7 at destination, source transfer)',
        mv.rows.length === 2 && mv.rows[0].warehouse_id === f.wh1 && Number(mv.rows[0].qty_change) === -7
        && mv.rows[1].warehouse_id === f.wh2 && Number(mv.rows[1].qty_change) === 7 && mv.rows.every((r) => r.source === 'transfer'),
        JSON.stringify(mv.rows))
      const l1 = await ledgerConsistent(admin, f.wh1, item)
      const l2 = await ledgerConsistent(admin, f.wh2, item)
      check('Transfer: ledger consistent at both warehouses', l1.ok && l2.ok, `${l1.detail} | ${l2.detail}`)

      // ship with insufficient stock → 400
      const tid2 = randomUUID()
      await admin.query(`INSERT INTO stock_transfers (id, tenant_id, transfer_no, from_warehouse_id, to_warehouse_id, status) VALUES ($1,$2,$3,$4,$5,'approved')`,
        [tid2, f.tenantId, `TR-${tid2.slice(0, 8)}`, f.wh1, f.wh2])
      await admin.query(`INSERT INTO stock_transfer_items (tenant_id, transfer_id, item_id, quantity) VALUES ($1,$2,$3,50)`, [f.tenantId, tid2, item])
      const bad = await json(await updateTransfer(req('PUT', { action: 'ship' }), ctx(tid2)))
      check('Transfer ship: insufficient stock → 400, stock unchanged', bad.status === 400 && await stockOf(admin, f.wh1, item) === 13, JSON.stringify(bad.body))
    })

    // 7. credit notes
    await step('credit notes', async () => {
      const r1 = await json(await createCreditNote(req('POST', {
        subtotal: 100, total: 100, items: [{ itemName: 'Refund', quantity: 1, unitPrice: 100, total: 100 }],
      })))
      check('Credit note: number CN-000001', r1.status === 201 && r1.body.creditNoteNo === 'CN-000001', JSON.stringify(r1.body).slice(0, 200))
      const r2 = await json(await createCreditNote(req('POST', {
        subtotal: 50, total: 50, items: [{ itemName: 'Refund', quantity: 1, unitPrice: 50, total: 50 }],
      })))
      check('Credit note: next number CN-000002', r2.body.creditNoteNo === 'CN-000002', String(r2.body.creditNoteNo))
      const badSale = await json(await createCreditNote(req('POST', {
        saleId: randomUUID(), subtotal: 1, total: 1, items: [{ itemName: 'x', quantity: 1, unitPrice: 1, total: 1 }],
      })))
      check('Credit note: foreign/unknown saleId → 400', badSale.status === 400, JSON.stringify(badSale.body))
      setTestSession(session(f, 'cashier'))
      const denied = await json(await createCreditNote(req('POST', {
        subtotal: 1, total: 1, items: [{ itemName: 'x', quantity: 1, unitPrice: 1, total: 1 }],
      })))
      setTestSession(session(f))
      check('Credit note: cashier → 403', denied.status === 403, JSON.stringify(denied.body))
    })

    // 8. static check: no direct stock writes left in the migrated files
    await step('grep', async () => {
      const files = [
        'src/app/api/purchases/[id]/route.ts',
        'src/app/api/purchases/[id]/return/route.ts',
        'src/app/api/purchase-orders/[id]/receive/route.ts',
        'src/app/api/purchase-orders/[id]/create-invoice/route.ts',
        'src/app/api/purchase-receipts/[id]/route.ts',
        'src/app/api/stock-transfers/[id]/route.ts',
        'src/app/api/credit-notes/route.ts',
      ]
      const offenders: string[] = []
      for (const rel of files) {
        const src = readFileSync(join(ROOT, rel), 'utf8')
        if (/insert\(\s*stockMovements\s*\)/.test(src)) offenders.push(`${rel}: insert(stockMovements)`)
        if (/INSERT\s+INTO\s+stock_movements/i.test(src)) offenders.push(`${rel}: INSERT INTO stock_movements`)
        if (/insert\(\s*warehouseStock\s*\)/.test(src) || /INSERT\s+INTO\s+warehouse_stock/i.test(src)) offenders.push(`${rel}: insert warehouse_stock`)
        if (/UPDATE\s+warehouse_stock/i.test(src)) offenders.push(`${rel}: UPDATE warehouse_stock`)
        // drizzle updates of warehouseStock may only touch reserved_stock (not ledgered), never current_stock
        const re = /update\(\s*warehouseStock\s*\)\s*\.set\(\{([\s\S]*?)\}\)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) {
          if (/currentStock/.test(m[1])) offenders.push(`${rel}: update(warehouseStock) sets currentStock`)
        }
        if (/GREATEST\(0,\s*\$\{warehouseStock\.currentStock\}/.test(src)) offenders.push(`${rel}: GREATEST clamp on currentStock`)
      }
      check('grep: no direct stock_movements inserts / warehouse_stock current_stock writes in migrated files', offenders.length === 0, offenders.join('; '))
    })
  } finally {
    setTestSession(null)
    if (process.env.KEEP_TEST_DATA !== '1') await cleanup(admin, f.tenantId)
    await admin.end()
  }
}

if (process.argv[1] && process.argv[1].endsWith('w8-purchasing.ts')) {
  const results: Array<{ name: string; ok: boolean }> = []
  const check: Check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
  }
  runPurchasingTests(check)
    .catch((err) => { check('runPurchasingTests', false, err instanceof Error ? err.stack : String(err)) })
    .then(async () => {
      await closeAllPools()
      const failed = results.filter((r) => !r.ok).length
      console.log(`\n${results.length - failed}/${results.length} checks passed`)
      process.exit(failed ? 1 : 0)
    })
}
