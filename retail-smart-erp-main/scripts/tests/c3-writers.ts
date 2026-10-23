/**
 * C3 stock-writer migration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_c3 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/c3-writers.ts
 *
 * Calls the real route handlers (auth mocked) for the last migrated writers —
 * layaway complete, work-order invoice + cancel, sales-order invoice, restaurant
 * order recipe deduction — and checks every one writes signed ledger rows with
 * stock_before/after that chain to the current stock. Then applies
 * drizzle/0142_drop_legacy_movement_trigger.sql, proves a direct insert without
 * qty_change now fails, and re-runs the app paths. Also checks stock-intake
 * branch access and a static grep for direct stock writes.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { sales } from '@/lib/db/schema'
import { POST as completeLayaway } from '@/app/api/layaways/[id]/complete/route'
import { POST as invoiceWorkOrder } from '@/app/api/work-orders/[id]/invoice/route'
import { PUT as updateWorkOrder } from '@/app/api/work-orders/[id]/route'
import { POST as invoiceSalesOrder } from '@/app/api/sales-orders/[id]/create-invoice/route'
import { PUT as updateRestaurantOrder } from '@/app/api/restaurant-orders/[id]/route'
import { POST as createIntake } from '@/app/api/stock-intake/route'

type Check = (name: string, ok: boolean, detail?: string) => void

interface Fx { tenantId: string; slug: string; wh1: string; wh2: string; ownerId: string; cashierId: string; customerId: string }

const ROOT = join(__dirname, '..', '..')

function session(f: Fx, role: 'owner' | 'cashier' | 'stock_manager' = 'owner') {
  return {
    user: {
      id: role === 'owner' ? f.ownerId : f.cashierId,
      accountId: null,
      email: `${role}-${f.slug}@example.test`,
      name: role,
      role,
      tenantId: f.tenantId,
      tenantSlug: f.slug,
      tenantName: 'C3 writers',
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
  const slug = `c3w-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh1: randomUUID(), wh2: randomUUID(), ownerId: randomUUID(), cashierId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'C3 writers', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true), ($3, $2, 'Branch', 'BR', false)`,
    [f.wh1, tenantId, f.wh2])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner'), ($4, $2, $5, 'x', 'Cashier', 'cashier')`,
    [f.ownerId, tenantId, `owner-${slug}@example.test`, f.cashierId, `cashier-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Nimal')`, [f.customerId, tenantId])
  return f
}

/** Item with `stock` opening units at wh1, written as a native ledger row. */
async function newItem(admin: Client, f: Fx, name: string, stock: number, cost = 50): Promise<string> {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, $4, $5, 100, true)`,
    [id, f.tenantId, `C3-${id.slice(0, 8)}`, name, cost])
  if (stock > 0) {
    await admin.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1,$2,$3,$4)`, [f.tenantId, f.wh1, id, stock])
    await admin.query(
      `INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity, qty_change, stock_before, stock_after, reference_type, source, sign_source)
       VALUES ($1,$2,$3,'in',$4,$4,0,$4,'opening','system','native')`, [f.tenantId, f.wh1, id, stock])
  }
  return id
}

async function stockOf(admin: Client, wh: string, itemId: string): Promise<number> {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}

/** Movements for a reference, with signed qty + before/after. */
async function movements(admin: Client, itemId: string, referenceType: string) {
  const r = await admin.query(
    `SELECT qty_change, stock_before, stock_after, sign_source, idempotency_key FROM stock_movements WHERE item_id=$1 AND reference_type=$2 ORDER BY created_at`,
    [itemId, referenceType])
  return r.rows.map((m) => ({
    qty: Number(m.qty_change), before: m.stock_before === null ? null : Number(m.stock_before),
    after: m.stock_after === null ? null : Number(m.stock_after), sign: m.sign_source as string, key: m.idempotency_key as string | null,
  }))
}

async function ledgerConsistent(admin: Client, wh: string, itemId: string): Promise<{ ok: boolean; detail: string }> {
  const r = await admin.query(
    `SELECT qty_change, stock_before, stock_after, sign_source FROM stock_movements WHERE warehouse_id=$1 AND item_id=$2 ORDER BY created_at, stock_before NULLS FIRST`,
    [wh, itemId])
  let prev = 0
  for (const m of r.rows) {
    if (m.stock_before === null) return { ok: false, detail: 'movement without stock_before' }
    if (m.sign_source === 'legacy_trigger') return { ok: false, detail: 'legacy_trigger movement' }
    if (Number(m.stock_before) !== prev) return { ok: false, detail: `chain break: before=${m.stock_before} prev=${prev}` }
    prev = Number(m.stock_after)
  }
  const cur = await stockOf(admin, wh, itemId)
  return { ok: prev === cur, detail: `last after=${prev}, stock=${cur}, rows=${r.rows.length}` }
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

// ---------------------------------------------------------------------------

async function runWriterScenarios(admin: Client, f: Fx, check: Check, tag: string) {
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn() } catch (err) { check(`${tag} ${name}`, false, err instanceof Error ? err.stack || err.message : String(err)) }
  }

  // 1. layaway complete
  await step('layaway', async () => {
    const item = await newItem(admin, f, `Saree ${tag}`, 10)
    const layawayId = randomUUID()
    await admin.query(
      `INSERT INTO layaways (id, tenant_id, layaway_no, customer_id, subtotal, total, deposit_amount, paid_amount, balance_due, status)
       VALUES ($1,$2,$3,$4,300,300,300,300,0,'fully_paid')`,
      [layawayId, f.tenantId, `LAY-${layawayId.slice(0, 8)}`, f.customerId])
    const lineId = randomUUID()
    await admin.query(
      `INSERT INTO layaway_items (id, tenant_id, layaway_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,$4,'Saree',3,100,300)`,
      [lineId, f.tenantId, layawayId, item])
    const r = await json(await completeLayaway(req('POST', { warehouseId: f.wh1 }), ctx(layawayId)))
    check(`${tag} layaway complete → 200`, r.status === 200, JSON.stringify(r.body).slice(0, 300))
    const mv = await movements(admin, item, 'sale')
    check(`${tag} layaway: one ledger row -3 (10→7), keyed per line`,
      mv.length === 1 && mv[0].qty === -3 && mv[0].before === 10 && mv[0].after === 7 && mv[0].key === `layaway:${layawayId}:${lineId}`,
      JSON.stringify(mv))
    check(`${tag} layaway: stock 7`, await stockOf(admin, f.wh1, item) === 7)
    const lc = await ledgerConsistent(admin, f.wh1, item)
    check(`${tag} layaway: ledger chain consistent`, lc.ok, lc.detail)

    // insufficient stock is refused, nothing written
    const item2 = await newItem(admin, f, `Saree low ${tag}`, 1)
    const lay2 = randomUUID()
    await admin.query(
      `INSERT INTO layaways (id, tenant_id, layaway_no, customer_id, subtotal, total, deposit_amount, paid_amount, balance_due, status)
       VALUES ($1,$2,$3,$4,200,200,200,200,0,'fully_paid')`, [lay2, f.tenantId, `LAY-${lay2.slice(0, 8)}`, f.customerId])
    await admin.query(
      `INSERT INTO layaway_items (tenant_id, layaway_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,'Saree',2,100,200)`,
      [f.tenantId, lay2, item2])
    const bad = await json(await completeLayaway(req('POST', { warehouseId: f.wh1 }), ctx(lay2)))
    check(`${tag} layaway: insufficient stock → 400, stock unchanged`, bad.status === 400 && await stockOf(admin, f.wh1, item2) === 1, JSON.stringify(bad.body))
  })

  // 2. work-order invoice, then cancel (restore)
  await step('work order', async () => {
    const item = await newItem(admin, f, `Brake pad ${tag}`, 8)
    const woId = randomUUID()
    await admin.query(
      `INSERT INTO work_orders (id, tenant_id, order_no, customer_id, warehouse_id, status, subtotal, tax_amount, total)
       VALUES ($1,$2,$3,$4,$5,'completed',200,0,200)`, [woId, f.tenantId, `WO-${woId.slice(0, 8)}`, f.customerId, f.wh1])
    const partId = randomUUID()
    await admin.query(
      `INSERT INTO work_order_parts (id, tenant_id, work_order_id, item_id, quantity, unit_price, total) VALUES ($1,$2,$3,$4,2,100,200)`,
      [partId, f.tenantId, woId, item])
    const r = await json(await invoiceWorkOrder(req('POST', { paidAmount: 200, paymentMethod: 'cash' }), ctx(woId)))
    check(`${tag} work-order invoice → 200`, r.status === 200, JSON.stringify(r.body).slice(0, 300))
    const mv = await movements(admin, item, 'work_order')
    check(`${tag} work-order invoice: ledger -2 (8→6) keyed wo-invoice`,
      mv.length === 1 && mv[0].qty === -2 && mv[0].before === 8 && mv[0].after === 6 && mv[0].key === `wo-invoice:${woId}:${partId}`,
      JSON.stringify(mv))

    const c = await json(await updateWorkOrder(req('PUT', { status: 'cancelled', cancellationReason: 'C3 test' }), ctx(woId)))
    check(`${tag} work-order cancel (invoiced) → 200`, c.status === 200, JSON.stringify(c.body).slice(0, 300))
    const back = await movements(admin, item, 'work_order_cancelled')
    check(`${tag} work-order cancel: ledger +2 (6→8) reverses the invoice movement`,
      back.length === 1 && back[0].qty === 2 && back[0].before === 6 && back[0].after === 8 && !!back[0].key?.startsWith('wo-cancel:'),
      JSON.stringify(back))
    const lc = await ledgerConsistent(admin, f.wh1, item)
    check(`${tag} work order: ledger chain consistent`, lc.ok, lc.detail)
  })

  // 3. sales-order invoice
  await step('sales order', async () => {
    const item = await newItem(admin, f, `Tea ${tag}`, 20)
    await admin.query(`UPDATE warehouse_stock SET reserved_stock = 5 WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])
    const soId = randomUUID()
    await admin.query(
      `INSERT INTO sales_orders (id, tenant_id, order_no, customer_id, warehouse_id, status, subtotal, total)
       VALUES ($1,$2,$3,$4,$5,'confirmed',500,500)`, [soId, f.tenantId, `SO-${soId.slice(0, 8)}`, f.customerId, f.wh1])
    const soItem = randomUUID()
    await admin.query(
      `INSERT INTO sales_order_items (id, tenant_id, sales_order_id, item_id, item_name, quantity, unit_price, total) VALUES ($1,$2,$3,$4,'Tea',5,100,500)`,
      [soItem, f.tenantId, soId, item])
    const r = await json(await invoiceSalesOrder(req('POST', { fulfilledQuantities: { [soItem]: 3 } }), ctx(soId)))
    check(`${tag} sales-order invoice → 200`, r.status === 200, JSON.stringify(r.body).slice(0, 300))
    const mv = await movements(admin, item, 'sale')
    check(`${tag} sales-order invoice: ledger -3 (20→17) keyed so-invoice`,
      mv.length === 1 && mv[0].qty === -3 && mv[0].before === 20 && mv[0].after === 17 && !!mv[0].key?.startsWith('so-invoice:'),
      JSON.stringify(mv))
    const rs = await admin.query(`SELECT reserved_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.wh1, item])
    check(`${tag} sales-order invoice: reservation released 5→2`, Number(rs.rows[0].reserved_stock) === 2, String(rs.rows[0].reserved_stock))
    const lc = await ledgerConsistent(admin, f.wh1, item)
    check(`${tag} sales order: ledger chain consistent`, lc.ok, lc.detail)
  })

  // 4. restaurant order completion → recipe ingredient deduction
  await step('restaurant', async () => {
    const flour = await newItem(admin, f, `Flour ${tag}`, 10)
    const egg = await newItem(admin, f, `Egg ${tag}`, 1) // goes negative: consumption never blocks the order
    const dish = await newItem(admin, f, `Hopper ${tag}`, 0)
    await admin.query(`UPDATE items SET track_stock=false WHERE id=$1`, [dish])
    const recipeId = randomUUID()
    await admin.query(`INSERT INTO recipes (id, tenant_id, item_id, name, is_active) VALUES ($1,$2,$3,'Hopper',true)`, [recipeId, f.tenantId, dish])
    await admin.query(`INSERT INTO recipe_ingredients (tenant_id, recipe_id, ingredient_item_id, quantity) VALUES ($1,$2,$3,0.25), ($1,$2,$4,1)`,
      [f.tenantId, recipeId, flour, egg])
    const orderId = randomUUID()
    await admin.query(`INSERT INTO restaurant_orders (id, tenant_id, order_no, order_type, status) VALUES ($1,$2,$3,'takeaway','closed')`,
      [orderId, f.tenantId, `RO-${orderId.slice(0, 8)}`])
    await admin.query(`INSERT INTO restaurant_order_items (tenant_id, order_id, item_id, item_name, quantity, unit_price) VALUES ($1,$2,$3,'Hopper',2,100)`,
      [f.tenantId, orderId, dish])
    const r = await json(await updateRestaurantOrder(req('PUT', { status: 'completed' }), ctx(orderId)))
    check(`${tag} restaurant order complete → 200`, r.status === 200, JSON.stringify(r.body).slice(0, 300))
    const mf = await movements(admin, flour, 'restaurant_order')
    check(`${tag} restaurant: flour -0.5 (10→9.5) keyed per ingredient`,
      mf.length === 1 && mf[0].qty === -0.5 && mf[0].before === 10 && mf[0].after === 9.5 && mf[0].key === `restaurant-order:${orderId}:${flour}`,
      JSON.stringify(mf))
    const me = await movements(admin, egg, 'restaurant_order')
    check(`${tag} restaurant: egg -2 (1→-1, allowNegative)`, me.length === 1 && me[0].qty === -2 && me[0].before === 1 && me[0].after === -1, JSON.stringify(me))
    for (const it of [flour, egg]) {
      const lc = await ledgerConsistent(admin, f.wh1, it)
      check(`${tag} restaurant: ledger chain consistent`, lc.ok, lc.detail)
    }
  })
}

async function applySql(admin: Client, file: string) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  for (const stmt of text.split('--> statement-breakpoint')) {
    if (stmt.replace(/--.*$/gm, '').trim()) await admin.query(stmt)
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === '__snapshots__') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p)
  }
  return out
}

export async function runC3WriterTests(check: Check): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  // Creates and deletes tenants: only ever run against a local throwaway poslanka_<name> database.
  if (!/@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i.test(process.env.DATABASE_URL)) throw new Error('refusing to run outside a local poslanka_<name> test database')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  // poslanka_c3 is migrated through 0139; sales.flags arrives with 0141 (offline
  // agent). When it is missing, hide the column from drizzle for this process so
  // the sale-creating routes can run (test-only shim; the DB is left untouched).
  const hasFlags = await admin.query(`SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='flags'`)
  if (hasFlags.rowCount === 0) {
    const cols = (sales as unknown as Record<symbol, Record<string, unknown>>)[Symbol.for('drizzle:Columns')]
    delete cols.flags
    console.log('NOTE  sales.flags (0141) not in this DB: hidden from drizzle for this test run')
  }
  const f = await makeTenant(admin)
  setTestSession(session(f))
  try {
    // A. app paths (trigger may or may not still exist)
    await runWriterScenarios(admin, f, check, '[pre-0142]')

    // B. drop the transitional trigger
    await applySql(admin, 'drizzle/0142_drop_legacy_movement_trigger.sql')
    const trg = await admin.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='stock_movements_legacy_fill'`)
    const fn = await admin.query(`SELECT count(*)::int n FROM pg_proc WHERE proname='stock_movements_legacy_fill'`)
    check('0142: trigger and function dropped', trg.rows[0].n === 0 && fn.rows[0].n === 0, `trigger=${trg.rows[0].n} fn=${fn.rows[0].n}`)
    // idempotent
    await applySql(admin, 'drizzle/0142_drop_legacy_movement_trigger.sql')
    check('0142: re-apply is a no-op', true)

    const probeItem = await newItem(admin, f, 'Probe', 0)
    let directErr = ''
    try {
      await admin.query(`INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity) VALUES ($1,$2,$3,'out',1)`,
        [f.tenantId, f.wh1, probeItem])
    } catch (e) { directErr = (e as { code?: string; message: string }).code + ' ' + (e as Error).message }
    check('0142: direct insert without qty_change fails (23502 not-null)', directErr.startsWith('23502'), directErr || 'insert succeeded')

    // C. app paths still work without the trigger
    await runWriterScenarios(admin, f, check, '[post-0142]')

    const legacy = await admin.query(`SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND (sign_source='legacy_trigger' OR stock_before IS NULL)`, [f.tenantId])
    check('no legacy-trigger / unbalanced movements written by app paths', legacy.rows[0].n === 0, String(legacy.rows[0].n))

    // D. stock intake branch access
    await (async () => {
      // Stock intake is for stock staff only (cashiers were removed from submitStockIntake)
      setTestSession(session(f, 'cashier'))
      const cashier = await json(await createIntake(req('POST', { warehouseId: f.wh1 })))
      check('intake: cashier → 403 (no stock-intake permission)', cashier.status === 403, JSON.stringify(cashier.body))
      // Branch rules apply to stock managers (only owners/managers bypass them)
      setTestSession(session(f, 'stock_manager'))
      const denied = await json(await createIntake(req('POST', { warehouseId: f.wh2 })))
      check('intake: stock manager without branch assignment → 403', denied.status === 403 && denied.body.code === 'BRANCH_FORBIDDEN', JSON.stringify(denied.body))
      await admin.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1,$2,$3,true)`, [f.tenantId, f.cashierId, f.wh1])
      const ok = await json(await createIntake(req('POST', { warehouseId: f.wh1 })))
      check('intake: stock manager on assigned branch → 201', ok.status === 201, JSON.stringify(ok.body).slice(0, 200))
      const other = await json(await createIntake(req('POST', { warehouseId: f.wh2 })))
      check('intake: stock manager on other branch → 403', other.status === 403, JSON.stringify(other.body))
      setTestSession(session(f))
      const owner = await json(await createIntake(req('POST', { warehouseId: f.wh2 })))
      check('intake: owner bypasses branch assignment → 201', owner.status === 201, JSON.stringify(owner.body).slice(0, 200))
    })().catch((e) => check('intake branch access', false, e instanceof Error ? e.stack : String(e)))

    // E. static grep: no direct stock writes anywhere in src/ (scripts only seed with qty_change)
    const offenders: string[] = []
    for (const file of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]) {
      const rel = relative(ROOT, file)
      // scripts/test-*.ts are standalone test harnesses (like scripts/tests/), not data writers
      if (rel === 'src/lib/inventory/apply-stock-change.ts' || rel.startsWith('scripts/tests/') || rel.startsWith('scripts/test-')) continue
      const src = readFileSync(file, 'utf8')
      if (/insert\(\s*stockMovements\s*\)/.test(src)) offenders.push(`${rel}: insert(stockMovements)`)
      if (/INSERT\s+INTO\s+stock_movements/i.test(src)) offenders.push(`${rel}: INSERT INTO stock_movements`)
      if (/UPDATE\s+warehouse_stock\s+SET\s+current_stock/i.test(src)) offenders.push(`${rel}: UPDATE warehouse_stock current_stock`)
      const re = /update\(\s*warehouseStock\s*\)\s*\.set\(\{([\s\S]*?)\}\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) if (/\bcurrentStock\s*:/.test(m[1])) offenders.push(`${rel}: update(warehouseStock) sets currentStock`)
    }
    check('grep: no direct stock_movements inserts / current_stock writes outside applyStockChange', offenders.length === 0, offenders.join('; '))
  } finally {
    setTestSession(null)
    if (process.env.KEEP_TEST_DATA !== '1') await cleanup(admin, f.tenantId)
    await admin.end()
  }
}

if (process.argv[1] && process.argv[1].endsWith('c3-writers.ts')) {
  const results: Array<{ name: string; ok: boolean }> = []
  const check: Check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
  }
  runC3WriterTests(check)
    .catch((err) => { check('runC3WriterTests', false, err instanceof Error ? err.stack : String(err)) })
    .then(async () => {
      await closeAllPools()
      const failed = results.filter((r) => !r.ok).length
      console.log(`\n${results.length - failed}/${results.length} checks passed`)
      process.exit(failed ? 1 : 0)
    })
}
