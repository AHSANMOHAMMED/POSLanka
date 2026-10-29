/**
 * L9 — super-admin vendor console: Stock tab (/api/sys-control/vendors/[id]/stock).
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/l9-admin-stock.ts
 *
 * Covers: no session → 401; list per branch with search; support role may view but not change;
 * set counts → stock, stock movement (admin_adjustment, reason code, note, no vendor user),
 * balanced GL entry for valued items, unvalued warning for zero-cost items; all-or-nothing on an
 * unknown item; another vendor's item refused; validation (note, negative); audit row on the vendor.
 * Throw-away data is removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { closeAllPools } from '@/lib/db'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as listStock, POST as adjustStock } from '@/app/api/sys-control/vendors/[id]/stock/route'
import { PATCH as patchRow } from '@/app/api/sys-control/vendors/[id]/data/[table]/[rowId]/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.39.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const adminIds: string[] = []
  const session = async (role: string) => {
    const id = randomUUID()
    const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'L9 Admin', $3)`, [id, `l9-${role}-${tag}@example.test`, role])
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    adminIds.push(id)
    return { id, use: () => setTestCookie('admin_session', token) }
  }

  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const tier = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-')) ?? tiers[0]

  const owner = await session('owner')
  const support = await session('support')

  const makeVendor = async (n: number) => {
    owner.use()
    const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
      name: `L9 Shop ${n} ${tag}`, slug: `l9-shop-${n}-${tag}`, email: `l9-shop-${n}-${tag}@example.test`,
      phone: `+9477${String(Date.now() + n).slice(-7)}`, address: 'Colombo', businessType: 'retail',
      tierId: tier.id, billingCycle: 'monthly', ownerName: 'L9 Owner', ownerEmail: `l9-owner-${n}-${tag}@example.test`, ownerPassword: 'Owner@12345',
    })))
    if (res.status !== 200) throw new Error(`create vendor failed: ${JSON.stringify(res.body)}`)
    tenantIds.push(res.body.vendor.id)
    return res.body.vendor.id as string
  }

  try {
    const vendorId = await makeVendor(1)
    const otherId = await makeVendor(2)
    const wh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY is_default DESC LIMIT 1`, [vendorId])).rows[0]?.id
    if (!wh) throw new Error('new vendor has no warehouse')
    const acct = (await pg.query(`SELECT default_stock_account_id, default_stock_adjustment_account_id FROM accounting_settings WHERE tenant_id = $1`, [vendorId])).rows[0]
    const valuedGL = !!acct?.default_stock_account_id && !!acct?.default_stock_adjustment_account_id

    const item = async (t: string, name: string, cost: number, barcode: string) =>
      (await pg.query(`INSERT INTO items (tenant_id, name, barcode, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [t, name, barcode, cost, cost * 2])).rows[0].id as string
    const A = await item(vendorId, `Blue Shirt ${tag}`, 100, `L9A${tag}`)
    const Z = await item(vendorId, `Free Sample ${tag}`, 0, `L9Z${tag}`)
    const O = await item(otherId, `Other Shop Item ${tag}`, 50, `L9O${tag}`)
    await pg.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1, $2, $3, 5)`, [vendorId, wh, A])
    const stockOf = async (itemId: string) => Number((await pg.query(`SELECT current_stock FROM warehouse_stock WHERE item_id = $1 AND warehouse_id = $2`, [itemId, wh])).rows[0]?.current_stock ?? 0)

    await step('no admin session → 401', async () => {
      setTestCookie('admin_session', null)
      const a = await listStock(req('GET', `/api/sys-control/vendors/${vendorId}/stock`), ctx(vendorId))
      const b = await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, {}), ctx(vendorId))
      check('GET / POST without a session → 401', a.status === 401 && b.status === 401, [a.status, b.status])
    })

    await step('list', async () => {
      support.use()
      const all = await json(await listStock(req('GET', `/api/sys-control/vendors/${vendorId}/stock`), ctx(vendorId)))
      check('support role can view: branches + default branch picked', all.status === 200 && all.body.warehouseId === wh && all.body.branches?.length >= 1, all.body)
      const row = all.body.rows?.find((r: J) => r.itemId === A)
      check('row shows the branch count', row?.stock === 5, row)
      check('item without a stock row shows 0', all.body.rows?.find((r: J) => r.itemId === Z)?.stock === 0)
      check('other vendor’s items not listed', !all.body.rows?.some((r: J) => r.itemId === O))
      const found = await json(await listStock(req('GET', `/api/sys-control/vendors/${vendorId}/stock?q=L9A${tag}`), ctx(vendorId)))
      check('search by barcode', found.body.total === 1 && found.body.rows[0].itemId === A, found.body)
    })

    await step('permissions + validation', async () => {
      support.use()
      const denied = await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'count_correction', note: 'check', adjustments: [{ itemId: A, newQuantity: 9 }] }), ctx(vendorId))
      check('support role cannot change stock → 403', denied.status === 403, denied.status)
      owner.use()
      const noNote = await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'count_correction', note: ' ', adjustments: [{ itemId: A, newQuantity: 9 }] }), ctx(vendorId))
      const negative = await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'count_correction', note: 'recount', adjustments: [{ itemId: A, newQuantity: -1 }] }), ctx(vendorId))
      check('missing note / negative count → 400', noNote.status === 400 && negative.status === 400, [noNote.status, negative.status])
      check('nothing changed', await stockOf(A) === 5)
    })

    await step('all-or-nothing', async () => {
      owner.use()
      const bad = await json(await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'count_correction', note: 'recount', adjustments: [{ itemId: A, newQuantity: 9 }, { itemId: randomUUID(), newQuantity: 1 }] }), ctx(vendorId)))
      check('unknown item → 404, nothing applied', bad.status === 404 && await stockOf(A) === 5, bad)
      const cross = await json(await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'count_correction', note: 'recount', adjustments: [{ itemId: O, newQuantity: 3 }] }), ctx(vendorId)))
      check('another vendor’s item refused', cross.status === 404, cross)
      const otherWh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [otherId])).rows[0].id
      const crossWh = await json(await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: otherWh, reasonCode: 'count_correction', note: 'recount', adjustments: [{ itemId: A, newQuantity: 3 }] }), ctx(vendorId)))
      check('another vendor’s branch refused', crossWh.status === 404, crossWh)
    })

    await step('set counts', async () => {
      owner.use()
      const ok = await json(await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'damage', note: 'owner recount', adjustments: [{ itemId: A, newQuantity: 12 }, { itemId: Z, newQuantity: 4 }] }), ctx(vendorId)))
      check('POST → 200, 2 adjusted', ok.status === 200 && ok.body.adjusted === 2, ok.body)
      check('stock set', await stockOf(A) === 12 && await stockOf(Z) === 4)
      check('zero-cost item warned as unvalued', ok.body.warnings?.length === 1 && ok.body.results?.some((r: J) => r.itemId === Z && r.unvalued), ok.body)
      const mv = (await pg.query(`SELECT * FROM stock_movements WHERE item_id = $1 AND reference_type = 'admin_adjustment'`, [A])).rows
      check('stock movement: +7, reason code, note, no vendor user', mv.length === 1 && Number(mv[0].qty_change) === 7 && mv[0].reason_code === 'damage' && mv[0].notes === 'Platform admin: owner recount' && mv[0].created_by === null, mv[0])
      if (valuedGL) {
        const gl = (await pg.query(`SELECT sum(debit)::numeric AS d, sum(credit)::numeric AS c, count(*)::int AS n FROM gl_entries WHERE tenant_id = $1 AND voucher_id = $2`, [vendorId, mv[0].id])).rows[0]
        check('balanced GL entry for 7 × 100', gl.n >= 2 && Number(gl.d) === 700 && Number(gl.c) === 700, gl)
      } else {
        console.log('SKIP  GL check (vendor has no stock accounts configured)')
      }
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'vendor_stock' AND resource_id = $2`, [owner.id, vendorId])).rows
      check('audited on the vendor with before / after', audit.length === 1 && audit[0].details.count === 2 && audit[0].details.lines.some((l: J) => l.before === 5 && l.after === 12), audit[0]?.details)
      const same = await json(await adjustStock(req('POST', `/api/sys-control/vendors/${vendorId}/stock`, { warehouseId: wh, reasonCode: 'damage', note: 'owner recount', adjustments: [{ itemId: A, newQuantity: 12 }] }), ctx(vendorId)))
      check('unchanged count → 0 adjusted, no extra audit', same.status === 200 && same.body.adjusted === 0
        && (await pg.query(`SELECT 1 FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'vendor_stock'`, [owner.id])).rowCount === 1, same.body)
    })

    await step('All data cannot change the count directly', async () => {
      owner.use()
      const row = (await pg.query(`SELECT id FROM warehouse_stock WHERE item_id = $1 AND warehouse_id = $2`, [A, wh])).rows[0].id
      const res = await json(await patchRow(req('PATCH', `/api/sys-control/vendors/${vendorId}/data/warehouse_stock/${row}`, { values: { current_stock: 99 } }),
        { params: Promise.resolve({ id: vendorId, table: 'warehouse_stock', rowId: row }) }))
      check('PATCH current_stock in All data → 400, count unchanged', res.status === 400 && await stockOf(A) === 12, res)
      const ok = await json(await patchRow(req('PATCH', `/api/sys-control/vendors/${vendorId}/data/warehouse_stock/${row}`, { values: { min_stock: 3 } }),
        { params: Promise.resolve({ id: vendorId, table: 'warehouse_stock', rowId: row }) }))
      check('other warehouse_stock columns still editable (min_stock)', ok.status === 200, ok)
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) await cleanup(pg, tenantIds, adminIds).catch((e) => console.error('cleanup:', e.message))
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

/** Remove the throw-away vendors: every tenant-scoped row first (retrying in FK order), then the globals. */
async function cleanup(pg: Client, tenantIds: string[], adminIds: string[]) {
  if (tenantIds.length) {
    const tables = (await pg.query(
      `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
    )).rows.map((r) => r.table_name as string)
    const accountIds = (await pg.query(`SELECT DISTINCT account_id FROM account_tenants WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])).rows.map((r) => r.account_id)
    let pending = tables
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next: string[] = []
      for (const t of pending) {
        try {
          await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])
        } catch {
          next.push(t)
        }
      }
      pending = next
    }
    await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds])
    if (accountIds.length) {
      await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
    }
  }
  for (const id of adminIds) {
    await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [id])
    await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [id])
    await pg.query(`DELETE FROM super_admins WHERE id = $1`, [id])
  }
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
