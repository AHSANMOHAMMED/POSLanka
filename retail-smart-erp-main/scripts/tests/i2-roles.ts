/**
 * I2 — staff roles, custom roles, module access and Business ID sign-in (server enforcement).
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/i2-roles.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on a throw-away tenant, prints
 * PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenant.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import * as permCache from '@/lib/auth/permission-cache'
import { registerPermissionOverrides, hasPermission } from '@/lib/auth/roles'
import { getLiveCompanyUser } from '@/lib/auth/live-user'
import { GET as listCustomRoles, POST as createCustomRole } from '@/app/api/custom-roles/route'
import { PUT as updateCustomRole, DELETE as deleteCustomRole } from '@/app/api/custom-roles/[id]/route'
import { GET as getRolePerms, PUT as putRolePerms } from '@/app/api/role-permissions/route'
import { POST as resetRolePerms } from '@/app/api/role-permissions/reset/route'
import { GET as getEffective } from '@/app/api/role-permissions/effective/route'
import { PUT as putModuleAccess } from '@/app/api/module-access/route'
import { GET as listUsers, POST as createUser } from '@/app/api/users/route'
import { PUT as updateUser, DELETE as deleteUser } from '@/app/api/users/[id]/route'
import { GET as userPermissions } from '@/app/api/users/[id]/permissions/route'
import { GET as listIntake } from '@/app/api/stock-intake/route'
import { GET as dashboardStats } from '@/app/api/sales/dashboard-stats/route'
import { POST as mobileLogin } from '@/app/api/auth/mobile-login/route'
import { GET as listSales } from '@/app/api/sales/route'
import { GET as listItems } from '@/app/api/items/route'
import { GET as listStockTakes } from '@/app/api/stock-takes/route'
import { GET as listPaymentRequests } from '@/app/api/accounting/payment-requests/route'
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const PASSWORD = 'Str0ngPass!'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

interface Actor { id: string; role: string; customRoleId?: string | null }
interface Fx { tenantId: string; slug: string; businessId: string; wh: string; owner: Actor; owner2: Actor; manager: Actor; cashier: Actor; stock: Actor }

let fx: Fx

/** Sets the mocked session and (re)loads the tenant's permission cache, like authWithCompany does. */
async function as(a: Actor) {
  setTestSession({
    user: {
      id: a.id, accountId: null, email: `${a.id.slice(0, 8)}@example.test`, name: a.role, role: a.role,
      customRoleId: a.customRoleId ?? null, tenantId: fx.tenantId, tenantSlug: fx.slug, tenantName: 'I2',
      businessType: 'retail', aiEnabled: false, isSuperAdmin: false, isOwner: a.role === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
  await permCache.warmPermissionCache(fx.tenantId)
}
function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
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
  const slug = `i2-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'I2 roles', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  const { rows } = await admin.query(`SELECT business_id FROM tenants WHERE id=$1`, [tenantId])
  const wh = randomUUID()
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [wh, tenantId])
  const hash = await bcrypt.hash(PASSWORD, 4)
  const mk = async (role: string, label: string): Promise<Actor> => {
    const id = randomUUID()
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, `${label}-${slug}@example.test`, hash, label, role])
    return { id, role }
  }
  return {
    tenantId, slug, businessId: rows[0].business_id, wh,
    owner: await mk('owner', 'owner'), owner2: await mk('owner', 'owner2'),
    manager: await mk('manager', 'manager'), cashier: await mk('cashier', 'cashier'),
    stock: await mk('stock_manager', 'stock'),
  }
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
  process.env.NEXTAUTH_SECRET ||= 'i2-test-secret'
  registerPermissionOverrides({
    getPermissionOverride: permCache.getPermissionOverride,
    getCustomRolePermission: permCache.getCustomRolePermission,
    getCustomRoleBaseRole: permCache.getCustomRoleBaseRole,
  })
  const admin = new Client({ connectionString: url })
  await admin.connect()
  try {
    fx = await makeTenant(admin)
    let seniorRoleId = ''
    let shadowRoleId = ''
    let seniorUser: Actor = { id: '', role: 'cashier' }

    // ---------------------------------------------------------------- custom roles
    await step('custom roles', async () => {
      await as(fx.owner)
      const r = await json(await createCustomRole(req('POST', '/api/custom-roles', {
        name: 'Senior Cashier', baseRole: 'cashier', color: '#22aa66',
        permissions: { voidSales: true, viewReports: true, submitStockIntake: false, manageTenant: true },
      })))
      check('owner creates custom role (201)', r.status === 201 && !!r.body.id, r.body)
      seniorRoleId = r.body.id

      const cr = await json(await listCustomRoles())
      const senior = (cr.body as unknown as J[]).find((x) => x.id === seniorRoleId)
      check('custom role list shows effective permissions (base defaults + explicit)',
        !!senior && senior.effectivePermissions.createSales === true && senior.effectivePermissions.voidSales === true
          && senior.effectivePermissions.submitStockIntake === false && senior.effectivePermissions.manageTenant === false, senior)

      await as(fx.cashier)
      const c = await json(await createCustomRole(req('POST', '/api/custom-roles', { name: 'Hacker', baseRole: 'cashier' })))
      check('cashier cannot create custom roles (403)', c.status === 403, c)
      await as(fx.manager)
      const m = await json(await createCustomRole(req('POST', '/api/custom-roles', { name: 'Mgr role', baseRole: 'cashier' })))
      check('manager cannot create custom roles by default (403, manageRoles is owner-only)', m.status === 403, m)
      const g = await json(await getRolePerms())
      check('manager (manageUsers) may read role definitions', g.status === 200 && !!g.body.effectiveByRole?.cashier, g.status)

      await as(fx.owner)
      const s = await json(await createCustomRole(req('POST', '/api/custom-roles', {
        name: 'Shadow Admin', baseRole: 'cashier', permissions: { manageSettings: true },
      })))
      shadowRoleId = s.body.id
      check('owner creates a role with manageSettings', s.status === 201, s.body)
      const bad = await json(await createCustomRole(req('POST', '/api/custom-roles', { name: 'Bad', baseRole: 'wizard' })))
      check('unknown base role refused (400)', bad.status === 400, bad)
    })

    // ---------------------------------------------------------------- assign to user
    await step('assign custom role', async () => {
      await as(fx.owner)
      const r = await json(await createUser(req('POST', '/api/users', {
        mode: 'create', email: `senior-${fx.slug}@example.test`, fullName: 'Senior One', role: 'manager',
        customRoleId: seniorRoleId, password: PASSWORD, pin: '1234', warehouseIds: [fx.wh],
      })))
      check('owner creates staff with a custom role (201)', r.status === 201 && r.body.user?.customRoleId === seniorRoleId, r.body)
      check('custom role user gets the base role (cashier), not the posted role', r.body.user?.role === 'cashier', r.body.user)
      seniorUser = { id: r.body.user?.id, role: 'cashier', customRoleId: seniorRoleId }

      const list = await json(await listUsers(req('GET', '/api/users?includeWarehouses=true')))
      const row = (list.body as unknown as J[]).find((u) => u.id === seniorUser.id)
      check('GET /api/users returns custom role id + name', row?.customRoleId === seniorRoleId && row?.customRoleName === 'Senior Cashier', row)

      const p = await json(await userPermissions(req('GET', `/api/users/${seniorUser.id}/permissions`), ctx(seniorUser.id)))
      check('user permissions endpoint: custom role effective map',
        p.status === 200 && p.body.permissions.voidSales === true && p.body.permissions.submitStockIntake === false
          && p.body.permissions.createSales === true && p.body.customRoleName === 'Senior Cashier', p.body)
      await as(fx.cashier)
      const p2 = await json(await userPermissions(req('GET', `/api/users/${seniorUser.id}/permissions`), ctx(seniorUser.id)))
      check("cashier cannot read another user's permissions (403)", p2.status === 403, p2.status)
    })

    // ---------------------------------------------------------------- allowed vs forbidden
    await step('allowed vs forbidden API calls', async () => {
      await as(seniorUser)
      const s1 = await json(await dashboardStats())
      check('custom role with viewReports → GET dashboard-stats 200', s1.status === 200, s1)
      const s2 = await json(await listIntake(req('GET', '/api/stock-intake')))
      check('custom role with submitStockIntake revoked → GET stock-intake 403', s2.status === 403, s2.status)
      const e = await json(await getEffective())
      check('effective endpoint mirrors custom role (voidSales on, intake off, name)',
        e.body.permissions.voidSales === true && e.body.permissions.submitStockIntake === false
          && e.body.customRoleName === 'Senior Cashier' && e.body.businessId === fx.businessId, e.body)

      await as(fx.cashier)
      const c1 = await json(await dashboardStats())
      check('plain cashier → dashboard-stats 403', c1.status === 403, c1.status)
      const c2 = await json(await listIntake(req('GET', '/api/stock-intake')))
      // Stock intake is for stock staff only (cashiers were removed from submitStockIntake)
      check('plain cashier → stock-intake 403 (stock staff only)', c2.status === 403, c2)
    })

    // ---------------------------------------------------------------- module access
    await step('permission cache: a change during an in-flight load is not lost', async () => {
      // Start a load, change a permission and invalidate while it reads the database: the load
      // must not store the old data (it used to, and the stale value stuck for 5 minutes).
      // Hold the load mid-read: custom_roles is locked, so that query waits while the overrides
      // query has already read the old rows; then change + invalidate, then release the lock.
      permCache.invalidatePermissionCache(fx.tenantId)
      await admin.query('BEGIN')
      await admin.query('LOCK TABLE custom_roles IN ACCESS EXCLUSIVE MODE')
      const loading = permCache.warmPermissionCache(fx.tenantId)
      await new Promise((r) => setTimeout(r, 300))
      await admin.query(`INSERT INTO role_permission_overrides (tenant_id, role, permission_key, is_granted) VALUES ($1, 'cashier', 'viewReports', true)`, [fx.tenantId])
      permCache.invalidatePermissionCache(fx.tenantId)
      await admin.query('COMMIT')
      await loading
      await permCache.warmPermissionCache(fx.tenantId) // no-op when the load above stored fresh data
      check('override written during a load is visible right after', permCache.getPermissionOverride(fx.tenantId, 'cashier', 'viewReports') === true,
        permCache.getPermissionOverride(fx.tenantId, 'cashier', 'viewReports'))
      await admin.query(`DELETE FROM role_permission_overrides WHERE tenant_id = $1 AND role = 'cashier' AND permission_key = 'viewReports'`, [fx.tenantId])
      permCache.invalidatePermissionCache(fx.tenantId)
    })

    await step('module access enforced server-side', async () => {
      await as(fx.cashier)
      const denied = await json(await putModuleAccess(req('PUT', '/api/module-access', { entries: [{ moduleKey: 'stock', role: 'cashier', isEnabled: true }] })))
      check('cashier cannot change module access (403)', denied.status === 403, denied.status)

      await as(fx.owner)
      const off = await json(await putModuleAccess(req('PUT', '/api/module-access', {
        entries: [
          { moduleKey: 'stock', role: 'cashier', isEnabled: false },
          { moduleKey: 'stock', role: 'stock_manager', isEnabled: false },
          { moduleKey: 'reports', role: 'cashier', isEnabled: false },
          { moduleKey: 'selling', role: 'owner', isEnabled: false },
        ],
      })))
      check('owner disables Stock + Reports for cashier (200)', off.status === 200, off.body)
      const unknown = await json(await putModuleAccess(req('PUT', '/api/module-access', { entries: [{ moduleKey: 'casino', role: 'cashier', isEnabled: false }] })))
      check('unknown module refused (400)', unknown.status === 400, unknown.status)

      await as(fx.stock)
      const c = await json(await listIntake(req('GET', '/api/stock-intake')))
      check('Stock disabled → stock manager GET stock-intake 403', c.status === 403, c.status)
      await as(seniorUser)
      const s = await json(await dashboardStats())
      check('Reports disabled for base role → custom role viewReports refused (403)', s.status === 403, s.status)
      const e = await json(await getEffective())
      check('effective permissions drop module-disabled permissions', e.body.permissions.viewReports === false && e.body.permissions.createSales === true, e.body.permissions)
      await as(fx.owner)
      const p = await json(await userPermissions(req('GET', `/api/users/${seniorUser.id}/permissions`), ctx(seniorUser.id)))
      check('user permissions list blockedByModule', (p.body.blockedByModule as string[]).includes('viewReports') && (p.body.blockedByModule as string[]).includes('submitStockIntake'), p.body.blockedByModule)
      check('owner can never be locked out of a module (owner row ignored)', hasPermission('owner', 'createSales', fx.tenantId), true)
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM module_access WHERE tenant_id=$1 AND role='owner'`, [fx.tenantId])
      check('owner module rows are not stored', rows[0].n === 0, rows[0])

      const on = await json(await putModuleAccess(req('PUT', '/api/module-access', {
        entries: [
          { moduleKey: 'stock', role: 'cashier', isEnabled: true },
          { moduleKey: 'stock', role: 'stock_manager', isEnabled: true },
          { moduleKey: 'reports', role: 'cashier', isEnabled: true },
        ],
      })))
      await as(fx.stock)
      const c2 = await json(await listIntake(req('GET', '/api/stock-intake')))
      check('re-enabled → stock manager GET stock-intake 200 again', on.status === 200 && c2.status === 200, c2.status)
    })

    // ---------------------------------------------------------------- module access on read endpoints
    await step('module access on read endpoints', async () => {
      const setModules = async (entries: Array<{ moduleKey: string; role: string; isEnabled: boolean }>) => {
        await as(fx.owner)
        const r = await json(await putModuleAccess(req('PUT', '/api/module-access', { entries })))
        if (r.status !== 200) throw new Error(`module-access PUT ${r.status}`)
      }
      await as(fx.cashier)
      const base = [
        await json(await listSales(req('GET', '/api/sales'))),
        await json(await listItems(req('GET', '/api/items?search=x'))),
        await json(await listStockTakes(req('GET', '/api/stock-takes'))),
      ]
      check('baseline: cashier reads sales, items, stock takes (200)', base.every((r) => r.status === 200), base.map((r) => r.status))

      await setModules([{ moduleKey: 'stock', role: 'cashier', isEnabled: false }])
      await as(fx.cashier)
      const st = await json(await listStockTakes(req('GET', '/api/stock-takes')))
      const it = await json(await listItems(req('GET', '/api/items?search=x')))
      const sa = await json(await listSales(req('GET', '/api/sales')))
      check('Stock off → stock takes list refused (403 MODULE_DISABLED)', st.status === 403 && st.body.code === 'MODULE_DISABLED', st)
      check('Stock off but Selling on → POS item lookup still works (200)', it.status === 200, it.status)
      check('Stock off → sales list unaffected (200)', sa.status === 200, sa.status)

      await setModules([{ moduleKey: 'stock', role: 'cashier', isEnabled: false }, { moduleKey: 'selling', role: 'cashier', isEnabled: false }])
      await as(fx.cashier)
      const sa2 = await json(await listSales(req('GET', '/api/sales')))
      const it2 = await json(await listItems(req('GET', '/api/items?search=x')))
      check('Selling off → sales list refused (403)', sa2.status === 403, sa2.status)
      check('Stock and Selling off → item lookup refused (403)', it2.status === 403, it2.status)
      await as(fx.owner)
      const ow = await json(await listSales(req('GET', '/api/sales')))
      check('owner unaffected by module toggles (200)', ow.status === 200, ow.status)

      await as(fx.manager)
      const pr1 = await json(await listPaymentRequests(req('GET', '/api/accounting/payment-requests')))
      await setModules([{ moduleKey: 'accounting', role: 'manager', isEnabled: false }])
      await as(fx.manager)
      const pr2 = await json(await listPaymentRequests(req('GET', '/api/accounting/payment-requests')))
      check('Accounting off for manager → payment requests list 200 → 403', pr1.status === 200 && pr2.status === 403, [pr1.status, pr2.status])

      await setModules([
        { moduleKey: 'stock', role: 'cashier', isEnabled: true }, { moduleKey: 'selling', role: 'cashier', isEnabled: true },
        { moduleKey: 'accounting', role: 'manager', isEnabled: true },
      ])
      await as(fx.cashier)
      const back = await json(await listSales(req('GET', '/api/sales')))
      check('re-enabled → cashier reads sales again', back.status === 200, back.status)
    })

    // ---------------------------------------------------------------- cross-process cache invalidation
    await step('permission cache invalidation via NOTIFY', async () => {
      await as(fx.owner)
      await new Promise((r) => setTimeout(r, 500)) // listener connects on first warm
      await as(fx.owner)
      const before = permCache.getCachedCustomRoles(fx.tenantId).length
      // Another app process changes a custom role directly in the database...
      const extraRole = randomUUID()
      await admin.query(`INSERT INTO custom_roles (id, tenant_id, name, slug, base_role) VALUES ($1, $2, 'From another process', $3, 'cashier')`, [extraRole, fx.tenantId, `other-${extraRole.slice(0, 8)}`])
      await permCache.warmPermissionCache(fx.tenantId)
      check('without a notice this process keeps its cached copy (TTL)', permCache.getCachedCustomRoles(fx.tenantId).length === before)
      // ...and publishes the change (same SQL invalidatePermissionCache sends)
      await admin.query(`SELECT pg_notify('permission_cache_invalidate', $1)`, [fx.tenantId])
      let after = before
      for (let i = 0; i < 20 && after === before; i++) {
        await new Promise((r) => setTimeout(r, 100))
        await permCache.warmPermissionCache(fx.tenantId)
        after = permCache.getCachedCustomRoles(fx.tenantId).length
      }
      check('after a NOTIFY from another process, the next load picks up the change', after === before + 1, { before, after })
      await admin.query(`DELETE FROM custom_roles WHERE id = $1`, [extraRole])
      permCache.invalidatePermissionCache(fx.tenantId)
    })

    // ---------------------------------------------------------------- email invite with a custom role
    await step('email invite with custom role', async () => {
      const email = `invitee-${fx.slug}@example.test`
      await as(fx.manager)
      const m = await json(await createUser(req('POST', '/api/users', { mode: 'invite', email: `shadow-inv-${fx.slug}@example.test`, role: 'cashier', customRoleId: shadowRoleId })))
      check('manager cannot invite with a custom role holding permissions they lack (403)', m.status === 403, m.body)

      await as(fx.owner)
      const r = await json(await createUser(req('POST', '/api/users', { mode: 'invite', email, role: 'manager', customRoleId: seniorRoleId })))
      check('owner invites by email with a custom role', r.status === 200 && r.body.mode === 'invited', r.body)
      const { rows } = await admin.query(`SELECT token, tenant_assignments FROM staff_invites WHERE email=$1`, [email])
      const a = rows[0]?.tenant_assignments?.[0]
      check('invite stores the custom role and its base role', a?.customRoleId === seniorRoleId && a?.role === 'cashier', a)

      const acc = await json(await acceptInvite(req('POST', `/api/invites/${rows[0]?.token}/accept`, { fullName: 'Invitee', password: PASSWORD }), { params: Promise.resolve({ token: rows[0]?.token }) }))
      const u = await admin.query(`SELECT role, custom_role_id FROM users WHERE tenant_id=$1 AND email=$2`, [fx.tenantId, email])
      check('accepted invite creates the user on the custom role', acc.status === 200 && u.rows[0]?.custom_role_id === seniorRoleId && u.rows[0]?.role === 'cashier', { acc: acc.body, row: u.rows[0] })
    })

    // ---------------------------------------------------------------- privilege escalation
    await step('privilege escalation', async () => {
      await as(fx.manager)
      const r1 = await json(await createUser(req('POST', '/api/users', {
        mode: 'create', email: `shadow-${fx.slug}@example.test`, fullName: 'Shadow', role: 'cashier',
        customRoleId: shadowRoleId, password: PASSWORD,
      })))
      check('manager cannot create a user with a custom role holding manageSettings (403)', r1.status === 403, r1.body)
      const r2 = await json(await updateUser(req('PUT', `/api/users/${fx.cashier.id}`, { customRoleId: shadowRoleId }), ctx(fx.cashier.id)))
      check('manager cannot move a cashier onto that custom role (403)', r2.status === 403, r2.body)
      const r3 = await json(await createUser(req('POST', '/api/users', {
        mode: 'create', email: `sm-${fx.slug}@example.test`, fullName: 'Sys', role: 'system_manager', password: PASSWORD,
      })))
      check('manager cannot create a system_manager (holds manageSettings) (403)', r3.status === 403, r3.body)
      const r4 = await json(await putRolePerms(req('PUT', '/api/role-permissions', { role: 'cashier', overrides: { manageSettings: true } })))
      check('manager cannot edit role permissions without manageRoles (403)', r4.status === 403, r4.status)

      // Owner delegates role editing to managers
      await as(fx.owner)
      const d = await json(await putRolePerms(req('PUT', '/api/role-permissions', { role: 'manager', overrides: { manageRoles: true } })))
      check('owner grants manageRoles to manager', d.status === 200, d.body)
      await as(fx.owner)
      const eff = await json(await getRolePerms())
      check('role-permissions GET shows effective manageRoles for manager', eff.body.effectiveByRole.manager.manageRoles === true, eff.body.effectiveByRole?.manager?.manageRoles)

      await as(fx.manager)
      const m1 = await json(await createCustomRole(req('POST', '/api/custom-roles', { name: 'Settings Clerk', baseRole: 'cashier', permissions: { manageSettings: true } })))
      check('manager with manageRoles cannot grant manageSettings in a custom role (403)', m1.status === 403 && (m1.body.missingPermissions || []).includes('manageSettings'), m1.body)
      await as(fx.manager)
      const m2 = await json(await createCustomRole(req('POST', '/api/custom-roles', { name: 'Mini Manager', baseRole: 'manager' })))
      check('manager cannot define roles at their own rank (403)', m2.status === 403, m2.body)
      await as(fx.manager)
      const m3 = await json(await createCustomRole(req('POST', '/api/custom-roles', { name: 'Floor Lead', baseRole: 'cashier', permissions: { voidSales: true } })))
      check('manager can create a custom role with permissions they hold (201)', m3.status === 201, m3.body)
      await as(fx.manager)
      const m4a = await json(await putRolePerms(req('PUT', '/api/role-permissions', { role: 'cashier', overrides: { manageSettings: true, voidSales: true } })))
      check('manager cannot grant cashier a permission they lack (403)', m4a.status === 403 && (m4a.body.missingPermissions || []).includes('manageSettings'), m4a.body)
      await as(fx.manager)
      const m4 = await json(await putRolePerms(req('PUT', '/api/role-permissions', { role: 'cashier', overrides: { voidSales: true } })))
      await as(fx.manager)
      check('manager can grant cashier a permission they hold (voidSales)',
        m4.status === 200 && !hasPermission('cashier', 'manageSettings', fx.tenantId) && hasPermission('cashier', 'voidSales', fx.tenantId), m4.body)
      await as(fx.manager)
      const m5 = await json(await putRolePerms(req('PUT', '/api/role-permissions', { role: 'manager', overrides: { manageSettings: true } })))
      check('manager cannot edit their own (or a higher) role (403)', m5.status === 403, m5.body)
      await as(fx.manager)
      const m6 = await json(await updateCustomRole(req('PUT', `/api/custom-roles/${shadowRoleId}`, { permissions: { manageSettings: true, voidSales: true } }), ctx(shadowRoleId)))
      await as(fx.manager)
      check('manager editing an owner-made role keeps permissions they lack as they were',
        m6.status === 200 && hasPermission('cashier', 'manageSettings', fx.tenantId, shadowRoleId), m6.body)
      await as(fx.manager)
      const m7 = await json(await updateCustomRole(req('PUT', `/api/custom-roles/${seniorRoleId}`, { baseRole: 'system_manager' }), ctx(seniorRoleId)))
      check('manager cannot rebase a role onto system_manager (gains manageSettings) (403)', m7.status === 403, m7.body)
      const m8 = await json(await resetRolePerms(req('POST', '/api/role-permissions/reset', { role: 'owner' })))
      check('owner role cannot be reset/edited (400)', m8.status === 400, m8.status)

      await as(fx.owner)
      await json(await resetRolePerms(req('POST', '/api/role-permissions/reset', { role: 'manager' })))
      await json(await resetRolePerms(req('POST', '/api/role-permissions/reset', { role: 'cashier' })))
      await as(fx.manager)
      check('owner reset removes the delegation', !hasPermission('manager', 'manageRoles', fx.tenantId), true)

      await as(fx.cashier)
      const c1 = await json(await createUser(req('POST', '/api/users', { mode: 'create', email: `x-${fx.slug}@example.test`, fullName: 'X', role: 'cashier', password: PASSWORD })))
      check('cashier cannot create staff (403)', c1.status === 403, c1.status)
    })

    // ---------------------------------------------------------------- owner protection
    await step('owner protection', async () => {
      await as(fx.manager)
      const a = await json(await updateUser(req('PUT', `/api/users/${fx.owner.id}`, { isActive: false }), ctx(fx.owner.id)))
      check('manager cannot deactivate the owner (refused 400/403)', a.status === 403 || a.status === 400, a.body)
      const b = await json(await updateUser(req('PUT', `/api/users/${fx.owner.id}`, { password: 'N3wPassword!' }), ctx(fx.owner.id)))
      check("manager cannot reset the owner's password (403)", b.status === 403, b.body)

      await as(fx.owner)
      const c = await json(await updateUser(req('PUT', `/api/users/${fx.owner2.id}`, { role: 'cashier' }), ctx(fx.owner2.id)))
      check('owner cannot demote another owner here (400)', c.status === 400, c.body)
      const d = await json(await updateUser(req('PUT', `/api/users/${fx.owner2.id}`, { isActive: false }), ctx(fx.owner2.id)))
      check('owner cannot deactivate another owner here (400)', d.status === 400, d.body)
      const e = await json(await deleteUser(req('DELETE', `/api/users/${fx.owner2.id}`), ctx(fx.owner2.id)))
      check('owner cannot delete an owner (400)', e.status === 400, e.body)
      const f = await json(await updateUser(req('PUT', `/api/users/${fx.owner2.id}`, { customRoleId: seniorRoleId }), ctx(fx.owner2.id)))
      check('owner cannot be given a custom role (400)', f.status === 400, f.body)
      const g = await json(await updateUser(req('PUT', `/api/users/${fx.owner.id}`, { customRoleId: seniorRoleId }), ctx(fx.owner.id)))
      check('nobody changes their own role (400)', g.status === 400, g.body)
      const h = await json(await updateUser(req('PUT', `/api/users/${fx.cashier.id}`, { role: 'owner' }), ctx(fx.cashier.id)))
      check('nobody is promoted to owner here (400)', h.status === 400, h.body)
    })

    // ---------------------------------------------------------------- role changes + deactivation are live
    await step('live role changes and deactivation', async () => {
      await as(fx.owner)
      const r = await json(await updateCustomRole(req('PUT', `/api/custom-roles/${seniorRoleId}`, { baseRole: 'stock_manager' }), ctx(seniorRoleId)))
      const { rows } = await admin.query(`SELECT role FROM users WHERE id=$1`, [seniorUser.id])
      check('rebasing a custom role moves its users to the new base role', r.status === 200 && rows[0].role === 'stock_manager', { s: r.status, rows })
      const live1 = await getLiveCompanyUser(fx.tenantId, seniorUser.id)
      check('live user check returns the new role + custom role', live1.ok && live1.role === 'stock_manager' && live1.customRoleId === seniorRoleId, live1)

      const del = await json(await deleteCustomRole(req('DELETE', `/api/custom-roles/${seniorRoleId}`), ctx(seniorRoleId)))
      check('custom role with users cannot be deleted (400)', del.status === 400, del.body)

      const back = await json(await updateUser(req('PUT', `/api/users/${seniorUser.id}`, { role: 'cashier' }), ctx(seniorUser.id)))
      check('choosing a built-in role clears the custom role', back.status === 200 && back.body.customRoleId === null && back.body.role === 'cashier', back.body)

      await json(await updateCustomRole(req('PUT', `/api/custom-roles/${shadowRoleId}`, { isActive: false }), ctx(shadowRoleId)))
      const inactive = await json(await updateUser(req('PUT', `/api/users/${seniorUser.id}`, { customRoleId: shadowRoleId }), ctx(seniorUser.id)))
      check('inactive custom role cannot be assigned (400)', inactive.status === 400, inactive.body)
      await as(fx.owner)
      check('inactive custom role grants nothing extra', !hasPermission('cashier', 'manageSettings', fx.tenantId, shadowRoleId), true)

      const off = await json(await deleteUser(req('DELETE', `/api/users/${seniorUser.id}`), ctx(seniorUser.id)))
      const live2 = await getLiveCompanyUser(fx.tenantId, seniorUser.id)
      check('deactivated user: every session/mobile token is refused (live check)', off.status === 200 && !live2.ok && live2.reason === 'inactive', live2)
    })

    // ---------------------------------------------------------------- Business ID mobile sign-in
    await step('mobile login with Business ID', async () => {
      const ip = { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }
      const pretty = `${fx.businessId.slice(0, 2).toLowerCase()}-${fx.businessId.slice(2)}`
      const a = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: `cashier-${fx.slug}@example.test`, password: PASSWORD, businessId: pretty }, ip)))
      check('mobile login with Business ID (any case / dash) → 200', a.status === 200 && !!a.body.token, a.body)
      check('login response carries businessId + effective permissions',
        a.body.user?.businessId === fx.businessId && a.body.user?.permissions?.createSales === true && a.body.user?.permissions?.manageSettings === false, a.body.user)
      const b = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: `cashier-${fx.slug}@example.test`, password: PASSWORD, tenantSlug: fx.slug }, ip)))
      check('legacy tenantSlug login still works', b.status === 200 && b.body.user?.businessId === fx.businessId, b.body)
      const c = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: `cashier-${fx.slug}@example.test`, password: PASSWORD }, ip)))
      check('missing Business ID → 400', c.status === 400, c.status)
      const d = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: `cashier-${fx.slug}@example.test`, password: PASSWORD, businessId: 'PL000000' }, ip)))
      check('unknown Business ID → 401', d.status === 401, d.status)
      const e = await json(await mobileLogin(req('POST', '/api/auth/mobile-login', { email: `senior-${fx.slug}@example.test`, password: PASSWORD, businessId: fx.businessId }, ip)))
      check('deactivated user cannot sign in on mobile (401)', e.status === 401, e.status)
      // Rate limit is keyed by the resolved tenant: wrong passwords via slug and Business ID share a bucket
      const ip2 = { 'x-forwarded-for': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }
      let last = 0
      for (let i = 0; i < 12; i++) {
        const body = { email: `manager-${fx.slug}@example.test`, password: 'wrong', ...(i % 2 ? { tenantSlug: fx.slug } : { businessId: fx.businessId }) }
        last = (await mobileLogin(req('POST', '/api/auth/mobile-login', body, ip2))).status
      }
      check('rate limit shared across slug / Business ID spellings (429)', last === 429, last)
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA && fx) await cleanup(admin, fx.tenantId)
    await admin.query(`DELETE FROM staff_invites WHERE email LIKE $1`, [`%-${fx?.slug}@example.test`]).catch(() => undefined)
    await admin.query(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`mobile:${fx?.tenantId}%`]).catch(() => undefined)
    await admin.end()
    await closeAllPools().catch(() => undefined)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
