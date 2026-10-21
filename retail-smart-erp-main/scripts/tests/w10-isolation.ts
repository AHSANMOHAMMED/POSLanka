/**
 * W10b tenant isolation integration test (tables fixed by drizzle/0139_rls_isolation_fixes.sql).
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w10 \
 *   DATABASE_APP_ROLE=app_user npx tsx scripts/tests/w10-isolation.ts
 *
 * Creates two throw-away tenants A and B (as the connecting superuser), then verifies that
 * tenant code (withTenant → SET ROLE app_user) for A cannot read or write B's rows, that
 * global rows are read-only, and that the plain-db paths (super admin, account dashboard,
 * push device lookup) still see everything. Exits non-zero on any failure.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db, withTenant, closeAllPools } from '@/lib/db'
import {
  quotations, quotationItems, creditNotes, creditNoteItems, userDevices, subscriptions,
  subscriptionPayments, accountTenants, tenantUsage, accountSessions, aiErrorLogs, vehicleTypes,
  settings,
} from '@/lib/db/schema'
import { sendPushToUsers, sendPushToPermission, sendPushToSuperAdmins } from '@/lib/notifications/push'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.message : String(err)) }
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false } catch { return true }
}

interface Fx { tenantId: string; userId: string; quotationId: string; creditNoteId: string; vehicleTypeId: string; token: string }

const accountId = randomUUID()
const superAdminToken = `ExponentPushToken[w10-sa-${randomUUID().slice(0, 8)}]`
const accountToken = `ExponentPushToken[w10-acc-${randomUUID().slice(0, 8)}]`
const globalVehicleTypeId = randomUUID()
const globalErrorId = randomUUID()
let tierId = ''
let superAdminId: string | null = null

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID(), userId = randomUUID(), quotationId = randomUUID(), creditNoteId = randomUUID(), vehicleTypeId = randomUUID()
  const slug = `w10-${label}-${tenantId.slice(0, 8)}`
  const token = `ExponentPushToken[w10-${label}-${tenantId.slice(0, 8)}]`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1,$2,$3,$4)`, [tenantId, `W10 ${label}`, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,'x','Owner','owner')`, [userId, tenantId, `o-${slug}@example.test`])
  await admin.query(`INSERT INTO quotations (id, tenant_id, quotation_no) VALUES ($1,$2,'QT-1')`, [quotationId, tenantId])
  await admin.query(`INSERT INTO quotation_items (tenant_id, quotation_id, item_name) VALUES ($1,$2,'Rice 5kg')`, [tenantId, quotationId])
  await admin.query(`INSERT INTO credit_notes (id, tenant_id, credit_note_no) VALUES ($1,$2,'CN-1')`, [creditNoteId, tenantId])
  await admin.query(`INSERT INTO credit_note_items (tenant_id, credit_note_id, item_name) VALUES ($1,$2,'Rice 5kg')`, [tenantId, creditNoteId])
  await admin.query(`INSERT INTO user_devices (tenant_id, user_id, push_token) VALUES ($1,$2,$3)`, [tenantId, userId, token])
  await admin.query(`INSERT INTO subscriptions (tenant_id, billing_account_id, tier_id) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, accountId, tierId])
  await admin.query(`INSERT INTO subscription_payments (tenant_id, amount) VALUES ($1, 1000)`, [tenantId])
  await admin.query(`INSERT INTO account_tenants (account_id, tenant_id, role, is_owner) VALUES ($1,$2,'owner',true)`, [accountId, tenantId])
  await admin.query(`INSERT INTO tenant_usage (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId])
  await admin.query(`INSERT INTO account_sessions (account_id, session_token, tenant_id, expires_at) VALUES ($1,$2,$3, now() + interval '1 day')`, [accountId, `w10-${randomUUID()}`, tenantId])
  await admin.query(`INSERT INTO ai_error_logs (tenant_id, source, message) VALUES ($1,'w10','tenant error')`, [tenantId])
  await admin.query(`INSERT INTO vehicle_types (id, tenant_id, name, body_type) VALUES ($1,$2,'W10 own type','sedan')`, [vehicleTypeId, tenantId])
  await admin.query(`INSERT INTO settings (tenant_id, key, value) VALUES ($1,'w10_key',$2)`, [tenantId, label])
  return { tenantId, userId, quotationId, creditNoteId, vehicleTypeId, token }
}

async function main() {
  if (process.env.DATABASE_APP_ROLE !== 'app_user') throw new Error('Run with DATABASE_APP_ROLE=app_user')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  tierId = (await admin.query(`SELECT id FROM pricing_tiers ORDER BY created_at LIMIT 1`)).rows[0].id
  await admin.query(`INSERT INTO accounts (id, email, phone, full_name, password_hash) VALUES ($1,$2,'0770000000','W10 Owner','x')`, [accountId, `w10-${accountId.slice(0, 8)}@example.test`])
  const sa = await admin.query(`SELECT id FROM super_admins LIMIT 1`).catch(() => ({ rows: [] as Array<{ id: string }> }))
  superAdminId = sa.rows[0]?.id ?? null
  // account-level + super-admin devices (tenant_id NULL), global rows
  await admin.query(`INSERT INTO user_devices (account_id, push_token) VALUES ($1,$2)`, [accountId, accountToken])
  if (superAdminId) await admin.query(`INSERT INTO user_devices (super_admin_id, push_token) VALUES ($1,$2)`, [superAdminId, superAdminToken])
  await admin.query(`INSERT INTO account_sessions (account_id, session_token, scope, expires_at) VALUES ($1,$2,'account', now() + interval '1 day')`, [accountId, `w10-acc-${randomUUID()}`])
  await admin.query(`INSERT INTO ai_error_logs (id, source, message) VALUES ($1,'w10','system error')`, [globalErrorId])
  await admin.query(`INSERT INTO vehicle_types (id, tenant_id, name, body_type, is_system_default) VALUES ($1,NULL,'W10 global type','van',true)`, [globalVehicleTypeId])

  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')

  // Expo push API stub (no network); records the tokens each call targets.
  const pushed: string[] = []
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const msgs = JSON.parse(init?.body || '[]') as Array<{ to: string }>
    pushed.push(...msgs.map((m) => m.to))
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }))
  }) as typeof fetch

  try {
    // ---------- a) tenant business data ----------
    await step('quotations/credit notes isolated', async () => {
      const r = await withTenant(A.tenantId, async (t) => ({
        q: await t.select().from(quotations),
        qi: await t.select().from(quotationItems),
        cn: await t.select().from(creditNotes),
        cni: await t.select().from(creditNoteItems),
        qB: await t.select().from(quotations).where(eq(quotations.id, B.quotationId)),
      }))
      check('A sees only its quotations', r.q.length === 1 && r.q[0].tenantId === A.tenantId, `${r.q.length} rows`)
      check('A sees only its quotation items', r.qi.length === 1 && r.qi[0].tenantId === A.tenantId)
      check('A sees only its credit notes', r.cn.length === 1 && r.cn[0].tenantId === A.tenantId)
      check('A sees only its credit note items', r.cni.length === 1 && r.cni[0].tenantId === A.tenantId)
      check('A cannot fetch B quotation by id', r.qB.length === 0)
    })
    await step('quotations writes isolated', async () => {
      const upd = await withTenant(A.tenantId, (t) => t.update(quotations).set({ notes: 'hacked' }).where(eq(quotations.id, B.quotationId)).returning())
      check('A cannot update B quotation', upd.length === 0)
      check('A cannot insert a quotation for B', await rejects(() => withTenant(A.tenantId, (t) => t.insert(quotations).values({ tenantId: B.tenantId, quotationNo: 'X' }))))
      check('A cannot insert a credit note item for B', await rejects(() => withTenant(A.tenantId, (t) => t.insert(creditNoteItems).values({ tenantId: B.tenantId, creditNoteId: B.creditNoteId, itemName: 'x' }))))
      const own = await withTenant(A.tenantId, (t) => t.insert(quotations).values({ tenantId: A.tenantId, quotationNo: 'QT-2' }).returning())
      check('A can insert its own quotation', own.length === 1)
    })

    // ---------- b) platform tables ----------
    await step('platform tables read-only + own tenant', async () => {
      const r = await withTenant(A.tenantId, async (t) => ({
        subs: await t.select().from(subscriptions),
        pays: await t.select().from(subscriptionPayments),
        at: await t.select().from(accountTenants),
        usage: await t.select().from(tenantUsage),
        sess: await t.select().from(accountSessions),
        // what /api/company/subscription does
        companySub: await t.query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, A.tenantId) }),
        companySubNoFilter: await t.query.subscriptions.findFirst(),
      }))
      check('subscriptions: only own', r.subs.length === 1 && r.subs[0].tenantId === A.tenantId, `${r.subs.length}`)
      check('subscription_payments: only own', r.pays.length === 1 && r.pays[0].tenantId === A.tenantId)
      check('account_tenants: only own', r.at.length === 1 && r.at[0].tenantId === A.tenantId)
      check('tenant_usage: only own', r.usage.length === 1 && r.usage[0].tenantId === A.tenantId)
      check('account_sessions: only own tenant (no account-level)', r.sess.length === 1 && r.sess[0].tenantId === A.tenantId)
      check('company subscription lookup returns own', r.companySub?.tenantId === A.tenantId)
      check('unfiltered findFirst cannot return another tenant', r.companySubNoFilter?.tenantId === A.tenantId)
      const subUpd = await withTenant(A.tenantId, (t) => t.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.tenantId, A.tenantId)).returning())
      check('tenant code cannot modify its subscription', subUpd.length === 0)
      check('tenant code cannot insert subscription payments', await rejects(() => withTenant(A.tenantId, (t) => t.insert(subscriptionPayments).values({ tenantId: A.tenantId, amount: '1' }))))
      const atOwn = await withTenant(A.tenantId, (t) => t.update(accountTenants).set({ isActive: true }).where(eq(accountTenants.tenantId, A.tenantId)).returning())
      const atB = await withTenant(A.tenantId, (t) => t.update(accountTenants).set({ isActive: false }).where(eq(accountTenants.tenantId, B.tenantId)).returning())
      check('account_tenants: users/[id] sync updates own membership', atOwn.length === 1)
      check('account_tenants: cannot update B membership', atB.length === 0)
    })

    // ---------- c) user_devices ----------
    await step('user_devices', async () => {
      const seen = await withTenant(A.tenantId, (t) => t.select().from(userDevices))
      check('tenant sees only own tenant devices (no account/super-admin/B)', seen.length === 1 && seen[0].pushToken === A.token, `${seen.length}`)
      check('tenant cannot register devices as app_user', await rejects(() => withTenant(A.tenantId, (t) => t.insert(userDevices).values({ tenantId: A.tenantId, pushToken: `ExponentPushToken[w10-x-${randomUUID()}]` }))))
      pushed.length = 0
      const r1 = await sendPushToUsers(A.tenantId, [A.userId, B.userId], { title: 't', body: 'b' })
      check('push: device lookup for tenant users works (plain db)', r1.sent === 1 && pushed[0] === A.token, JSON.stringify(pushed))
      pushed.length = 0
      const r2 = await sendPushToPermission(B.tenantId, 'manageSales', { title: 't', body: 'b' })
      check('push: permission fan-out reads users under tenant context', r2.sent === 1 && pushed[0] === B.token, JSON.stringify(pushed))
      if (superAdminId) {
        pushed.length = 0
        await sendPushToSuperAdmins({ title: 't', body: 'b' })
        check('push: super admin devices found', pushed.includes(superAdminToken))
      }
    })

    // ---------- d) ai_error_logs / global+tenant / settings ----------
    await step('ai_error_logs', async () => {
      const logs = await withTenant(A.tenantId, (t) => t.select().from(aiErrorLogs).where(eq(aiErrorLogs.source, 'w10')))
      check('tenant sees own error logs only (no system/B logs)', logs.length === 1 && logs[0].tenantId === A.tenantId, `${logs.length}`)
      const upd = await withTenant(A.tenantId, (t) => t.update(aiErrorLogs).set({ resolutionStatus: 'resolved' }).where(eq(aiErrorLogs.id, globalErrorId)).returning())
      check('tenant cannot resolve system error logs', upd.length === 0)
      check('tenant cannot write system error logs', await rejects(() => withTenant(A.tenantId, (t) => t.insert(aiErrorLogs).values({ tenantId: null, source: 'w10', message: 'x' }))))
    })
    await step('vehicle_types global + tenant', async () => {
      const vt = await withTenant(A.tenantId, (t) => t.select().from(vehicleTypes).where(eq(vehicleTypes.name, 'W10 global type')))
      const own = await withTenant(A.tenantId, (t) => t.select().from(vehicleTypes).where(eq(vehicleTypes.name, 'W10 own type')))
      check('global vehicle type visible to tenant', vt.length === 1)
      check('only own tenant vehicle types visible', own.length === 1 && own[0].id === A.vehicleTypeId)
      const g = await withTenant(A.tenantId, (t) => t.update(vehicleTypes).set({ isActive: false }).where(eq(vehicleTypes.id, globalVehicleTypeId)).returning())
      check('global vehicle type is read-only for tenants', g.length === 0)
      const gd = await withTenant(A.tenantId, (t) => t.delete(vehicleTypes).where(isNull(vehicleTypes.tenantId)).returning())
      check('tenant cannot delete global vehicle types', gd.length === 0)
      check('tenant cannot create global vehicle types', await rejects(() => withTenant(A.tenantId, (t) => t.insert(vehicleTypes).values({ tenantId: null, name: 'x', bodyType: 'van' }))))
      const ownIns = await withTenant(A.tenantId, (t) => t.insert(vehicleTypes).values({ tenantId: A.tenantId, name: 'W10 own 2', bodyType: 'van' }).returning())
      check('tenant can create own vehicle type', ownIns.length === 1)
    })
    await step('settings', async () => {
      const s = await withTenant(A.tenantId, (t) => t.query.settings.findFirst({ where: eq(settings.key, 'w10_key') }))
      check('settings lookup returns own row', s?.value === 'a')
      check('settings tenant_id NOT NULL', await rejects(() => admin.query(`INSERT INTO settings (key) VALUES ('w10_null')`)))
    })

    // ---------- plain db (login role) paths ----------
    await step('plain db paths', async () => {
      const allSubs = await db.select().from(subscriptions).where(eq(subscriptions.billingAccountId, accountId))
      check('super admin / billing: subscriptions of both tenants', allSubs.length === 2)
      const companies = await db.query.accountTenants.findMany({ where: and(eq(accountTenants.accountId, accountId), eq(accountTenants.isActive, true)) })
      check('account dashboard: memberships in both companies', companies.length === 2, `${companies.length}`)
      const usage = await db.select().from(tenantUsage).where(eq(tenantUsage.tenantId, B.tenantId))
      check('storage quota: tenant_usage readable', usage.length === 1)
      const sessions = await db.select().from(accountSessions).where(eq(accountSessions.accountId, accountId))
      check('session manager: account sessions readable', sessions.length === 3)
      const sys = await db.select().from(aiErrorLogs).where(eq(aiErrorLogs.source, 'w10'))
      check('sys-control: all error logs readable', sys.length === 3)
    })

    // Same plain-db paths with a NON-superuser login role that is a member of app_user
    // (the production setup in docs/PRODUCTION_DEPLOYMENT.md).
    await step('non-bypass login role', async () => {
      const role = `w10_login_${randomUUID().slice(0, 8).replace(/-/g, '')}`
      await admin.query(`CREATE ROLE ${role} NOLOGIN`)
      await admin.query(`GRANT app_user TO ${role}`)
      try {
        await admin.query('BEGIN')
        await admin.query(`SET LOCAL ROLE ${role}`)
        const subs = await admin.query(`SELECT count(*)::int AS n FROM subscriptions WHERE billing_account_id = $1`, [accountId])
        const at = await admin.query(`SELECT count(*)::int AS n FROM account_tenants WHERE account_id = $1`, [accountId])
        const dev = await admin.query(`SELECT count(*)::int AS n FROM user_devices WHERE push_token = ANY($1)`, [[A.token, B.token, accountToken]])
        const gl = await admin.query(`SELECT count(*)::int AS n FROM vehicle_types WHERE id = $1`, [globalVehicleTypeId])
        check('login role (no tenant ctx) sees all subscriptions', subs.rows[0].n === 2)
        check('login role sees all memberships', at.rows[0].n === 2)
        check('login role sees all push devices', dev.rows[0].n === 3)
        check('login role sees global vehicle types', gl.rows[0].n === 1)
        await admin.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.tenantId])
        // platform transactions (vendor creation, billing, invites) set a tenant but stay unrestricted
        const subsP = await admin.query(`SELECT count(*)::int AS n FROM subscriptions WHERE billing_account_id = $1`, [accountId])
        check('login role with tenant ctx (platform transaction) keeps full access', subsP.rows[0].n === 2, `subs=${subsP.rows[0].n}`)
        // withTenant without an app role marks the transaction strict
        await admin.query(`SELECT set_config('app.rls_strict', 'on', true)`)
        const subsT = await admin.query(`SELECT count(*)::int AS n FROM subscriptions WHERE billing_account_id = $1`, [accountId])
        const qT = await admin.query(`SELECT count(*)::int AS n FROM quotations WHERE tenant_id = ANY($1)`, [[A.tenantId, B.tenantId]])
        check('login role WITH tenant ctx is restricted (owner_force_rls mode)', subsT.rows[0].n === 1 && qT.rows[0].n === 2, `subs=${subsT.rows[0].n} q=${qT.rows[0].n}`)
      } finally {
        await admin.query('ROLLBACK')
        await admin.query(`DROP ROLE ${role}`)
      }
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await admin.query(`SET session_replication_role = replica`)
      for (const f of [A, B]) {
        const t = f.tenantId
        for (const tbl of ['quotation_items', 'quotations', 'credit_note_items', 'credit_notes', 'user_devices', 'subscriptions',
          'subscription_payments', 'account_tenants', 'account_sessions', 'ai_error_logs', 'vehicle_types', 'settings', 'users', 'tenant_usage']) {
          await admin.query(`DELETE FROM ${tbl} WHERE tenant_id=$1`, [t]).catch((e) => console.warn(`cleanup ${tbl}:`, e.message))
        }
        await admin.query(`DELETE FROM tenants WHERE id=$1`, [t]).catch((e) => console.warn('cleanup tenant:', e.message))
      }
      await admin.query(`DELETE FROM user_devices WHERE push_token = ANY($1)`, [[accountToken, superAdminToken]])
      await admin.query(`DELETE FROM account_sessions WHERE account_id=$1`, [accountId])
      await admin.query(`DELETE FROM ai_error_logs WHERE id=$1`, [globalErrorId])
      await admin.query(`DELETE FROM vehicle_types WHERE id=$1`, [globalVehicleTypeId])
      await admin.query(`DELETE FROM accounts WHERE id=$1`, [accountId])
      await admin.query(`SET session_replication_role = origin`)
    }
    await admin.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
