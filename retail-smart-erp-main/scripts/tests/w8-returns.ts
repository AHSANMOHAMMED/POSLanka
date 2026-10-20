/**
 * W8 returns / refunds / exchange / lookup integration test (+ the purchasing suite).
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w8 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/w8-returns.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) and the returns library on a
 * throw-away tenant. Prints PASS/FAIL per check, exits non-zero on failure. SKIP_PURCHASING=1
 * runs only the sales side.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { createReturnInTx, SaleFlowError } from '@/lib/sales/returns'
import { POST as postSale } from '@/app/api/sales/route'
import { PUT as voidSale } from '@/app/api/sales/[id]/route'
import { GET as lookupSale } from '@/app/api/sales/lookup/route'
import { POST as postExchange } from '@/app/api/sales/exchange/route'
import { POST as removeLines } from '@/app/api/sales/[id]/remove-lines/route'
import { runPurchasingTests } from './w8-purchasing'

type Check = (name: string, ok: boolean, detail?: string) => void
type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

interface Fx { tenantId: string; slug: string; wh: string; userId: string; customerId: string }

const ROOT = join(__dirname, '..', '..')

function session(f: Fx) {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'W8 returns', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}

function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
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

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `w8r-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'W8 returns', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Kamal Silva')`, [f.customerId, tenantId])
  return f
}

async function cleanup(admin: Client, tenantId: string) {
  await new Promise((r) => setTimeout(r, 500))
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

async function newItem(admin: Client, f: Fx, name: string, price: number, opts: { serial?: boolean; stock?: number } = {}): Promise<string> {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_serial_numbers)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
    [id, f.tenantId, `W8R-${id.slice(0, 8)}`, name, Math.round(price * 0.6), price, !!opts.serial])
  if (opts.stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: opts.stock!,
      referenceType: 'test_seed', source: 'system', userId: f.userId,
    }))
  }
  return id
}

async function stockOf(admin: Client, f: Fx, itemId: string): Promise<number> {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}

async function ledgerConsistent(admin: Client, f: Fx, itemId: string): Promise<{ ok: boolean; detail: string }> {
  const r = await admin.query(
    `SELECT qty_change, stock_before, stock_after FROM stock_movements WHERE warehouse_id=$1 AND item_id=$2 ORDER BY created_at, id`,
    [f.wh, itemId])
  // order by the before-chain (several rows can share created_at inside one transaction)
  const rowsLeft = [...r.rows]
  let prev = 0
  while (rowsLeft.length) {
    const idx = rowsLeft.findIndex((m) => Number(m.stock_before) === prev)
    if (idx < 0) return { ok: false, detail: `chain break at ${prev}` }
    prev = Number(rowsLeft[idx].stock_after)
    rowsLeft.splice(idx, 1)
  }
  const cur = await stockOf(admin, f, itemId)
  return { ok: prev === cur, detail: `ledger end=${prev} stock=${cur} rows=${r.rows.length}` }
}

interface Line { itemId: string; name: string; quantity: number; unitPrice: number; taxAmount?: number; serialNumberIds?: string[] }

async function sell(f: Fx, lines: Line[], opts: { method?: 'cash' | 'card'; offlineRef?: string; customerId?: string } = {}) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const tax = lines.reduce((s, l) => s + (l.taxAmount || 0), 0)
  const total = subtotal + tax
  return json(await postSale(req('POST', '/api/sales', {
    cartItems: lines.map((l) => ({ ...l, discount: 0 })),
    paymentMethod: opts.method || 'cash',
    subtotal, discount: 0, tax, total, amountPaid: total, creditAmount: 0,
    warehouseId: f.wh, offlineRef: opts.offlineRef, customerId: opts.customerId,
  })))
}

async function saleLines(admin: Client, saleId: string) {
  return (await admin.query(`SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY item_name`, [saleId])).rows
}

async function returnViaApi(f: Fx, saleId: string, lines: Array<{ originalSaleItemId?: string; itemId: string; name: string; quantity: number; unitPrice?: number; serialNumberIds?: string[] }>, extra: Record<string, unknown> = {}) {
  return json(await postSale(req('POST', '/api/sales', {
    isReturn: true,
    returnAgainst: saleId,
    cartItems: lines.map((l) => ({ ...l, quantity: -Math.abs(l.quantity), unitPrice: l.unitPrice ?? 0 })),
    subtotal: 0, tax: 0, total: 0,
    refundMethod: 'cash',
    warehouseId: f.wh,
    ...extra,
  })))
}

export async function runReturnsTests(check: Check): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  const f = await makeTenant(admin)
  setTestSession(session(f))

  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
  }

  try {
    const A = await newItem(admin, f, 'A Tea 400g', 100, { stock: 50 })
    const B = await newItem(admin, f, 'B Phone', 1000, { serial: true, stock: 2 })
    const C = await newItem(admin, f, 'C Kettle', 200, { stock: 10 })
    const D = await newItem(admin, f, 'D Spoon', 50, { stock: 10 })
    const serial1 = randomUUID(); const serial2 = randomUUID()
    await admin.query(
      `INSERT INTO item_serial_numbers (id, tenant_id, item_id, warehouse_id, serial_number, status) VALUES
       ($1, $3, $4, $5, 'SN-W8-1', 'available'), ($2, $3, $4, $5, 'SN-W8-2', 'available')`,
      [serial1, serial2, f.tenantId, B, f.wh])

    // ---------- S1: 2×A (tax 15 each) + 1×B (serial) cash, printed offline
    let s1: J = {}
    let s1A = ''; let s1B = ''
    await step('sale S1', async () => {
      const r = await sell(f, [
        { itemId: A, name: 'A Tea 400g', quantity: 2, unitPrice: 100, taxAmount: 30 },
        { itemId: B, name: 'B Phone', quantity: 1, unitPrice: 1000, serialNumberIds: [serial1] },
      ], { offlineRef: 'OFF-DEV1-1' })
      check('normal sale POST /api/sales still works (200)', r.status === 200, JSON.stringify(r.body).slice(0, 300))
      s1 = r.body
      check('sale stores offline_ref', s1.offlineRef === 'OFF-DEV1-1')
      const lines = await saleLines(admin, s1.id)
      s1A = lines.find((l) => l.item_id === A).id
      s1B = lines.find((l) => l.item_id === B).id
      check('sale decremented stock via ledger', (await stockOf(admin, f, A)) === 48)
      const mv = await admin.query(`SELECT qty_change, stock_before, stock_after, idempotency_key FROM stock_movements WHERE reference_id=$1 AND item_id=$2`, [s1.id, A])
      check('sale movement: signed qty_change, before/after, idempotency key',
        mv.rows.length === 1 && Number(mv.rows[0].qty_change) === -2 && Number(mv.rows[0].stock_before) === 50
        && Number(mv.rows[0].stock_after) === 48 && String(mv.rows[0].idempotency_key).startsWith(`sale:${s1.id}:`),
        JSON.stringify(mv.rows))
    })

    // ---------- refund guard + price forcing + tax reversal
    await step('return pricing', async () => {
      const tooMuch = await returnViaApi(f, s1.id, [{ originalSaleItemId: s1A, itemId: A, name: 'A', quantity: 1, unitPrice: 999 }], { refundAmount: 500 })
      check('refundAmount above computed value rejected (400)', tooMuch.status === 400 && tooMuch.body.code === 'REFUND_EXCEEDS_COMPUTED', JSON.stringify(tooMuch.body))

      const r = await returnViaApi(f, s1.id, [{ originalSaleItemId: s1A, itemId: A, name: 'A', quantity: 1, unitPrice: 999 }], { refundAmount: 115 })
      check('partial return #1 (1 of 2) succeeds', r.status === 200, JSON.stringify(r.body).slice(0, 300))
      const lines = await saleLines(admin, r.body.id)
      check('return price forced to original (100, not client 999)', Number(lines[0].unit_price) === 100, `unit=${lines[0].unit_price}`)
      check('tax reversed proportionally (-15)', Number(lines[0].tax_amount) === -15 && Number(r.body.taxAmount) === -15, `line tax=${lines[0].tax_amount}`)
      check('server-computed refund = 115 incl. tax', r.body.refundAmount === 115 && Number(r.body.total) === -115, `refund=${r.body.refundAmount} total=${r.body.total}`)
      check('return number RTN-', String(r.body.invoiceNo).startsWith('RTN-'))
      check('return line bound to original line', lines[0].original_sale_item_id === s1A)
      check('returnStatus partial', r.body.returnStatus === 'partial')
      check('stock restored by exactly 1', (await stockOf(admin, f, A)) === 49)
      const mv = await admin.query(`SELECT qty_change, stock_before, stock_after, idempotency_key FROM stock_movements WHERE reference_id=$1`, [r.body.id])
      check('return ledger row: +1, before 48 → after 49, keyed return:<id>:<line>',
        mv.rows.length === 1 && Number(mv.rows[0].qty_change) === 1 && Number(mv.rows[0].stock_before) === 48
        && Number(mv.rows[0].stock_after) === 49 && mv.rows[0].idempotency_key === `return:${r.body.id}:${lines[0].id}`,
        JSON.stringify(mv.rows))

      const r2 = await returnViaApi(f, s1.id, [{ itemId: A, name: 'A Tea 400g', quantity: 1 }])
      check('partial return #2 up to remaining (legacy itemId binding)', r2.status === 200, JSON.stringify(r2.body).slice(0, 200))
      const r3 = await returnViaApi(f, s1.id, [{ originalSaleItemId: s1A, itemId: A, name: 'A', quantity: 1 }])
      check('third return beyond remaining rejected', r3.status === 400, JSON.stringify(r3.body))
      const rq = await admin.query(`SELECT returned_quantity FROM sale_items WHERE id=$1`, [s1A])
      check('returned_quantity maintained (2)', Number(rq.rows[0].returned_quantity) === 2)
    })

    // ---------- serials
    await step('serial return', async () => {
      const bad = await returnViaApi(f, s1.id, [{ originalSaleItemId: s1B, itemId: B, name: 'B', quantity: 1, serialNumberIds: [serial2] }])
      check('serial not sold on the invoice rejected', bad.status === 400 && bad.body.code === 'SERIAL_NOT_IN_SALE', JSON.stringify(bad.body))
      const ok = await returnViaApi(f, s1.id, [{ originalSaleItemId: s1B, itemId: B, name: 'B', quantity: 1, serialNumberIds: [serial1] }])
      check('serial return succeeds', ok.status === 200, JSON.stringify(ok.body).slice(0, 200))
      const st = await admin.query(`SELECT status FROM item_serial_numbers WHERE id=$1`, [serial1])
      check('serial back to available', st.rows[0].status === 'available', st.rows[0].status)
      check('returnStatus full after everything returned', ok.body.returnStatus === 'full', ok.body.returnStatus)
      const s1Total = Number(s1.total)
      const sum = await admin.query(`SELECT COALESCE(SUM(-total),0) AS t FROM sales WHERE return_against=$1`, [s1.id])
      check('returns add up exactly to the original total', Math.abs(Number(sum.rows[0].t) - s1Total) < 0.005, `${sum.rows[0].t} vs ${s1Total}`)
      const resell = await sell(f, [{ itemId: B, name: 'B Phone', quantity: 1, unitPrice: 1000, serialNumberIds: [serial1] }])
      check('returned serial can be resold', resell.status === 200, JSON.stringify(resell.body).slice(0, 200))
    })

    // ---------- concurrency
    await step('concurrent returns', async () => {
      const s2 = await sell(f, [{ itemId: A, name: 'A Tea 400g', quantity: 3, unitPrice: 100 }])
      const line = (await saleLines(admin, s2.body.id))[0].id
      const before = await stockOf(admin, f, A)
      const attempt = () => withTenantTransaction(f.tenantId, (tx) => createReturnInTx(tx, { tenantId: f.tenantId, userId: f.userId }, {
        originalSaleId: s2.body.id, lines: [{ originalSaleItemId: line, quantity: 3 }], refundMethod: 'cash',
      }))
      const out = await Promise.allSettled([attempt(), attempt()])
      const ok = out.filter((o) => o.status === 'fulfilled').length
      const rejected = out.find((o) => o.status === 'rejected') as PromiseRejectedResult | undefined
      check('two concurrent full returns of one line → exactly one succeeds', ok === 1
        && rejected?.reason instanceof SaleFlowError, rejected ? String(rejected.reason?.message) : 'both succeeded')
      check('stock restored once (+3)', (await stockOf(admin, f, A)) === before + 3)
      const l = await ledgerConsistent(admin, f, A)
      check('ledger chain consistent with stock (item A)', l.ok, l.detail)
    })

    // ---------- refund bounds by method
    await step('refund method bound', async () => {
      const s = await sell(f, [{ itemId: D, name: 'D Spoon', quantity: 2, unitPrice: 50 }], { method: 'card', customerId: f.customerId })
      const line = (await saleLines(admin, s.body.id))[0].id
      const cash = await returnViaApi(f, s.body.id, [{ originalSaleItemId: line, itemId: D, name: 'D', quantity: 1 }])
      check('cash refund of a card-paid sale rejected', cash.status === 400 && cash.body.code === 'REFUND_METHOD_EXCEEDS_PAID', JSON.stringify(cash.body))
      const card = await returnViaApi(f, s.body.id, [{ originalSaleItemId: line, itemId: D, name: 'D', quantity: 1 }], { refundMethod: 'card' })
      check('card refund within paid amount ok', card.status === 200, JSON.stringify(card.body).slice(0, 200))
      const credit = await returnViaApi(f, s.body.id, [{ originalSaleItemId: line, itemId: D, name: 'D', quantity: 1 }], { refundMethod: 'credit' })
      const bal = await admin.query(`SELECT balance FROM customers WHERE id=$1`, [f.customerId])
      check('store-credit refund goes to customer balance', credit.status === 200 && Number(bal.rows[0].balance) === 50, `${credit.status} bal=${bal.rows[0].balance}`)
    })

    // ---------- manual return
    await step('manual return', async () => {
      const noReason = json(await postSale(req('POST', '/api/sales', {
        isReturn: true, cartItems: [{ itemId: C, name: 'C', quantity: -1, unitPrice: 1 }], subtotal: -1, tax: 0, total: -1, refundMethod: 'cash', warehouseId: f.wh,
      })))
      const r0 = await noReason
      check('manual return without reason rejected', r0.status === 400 && r0.body.code === 'REASON_REQUIRED', JSON.stringify(r0.body))
      const r = await json(await postSale(req('POST', '/api/sales', {
        isReturn: true, returnReason: 'Gift, no receipt', cartItems: [{ itemId: C, name: 'C', quantity: -1, unitPrice: 1 }],
        subtotal: -1, tax: 0, total: -1, refundMethod: 'cash', warehouseId: f.wh,
      })))
      check('manual return uses catalogue price + flagged no_receipt', r.status === 200 && Number(r.body.total) === -200 && r.body.returnReason === 'no_receipt',
        `${r.status} total=${r.body.total} reason=${r.body.returnReason}`)
    })

    // ---------- exchange both directions
    await step('exchange', async () => {
      const s = await sell(f, [{ itemId: A, name: 'A Tea 400g', quantity: 1, unitPrice: 100, taxAmount: 15 }, { itemId: D, name: 'D Spoon', quantity: 2, unitPrice: 50 }])
      const lines = await saleLines(admin, s.body.id)
      const la = lines.find((l) => l.item_id === A).id
      const ld = lines.find((l) => l.item_id === D).id
      const cBefore = await stockOf(admin, f, C)
      const up = await json(await postExchange(req('POST', '/api/sales/exchange', {
        originalSaleId: s.body.id, returnLines: [{ originalSaleItemId: la, quantity: 1 }],
        newCartItems: [{ itemId: C, name: 'C Kettle', quantity: 1, unitPrice: 200 }],
        paymentMethod: 'cash', amountPaid: 100, warehouseId: f.wh, clientSaleId: randomUUID(),
      })))
      check('exchange up: 200 and collects 85', up.status === 200 && up.body.net?.difference === 85 && up.body.net?.collected === 85, JSON.stringify(up.body.net || up.body))
      check('exchange docs linked (sale.exchange_of = return.id, RTN-/INV-)', up.body.sale?.exchangeOf === up.body.returnSale?.id
        && String(up.body.returnSale?.invoiceNo).startsWith('RTN-') && String(up.body.sale?.invoiceNo).startsWith('INV-'))
      check('exchange moved stock (C -1)', (await stockOf(admin, f, C)) === cBefore - 1)
      const pay = await admin.query(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE sale_id IN ($1,$2)`, [up.body.sale?.id, up.body.returnSale?.id])
      check('exchange till nets to the collected difference', Number(pay.rows[0].s) === 85, pay.rows[0].s)

      const down = await json(await postExchange(req('POST', '/api/sales/exchange', {
        originalSaleId: s.body.id, returnLines: [{ originalSaleItemId: ld, quantity: 2 }],
        newCartItems: [{ itemId: A, name: 'A Tea 400g', quantity: 0.5, unitPrice: 60 }],
        refundMethod: 'cash', warehouseId: f.wh,
      })))
      check('exchange down: refunds 70', down.status === 200 && down.body.net?.difference === -70 && down.body.net?.refunded === 70, JSON.stringify(down.body.net || down.body))
      const ref = await admin.query(`SELECT amount FROM refunds WHERE sale_id=$1`, [down.body.returnSale?.id])
      check('exchange refund row records only the net paid out', ref.rows.length === 1 && Number(ref.rows[0].amount) === 70)
    })

    // ---------- remove-lines + lookup + void
    await step('remove-lines / lookup / void', async () => {
      const s = await sell(f, [{ itemId: C, name: 'C Kettle', quantity: 1, unitPrice: 200 }, { itemId: D, name: 'D Spoon', quantity: 3, unitPrice: 50 }], { offlineRef: 'OFF-DEV1-2' })
      const lines = await saleLines(admin, s.body.id)
      const ld = lines.find((l) => l.item_id === D).id
      const rm = await json(await removeLines(req('POST', `/api/sales/${s.body.id}/remove-lines`, {
        lines: [{ saleItemId: ld, quantity: 1 }], reason: 'customer changed mind', refundMethod: 'cash',
      }), ctx(s.body.id)))
      check('remove-lines creates a return (RTN-, partial)', rm.status === 200 && String(rm.body.returnSale?.invoiceNo).startsWith('RTN-')
        && rm.body.returnStatus === 'partial' && rm.body.refundAmount === 50, JSON.stringify(rm.body).slice(0, 300))

      const byInv = await json(await lookupSale(req('GET', `/api/sales/lookup?code=${s.body.invoiceNo}`)))
      const remD = byInv.body.sale?.items?.find((i: J) => i.id === ld)
      check('lookup by INV: exact + remaining quantity', byInv.status === 200 && byInv.body.matchedBy === 'invoice' && remD?.remainingQuantity === 2, JSON.stringify(byInv.body).slice(0, 200))
      const byRtn = await json(await lookupSale(req('GET', `/api/sales/lookup?code=${rm.body.returnSale?.invoiceNo}`)))
      check('lookup by RTN → original sale', byRtn.status === 200 && byRtn.body.matchedBy === 'return' && byRtn.body.sale?.id === s.body.id)
      const byOff = await json(await lookupSale(req('GET', '/api/sales/lookup?code=off-dev1-2')))
      check('lookup by OFF ref (case-insensitive)', byOff.status === 200 && byOff.body.matchedBy === 'offline_ref' && byOff.body.sale?.id === s.body.id)
      const none = await json(await lookupSale(req('GET', '/api/sales/lookup?code=INV-999999999')))
      check('lookup unknown → 404', none.status === 404)

      const dBefore = await stockOf(admin, f, D)
      const v = await json(await voidSale(req('PUT', `/api/sales/${s.body.id}`, { voidReason: 'test' }), ctx(s.body.id)))
      check('void after partial return restores only the remaining (D +2) via ledger', v.status === 200 && (await stockOf(admin, f, D)) === dBefore + 2,
        `${v.status} ${dBefore} → ${await stockOf(admin, f, D)}`)
      const mv = await admin.query(`SELECT count(*)::int n FROM stock_movements WHERE reference_id=$1 AND reference_type='sale_void' AND stock_before IS NOT NULL`, [s.body.id])
      check('void movements are ledger rows', mv.rows[0].n === 2, String(mv.rows[0].n))
      const afterVoid = await returnViaApi(f, s.body.id, [{ originalSaleItemId: ld, itemId: D, name: 'D', quantity: 1 }])
      check('return against voided sale rejected', afterVoid.status === 400)
      for (const it of [C, D]) {
        const l = await ledgerConsistent(admin, f, it)
        check(`ledger chain consistent with stock (${it === C ? 'C' : 'D'})`, l.ok, l.detail)
      }
    })

    // ---------- grep: no direct ledger/stock writes in migrated files
    await step('grep', async () => {
      const files = [
        'src/app/api/sales/route.ts', 'src/app/api/sales/[id]/route.ts', 'src/lib/sales/returns.ts', 'src/lib/sales/exchange.ts',
        'src/app/api/purchases/[id]/route.ts', 'src/app/api/purchases/[id]/return/route.ts',
        'src/app/api/purchase-orders/[id]/receive/route.ts', 'src/app/api/purchase-orders/[id]/create-invoice/route.ts',
        'src/app/api/purchase-receipts/[id]/route.ts', 'src/app/api/stock-transfers/[id]/route.ts',
      ]
      const offenders: string[] = []
      for (const file of files) {
        const src = readFileSync(join(ROOT, file), 'utf8')
        if (/insert\(\s*stockMovements\s*\)/.test(src) || /INSERT\s+INTO\s+stock_movements/i.test(src)) offenders.push(`${file}: stock_movements insert`)
        if (/insert\(\s*warehouseStock\s*\)/.test(src)) offenders.push(`${file}: warehouse_stock insert`)
        if (/currentStock:\s*sql`/.test(src) || /UPDATE\s+warehouse_stock\s+SET\s+current_stock/i.test(src)) offenders.push(`${file}: current_stock write`)
      }
      check('no direct stock_movements inserts / current_stock writes in migrated files', offenders.length === 0, offenders.join('; '))
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') await cleanup(admin, f.tenantId)
    await admin.end()
  }
}

if (process.argv[1] && process.argv[1].endsWith('w8-returns.ts')) {
  const results: Array<{ name: string; ok: boolean }> = []
  const check: Check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
  }
  ;(async () => {
    console.log('— sales returns / exchange / lookup —')
    await runReturnsTests(check).catch((err) => check('runReturnsTests', false, err instanceof Error ? err.stack : String(err)))
    if (process.env.SKIP_PURCHASING !== '1') {
      console.log('— purchasing / transfers / credit notes —')
      await runPurchasingTests(check).catch((err) => check('runPurchasingTests', false, err instanceof Error ? err.stack : String(err)))
    }
    await closeAllPools()
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  })()
}
