/**
 * K4 — branch (warehouse) isolation for staff inside one vendor.
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/k4-branches.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on a throw-away tenant with two
 * branches (Colombo = A, Kandy = B). Rule under test (src/lib/auth/branch-access.ts): the owner
 * and staff with no branch assignment work with every branch; anyone else only with the branches
 * assigned to them. Transfers: the sending branch sends, the receiving branch receives.
 * Prints PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenant.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { tenantToday } from '@/lib/accounting/gl'
import { GET as listWarehouses } from '@/app/api/warehouses/route'
import { GET as getWarehouse } from '@/app/api/warehouses/[id]/route'
import { POST as adjustStock } from '@/app/api/warehouses/[id]/stock/route'
import { POST as bulkAdjust } from '@/app/api/stock-adjustments/bulk/route'
import { GET as listMovements } from '@/app/api/stock-movements/route'
import { GET as listSales, POST as postSale } from '@/app/api/sales/route'
import { GET as getSale, PUT as voidSale } from '@/app/api/sales/[id]/route'
import { GET as listShifts, POST as openShift } from '@/app/api/pos-opening-entries/route'
import { GET as listProfiles } from '@/app/api/pos-profiles/route'
import { POST as holdSale } from '@/app/api/held-sales/route'
import { GET as listItems } from '@/app/api/items/route'
import { GET as barcodeLookup } from '@/app/api/items/barcode-lookup/route'
import { GET as itemWarehouseStock } from '@/app/api/items/[id]/warehouse-stock/route'
import { GET as listTransfers, POST as createTransfer } from '@/app/api/stock-transfers/route'
import { GET as getTransfer, PUT as updateTransfer } from '@/app/api/stock-transfers/[id]/route'
import { GET as listPOs, POST as createPO } from '@/app/api/purchase-orders/route'
import { GET as getPO } from '@/app/api/purchase-orders/[id]/route'
import { POST as createIntake } from '@/app/api/stock-intake/route'
import { GET as listExpenses, POST as createExpense } from '@/app/api/expenses/route'
import { GET as salesSummary } from '@/app/api/reports/sales-summary/route'
import { GET as taxReport } from '@/app/api/reports/tax-report/route'
import { GET as ownerDashboard } from '@/app/api/dashboard/owner/route'
import { GET as listUsers, POST as createUser } from '@/app/api/users/route'
import { PUT as setUserWarehouses } from '@/app/api/users/[id]/warehouses/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = 'owner' | 'cashierA' | 'keeperA' | 'keeperB' | 'managerA' | 'cashierFree'
interface Fx {
  tenantId: string; slug: string; whA: string; whB: string; supplierId: string
  users: Record<Who, { id: string; role: string }>
  profileA: string; profileB: string
}

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function as(f: Fx, who: Who) {
  const u = f.users[who]
  setTestSession({
    user: {
      id: u.id, accountId: null, email: `${who}-${f.slug}@example.test`, name: who, role: u.role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'K4', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: u.role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
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
const short = (b: unknown) => JSON.stringify(b).slice(0, 400)
const denied = (r: { status: number; body: J }) => r.status === 403 && r.body.code === 'BRANCH_ACCESS_DENIED'
const listOf = (b: J): J[] => (Array.isArray(b) ? b : (b.data as J[]) || [])

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `k4-${tenantId.slice(0, 8)}`
  const users = {} as Fx['users']
  const roles: Record<Who, string> = {
    owner: 'owner', cashierA: 'cashier', keeperA: 'stock_manager', keeperB: 'stock_manager', managerA: 'manager', cashierFree: 'cashier',
  }
  for (const who of Object.keys(roles) as Who[]) users[who] = { id: randomUUID(), role: roles[who] }
  const f: Fx = { tenantId, slug, whA: randomUUID(), whB: randomUUID(), supplierId: randomUUID(), users, profileA: randomUUID(), profileB: randomUUID() }

  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'K4 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true)`, [f.whA, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Kandy', 'KDY', false)`, [f.whB, tenantId])
  for (const who of Object.keys(roles) as Who[]) {
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, $5)`,
      [users[who].id, tenantId, `${who.toLowerCase()}-${slug}@example.test`, who, roles[who]])
  }
  // Branch assignments: the A staff to Colombo, keeperB to Kandy; cashierFree and the owner none
  for (const [who, wh] of [['cashierA', f.whA], ['keeperA', f.whA], ['managerA', f.whA], ['keeperB', f.whB]] as Array<[Who, string]>) {
    await admin.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1,$2,$3,true)`, [tenantId, users[who].id, wh])
  }
  // Counters: one per branch. cashierA is (wrongly) also on the Kandy counter: the branch rule still applies
  await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Colombo till',$3)`, [f.profileA, tenantId, f.whA])
  await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Kandy till',$3)`, [f.profileB, tenantId, f.whB])
  for (const [p, who, def] of [[f.profileA, 'cashierA', true], [f.profileB, 'cashierA', false], [f.profileA, 'cashierFree', true]] as Array<[string, Who, boolean]>) {
    await admin.query(`INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1,$2,$3,$4)`, [tenantId, p, users[who].id, def])
  }
  await admin.query(`INSERT INTO suppliers (id, tenant_id, name, balance) VALUES ($1, $2, 'Lanka Wholesale', 0)`, [f.supplierId, tenantId])

  const acc = async (name: string, no: string, root: string, type: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO chart_of_accounts (id, tenant_id, name, account_number, root_type, account_type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, name, no, root, type])
    return id
  }
  const a = {
    cash: await acc('Cash', '1100', 'asset', 'cash'), bank: await acc('Bank', '1200', 'asset', 'bank'),
    ar: await acc('Receivable', '1300', 'asset', 'receivable'), stock: await acc('Stock', '1400', 'asset', 'stock'),
    income: await acc('Sales', '4000', 'income', 'income_account'), cogs: await acc('COGS', '5000', 'expense', 'cost_of_goods_sold'),
    expense: await acc('General expenses', '5100', 'expense', 'expense_account'), adj: await acc('Stock adjustment', '5200', 'expense', 'expense_account'),
    ap: await acc('Payable', '2100', 'liability', 'payable'),
  }
  const fy = randomUUID()
  await admin.query(`INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES ($1,$2,'FY',$3,$4)`,
    [fy, tenantId, `${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() + 1}-12-31`])
  await admin.query(
    `INSERT INTO accounting_settings (tenant_id, default_receivable_account_id, default_income_account_id, default_cash_account_id,
       default_bank_account_id, default_expense_account_id, default_payable_account_id, default_cogs_account_id, default_stock_account_id,
       default_stock_adjustment_account_id, current_fiscal_year_id, auto_post_sales, auto_post_purchases)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,true)`,
    [tenantId, a.ar, a.income, a.cash, a.bank, a.expense, a.ap, a.cogs, a.stock, a.adj, fy])
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
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin)
    tenants.push(f.tenantId)
    const today = await tenantToday(f.tenantId)

    // Item X: 100 at Colombo, 100 at Kandy
    const X = randomUUID()
    await admin.query(`INSERT INTO items (id, tenant_id, item_code, name, barcode, cost_price, selling_price, track_stock) VALUES ($1,$2,'K4-X','Rice 5kg','4790000000017',500,800,true)`, [X, f.tenantId])
    for (const wh of [f.whA, f.whB]) {
      await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
        tenantId: f.tenantId, warehouseId: wh, itemId: X, mode: 'delta', qty: 100, referenceType: 'test_seed', source: 'system', userId: f.users.owner.id,
      }))
    }
    const stockAt = async (wh: string) => Number((await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, X])).rows[0]?.current_stock || 0)
    const line = (qty: number) => ({ itemId: X, name: 'Rice 5kg', quantity: qty, unitPrice: 800 })
    const sale = async (body: Record<string, unknown>) =>
      json(await postSale(req('POST', '/api/sales', { discount: 0, tax: 0, creditAmount: 0, paymentMethod: 'cash', ...body })))

    // ============================================================ warehouses list
    await step('branch list', async () => {
      as(f, 'owner')
      const o = await json(await listWarehouses(req('GET', '/api/warehouses?all=true')))
      check('owner sees both branches', o.status === 200 && listOf(o.body).length === 2, short(o.body))
      as(f, 'cashierA')
      const c = await json(await listWarehouses(req('GET', '/api/warehouses?all=true')))
      check('cashier of Colombo sees only Colombo (dropdowns)', c.status === 200 && listOf(c.body).length === 1 && listOf(c.body)[0].id === f.whA, short(c.body))
      const paged = await json(await listWarehouses(req('GET', '/api/warehouses?page=1&pageSize=10')))
      check('… paginated list too (total 1)', paged.status === 200 && paged.body.pagination?.total === 1 && listOf(paged.body).length === 1, short(paged.body))
      const other = await json(await getWarehouse(req('GET', `/api/warehouses/${f.whB}`), ctx(f.whB)))
      check('opening Kandy → 403 BRANCH_ACCESS_DENIED naming their branch', denied(other) && /Colombo/.test(String(other.body.error)), short(other.body))
      as(f, 'cashierFree')
      const free = await json(await listWarehouses(req('GET', '/api/warehouses?all=true')))
      check('unassigned cashier sees both branches (unchanged)', free.status === 200 && listOf(free.body).length === 2, short(free.body))
      const mine = await json(await listWarehouses(req('GET', '/api/warehouses?all=true&userOnly=true')))
      check('userOnly for an unassigned user is still empty (clients fall back)', mine.status === 200 && listOf(mine.body).length === 0, short(mine.body))
    })

    // ============================================================ POS shifts + sales
    let shiftA = ''
    let saleOwnerB = ''
    let saleCashierA = ''
    await step('shifts and sales', async () => {
      as(f, 'owner')
      const sb = await sale({ warehouseId: f.whB, cartItems: [line(2)], subtotal: 1600, total: 1600, amountPaid: 1600 })
      saleOwnerB = sb.body.id
      check('owner sells from Kandy → 200', sb.status === 200 && sb.body.warehouseId === f.whB, short(sb.body))

      as(f, 'cashierA')
      const profiles = await json(await listProfiles(req('GET', '/api/pos-profiles')))
      check('cashier A is offered only the Colombo counter', profiles.status === 200 && profiles.body.profiles?.length === 1 && profiles.body.profiles[0].id === f.profileA, short(profiles.body))
      const openB = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: f.profileB, openingBalances: [{ paymentMethod: 'cash', amount: 1000 }] })))
      check('cashier A cannot open the Kandy counter (even though assigned to it) → 403', denied(openB), short(openB.body))
      const openA = await json(await openShift(req('POST', '/api/pos-opening-entries', { posProfileId: f.profileA, openingBalances: [{ paymentMethod: 'cash', amount: 1000 }] })))
      shiftA = openA.body.id
      check('cashier A opens the Colombo counter → 200', openA.status === 200 && !!shiftA, short(openA.body))

      const fromB = await sale({ warehouseId: f.whB, posOpeningEntryId: shiftA, cartItems: [line(1)], subtotal: 800, total: 800, amountPaid: 800 })
      check('cashier A selling from Kandy → 403 BRANCH_ACCESS_DENIED', denied(fromB), short(fromB.body))
      const before = await stockAt(f.whB)
      check('… and Kandy stock untouched', before === 98, String(before))
      const ok = await sale({ posOpeningEntryId: shiftA, cartItems: [line(3)], subtotal: 2400, total: 2400, amountPaid: 2400 })
      saleCashierA = ok.body.id
      check('cashier A sale without a warehouse → 200 from Colombo', ok.status === 200 && ok.body.warehouseId === f.whA, short(ok.body))
      check('Colombo stock 97', (await stockAt(f.whA)) === 97)

      const list = await json(await listSales(req('GET', '/api/sales?pageSize=50')))
      const ids = listOf(list.body).map((s) => s.id)
      check('cashier A sales list: Colombo sale only', list.status === 200 && ids.includes(saleCashierA) && !ids.includes(saleOwnerB), short(ids))
      const g = await json(await getSale(req('GET', `/api/sales/${saleOwnerB}`), ctx(saleOwnerB)))
      check('cashier A opening the Kandy sale → 403', denied(g), short(g.body))
      const shifts = await json(await listShifts(req('GET', '/api/pos-opening-entries')))
      check('shift list holds only Colombo shifts', shifts.status === 200 && listOf(shifts.body).every((s) => s.warehouseId === f.whA), short(shifts.body))
      const held = [{ ...line(1), total: 800 }]
      const hold = await json(await holdSale(req('POST', '/api/held-sales', { warehouseId: f.whB, cartItems: held, subtotal: 800 })))
      check('cashier A holding a bill at Kandy → 403', denied(hold), short(hold.body))
      const holdA = await json(await holdSale(req('POST', '/api/held-sales', { cartItems: held, subtotal: 800 })))
      check('… holding one without a warehouse → kept at Colombo', (holdA.status === 200 || holdA.status === 201) && holdA.body.warehouseId === f.whA, short(holdA.body))

      as(f, 'managerA')
      const v = await json(await voidSale(req('PUT', `/api/sales/${saleOwnerB}`, { voidReason: 'test' }), ctx(saleOwnerB)))
      check('manager of Colombo voiding a Kandy sale → 403', denied(v), short(v.body))

      as(f, 'owner')
      const all = await json(await listSales(req('GET', '/api/sales?pageSize=50')))
      const allIds = listOf(all.body).map((s) => s.id)
      check('owner sees both sales', allIds.includes(saleCashierA) && allIds.includes(saleOwnerB), short(allIds))
      as(f, 'cashierFree')
      const free = await json(await listSales(req('GET', '/api/sales?pageSize=50')))
      check('unassigned cashier still sees both sales', listOf(free.body).length >= 2, short(free.body))
    })

    // ============================================================ items / stock reads
    await step('stock reads', async () => {
      as(f, 'cashierA')
      const foreign = await json(await listItems(req('GET', `/api/items?warehouseId=${f.whB}`)))
      check('items with Kandy stock → 403', denied(foreign), short(foreign.body))
      const items = await json(await listItems(req('GET', '/api/items?pageSize=50')))
      const x = listOf(items.body).find((i) => i.id === X)
      check('items list (no warehouse) shows Colombo stock only (97)', !!x && Number(x.currentStock ?? x.stock ?? x.totalStock) === 97, short(x))
      const bc = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=4790000000017&warehouseId=${f.whB}`)))
      check('barcode lookup at Kandy → 403', denied(bc), short(bc.body))
      const bcA = await json(await barcodeLookup(req('GET', `/api/items/barcode-lookup?barcode=4790000000017&warehouseId=${f.whA}`)))
      check('barcode lookup at Colombo → 200', bcA.status === 200, short(bcA.body))

      as(f, 'keeperA')
      const ws = await json(await itemWarehouseStock(req('GET', `/api/items/${X}/warehouse-stock`), ctx(X)))
      const rows = (ws.body.warehouses || []) as J[]
      check('per-branch stock of an item: Colombo only', ws.status === 200 && rows.length === 1 && rows[0].warehouseId === f.whA, short(ws.body))

      as(f, 'owner')
      const o = await json(await listItems(req('GET', '/api/items?pageSize=50')))
      const ox = listOf(o.body).find((i) => i.id === X)
      check('owner items list shows both branches (97 + 98 = 195)', !!ox && Number(ox.currentStock ?? ox.stock ?? ox.totalStock) === 195, short(ox))
    })

    // ============================================================ adjustments + movements
    await step('stock adjustments', async () => {
      as(f, 'keeperA')
      const b = await json(await adjustStock(req('POST', `/api/warehouses/${f.whB}/stock`, { itemId: X, quantity: 1, type: 'subtract', reasonCode: 'damage' }), ctx(f.whB)))
      check('stock keeper of Colombo adjusting Kandy → 403', denied(b), short(b.body))
      const bulk = await json(await bulkAdjust(req('POST', '/api/stock-adjustments/bulk', { warehouseId: f.whB, adjustments: [{ itemId: X, newQuantity: 0 }], reasonCode: 'damage' })))
      check('bulk adjustment at Kandy → 403', denied(bulk), short(bulk.body))
      check('Kandy stock still 98', (await stockAt(f.whB)) === 98)
      const a = await json(await adjustStock(req('POST', `/api/warehouses/${f.whA}/stock`, { itemId: X, quantity: 2, type: 'subtract', reasonCode: 'damage' }), ctx(f.whA)))
      check('adjusting Colombo → 200 (95 left)', a.status === 200 && (await stockAt(f.whA)) === 95, short(a.body))
      const mv = await json(await listMovements(req('GET', '/api/stock-movements?pageSize=100')))
      const whs = new Set(listOf(mv.body).map((m) => m.warehouseId))
      check('stock movements: Colombo only', mv.status === 200 && whs.size === 1 && whs.has(f.whA), short([...whs]))
      const mvB = await json(await listMovements(req('GET', `/api/stock-movements?warehouseId=${f.whB}`)))
      check('stock movements filtered on Kandy → 403', denied(mvB), short(mvB.body))
    })

    // ============================================================ transfers
    await step('stock transfers', async () => {
      as(f, 'keeperA')
      const out = await json(await createTransfer(req('POST', '/api/stock-transfers', { fromWarehouseId: f.whB, toWarehouseId: f.whA, items: [{ itemId: X, quantity: 5 }] })))
      check('Colombo keeper pulling stock out of Kandy → 403', denied(out), short(out.body))
      const t = await json(await createTransfer(req('POST', '/api/stock-transfers', { fromWarehouseId: f.whA, toWarehouseId: f.whB, items: [{ itemId: X, quantity: 5 }] })))
      check('Colombo keeper sending Colombo → Kandy → 200', t.status === 200 && !!t.body.id, short(t.body))
      const id = t.body.id as string
      for (const action of ['submit_for_approval', 'approve', 'ship']) {
        const r = await json(await updateTransfer(req('PUT', `/api/stock-transfers/${id}`, { action }), ctx(id)))
        check(`sending branch may ${action} → 200`, r.status === 200, short(r.body))
      }
      const lines = (await admin.query(`SELECT id, quantity FROM stock_transfer_items WHERE transfer_id=$1`, [id])).rows
      const receivedItems = lines.map((l) => ({ transferItemId: l.id, receivedQuantity: Number(l.quantity) }))
      const recvA = await json(await updateTransfer(req('PUT', `/api/stock-transfers/${id}`, { action: 'receive', receivedItems }), ctx(id)))
      check('sending branch cannot receive at Kandy → 403', denied(recvA), short(recvA.body))
      const seen = await json(await getTransfer(req('GET', `/api/stock-transfers/${id}`), ctx(id)))
      check('sending branch still sees the transfer', seen.status === 200, short(seen.body))

      as(f, 'keeperB')
      const listB = await json(await listTransfers(req('GET', '/api/stock-transfers')))
      check('Kandy keeper sees the incoming transfer', listOf(listB.body).some((x) => x.id === id), short(listB.body))
      const recvB = await json(await updateTransfer(req('PUT', `/api/stock-transfers/${id}`, { action: 'receive', receivedItems }), ctx(id)))
      check('Kandy keeper receives → 200', recvB.status === 200, short(recvB.body))
      check('stock moved: Colombo 90, Kandy 103', (await stockAt(f.whA)) === 90 && (await stockAt(f.whB)) === 103, `${await stockAt(f.whA)} / ${await stockAt(f.whB)}`)

      as(f, 'cashierA')
      const c = await json(await getTransfer(req('GET', `/api/stock-transfers/${id}`), ctx(id)))
      check('a Colombo user may view a transfer touching Colombo', c.status === 200, short(c.body))
    })

    // ============================================================ purchasing, intake, expenses
    await step('purchasing, intake and expenses', async () => {
      as(f, 'owner')
      const po = await json(await createPO(req('POST', '/api/purchase-orders', { supplierId: f.supplierId, warehouseId: f.whB })))
      check('owner orders for Kandy → 200', po.status === 200 || po.status === 201, short(po.body))
      const exp = await json(await createExpense(req('POST', '/api/expenses', { kind: 'expense', paidFrom: 'cash', amount: 300, warehouseId: f.whB, description: 'Kandy rent' })))
      check('owner records a Kandy expense → 200', exp.status === 200 || exp.status === 201, short(exp.body))

      as(f, 'managerA')
      const list = await json(await listPOs(req('GET', '/api/purchase-orders?pageSize=50')))
      check('manager of Colombo: Kandy order not listed', list.status === 200 && !listOf(list.body).some((x) => x.id === po.body.id), short(list.body))
      const g = await json(await getPO(req('GET', `/api/purchase-orders/${po.body.id}`), ctx(po.body.id)))
      check('… opening it → 403', denied(g), short(g.body))
      const mine = await json(await createPO(req('POST', '/api/purchase-orders', { supplierId: f.supplierId, warehouseId: f.whB })))
      check('manager of Colombo ordering for Kandy → 403', denied(mine), short(mine.body))
      const intake = await json(await createIntake(req('POST', '/api/stock-intake', { warehouseId: f.whB })))
      check('manager of Colombo: stock intake at Kandy → 403', intake.status === 403, short(intake.body))
      const intakeA = await json(await createIntake(req('POST', '/api/stock-intake', { warehouseId: f.whA })))
      check('… at Colombo → 201', intakeA.status === 201, short(intakeA.body))
      if (exp.body.id) {
        const el = await json(await listExpenses(req('GET', '/api/expenses?pageSize=50')))
        check('Kandy expense not in the Colombo manager\'s list', el.status === 200 && !listOf(el.body).some((x) => x.id === exp.body.id), short(el.body))
      }
    })

    // ============================================================ reports + dashboard
    await step('reports and dashboard', async () => {
      as(f, 'managerA')
      const s = await json(await salesSummary(req('GET', `/api/reports/sales-summary?fromDate=${today}&toDate=${today}`)))
      check('sales summary of the Colombo manager = Colombo sales only (2400)', s.status === 200 && Number(s.body.summary?.totalSales) === 2400, short(s.body.summary))
      const t = await json(await taxReport(req('GET', `/api/reports/tax-report?fromDate=${today}&toDate=${today}`)))
      check('company-wide tax report → 403 for a branch-restricted manager', denied(t), short(t.body))
      const d = await json(await ownerDashboard(req('GET', '/api/dashboard/owner')))
      check('dashboard: Colombo branch only, revenue 2400', d.status === 200 && d.body.branches?.length === 1 && d.body.stock?.byBranch?.length === 1 && d.body.profit?.revenue === 2400, short([d.body.branches, d.body.profit]))
      const dB = await json(await ownerDashboard(req('GET', `/api/dashboard/owner?warehouseId=${f.whB}`)))
      check('dashboard filtered on Kandy → 403', denied(dB), short(dB.body))

      as(f, 'owner')
      const so = await json(await salesSummary(req('GET', `/api/reports/sales-summary?fromDate=${today}&toDate=${today}`)))
      check('owner sales summary = both branches (4000)', Number(so.body.summary?.totalSales) === 4000, short(so.body.summary))
      const to = await json(await taxReport(req('GET', `/api/reports/tax-report?fromDate=${today}&toDate=${today}`)))
      check('owner tax report → 200', to.status === 200, short(to.body))
    })

    // ============================================================ staff + assignment changes
    await step('staff and branch assignments', async () => {
      as(f, 'managerA')
      const staff = await json(await listUsers(req('GET', '/api/users')))
      const names = listOf(staff.body).map((u) => u.fullName)
      check('Colombo manager sees Colombo staff only', staff.status === 200 && names.includes('cashierA') && names.includes('keeperA') && !names.includes('keeperB') && !names.includes('cashierFree'), short(names))
      const toB = await json(await createUser(req('POST', '/api/users', { mode: 'create', fullName: 'Kandy Cashier', role: 'cashier', password: 'pass1234', warehouseIds: [f.whB] })))
      check('Colombo manager adding a Kandy cashier → 403', denied(toB), short(toB.body))
      const plain = await json(await createUser(req('POST', '/api/users', { mode: 'create', fullName: 'New Cashier', role: 'cashier', password: 'pass1234' })))
      check('… adding one without branches → 201, assigned to Colombo', plain.status === 201 && plain.body.user?.warehouseIds?.length === 1 && plain.body.user.warehouseIds[0] === f.whA, short(plain.body))
      const move = await json(await setUserWarehouses(req('PUT', `/api/users/${f.users.keeperB.id}/warehouses`, { warehouseIds: [f.whA] }), ctx(f.users.keeperB.id)))
      check('Colombo manager moving the Kandy keeper → 403', denied(move), short(move.body))

      // The owner assigns the free cashier to Kandy: the restriction applies straight away
      as(f, 'cashierFree')
      const before = await json(await listWarehouses(req('GET', '/api/warehouses?all=true')))
      as(f, 'owner')
      const set = await json(await setUserWarehouses(req('PUT', `/api/users/${f.users.cashierFree.id}/warehouses`, { warehouseIds: [f.whB] }), ctx(f.users.cashierFree.id)))
      check('owner assigns the free cashier to Kandy → 200', set.status === 200, short(set.body))
      as(f, 'cashierFree')
      const after = await json(await listWarehouses(req('GET', '/api/warehouses?all=true')))
      check('cached scope dropped: the cashier now sees Kandy only', listOf(before.body).length === 2 && listOf(after.body).length === 1 && listOf(after.body)[0].id === f.whB, short(after.body))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) {
      for (const t of tenants) await cleanup(admin, t)
    }
    await admin.end()
    await closeAllPools()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
