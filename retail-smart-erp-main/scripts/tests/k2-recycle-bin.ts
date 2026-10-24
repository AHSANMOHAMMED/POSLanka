/**
 * K2 — deletes are safe: vendor "delete" goes to the recycle bin; only a super admin restores or purges.
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/k2-recycle-bin.ts
 *
 * Calls the real vendor route handlers (auth mocked) and the real super-admin handlers (admin
 * sessions). Covers: item / customer / category / supplier delete → archived + bin row + hidden from
 * lists and POS search, row still there (no hard delete); super admin restore brings it back; purge
 * removes it; purge refused (clear message) while referenced; held sale discard keeps a snapshot that
 * restore re-inserts, recall leaves no bin row; posted purchase / layaway with payment refuse delete,
 * sales have no DELETE; permissions; audit; RLS (vendor B never sees A's bin).
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { RECYCLE_ENTITIES } from '@/lib/recycle-bin'
import * as salesIdRoute from '@/app/api/sales/[id]/route'
import { GET as listItems } from '@/app/api/items/route'
import { DELETE as deleteItem } from '@/app/api/items/[id]/route'
import { GET as listCustomers } from '@/app/api/customers/route'
import { DELETE as deleteCustomer } from '@/app/api/customers/[id]/route'
import { GET as listCategories } from '@/app/api/categories/route'
import { DELETE as deleteCategory } from '@/app/api/categories/[id]/route'
import { GET as listSuppliers } from '@/app/api/suppliers/route'
import { DELETE as deleteSupplier } from '@/app/api/suppliers/[id]/route'
import { DELETE as deleteHeld } from '@/app/api/held-sales/[id]/route'
import { DELETE as deletePurchase } from '@/app/api/purchases/[id]/route'
import { DELETE as deleteLayaway } from '@/app/api/layaways/[id]/route'
import { GET as search } from '@/app/api/search/route'
import { GET as binList } from '@/app/api/sys-control/vendors/[id]/recycle-bin/route'
import { GET as binGet, DELETE as binPurge } from '@/app/api/sys-control/vendors/[id]/recycle-bin/[entryId]/route'
import { POST as binRestore } from '@/app/api/sys-control/vendors/[id]/recycle-bin/[entryId]/restore/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; userId: string; wh: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.44.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: { raw: text } } }
}
const c1 = (id: string) => ({ params: Promise.resolve({ id }) })
const c2 = (id: string, entryId: string) => ({ params: Promise.resolve({ id, entryId }) })

function vendorSession(f: Fx) {
  setTestSession({
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner K2', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'K2', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
}

async function makeTenant(pg: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `k2-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, userId: randomUUID(), wh: randomUUID() }
  await pg.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)`, [tenantId, `K2 ${label}`, slug, `${slug}@example.test`])
  await pg.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await pg.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner K2', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  return f
}

async function cleanup(pg: Client, tenantId: string) {
  await pg.query(`SET session_replication_role = replica`)
  const tables = await pg.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='tenant_id'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)
  for (const t of tables.rows) await pg.query(`DELETE FROM "${t.table_name}" WHERE tenant_id=$1`, [tenantId]).catch(() => undefined)
  await pg.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => undefined)
  await pg.query(`SET session_replication_role = origin`)
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const admins: Record<string, { id: string; token: string }> = {}
  for (const role of ['owner', 'support', 'viewer']) {
    const id = randomUUID(); const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'K2 Admin', $3)`, [id, `k2-${role}-${tag}@example.test`, role])
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    admins[role] = { id, token }
  }
  const as = (role: string) => setTestCookie('admin_session', admins[role].token)

  const A = await makeTenant(pg, 'a')
  const B = await makeTenant(pg, 'b')
  const tenantIds = [A.tenantId, B.tenantId]

  const newItem = async (f: Fx, name: string) => {
    const id = randomUUID()
    await pg.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price) VALUES ($1, $2, $3, $4, 0, 100)`,
      [id, f.tenantId, `K2-${id.slice(0, 8)}`, name])
    return id
  }
  const openEntry = async (tenantId: string, type: string, entityId: string) =>
    (await pg.query(`SELECT * FROM recycle_bin WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY deleted_at DESC LIMIT 1`, [tenantId, type, entityId])).rows[0]

  try {
    await step('registry matches the database', async () => {
      const cols = (await pg.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)).rows
      const has = (t: string, c: string) => cols.some((r) => r.table_name === t && r.column_name === c)
      const bad: string[] = []
      for (const [type, d] of Object.entries(RECYCLE_ENTITIES) as Array<[string, J]>) {
        if (!has(d.table, 'id') || !has(d.table, 'tenant_id')) bad.push(`${type}: ${d.table} lacks id/tenant_id`)
        if (d.activeColumn && !has(d.table, d.activeColumn)) bad.push(`${type}: no ${d.activeColumn}`)
        for (const n of d.nameColumns) if (!has(d.table, n)) bad.push(`${type}: no name column ${n}`)
        for (const c of d.children ?? []) if (!has(c.table, c.fk)) bad.push(`${type}: child ${c.table}.${c.fk} missing`)
      }
      check(`all ${Object.keys(RECYCLE_ENTITIES).length} recycle-bin entity types point at real tables / columns`, bad.length === 0, bad)
    })

    // ---------------- items ----------------
    const itemName = `K2 Biscuits ${tag}`
    const item1 = await newItem(A, itemName)
    let item1Entry = ''
    await step('vendor deletes an item → archived + bin row', async () => {
      vendorSession(A)
      const r = await json(await deleteItem(req('DELETE', `/api/items/${item1}`), c1(item1)))
      check('item DELETE → 200 archived', r.status === 200 && r.body.archived === true && !!r.body.recycleBinId, r.body)
      const row = (await pg.query(`SELECT is_active FROM items WHERE id=$1`, [item1])).rows[0]
      check('item row still exists (no hard delete), is_active=false', row && row.is_active === false, row)
      const e = await openEntry(A.tenantId, 'item', item1)
      item1Entry = e?.id
      check('bin row with name, snapshot, deleted_by', e && e.display_name === itemName && e.mode === 'archive' && e.snapshot?.name === itemName
        && e.deleted_by === A.userId && e.deleted_by_name === 'Owner K2' && !e.restored_at && !e.purged_at, e)
    })
    await step('archived item hidden from lists and POS search', async () => {
      vendorSession(A)
      const pos = await json(await listItems(req('GET', `/api/items?search=${encodeURIComponent(itemName)}`)))
      const posRows = (pos.body.data ?? pos.body) as J[]
      check('POS item search does not show it', pos.status === 200 && Array.isArray(posRows) && !posRows.some((i) => i.id === item1), pos.body)
      const all = await json(await listItems(req('GET', `/api/items?includeInactive=true&search=${encodeURIComponent(itemName)}`)))
      const allRows = (all.body.data ?? all.body) as J[]
      check('items list incl. inactive does not show it', all.status === 200 && !allRows.some((i) => i.id === item1), all.body)
      const s = await json(await search(req('GET', `/api/search?q=${encodeURIComponent(itemName)}`)))
      check('global search does not show it', s.status === 200 && !JSON.stringify(s.body).includes(item1), s.body)
    })
    await step('super admin lists the bin, restores the item', async () => {
      as('viewer')
      const denied = await json(await binList(req('GET', `/api/sys-control/vendors/${A.tenantId}/recycle-bin`), c1(A.tenantId)))
      check('viewer admin cannot open the bin', denied.status === 401 || denied.status === 403, denied.status)
      as('support')
      const l = await json(await binList(req('GET', `/api/sys-control/vendors/${A.tenantId}/recycle-bin?type=item`), c1(A.tenantId)))
      check('support admin can view the bin', l.status === 200 && l.body.rows.some((r: J) => r.id === item1Entry && r.status === 'open'), l.body)
      const q = await json(await binList(req('GET', `/api/sys-control/vendors/${A.tenantId}/recycle-bin?q=${encodeURIComponent(`biscuits ${tag}`)}`), c1(A.tenantId)))
      check('search by name', q.status === 200 && q.body.total === 1, q.body.total)
      const d = await json(await binGet(req('GET', '/x'), c2(A.tenantId, item1Entry)))
      check('entry detail has the snapshot', d.status === 200 && d.body.entry?.snapshot?.name === itemName, d.body)
      const sr = await json(await binRestore(req('POST', '/x'), c2(A.tenantId, item1Entry)))
      check('support admin cannot restore (needs vendors.manage)', sr.status === 401 || sr.status === 403, sr.status)
      as('owner')
      const r = await json(await binRestore(req('POST', '/x'), c2(A.tenantId, item1Entry)))
      check('restore → 200', r.status === 200, r.body)
      const row = (await pg.query(`SELECT is_active FROM items WHERE id=$1`, [item1])).rows[0]
      check('item active again', row?.is_active === true, row)
      const e = (await pg.query(`SELECT restored_at, restored_by FROM recycle_bin WHERE id=$1`, [item1Entry])).rows[0]
      check('bin row marked restored by the admin', !!e.restored_at && e.restored_by === admins.owner.id, e)
      const again = await json(await binRestore(req('POST', '/x'), c2(A.tenantId, item1Entry)))
      check('restoring twice → 409', again.status === 409, again.body)
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE resource='vendor_recycle_bin' AND resource_id=$1 AND details->>'op'='recycle_restore'`, [item1Entry])).rows[0]
      check('restore audited', audit?.details?.entityId === item1 && audit?.details?.tenantId === A.tenantId, audit)
      vendorSession(A)
      const pos = await json(await listItems(req('GET', `/api/items?search=${encodeURIComponent(itemName)}`)))
      check('restored item back in POS search', ((pos.body.data ?? pos.body) as J[]).some((i) => i.id === item1), pos.body)
    })
    await step('purge removes an unreferenced item', async () => {
      vendorSession(A)
      await deleteItem(req('DELETE', `/api/items/${item1}`), c1(item1))
      const e = await openEntry(A.tenantId, 'item', item1)
      check('second delete → new open bin row', e && !e.restored_at && e.id !== item1Entry, e)
      as('owner')
      const p = await json(await binPurge(req('DELETE', '/x'), c2(A.tenantId, e.id)))
      check('purge → 200', p.status === 200, p.body)
      const gone = (await pg.query(`SELECT 1 FROM items WHERE id=$1`, [item1])).rowCount
      check('item row permanently deleted', gone === 0, gone)
      const after = (await pg.query(`SELECT purged_at, purged_by FROM recycle_bin WHERE id=$1`, [e.id])).rows[0]
      check('bin row marked purged', !!after.purged_at && after.purged_by === admins.owner.id, after)
      const tomb = (await pg.query(`SELECT 1 FROM item_tombstones WHERE item_id=$1`, [item1])).rowCount
      check('purged item tombstoned for offline catalogs', tomb === 1, tomb)
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE resource='vendor_recycle_bin' AND resource_id=$1 AND details->>'op'='recycle_purge'`, [e.id])).rows[0]
      check('purge audited with the snapshot', audit?.details?.before?.name === itemName, audit)
    })
    await step('purge refused while referenced', async () => {
      const item2 = await newItem(A, `K2 Tea ${tag}`)
      await pg.query(`INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity, qty_change) VALUES ($1, $2, $3, 'in', 5, 5)`, [A.tenantId, A.wh, item2])
      vendorSession(A)
      const d = await json(await deleteItem(req('DELETE', `/api/items/${item2}`), c1(item2)))
      check('item with stock history can still be moved to the bin', d.status === 200 && d.body.archived, d.body)
      const e = await openEntry(A.tenantId, 'item', item2)
      as('owner')
      const p = await json(await binPurge(req('DELETE', '/x'), c2(A.tenantId, e.id)))
      check('purge → 409 with a clear message', p.status === 409 && /Cannot purge/.test(p.body.error) && /stock movements/.test(p.body.error), p.body)
      const still = (await pg.query(`SELECT is_active FROM items WHERE id=$1`, [item2])).rows[0]
      const binRow = (await pg.query(`SELECT purged_at FROM recycle_bin WHERE id=$1`, [e.id])).rows[0]
      check('row kept (archived) and bin entry still open', still?.is_active === false && !binRow.purged_at, { still, binRow })
    })

    // ---------------- customers / categories / suppliers ----------------
    await step('customer delete → archived, hidden; restore', async () => {
      const cust = randomUUID()
      await pg.query(`INSERT INTO customers (id, tenant_id, name, phone) VALUES ($1, $2, $3, '0771112223')`, [cust, A.tenantId, `Kamal ${tag}`])
      await pg.query(`INSERT INTO sales (tenant_id, invoice_no, customer_id, subtotal, total, status) VALUES ($1, $2, $3, 100, 100, 'completed')`, [A.tenantId, `K2-${tag}`, cust])
        .catch((e) => console.warn('sale seed:', e.message))
      vendorSession(A)
      const d = await json(await deleteCustomer(req('DELETE', `/api/customers/${cust}`), c1(cust)))
      check('customer with sales history → archived (was refused before)', d.status === 200 && d.body.archived, d.body)
      const row = (await pg.query(`SELECT is_active FROM customers WHERE id=$1`, [cust])).rows[0]
      check('customer row kept, is_active=false', row?.is_active === false, row)
      const l = await json(await listCustomers(req('GET', `/api/customers?search=${encodeURIComponent(`Kamal ${tag}`)}`)))
      check('customer list / POS picker hides it', l.status === 200 && !l.body.data.some((c: J) => c.id === cust), l.body)
      const e = await openEntry(A.tenantId, 'customer', cust)
      as('owner')
      const r = await json(await binRestore(req('POST', '/x'), c2(A.tenantId, e.id)))
      vendorSession(A)
      const l2 = await json(await listCustomers(req('GET', `/api/customers?search=${encodeURIComponent(`Kamal ${tag}`)}`)))
      check('restored customer back in the list', r.status === 200 && l2.body.data.some((c: J) => c.id === cust), { r: r.body, l2: l2.body })
    })
    await step('category and supplier delete → archived, hidden', async () => {
      const cat = randomUUID(); const sup = randomUUID()
      await pg.query(`INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, $3)`, [cat, A.tenantId, `K2 Cat ${tag}`])
      await pg.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, $3)`, [sup, A.tenantId, `K2 Sup ${tag}`])
      vendorSession(A)
      const dc = await json(await deleteCategory(req('DELETE', `/api/categories/${cat}`), c1(cat)))
      const ds = await json(await deleteSupplier(req('DELETE', `/api/suppliers/${sup}`), c1(sup)))
      check('category + supplier archived', dc.status === 200 && dc.body.archived && ds.status === 200 && ds.body.archived, { dc: dc.body, ds: ds.body })
      const rows = (await pg.query(`SELECT (SELECT count(*) FROM categories WHERE id=$1)::int c, (SELECT count(*) FROM suppliers WHERE id=$2)::int s`, [cat, sup])).rows[0]
      check('rows kept', rows.c === 1 && rows.s === 1, rows)
      const lc = await json(await listCategories(req('GET', `/api/categories?all=true`)))
      check('category list hides it', lc.status === 200 && !(lc.body as J[]).some((c) => c.id === cat), lc.body)
      const ls = await json(await listSuppliers(req('GET', `/api/suppliers?all=true`)))
      const supRows = (ls.body.data ?? ls.body) as J[]
      check('supplier list hides it', ls.status === 200 && Array.isArray(supRows) && !supRows.some((s) => s.id === sup), ls.body)
    })

    // ---------------- drafts: held sale ----------------
    await step('held sale discard → snapshot; restore re-inserts; recall leaves nothing', async () => {
      const held = randomUUID()
      await pg.query(`INSERT INTO held_sales (id, tenant_id, hold_number, cart_items, customer_name) VALUES ($1, $2, $3, '[{"itemId":"x","qty":2}]'::jsonb, 'Sunil')`, [held, A.tenantId, `HOLD-${tag}`])
      vendorSession(A)
      const d = await json(await deleteHeld(req('DELETE', `/api/held-sales/${held}`), c1(held)))
      const gone = (await pg.query(`SELECT 1 FROM held_sales WHERE id=$1`, [held])).rowCount
      const e = await openEntry(A.tenantId, 'held_sale', held)
      check('discard deletes the draft and keeps a snapshot', d.status === 200 && gone === 0 && e?.mode === 'delete' && e.snapshot?.hold_number === `HOLD-${tag}`, { d: d.body, gone, e })
      as('owner')
      const r = await json(await binRestore(req('POST', '/x'), c2(A.tenantId, e.id)))
      const back = (await pg.query(`SELECT hold_number, cart_items, tenant_id FROM held_sales WHERE id=$1`, [held])).rows[0]
      check('restore re-inserts the held sale as it was', r.status === 200 && back?.hold_number === `HOLD-${tag}` && back.cart_items?.[0]?.qty === 2 && back.tenant_id === A.tenantId, { r: r.body, back })
      vendorSession(A)
      await deleteHeld(req('DELETE', `/api/held-sales/${held}?recall=1`), c1(held))
      const n = (await pg.query(`SELECT count(*)::int n FROM recycle_bin WHERE entity_id=$1`, [held])).rows[0].n
      check('recall (resume into cart) adds no bin row', n === 1, n)
      // purge of a deleted draft drops its copy
      const d2 = randomUUID()
      await pg.query(`INSERT INTO held_sales (id, tenant_id, hold_number, cart_items) VALUES ($1, $2, $3, '[]'::jsonb)`, [d2, A.tenantId, `HOLD2-${tag}`])
      await deleteHeld(req('DELETE', `/api/held-sales/${d2}`), c1(d2))
      const e2 = await openEntry(A.tenantId, 'held_sale', d2)
      as('owner')
      const p = await json(await binPurge(req('DELETE', '/x'), c2(A.tenantId, e2.id)))
      const after = (await pg.query(`SELECT snapshot, purged_at FROM recycle_bin WHERE id=$1`, [e2.id])).rows[0]
      check('purging a draft drops its saved copy', p.status === 200 && after.snapshot === null && !!after.purged_at, { p: p.body, after })
    })

    // ---------------- posted documents ----------------
    await step('posted documents cannot be deleted by vendors', async () => {
      check('sales/[id] has no DELETE handler', !('DELETE' in salesIdRoute), Object.keys(salesIdRoute))
      const pur = randomUUID()
      await pg.query(`INSERT INTO purchases (id, tenant_id, purchase_no, warehouse_id, status, subtotal, total) VALUES ($1, $2, $3, $4, 'pending', 0, 0)`, [pur, A.tenantId, `PI-${tag}`, A.wh])
      vendorSession(A)
      const d = await json(await deletePurchase(req('DELETE', `/api/purchases/${pur}`), c1(pur)))
      const still = (await pg.query(`SELECT status FROM purchases WHERE id=$1`, [pur])).rows[0]
      check('submitted (pending) purchase → refused, still there', d.status === 400 && /draft/i.test(d.body.error) && still?.status === 'pending', { d: d.body, still })
      const cust = randomUUID(); const lay = randomUUID()
      await pg.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Layaway cust')`, [cust, A.tenantId])
      await pg.query(`INSERT INTO layaways (id, tenant_id, layaway_no, customer_id, status, subtotal, total, deposit_amount, paid_amount, balance_due)
                      VALUES ($1, $2, $3, $4, 'active', 1000, 1000, 200, 200, 800)`, [lay, A.tenantId, `LAY-${tag}`, cust])
      await pg.query(`INSERT INTO layaway_payments (tenant_id, layaway_id, amount, payment_method) VALUES ($1, $2, 200, 'cash')`, [A.tenantId, lay])
      const dl = await json(await deleteLayaway(req('DELETE', `/api/layaways/${lay}`), c1(lay)))
      const layStill = (await pg.query(`SELECT 1 FROM layaways WHERE id=$1`, [lay])).rowCount
      check('layaway with a payment → refused (cancel instead)', dl.status === 400 && /payments/i.test(dl.body.error) && layStill === 1, dl.body)
    })

    // ---------------- isolation ----------------
    await step('RLS: vendor B never sees vendor A\'s bin', async () => {
      const itemB = await newItem(B, `K2 B item ${tag}`)
      vendorSession(B)
      await deleteItem(req('DELETE', `/api/items/${itemB}`), c1(itemB))
      const seenByB = await withTenant(B.tenantId, async (db) =>
        ((await db.execute(sql`SELECT tenant_id FROM recycle_bin`)) as unknown as { rows: Array<{ tenant_id: string }> }).rows)
      check('vendor B context sees only its own bin rows', seenByB.length >= 1 && seenByB.every((r) => r.tenant_id === B.tenantId), seenByB)
      const seenByA = await withTenant(A.tenantId, async (db) =>
        ((await db.execute(sql`SELECT tenant_id FROM recycle_bin WHERE entity_id = ${itemB}::uuid`)) as unknown as { rows: unknown[] }).rows)
      check('vendor A context cannot see B\'s entry', seenByA.length === 0, seenByA)
      const crossDelete = await json(await deleteItem(req('DELETE', `/api/items/${item1}`), c1(item1)))
      check('vendor B cannot bin vendor A\'s item', crossDelete.status === 404, crossDelete.body)
      as('owner')
      const eA = (await pg.query(`SELECT id FROM recycle_bin WHERE tenant_id=$1 LIMIT 1`, [A.tenantId])).rows[0]
      const lB = await json(await binList(req('GET', `/api/sys-control/vendors/${B.tenantId}/recycle-bin?status=all`), c1(B.tenantId)))
      check('admin list for B shows only B\'s entries', lB.status === 200 && lB.body.rows.length >= 1 && !lB.body.rows.some((r: J) => r.id === eA.id), lB.body.rows?.length)
      const cross = await json(await binRestore(req('POST', '/x'), c2(B.tenantId, eA.id)))
      check('A\'s entry through B\'s URL → 404', cross.status === 404, cross.body)
      const crossP = await json(await binPurge(req('DELETE', '/x'), c2(B.tenantId, eA.id)))
      check('A\'s entry purge through B\'s URL → 404', crossP.status === 404, crossP.body)
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) for (const t of tenantIds) await cleanup(pg, t)
    await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = ANY($1::uuid[])`, [Object.values(admins).map((a) => a.id)]).catch(() => undefined)
    await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = ANY($1::uuid[])`, [Object.values(admins).map((a) => a.id)]).catch(() => undefined)
    await pg.query(`DELETE FROM super_admins WHERE id = ANY($1::uuid[])`, [Object.values(admins).map((a) => a.id)]).catch(() => undefined)
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
