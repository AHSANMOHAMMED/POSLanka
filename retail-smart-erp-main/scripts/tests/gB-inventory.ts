/**
 * Audit B (inventory & stock) regression suite.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/audit_b DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/gB-inventory.ts
 *
 * Requires migration drizzle/0151_inventory_audit_b.sql. Calls the real route handlers (auth
 * mocked via the w8 harness) on throw-away tenants, prints PASS/FAIL per check and exits non-zero
 * on failure. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { allocateBatchesFEFO } from '@/lib/inventory/batches'
import { validateSerialAvailability, allocateSerials } from '@/lib/inventory/serial-numbers'
import { POST as createTransfer } from '@/app/api/stock-transfers/route'
import { PUT as updateTransfer } from '@/app/api/stock-transfers/[id]/route'
import { POST as createItemRoute } from '@/app/api/items/route'
import { PUT as updateItemRoute } from '@/app/api/items/[id]/route'
import { POST as createSerials } from '@/app/api/items/[id]/serial-numbers/route'
import { POST as createBatchRoute } from '@/app/api/items/[id]/batches/route'
import { PUT as updateBatchRoute } from '@/app/api/item-batches/[id]/route'
import { PUT as updateWarehouseRoute } from '@/app/api/warehouses/[id]/route'
import { POST as addIngredient } from '@/app/api/recipes/[id]/ingredients/route'
import { GET as barcodeLookup } from '@/app/api/items/barcode-lookup/route'
import { POST as logWaste } from '@/app/api/waste-log/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh1: string; wh2: string; userId: string }

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
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'GB', businessType: 'retail',
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
  const slug = `gb-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh1: randomUUID(), wh2: randomUUID(), userId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'GB test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true), ($3, $2, 'Kandy', 'KDY', false)`,
    [f.wh1, tenantId, f.wh2])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  return f
}
async function cleanup(admin: Client, tenantId: string) {
  await new Promise((r) => setTimeout(r, 300))
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

async function newItem(admin: Client, f: Fx, name: string, opts: { stock?: number; batches?: boolean; serial?: boolean } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, track_batches, track_serial_numbers)
     VALUES ($1, $2, $3, $4, 0, 100, true, $5, $6)`,
    [id, f.tenantId, `GB-${id.slice(0, 8)}`, name, !!opts.batches, !!opts.serial])
  if (opts.stock) await seed(f, f.wh1, id, opts.stock)
  return id
}
async function seed(f: Fx, wh: string, itemId: string, qty: number) {
  await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
    tenantId: f.tenantId, warehouseId: wh, itemId, mode: 'delta', qty, referenceType: 'test_seed', source: 'system', userId: f.userId,
  }))
}
async function stockOf(admin: Client, wh: string, itemId: string) {
  const r = await admin.query(`SELECT current_stock, reserved_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? { cur: Number(r.rows[0].current_stock), res: Number(r.rows[0].reserved_stock) } : { cur: 0, res: 0 }
}
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
async function newBatch(admin: Client, f: Fx, itemId: string, no: string, qty: number, expiry: string | null, wh: string | null = f.wh1) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`, [id, f.tenantId, itemId, no, wh, expiry, qty])
  return id
}
async function batchRows(admin: Client, itemId: string) {
  return (await admin.query(
    `SELECT id, batch_number, warehouse_id, current_quantity::float AS q, status::text AS status FROM item_batches WHERE item_id=$1 ORDER BY batch_number, warehouse_id`,
    [itemId])).rows as Array<{ id: string; batch_number: string; warehouse_id: string | null; q: number; status: string }>
}

async function transferFlow(f: Fx, items: Array<{ itemId: string; quantity: number }>, upTo: 'draft' | 'submitted' | 'approved' | 'shipped') {
  const c = await json(await createTransfer(req('POST', { fromWarehouseId: f.wh1, toWarehouseId: f.wh2, items })))
  if (c.status !== 200) throw new Error(`create transfer ${c.status} ${JSON.stringify(c.body)}`)
  const id = c.body.id as string
  const steps: Array<[string, 'submitted' | 'approved' | 'shipped']> = [['submit_for_approval', 'submitted'], ['approve', 'approved'], ['ship', 'shipped']]
  for (const [action, stage] of steps) {
    if (upTo === 'draft') break
    const r = await json(await updateTransfer(req('PUT', { action }), ctx(id)))
    if (r.status !== 200) return { id, body: c.body, failed: { action, ...r } }
    if (stage === upTo) break
  }
  return { id, body: c.body, failed: null as null | { action: string; status: number; body: J } }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')
  setTestSession(session(A))

  try {
    // 1. Approval re-checks availability (stock sold after submit)
    await step('transfer approve re-validates stock', async () => {
      const it = await newItem(admin, A, 'Anchor milk powder 400g', { stock: 10 })
      const t = await transferFlow(A, [{ itemId: it, quantity: 8 }], 'submitted')
      await seed(A, A.wh1, it, -5) // sold 5 at the counter meanwhile
      const r = await json(await updateTransfer(req('PUT', { action: 'approve' }), ctx(t.id)))
      check('approve with only 5 left for an 8-unit transfer → 400', r.status === 400 && /Insufficient stock/.test(String(r.body.error)), JSON.stringify(r.body))
      const s = await stockOf(admin, A.wh1, it)
      check('no reservation booked on the rejected approval', s.res === 0, JSON.stringify(s))
      const st = await admin.query(`SELECT status FROM stock_transfers WHERE id=$1`, [t.id])
      check('transfer still pending approval', st.rows[0].status === 'pending_approval')
    })

    await step('transfer approve sums duplicate lines', async () => {
      const it = await newItem(admin, A, 'Sunlight soap', { stock: 10 })
      const t = await transferFlow(A, [{ itemId: it, quantity: 6 }, { itemId: it, quantity: 6 }], 'submitted')
      const r = await json(await updateTransfer(req('PUT', { action: 'approve' }), ctx(t.id)))
      check('two 6-unit lines of a 10-unit item cannot be approved → 400', r.status === 400, JSON.stringify(r.body))
    })

    await step('transfer approve reserves', async () => {
      const it = await newItem(admin, A, 'Maliban cream crackers', { stock: 10 })
      const t = await transferFlow(A, [{ itemId: it, quantity: 4 }], 'approved')
      check('approve within stock → ok', !t.failed, JSON.stringify(t.failed))
      check('reservation = 4', (await stockOf(admin, A.wh1, it)).res === 4)
    })

    // 2. Batches travel with the transfer
    await step('batch-tracked transfer', async () => {
      const it = await newItem(admin, A, 'Panadol 500mg strip', { stock: 20, batches: true })
      const b1 = await newBatch(admin, A, it, 'PN-001', 5, day(30))
      const b2 = await newBatch(admin, A, it, 'PN-002', 15, day(200))
      const t = await transferFlow(A, [{ itemId: it, quantity: 8 }], 'shipped')
      check('ship ok', !t.failed, JSON.stringify(t.failed))
      let rows = await batchRows(admin, it)
      const q = (id: string) => rows.find((r) => r.id === id)?.q
      check('ship takes 8 from source batches FEFO (PN-001 5→0, PN-002 15→12)', q(b1) === 0 && q(b2) === 12, JSON.stringify(rows))
      const line = (await admin.query(`SELECT id, batch_allocations FROM stock_transfer_items WHERE transfer_id=$1`, [t.id])).rows[0]
      check('ship records the batch picks on the line', Array.isArray(line.batch_allocations) && line.batch_allocations.length === 2, JSON.stringify(line.batch_allocations))

      const r = await json(await updateTransfer(req('PUT', { action: 'receive', receivedItems: [{ transferItemId: line.id, receivedQuantity: 7 }] }), ctx(t.id)))
      check('receive 7 of 8 → 200', r.status === 200, JSON.stringify(r.body))
      rows = await batchRows(admin, it)
      const dest = rows.filter((x) => x.warehouse_id === A.wh2)
      const d1 = dest.find((x) => x.batch_number === 'PN-001')
      const d2 = dest.find((x) => x.batch_number === 'PN-002')
      check('destination gets PN-001 ×5 and PN-002 ×2 (short unit not booked)', d1?.q === 5 && d2?.q === 2 && d1?.status === 'active', JSON.stringify(dest))
      check('destination stock 7', (await stockOf(admin, A.wh2, it)).cur === 7)

      // the received units can be sold (FEFO) at the destination
      const alloc = await withTenantTransaction(A.tenantId, (tx) => allocateBatchesFEFO(tx, {
        tenantId: A.tenantId, warehouseId: A.wh2, itemId: it, qty: 6, itemName: 'Panadol',
      }))
      check('destination FEFO sale of 6 succeeds (PN-001 5 + PN-002 1)',
        alloc.shortfall === 0 && alloc.allocations[0]?.batchNumber === 'PN-001' && alloc.allocations[0]?.quantity === 5, JSON.stringify(alloc))
    })

    await step('batch-tracked transfer cancelled in transit', async () => {
      const it = await newItem(admin, A, 'Amoxicillin 250mg', { stock: 10, batches: true })
      const b1 = await newBatch(admin, A, it, 'AX-1', 10, day(90))
      const t = await transferFlow(A, [{ itemId: it, quantity: 10 }], 'shipped')
      check('ship ok', !t.failed, JSON.stringify(t.failed))
      let rows = await batchRows(admin, it)
      check('batch consumed on ship', rows.find((r) => r.id === b1)?.q === 0 && rows.find((r) => r.id === b1)?.status === 'consumed', JSON.stringify(rows))
      const r = await json(await updateTransfer(req('PUT', { action: 'cancel', cancellationReason: 'Lorry broke down' }), ctx(t.id)))
      check('cancel in transit → 200', r.status === 200, JSON.stringify(r.body))
      rows = await batchRows(admin, it)
      check('cancel puts the batch back (AX-1 10, active)', rows.length === 1 && rows[0].q === 10 && rows[0].status === 'active', JSON.stringify(rows))
      check('source stock restored to 10', (await stockOf(admin, A.wh1, it)).cur === 10)
    })

    // 3. Receive matching with two lines of the same item
    await step('receive with duplicate item lines', async () => {
      const it = await newItem(admin, A, 'Elephant House ginger beer', { stock: 20 })
      const t = await transferFlow(A, [{ itemId: it, quantity: 5 }, { itemId: it, quantity: 3 }], 'shipped')
      check('ship ok', !t.failed, JSON.stringify(t.failed))
      const lines = (await admin.query(`SELECT id, quantity::float AS q FROM stock_transfer_items WHERE transfer_id=$1 ORDER BY quantity DESC`, [t.id])).rows
      const r = await json(await updateTransfer(req('PUT', {
        action: 'receive',
        receivedItems: [{ transferItemId: lines[0].id, receivedQuantity: 5 }, { transferItemId: lines[1].id, receivedQuantity: 2 }],
      }), ctx(t.id)))
      check('receive → 200', r.status === 200, JSON.stringify(r.body))
      check('destination stock = 5 + 2 = 7 (each line its own received qty)', (await stockOf(admin, A.wh2, it)).cur === 7, JSON.stringify(await stockOf(admin, A.wh2, it)))
    })

    // 4. Transfer line update rejects foreign items
    await step('transfer update validates items', async () => {
      const it = await newItem(admin, A, 'Keells sausages', { stock: 5 })
      const foreign = await newItem(admin, B, 'B-only item', { stock: 5 })
      const t = await transferFlow(A, [{ itemId: it, quantity: 1 }], 'draft')
      const r = await json(await updateTransfer(req('PUT', { action: 'update', items: [{ itemId: foreign, quantity: 1 }] }), ctx(t.id)))
      check('update with another tenant\'s item → 404', r.status === 404, JSON.stringify(r.body))
      const n = await admin.query(`SELECT item_id FROM stock_transfer_items WHERE transfer_id=$1`, [t.id])
      check('lines unchanged', n.rows.length === 1 && n.rows[0].item_id === it)
    })

    // 5. Item edit keeps trackBatches
    await step('item PUT trackBatches', async () => {
      const c = await json(await createItemRoute(req('POST', { name: 'Ratthi milk powder', sellingPrice: 1200 })))
      check('create item → 200', c.status === 200, JSON.stringify(c.body))
      const u = await json(await updateItemRoute(req('PUT', { name: 'Ratthi milk powder', sellingPrice: 1200, trackBatches: true }), ctx(c.body.id)))
      check('PUT trackBatches=true is saved', u.status === 200 && u.body.trackBatches === true, JSON.stringify(u.body).slice(0, 200))
      const u2 = await json(await updateItemRoute(req('PUT', { name: 'Ratthi milk powder', sellingPrice: 1250 }), ctx(c.body.id)))
      check('PUT without trackBatches keeps it', u2.status === 200 && u2.body.trackBatches === true)
    })

    // 6. Opening stock with no active default warehouse
    await step('opening stock needs a default warehouse', async () => {
      await admin.query(`UPDATE warehouses SET is_default=false WHERE tenant_id=$1`, [B.tenantId])
      setTestSession(session(B))
      const c = await json(await createItemRoute(req('POST', { name: 'Prima flour 1kg', sellingPrice: 300, currentStock: 50 })))
      check('opening stock 50 without default warehouse → 400 (not silently dropped)', c.status === 400 && c.body.code === 'NO_DEFAULT_WAREHOUSE', JSON.stringify(c.body))
      const n = await admin.query(`SELECT count(*)::int AS n FROM items WHERE tenant_id=$1 AND name='Prima flour 1kg'`, [B.tenantId])
      check('no item created', n.rows[0].n === 0)
      const ok = await json(await createItemRoute(req('POST', { name: 'Prima flour 1kg', sellingPrice: 300 })))
      check('without opening stock → 200', ok.status === 200)
      await admin.query(`UPDATE warehouses SET is_default=true WHERE id=$1`, [B.wh1])
      setTestSession(session(A))
    })

    // 7. Serial numbers
    await step('serial numbers', async () => {
      const it = await newItem(admin, A, 'Samsung A15', { stock: 2, serial: true })
      const c = await json(await createSerials(req('POST', { serialNumbers: 'IMEI-1001\nIMEI-1002', warehouseId: A.wh1 }), ctx(it)))
      check('create 2 serials → 201', c.status === 201, JSON.stringify(c.body))
      const dup = await json(await createSerials(req('POST', { serialNumbers: 'IMEI-1002' }), ctx(it)))
      check('duplicate serial → 400', dup.status === 400)
      const idx = await admin.query(`SELECT 1 FROM pg_indexes WHERE indexname='item_serial_numbers_tenant_item_serial_unique'`)
      check('unique index (tenant, item, serial) exists', idx.rows.length === 1)
      let raced = 'none'
      try {
        await admin.query(`INSERT INTO item_serial_numbers (tenant_id, item_id, serial_number) VALUES ($1,$2,'IMEI-1001')`, [A.tenantId, it])
      } catch (e) { raced = (e as { code?: string }).code || 'err' }
      check('DB rejects a duplicate serial insert (23505)', raced === '23505', raced)

      const foreign = await newItem(admin, B, 'B phone', { serial: true })
      const f = await json(await createSerials(req('POST', { serialNumbers: 'X-1' }), ctx(foreign)))
      check('serials for another tenant\'s item → 404', f.status === 404, JSON.stringify(f.body))
      const fw = await json(await createSerials(req('POST', { serialNumbers: 'X-2', warehouseId: B.wh1 }), ctx(it)))
      check('serials into another tenant\'s warehouse → 404', fw.status === 404, JSON.stringify(fw.body))

      // concurrent sale of the same serial: exactly one wins
      const sid = (c.body.data as Array<{ id: string; serialNumber: string }>).find((s) => s.serialNumber === 'IMEI-1001')!.id
      const sell = () => withTenantTransaction(A.tenantId, async (tx) => {
        await validateSerialAvailability(tx, [sid], it, A.wh1)
        await new Promise((r) => setTimeout(r, 150))
        await allocateSerials(tx, { tenantId: A.tenantId, serialNumberIds: [sid], newStatus: 'sold', referenceType: 'sale', referenceId: randomUUID(), changedBy: A.userId })
      })
      const outcomes = await Promise.allSettled([sell(), sell()])
      const won = outcomes.filter((o) => o.status === 'fulfilled').length
      check('two concurrent sales of one IMEI → exactly one succeeds', won === 1, JSON.stringify(outcomes.map((o) => o.status === 'rejected' ? String(o.reason) : 'ok')))
      const mv = await admin.query(`SELECT count(*)::int AS n FROM serial_number_movements WHERE serial_number_id=$1 AND to_status='sold'`, [sid])
      check('one sold movement', mv.rows[0].n === 1)
      let dupErr = ''
      try { await withTenantTransaction(A.tenantId, (tx) => validateSerialAvailability(tx, [sid, sid], it, null)) } catch (e) { dupErr = String(e) }
      check('same serial listed twice is rejected', /more than once/.test(dupErr), dupErr)
    })

    // 8. Batches: create / update
    await step('batch create & update', async () => {
      const it = await newItem(admin, A, 'Yoghurt cup', { batches: true })
      const foreign = await newItem(admin, B, 'B yoghurt', { batches: true })
      const f = await json(await createBatchRoute(req('POST', { batchNumber: 'Y1', initialQuantity: 5 }), ctx(foreign)))
      check('batch for another tenant\'s item → 404', f.status === 404, JSON.stringify(f.body))
      const bad = await json(await createBatchRoute(req('POST', { batchNumber: 'Y1', initialQuantity: 5, manufacturingDate: day(0), expiryDate: day(-3) }), ctx(it)))
      check('expiry before manufacturing → 400', bad.status === 400, JSON.stringify(bad.body))
      const ok = await json(await createBatchRoute(req('POST', { batchNumber: 'Y1', initialQuantity: 5, warehouseId: A.wh1, expiryDate: day(10) }), ctx(it)))
      check('batch create → 201', ok.status === 201, JSON.stringify(ok.body))
      const upd = await json(await updateBatchRoute(req('PUT', { expiryDate: day(20) }), ctx(ok.body.id)))
      check('PUT valid expiry → 200 and saved', upd.status === 200 && upd.body.expiryDate === day(20), JSON.stringify(upd.body))
      const badDate = await json(await updateBatchRoute(req('PUT', { expiryDate: '31/12/2026' }), ctx(ok.body.id)))
      check('PUT malformed expiry → 400 (was a 500 from the date column)', badDate.status === 400, JSON.stringify(badDate.body))
    })

    // 9. Warehouses: default cannot be deactivated
    await step('default warehouse deactivation', async () => {
      const r = await json(await updateWarehouseRoute(req('PUT', { name: 'Colombo', code: 'CMB', isActive: false }), ctx(A.wh1)))
      check('deactivate default warehouse → 400', r.status === 400, JSON.stringify(r.body))
      const r2 = await json(await updateWarehouseRoute(req('PUT', { name: 'Kandy', code: 'KDY', isActive: false, isDefault: true }), ctx(A.wh2)))
      check('make an inactive warehouse default → 400', r2.status === 400, JSON.stringify(r2.body))
      const d = await admin.query(`SELECT id FROM warehouses WHERE tenant_id=$1 AND is_default AND is_active`, [A.tenantId])
      check('tenant still has exactly one active default (Colombo)', d.rows.length === 1 && d.rows[0].id === A.wh1)
      const r3 = await json(await updateWarehouseRoute(req('PUT', { name: 'Kandy Branch', code: 'KDY' }), ctx(A.wh2)))
      check('normal edit of a non-default warehouse → 200', r3.status === 200, JSON.stringify(r3.body))
    })

    // 10. Recipe ingredients
    await step('recipe ingredients', async () => {
      const dish = await newItem(admin, A, 'Chicken kottu')
      const chicken = await newItem(admin, A, 'Chicken (kg)')
      const foreign = await newItem(admin, B, 'B chicken')
      const recipeId = randomUUID()
      await admin.query(`INSERT INTO recipes (id, tenant_id, item_id, name) VALUES ($1,$2,$3,'Chicken kottu')`, [recipeId, A.tenantId, dish])
      const f = await json(await addIngredient(req('POST', { ingredientItemId: foreign, quantity: 0.2 }), ctx(recipeId)))
      check('ingredient from another tenant → 404', f.status === 404, JSON.stringify(f.body))
      const self = await json(await addIngredient(req('POST', { ingredientItemId: dish, quantity: 1 }), ctx(recipeId)))
      check('dish as its own ingredient → 400', self.status === 400, JSON.stringify(self.body))
      const ok = await json(await addIngredient(req('POST', { ingredientItemId: chicken, quantity: 0.2, unit: 'kg' }), ctx(recipeId)))
      check('valid ingredient → 200', ok.status === 200, JSON.stringify(ok.body))
    })
    // 11. GS1 amount payable (AI 392n) is the line total, not a unit price
    await step('gs1 price is the line total', async () => {
      const gtin = '09501101530003'
      const it = await newItem(admin, A, 'Keells chicken breast pack')
      await admin.query(`UPDATE items SET barcode=$1, selling_price=1500 WHERE id=$2`, [gtin, it])
      const code = `(01)${gtin}(3103)001300(3922)50000`
      const r = await json(await barcodeLookup(new NextRequest(`http://localhost/api/items/barcode-lookup?barcode=${encodeURIComponent(code)}`)))
      const sc = r.body.scan || {}
      check('lookup → 200, qty 1.3 kg', r.status === 200 && sc.quantity === 1.3, JSON.stringify(r.body).slice(0, 300))
      check('lineTotal = 500.00 (amount payable)', sc.lineTotal === 500, JSON.stringify(sc))
      check('qty × unitPrice reproduces 500.00 to the cent (not 650)', Math.round(sc.quantity * sc.unitPrice * 100) / 100 === 500, JSON.stringify(sc))
    })
    // 12. Waste log reduces stock (ledger, batches FEFO, default warehouse)
    await step('waste log reduces stock', async () => {
      const bread = await newItem(admin, A, 'Sandwich bread loaf', { stock: 20 })
      const r = await json(await logWaste(req('POST', { itemId: bread, quantity: 5, unit: 'pcs', reason: 'Spoiled' })))
      check('waste 5 loaves → 200', r.status === 200, JSON.stringify(r.body))
      check('default warehouse stock 20 → 15', (await stockOf(admin, A.wh1, bread)).cur === 15)
      check('entry records warehouse + movement', r.body.warehouseId === A.wh1 && !!r.body.stockMovementId, JSON.stringify(r.body))
      const mv = await admin.query(`SELECT qty_change::float AS q, type::text AS type, reference_type, reference_id FROM stock_movements WHERE id=$1`, [r.body.stockMovementId])
      check('ledger row: −5 adjustment, referenceType waste, referenceId = log id',
        mv.rows[0]?.q === -5 && mv.rows[0]?.type === 'adjustment' && mv.rows[0]?.reference_type === 'waste' && mv.rows[0]?.reference_id === r.body.id, JSON.stringify(mv.rows))

      await seed(A, A.wh2, bread, 4)
      const w2 = await json(await logWaste(req('POST', { itemId: bread, quantity: 1, reason: 'Dropped', warehouseId: A.wh2 })))
      check('waste from a chosen warehouse (Kandy 4 → 3)', w2.status === 200 && (await stockOf(admin, A.wh2, bread)).cur === 3 && (await stockOf(admin, A.wh1, bread)).cur === 15)

      const over = await json(await logWaste(req('POST', { itemId: bread, quantity: 50, reason: 'Spoiled' })))
      check('waste more than on hand → 400 INSUFFICIENT_STOCK', over.status === 400 && over.body.code === 'INSUFFICIENT_STOCK', JSON.stringify(over.body))
      const n = await admin.query(`SELECT count(*)::int AS n FROM waste_log WHERE item_id=$1`, [bread])
      check('rejected waste leaves no log entry', n.rows[0].n === 2)

      const fw = await json(await logWaste(req('POST', { itemId: bread, quantity: 1, reason: 'x', warehouseId: B.wh1 })))
      check('waste from another tenant\'s warehouse → 404', fw.status === 404, JSON.stringify(fw.body))

      const yog = await newItem(admin, A, 'Curd pot', { stock: 10, batches: true })
      const old1 = await newBatch(admin, A, yog, 'CD-OLD', 4, day(-2))
      const new1 = await newBatch(admin, A, yog, 'CD-NEW', 6, day(20))
      const wy = await json(await logWaste(req('POST', { itemId: yog, quantity: 5, reason: 'Expired' })))
      const bq = async (id: string) => Number((await admin.query(`SELECT current_quantity FROM item_batches WHERE id=$1`, [id])).rows[0].current_quantity)
      check('batch item: waste takes expired batch first, then FEFO (CD-OLD 4→0, CD-NEW 6→5)',
        wy.status === 200 && await bq(old1) === 0 && await bq(new1) === 5 && wy.body.batchAllocations?.length === 2, JSON.stringify(wy.body))
      check('batch item stock 10 → 5', (await stockOf(admin, A.wh1, yog)).cur === 5)

      const svc = randomUUID()
      await admin.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1,$2,$3,'Staff meal',0,0,false)`, [svc, A.tenantId, `GB-${svc.slice(0, 8)}`])
      const ws = await json(await logWaste(req('POST', { itemId: svc, quantity: 2, reason: 'Leftover' })))
      const sm = await admin.query(`SELECT count(*)::int AS n FROM stock_movements WHERE item_id=$1`, [svc])
      check('non-stock item: logged, no stock movement', ws.status === 200 && sm.rows[0].n === 0, JSON.stringify(ws.body))
    })
    // 13. Waste with a cost posts the stock-adjustment GL (Dr adjustment / Cr stock) atomically
    await step('waste GL', async () => {
      setTestSession(session(B))
      const acc = async (name: string, no: string, root: string, type: string) => {
        const id = randomUUID()
        await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, B.tenantId, name, no, root, type])
        return id
      }
      const stockAcc = await acc('Stock in hand', '1400', 'asset', 'stock')
      const adjAcc = await acc('Stock adjustment', '5200', 'expense', 'expense_account')
      const fy = randomUUID()
      await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
        [fy, B.tenantId, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`])
      await admin.query(
        `INSERT INTO accounting_settings (tenant_id, default_stock_account_id, default_stock_adjustment_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
         VALUES ($1,$2,$3,$4,true,false)`, [B.tenantId, stockAcc, adjAcc, fy])
      const it = await newItem(admin, B, 'Fish (kg)', { stock: 10 })
      await admin.query(`UPDATE items SET cost_price=1200 WHERE id=$1`, [it])
      const r = await json(await logWaste(req('POST', { itemId: it, quantity: 1.5, unit: 'kg', reason: 'Spoiled' })))
      check('costed waste → 200, cost 1800', r.status === 200 && Number(r.body.costAmount) === 1800, JSON.stringify(r.body))
      const gl = (await admin.query(`SELECT account_id, debit::float d, credit::float c FROM gl_entries WHERE voucher_id=$1 AND voucher_type='stock_adjustment'`, [r.body.stockMovementId])).rows
      check('GL: Dr stock adjustment 1800 / Cr stock 1800',
        gl.length === 2 && gl.some((g) => g.account_id === adjAcc && g.d === 1800) && gl.some((g) => g.account_id === stockAcc && g.c === 1800), JSON.stringify(gl))
      check('stock 10 → 8.5', (await stockOf(admin, B.wh1, it)).cur === 8.5)
      setTestSession(session(A))
    })
  } finally {
    setTestSession(null)
    if (process.env.KEEP_TEST_DATA !== '1') {
      await cleanup(admin, A.tenantId)
      await cleanup(admin, B.tenantId)
    }
    await admin.end()
  }
}

main()
  .catch((err) => { check('gB-inventory', false, err instanceof Error ? err.stack : String(err)) })
  .then(async () => {
    await closeAllPools()
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  })
