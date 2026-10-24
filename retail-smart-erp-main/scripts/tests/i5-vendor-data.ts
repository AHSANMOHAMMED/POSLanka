/**
 * I5 — super-admin "Vendor data" console: every table of one vendor, full CRUD, kept inside that vendor.
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/i5-vendor-data.ts
 *
 * Calls the real /api/sys-control/vendors/[id]/data handlers with real admin sessions (owner, support,
 * viewer). Covers: table list + counts; add / search / edit / delete a row; another vendor's id never
 * reaches the row; tenant_id and secrets cannot be written and secrets are masked; read-only tables;
 * business profile edits but not lifecycle columns; type errors and missing values → 400 with the
 * column; delete refused while other rows use it; permissions; audit with before / after.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { closeAllPools } from '@/lib/db'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as listTables } from '@/app/api/sys-control/vendors/[id]/data/route'
import { GET as listRows, POST as addRow } from '@/app/api/sys-control/vendors/[id]/data/[table]/route'
import { GET as getRow, PATCH as editRow, DELETE as removeRow } from '@/app/api/sys-control/vendors/[id]/data/[table]/[rowId]/route'

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
  // fresh client IP per call so the per-IP admin rate limits never interfere
  const addr = `10.33.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

const c1 = (id: string) => ({ params: Promise.resolve({ id }) })
const c2 = (id: string, table: string) => ({ params: Promise.resolve({ id, table }) })
const c3 = (id: string, table: string, rowId: string) => ({ params: Promise.resolve({ id, table, rowId }) })

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const admins: Record<string, { id: string; token: string }> = {}
  for (const role of ['owner', 'support', 'viewer']) {
    const id = randomUUID(); const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'I5 Admin', $3)`, [id, `i5-${role}-${tag}@example.test`, role])
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    admins[role] = { id, token }
  }
  const as = (role: string) => setTestCookie('admin_session', admins[role].token)

  try {
    as('owner')
    const mk = async (n: string) => {
      const r = await json(await createVendor(req('POST', '/api/sys-control/vendors', { name: `I5 ${n} ${tag}`, phone: '+94771234567', address: 'Colombo' })))
      if (r.status !== 200) throw new Error(`vendor create failed: ${JSON.stringify(r.body)}`)
      tenantIds.push(r.body.vendor.id)
      return r.body.vendor.id as string
    }
    const A = await mk('A')
    const B = await mk('B')

    await step('table list', async () => {
      as('owner')
      const r = await json(await listTables(req('GET', `/api/sys-control/vendors/${A}/data`), c1(A)))
      const names = (r.body.tables || []).map((t: J) => t.name)
      check('lists the vendor’s tables (200+)', r.status === 200 && names.length >= 200, names.length)
      check('business profile first, items / customers / users present',
        names[0] === 'business_profile' && ['items', 'customers', 'users', 'sales', 'warehouses'].every((n) => names.includes(n)))
      const users = r.body.tables.find((t: J) => t.name === 'users')
      check('row counts per vendor (one owner user)', users?.rows === 1, users)
      check('logs are read-only', r.body.tables.find((t: J) => t.name === 'activity_logs')?.canEdit === false)
      const unknown = await json(await listRows(req('GET', `/api/sys-control/vendors/${A}/data/nope_table`), c2(A, 'nope_table')))
      check('unknown table → 404', unknown.status === 404, unknown.status)
    })

    await step('every table opens', async () => {
      as('owner')
      const r = await json(await listTables(req('GET', `/api/sys-control/vendors/${A}/data`), c1(A)))
      const broken: string[] = []
      for (const t of r.body.tables as J[]) {
        const rows = await json(await listRows(req('GET', `/api/sys-control/vendors/${A}/data/${t.name}?q=x`), c2(A, t.name)))
        if (rows.status !== 200) broken.push(`${t.name}:${rows.status}:${rows.body.error}`)
      }
      check(`all ${r.body.tables.length} tables list and search without error`, broken.length === 0, broken)
    })

    let catId = ''
    await step('add, search, edit, delete a row', async () => {
      as('owner')
      const miss = await json(await addRow(req('POST', `/api/sys-control/vendors/${A}/data/categories`, { values: { is_active: true } }), c2(A, 'categories')))
      check('missing required column → 400 naming it', miss.status === 400 && miss.body.field === 'name', miss.body)
      const add = await json(await addRow(req('POST', `/api/sys-control/vendors/${A}/data/categories`, { values: { name: `Snacks ${tag}`, tenant_id: B } }), c2(A, 'categories')))
      catId = add.body.row?.id
      check('add row → 201', add.status === 201 && !!catId, add.body)
      const stored = (await pg.query(`SELECT tenant_id FROM categories WHERE id = $1`, [catId])).rows[0]
      check('row belongs to this vendor even when another tenant_id is sent', stored?.tenant_id === A, stored)

      const found = await json(await listRows(req('GET', `/api/sys-control/vendors/${A}/data/categories?q=snacks%20${tag}`), c2(A, 'categories')))
      check('search finds it', found.status === 200 && found.body.total === 1 && found.body.rows[0]?.id === catId, found.body.total)
      const otherVendor = await json(await listRows(req('GET', `/api/sys-control/vendors/${B}/data/categories?q=${tag}`), c2(B, 'categories')))
      check('another vendor does not see it', otherVendor.body.total === 0, otherVendor.body.total)
      const crossGet = await json(await getRow(req('GET', '/x'), c3(B, 'categories', catId)))
      check('row id through another vendor → 404', crossGet.status === 404, crossGet.status)
      const crossEdit = await json(await editRow(req('PATCH', '/x', { values: { name: 'hijack' } }), c3(B, 'categories', catId)))
      check('edit through another vendor → 404', crossEdit.status === 404, crossEdit.status)
      const crossDel = await json(await removeRow(req('DELETE', '/x'), c3(B, 'categories', catId)))
      check('delete through another vendor → 404', crossDel.status === 404, crossDel.status)

      const bad = await json(await editRow(req('PATCH', '/x', { values: { is_active: 'maybe' } }), c3(A, 'categories', catId)))
      check('wrong type → 400 naming the column', bad.status === 400 && bad.body.field === 'is_active', bad.body)
      const edit = await json(await editRow(req('PATCH', '/x', { values: { name: `Crisps ${tag}`, is_active: false } }), c3(A, 'categories', catId)))
      check('edit row → 200 with the changed columns', edit.status === 200 && edit.body.row?.name === `Crisps ${tag}` && edit.body.changed?.includes('name'), edit.body)
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE resource = 'vendor_data' AND resource_id = $1 AND details->>'op' = 'data_update'`, [catId])).rows[0]
      check('edit audited with before and after', audit?.details?.before?.name === `Snacks ${tag}` && audit?.details?.after?.name === `Crisps ${tag}`, audit?.details)

      const del = await json(await removeRow(req('DELETE', '/x'), c3(A, 'categories', catId)))
      check('delete row → 200 and gone', del.status === 200 && (await pg.query(`SELECT 1 FROM categories WHERE id = $1`, [catId])).rowCount === 0, del.status)
      check('delete audited with the row', (await pg.query(`SELECT 1 FROM admin_audit_logs WHERE resource_id = $1 AND action = 'delete' AND details->'before'->>'name' = $2`, [catId, `Crisps ${tag}`])).rowCount === 1)
    })

    await step('rows other rows depend on', async () => {
      as('owner')
      const wh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [A])).rows[0]
      const r = await json(await removeRow(req('DELETE', '/x'), c3(A, 'warehouses', wh.id)))
      check('deleting a branch its counter uses → 409, kept', r.status === 409 && (await pg.query(`SELECT 1 FROM warehouses WHERE id = $1`, [wh.id])).rowCount === 1, r.body)
    })

    await step('secrets, users and read-only tables', async () => {
      as('owner')
      const users = await json(await listRows(req('GET', `/api/sys-control/vendors/${A}/data/users`), c2(A, 'users')))
      const u = users.body.rows?.[0]
      check('password hash never returned', u && u.password_hash === '••••••', u?.password_hash)
      check('secret column marked', users.body.columns.find((c: J) => c.name === 'password_hash')?.secret === true)
      const before = (await pg.query(`SELECT password_hash FROM users WHERE id = $1`, [u.id])).rows[0].password_hash
      const w = await json(await editRow(req('PATCH', '/x', { values: { password_hash: 'x' } }), c3(A, 'users', u.id)))
      const after = (await pg.query(`SELECT password_hash FROM users WHERE id = $1`, [u.id])).rows[0].password_hash
      check('password hash cannot be written', w.status === 400 && before === after, w.body)
      await json(await editRow(req('PATCH', '/x', { values: { is_super_admin: true, full_name: 'Owner Renamed' } }), c3(A, 'users', u.id)))
      const su = (await pg.query(`SELECT is_super_admin, full_name FROM users WHERE id = $1`, [u.id])).rows[0]
      check('is_super_admin cannot be written (other columns still save)', su.is_super_admin === false && su.full_name === 'Owner Renamed', su)
      const ro = await json(await addRow(req('POST', `/api/sys-control/vendors/${A}/data/activity_logs`, { values: { action: 'x' } }), c2(A, 'activity_logs')))
      check('read-only table refuses rows → 400', ro.status === 400, ro.status)
    })

    await step('business profile', async () => {
      as('owner')
      const p = await json(await listRows(req('GET', `/api/sys-control/vendors/${A}/data/business_profile`), c2(A, 'business_profile')))
      check('profile is the vendor’s own row only', p.body.total === 1 && p.body.rows[0]?.id === A, p.body.total)
      const e = await json(await editRow(req('PATCH', '/x', { values: { phone: '+94112223344', status: 'suspended', address: 'Kandy' } }), c3(A, 'business_profile', A)))
      const t = (await pg.query(`SELECT phone, address, status FROM tenants WHERE id = $1`, [A])).rows[0]
      check('phone / address change; status is left to the vendor actions', e.status === 200 && t.phone === '+94112223344' && t.address === 'Kandy' && t.status === 'active', { e: e.body, t })
      const other = await json(await editRow(req('PATCH', '/x', { values: { phone: '1' } }), c3(A, 'business_profile', B)))
      check('another vendor’s profile through this vendor → 404', other.status === 404, other.status)
    })

    await step('permissions', async () => {
      as('support')
      const r = await json(await listRows(req('GET', `/api/sys-control/vendors/${A}/data/items`), c2(A, 'items')))
      check('support admin can view', r.status === 200, r.status)
      const w = await json(await addRow(req('POST', `/api/sys-control/vendors/${A}/data/categories`, { values: { name: 'nope' } }), c2(A, 'categories')))
      check('support admin cannot change → 403', w.status === 403, w.status)
      as('viewer')
      const v = await json(await listTables(req('GET', `/api/sys-control/vendors/${A}/data`), c1(A)))
      check('viewer cannot open vendor data → 403', v.status === 403, v.status)
      setTestCookie('admin_session', null)
      const n = await json(await listTables(req('GET', `/api/sys-control/vendors/${A}/data`), c1(A)))
      check('no session → 401', n.status === 401, n.status)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      for (const a of Object.values(admins)) await cleanup(pg, tenantIds.splice(0), [], a.id).catch((e) => console.error('cleanup failed:', e))
    }
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

/** Remove the throw-away vendors: every tenant-scoped row first (retrying in FK order), then the globals. */
async function cleanup(pg: Client, tenantIds: string[], tierIds: string[], adminId: string) {
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
    await pg.query(`DELETE FROM staff_invites WHERE tenant_assignments::text LIKE ANY($1)`, [tenantIds.map((id) => `%${id}%`)])
    await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds])
    if (accountIds.length) {
      await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
    }
  }
  if (tierIds.length) await pg.query(`DELETE FROM pricing_tiers WHERE id = ANY($1::uuid[])`, [tierIds])
  await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [adminId])
  await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [adminId])
  await pg.query(`DELETE FROM super_admins WHERE id = $1`, [adminId])
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
