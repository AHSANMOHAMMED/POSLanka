/**
 * I4 — super-admin platform console: admins, audit log, error log, broadcasts, settings,
 * single-use impersonation links and unlock without a free month.
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/i4-admin-platform.ts
 *
 * Calls the real /api/sys-control handlers with real admin_sessions rows (cookie via the
 * next/headers mock). Throw-away data is removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { closeAllPools } from '@/lib/db'
import { authenticateSuperAdmin } from '@/lib/admin'
import { consumeImpersonationToken } from '@/lib/auth/impersonation-token'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { POST as impersonate } from '@/app/api/sys-control/vendors/[id]/impersonate/route'
import { GET as listAdmins, POST as createAdmin } from '@/app/api/sys-control/users/admins/route'
import { POST as adminAction } from '@/app/api/sys-control/users/admins/[id]/route'
import { POST as changeOwnPassword } from '@/app/api/sys-control/users/me/password/route'
import { GET as listAccounts } from '@/app/api/sys-control/users/route'
import { GET as twoFactorStatus, POST as twoFactor } from '@/app/api/sys-control/auth/2fa/route'
import { POST as mobileAdminLogin } from '@/app/api/sys-control/auth/mobile-login/route'
import { GET as listAudit } from '@/app/api/sys-control/audit-logs/route'
import { GET as exportAudit } from '@/app/api/sys-control/audit-logs/export/route'
import { GET as listErrors, PUT as updateErrors } from '@/app/api/sys-control/error-logs/route'
import { GET as errorDetail } from '@/app/api/sys-control/error-logs/[id]/route'
import { GET as listNotifications, POST as sendNotification } from '@/app/api/sys-control/notifications/route'
import { GET as broadcastDetail } from '@/app/api/sys-control/notifications/[id]/route'
import { POST as sendEmail } from '@/app/api/sys-control/send-email/route'
import { GET as getSettings, PUT as putSetting } from '@/app/api/sys-control/settings/route'
import { PUT as updateSubscription } from '@/app/api/sys-control/subscriptions/[id]/route'
import { GET as listMessages, POST as startConversation } from '@/app/api/sys-control/messages/route'
import { POST as replyMessage } from '@/app/api/sys-control/messages/[conversationId]/route'

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
  const addr = `10.44.${Math.floor(ip / 250)}.${ip++ % 250}`
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
  delete process.env.RESEND_API_KEY // emails are only logged in this test
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const adminIds: string[] = []
  const tenantIds: string[] = []
  const tierIdsToDrop: string[] = []
  const errorIds: string[] = []
  const broadcastIds: string[] = []
  const conversationIds: string[] = []
  const settingsBackup = (await pg.query(`SELECT key, value FROM system_settings WHERE key IN ('bank_details', 'system_announcement', 'volume_discounts')`)).rows
  const deactivatedForTest: string[] = []

  // ---------------------------------------------------------------- acting admin + session
  const adminId = randomUUID()
  adminIds.push(adminId)
  const token = randomBytes(32).toString('hex')
  await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name) VALUES ($1, $2, $3, 'I4 Admin')`, [adminId, `i4-admin-${tag}@example.test`, await bcrypt.hash('Admin@123456', 4)])
  await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [adminId, token])
  const asAdmin = () => setTestCookie('admin_session', token)
  const asNobody = () => setTestCookie('admin_session', null)

  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const starter = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-'))
  if (!starter) throw new Error('Test DB needs a paid tier')

  try {
    // ============================================================ auth
    await step('non-admin rejected', async () => {
      asNobody()
      const r = await Promise.all([
        listAdmins(), createAdmin(req('POST', '/api/sys-control/users/admins', {})),
        listAudit(req('GET', '/api/sys-control/audit-logs')), listErrors(req('GET', '/api/sys-control/error-logs')),
        sendNotification(req('POST', '/api/sys-control/notifications', {})), getSettings(req('GET', '/api/sys-control/settings')),
      ])
      check('admins / audit / errors / notifications / settings → 401 without session', r.every((x) => x.status === 401), r.map((x) => x.status))
    })

    // ============================================================ vendors used below
    asAdmin()
    const vendors: Array<{ id: string; businessId: string; ownerEmail: string; subId: string }> = []
    await step('create two test vendors', async () => {
      for (const [i, type] of (['supermarket', 'restaurant'] as const).entries()) {
        const ownerEmail = `i4-owner${i}-${tag}@example.test`
        const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
          name: `I4 Shop ${i} ${tag}`, slug: `i4-shop${i}-${tag}`, email: `i4-shop${i}-${tag}@example.test`,
          phone: `+9477${String(Date.now() + i).slice(-7)}`, businessType: type, tierId: starter.id, billingCycle: 'monthly',
          ownerName: `I4 Owner ${i}`, ownerEmail, ownerPassword: 'Owner@12345',
        })))
        if (res.body.vendor?.id) tenantIds.push(res.body.vendor.id)
        const sub = (await pg.query(`SELECT id FROM subscriptions WHERE tenant_id = $1`, [res.body.vendor?.id])).rows[0]
        vendors.push({ id: res.body.vendor?.id, businessId: res.body.businessId, ownerEmail, subId: sub?.id })
      }
      check('vendors created', vendors.length === 2 && vendors.every((v) => v.id && v.businessId && v.subId), vendors)
    })

    // ============================================================ platform admins
    let newAdminId = ''
    let newAdminPassword = ''
    await step('platform admins: create / rules / reset / 2FA', async () => {
      asAdmin()
      const bad = await json(await createAdmin(req('POST', '/api/sys-control/users/admins', { email: 'not-an-email', fullName: 'X' })))
      check('create admin: validation → 400', bad.status === 400, bad)
      const email = `i4-new-${tag}@example.test`
      const created = await json(await createAdmin(req('POST', '/api/sys-control/users/admins', { email, fullName: 'I4 New Admin', requireTotp: true, sendEmail: true })))
      newAdminId = created.body.admin?.id
      newAdminPassword = created.body.tempPassword
      if (newAdminId) adminIds.push(newAdminId)
      check('create admin → 201 with a one-time temporary password', created.status === 201 && typeof newAdminPassword === 'string' && newAdminPassword.length >= 10, created.body)
      check('credentials email logged (no transport configured)', created.body.emailStatus === 'logged', created.body.emailStatus)
      const row = (await pg.query(`SELECT must_change_password, totp_required, password_hash FROM super_admins WHERE id = $1`, [newAdminId])).rows[0]
      check('new admin must change password and requires 2FA', row?.must_change_password === true && row?.totp_required === true)
      check('password stored hashed', !!row && row.password_hash !== newAdminPassword && await bcrypt.compare(newAdminPassword, row.password_hash))
      const dup = await json(await createAdmin(req('POST', '/api/sys-control/users/admins', { email, fullName: 'Again' })))
      check('duplicate email → 409', dup.status === 409, dup)
      const auditCreate = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = $2 AND details->>'op' = 'create_admin'`, [adminId, newAdminId])).rows[0].n
      check('create audited', auditCreate === 1)

      const list = await json(await listAdmins())
      const mine = (list.body.admins ?? []).find((a: J) => a.id === newAdminId)
      check('list admins: includes 2FA/status/sessions, no secrets', list.status === 200 && list.body.meId === adminId && mine && mine.totpRequired === true && !('passwordHash' in mine) && !('totpSecret' in mine), mine)

      const self = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${adminId}`, { action: 'deactivate' }), ctx(adminId)))
      check('cannot deactivate yourself → 400', self.status === 400, self.body)

      // sign in the new admin (session), then deactivate: session removed + login refused
      const ok = await authenticateSuperAdmin(email, newAdminPassword, '10.0.0.1')
      check('new admin can sign in with the temporary password', ok.success === true, ok)
      await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [newAdminId, randomBytes(32).toString('hex')])
      const deact = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'deactivate', reason: 'I4 test' }), ctx(newAdminId)))
      const sessions = (await pg.query(`SELECT count(*)::int AS n FROM admin_sessions WHERE super_admin_id = $1`, [newAdminId])).rows[0].n
      check('deactivate → 200, sessions ended', deact.status === 200 && deact.body.admin?.isActive === false && sessions === 0, { deact: deact.body, sessions })
      check('deactivated admin cannot sign in', (await authenticateSuperAdmin(email, newAdminPassword)).success === false)
      const again = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'deactivate' }), ctx(newAdminId)))
      check('deactivating twice → 409', again.status === 409, again.body)
      const re = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'reactivate' }), ctx(newAdminId)))
      check('reactivate → 200, can sign in again', re.status === 200 && (await authenticateSuperAdmin(email, newAdminPassword)).success === true, re.body)

      // last active admin: with only two active admins left, the other admin deactivates the acting
      // admin while this request waits on the row lock — it must then refuse to remove the last one
      const others = (await pg.query(`SELECT id FROM super_admins WHERE is_active AND id <> ALL($1::uuid[])`, [[adminId, newAdminId]])).rows.map((r) => r.id as string)
      deactivatedForTest.push(...others)
      await pg.query(`UPDATE super_admins SET is_active = false WHERE id = ANY($1::uuid[])`, [others])
      const blocker = new Client({ connectionString: process.env.DATABASE_URL })
      await blocker.connect()
      await blocker.query('BEGIN')
      await blocker.query(`SELECT id FROM super_admins WHERE is_active = true ORDER BY id FOR UPDATE`)
      asAdmin()
      const pendingDeactivate = adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'deactivate' }), ctx(newAdminId))
      await new Promise((r) => setTimeout(r, 1500))
      await blocker.query(`UPDATE super_admins SET is_active = false, deactivated_at = now() WHERE id = $1`, [adminId]) // the concurrent deactivation
      await blocker.query('COMMIT')
      await blocker.end()
      const last = await json(await pendingDeactivate)
      const nActive = (await pg.query(`SELECT is_active FROM super_admins WHERE id = $1`, [newAdminId])).rows[0].is_active
      check('concurrent deactivation cannot remove the last active admin → 409', last.status === 409 && /last active/i.test(last.body.error || '') && nActive === true, last.body)
      await pg.query(`UPDATE super_admins SET is_active = true, deactivated_at = NULL WHERE id = ANY($1::uuid[])`, [[adminId, newAdminId, ...others]])
      deactivatedForTest.length = 0
      asAdmin()

      // reset password → new temp password works, old one does not, must change
      const reset = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'reset_password', sendEmail: false }), ctx(newAdminId)))
      check('reset password → new temporary password', reset.status === 200 && typeof reset.body.tempPassword === 'string' && reset.body.tempPassword !== newAdminPassword && reset.body.emailStatus === 'skipped', reset.body)
      check('old password refused, new accepted',
        (await authenticateSuperAdmin(email, newAdminPassword)).success === false && (await authenticateSuperAdmin(email, reset.body.tempPassword)).success === true)
      const selfReset = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${adminId}`, { action: 'reset_password' }), ctx(adminId)))
      check('cannot reset your own password here → 400', selfReset.status === 400)

      // the new admin changes their password (clears the forced change)
      const newToken = randomBytes(32).toString('hex')
      await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [newAdminId, newToken])
      setTestCookie('admin_session', newToken)

      // ---- account setup pending: every other API refuses with 403 ACCOUNT_SETUP_REQUIRED
      const blocked = await Promise.all([
        listAdmins(), listAudit(req('GET', '/api/sys-control/audit-logs?page=1')), getSettings(req('GET', '/api/sys-control/settings')),
        listErrors(req('GET', '/api/sys-control/error-logs')), sendNotification(req('POST', '/api/sys-control/notifications', {})),
      ].map(async (p) => json(await p)))
      check('pending password change: other sys-control APIs → 403 ACCOUNT_SETUP_REQUIRED',
        blocked.every((b) => b.status === 403 && b.body.code === 'ACCOUNT_SETUP_REQUIRED' && b.body.setup?.mustChangePassword === true), blocked.map((b) => [b.status, b.body.code]))
      const tfa = await json(await twoFactorStatus())
      check('pending: 2FA status still allowed', tfa.status === 200 && tfa.body.required === true, tfa)
      const bearer = `sa_${randomBytes(32).toString('hex')}`
      await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [newAdminId, bearer])
      setTestCookie('admin_session', null)
      setTestHeader('authorization', `Bearer ${bearer}`)
      const viaBearer = await json(await listAdmins())
      setTestHeader('authorization', null)
      check('pending: mobile bearer token refused too', viaBearer.status === 403 && viaBearer.body.code === 'ACCOUNT_SETUP_REQUIRED', viaBearer)
      const mobile = await json(await mobileAdminLogin(req('POST', '/api/sys-control/auth/mobile-login', { email, password: reset.body.tempPassword })))
      check('pending: mobile login refused with ACCOUNT_SETUP_REQUIRED', mobile.status === 403 && mobile.body.code === 'ACCOUNT_SETUP_REQUIRED' && !mobile.body.token, mobile)
      setTestCookie('admin_session', newToken)
      const noSession = await (async () => { setTestCookie('admin_session', 'nope'); const r = await listAdmins(); setTestCookie('admin_session', newToken); return r.status })()
      check('no valid session is still 401', noSession === 401)

      const weak = await json(await changeOwnPassword(req('POST', '/api/sys-control/users/me/password', { currentPassword: reset.body.tempPassword, newPassword: 'short' })))
      check('weak new password → 400', weak.status === 400)
      const wrong = await json(await changeOwnPassword(req('POST', '/api/sys-control/users/me/password', { currentPassword: 'nope', newPassword: 'Better12345x' })))
      check('wrong current password → 400', wrong.status === 400)
      const changed = await json(await changeOwnPassword(req('POST', '/api/sys-control/users/me/password', { currentPassword: reset.body.tempPassword, newPassword: 'Better12345x' })))
      const flag = (await pg.query(`SELECT must_change_password FROM super_admins WHERE id = $1`, [newAdminId])).rows[0].must_change_password
      check('password changed, forced change cleared', changed.status === 200 && flag === false && (await authenticateSuperAdmin(email, 'Better12345x')).success, changed.body)

      const stillPending = await json(await listAdmins())
      check('password changed but required 2FA missing → still 403', stillPending.status === 403 && stillPending.body.setup?.totpRequired === true && stillPending.body.setup?.mustChangePassword === false, stillPending.body)

      // 2FA requirement: cannot be turned off by the admin while required
      await pg.query(`UPDATE super_admins SET totp_enabled = true, totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = $1`, [newAdminId])
      const unblocked = await listAdmins()
      check('setup complete → APIs open again', unblocked.status === 200, unblocked.status)
      const off = await json(await twoFactor(req('POST', '/api/sys-control/auth/2fa', { action: 'disable', code: '000000' })))
      check('2FA disable refused (code invalid or required)', off.status === 403, off)
      asAdmin()
      const waive = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'waive_2fa' }), ctx(newAdminId)))
      const require2 = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'require_2fa' }), ctx(newAdminId)))
      const resetTotp = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'reset_2fa' }), ctx(newAdminId)))
      const t = (await pg.query(`SELECT totp_required, totp_enabled, totp_secret FROM super_admins WHERE id = $1`, [newAdminId])).rows[0]
      check('waive / require / reset 2FA persist', waive.status === 200 && require2.status === 200 && resetTotp.status === 200 && t.totp_required === true && t.totp_enabled === false && t.totp_secret === null, { t })
      await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'update', phone: '+94 77 000 0000' }), ctx(newAdminId))
      const cleared = await json(await adminAction(req('POST', `/api/sys-control/users/admins/${newAdminId}`, { action: 'update', phone: '' }), ctx(newAdminId)))
      const ph = (await pg.query(`SELECT phone FROM super_admins WHERE id = $1`, [newAdminId])).rows[0].phone
      check('empty phone clears it', cleared.status === 200 && ph === null, { cleared: cleared.body, ph })
      const n = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource_id = $2`, [adminId, newAdminId])).rows[0].n
      check('admin actions audited', n >= 7, n)

      const accts = await json(await listAccounts(req('GET', `/api/sys-control/users?q=i4-owner0-${tag}`)))
      check('customer accounts: paginated with business count', accts.status === 200 && accts.body.pagination?.total === 1 && accts.body.accounts?.[0]?.companies === 1, accts.body)
    })

    // ============================================================ audit log
    await step('audit log: filters + export', async () => {
      asAdmin()
      const v = vendors[0]
      await pg.query(
        `INSERT INTO admin_audit_logs (super_admin_id, action, resource, resource_id, details, ip_address, created_at) VALUES
         ($1, 'update', 'vendor', $2, '{"op":"suspend"}', '10.9.9.9', now() - interval '2 days'),
         ($1, 'update', 'subscription', $3, $4, '10.9.9.9', now() - interval '40 days'),
         ($1, 'approve', 'payment', NULL, '{"note":"i4-${tag}"}', '10.9.9.9', now())`,
        [adminId, v.id, v.subId, JSON.stringify({ tenantId: v.id, op: 'extend' })],
      )
      const byVendor = await json(await listAudit(req('GET', `/api/sys-control/audit-logs?vendor=${v.businessId}&adminId=${adminId}&page=1&pageSize=50`)))
      const resources = (byVendor.body.logs ?? []).map((l: J) => l.resource)
      check('vendor filter (Business ID) matches resource_id and details.tenantId', byVendor.status === 200 && resources.includes('vendor') && resources.includes('subscription') && !resources.includes('payment'), resources)
      check('rows carry admin + vendor names', byVendor.body.logs?.every((l: J) => l.adminEmail === `i4-admin-${tag}@example.test` && l.vendorId === v.id))
      const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
      const ranged = await json(await listAudit(req('GET', `/api/sys-control/audit-logs?vendor=${v.businessId}&adminId=${adminId}&from=${day(10)}&to=${day(0)}&page=1`)))
      const rangedRes = (ranged.body.logs ?? []).map((l: J) => l.resource)
      check('date range excludes the 40-day-old row', rangedRes.includes('vendor') && !rangedRes.includes('subscription'), rangedRes)
      const byAction = await json(await listAudit(req('GET', `/api/sys-control/audit-logs?action=approve&adminId=${adminId}&q=i4-${tag}&page=1`)))
      check('action + text filter', byAction.body.pagination?.total === 1 && byAction.body.logs?.[0]?.resource === 'payment', byAction.body.pagination)
      const meta = await json(await listAudit(req('GET', `/api/sys-control/audit-logs?page=1&pageSize=1&meta=1&adminId=${adminId}`)))
      check('pagination + meta (admins, resources)', meta.body.logs?.length === 1 && meta.body.pagination.total > 1 && Array.isArray(meta.body.admins) && meta.body.resources?.includes('vendor'), meta.body.pagination)
      const legacy = await json(await listAudit(req('GET', `/api/sys-control/audit-logs?days=30&limit=3`)))
      check('legacy overview call still returns an array', Array.isArray(legacy.body) && legacy.body.length <= 3)
      const badRange = await json(await listAudit(req('GET', `/api/sys-control/audit-logs?from=yesterday`)))
      check('invalid date → 400', badRange.status === 400)

      const csvRes = await exportAudit(req('GET', `/api/sys-control/audit-logs/export?vendor=${v.businessId}&adminId=${adminId}`))
      const csv = await csvRes.text()
      const lines = csv.trim().split('\r\n')
      check('CSV export: header + exactly the filtered rows', csvRes.status === 200 && lines[0].includes('Time (UTC)') && lines.length === 1 + byVendor.body.pagination.total && csv.includes('subscription') && !csv.includes(`i4-${tag}"`), { lines: lines.length, total: byVendor.body.pagination.total })
      check('export is attachment', (csvRes.headers.get('content-disposition') || '').includes('attachment'))
      const exportAudited = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'audit_export'`, [adminId])).rows[0].n
      check('export audited', exportAudited === 1)
    })

    // ============================================================ error log
    await step('error log: group, resolve, reopen, scrub', async () => {
      asAdmin()
      const hash = `i4${tag}`.padEnd(16, '0')
      const ids = (await pg.query(
        `INSERT INTO ai_error_logs (tenant_id, level, source, message, stack, context, group_hash, resolution_status, occurrence_count, error_source)
         VALUES ($1, 'error', 'api/i4', 'I4 boom ${tag}', 'Error: boom postgresql://postgres:hunter2@db:5432/x Bearer abcdefghijklmnopqrst', '{"password":"pw1","path":"/x"}', $2, 'open', 3, 'system'),
                ($1, 'error', 'api/i4', 'I4 boom ${tag}', null, null, $2, 'open', 1, 'system')
         RETURNING id`, [vendors[0].id, hash])).rows.map((r) => r.id as string)
      errorIds.push(...ids)
      const groups = await json(await listErrors(req('GET', `/api/sys-control/error-logs?view=groups&q=I4 boom ${tag}&includeStats=1`)))
      const g = groups.body.groups?.[0]
      check('grouped view: 2 entries, 4 occurrences', groups.status === 200 && groups.body.groups?.length === 1 && g.entries === 2 && g.occurrences === 4 && g.openEntries === 2 && !!groups.body.stats, groups.body)
      const resolve = await json(await updateErrors(req('PUT', '/api/sys-control/error-logs', { id: ids[0], resolutionStatus: 'resolved', resolutionNotes: 'fixed in i4' })))
      let row = (await pg.query(`SELECT resolution_status, resolved_at, resolution_notes FROM ai_error_logs WHERE id = $1`, [ids[0]])).rows[0]
      check('resolve persists (status, time, notes)', resolve.status === 200 && row.resolution_status === 'resolved' && row.resolved_at !== null && row.resolution_notes === 'fixed in i4', row)
      const open = await json(await listErrors(req('GET', `/api/sys-control/error-logs?status=unresolved&q=I4 boom ${tag}`)))
      check('unresolved filter hides the resolved entry', open.body.pagination?.total === 1 && open.body.data?.[0]?.id === ids[1], open.body.pagination)
      await updateErrors(req('PUT', '/api/sys-control/error-logs', { id: ids[0], resolutionStatus: 'open' }))
      row = (await pg.query(`SELECT resolution_status, resolved_at FROM ai_error_logs WHERE id = $1`, [ids[0]])).rows[0]
      check('reopen clears resolved time', row.resolution_status === 'open' && row.resolved_at === null, row)
      const grp = await json(await updateErrors(req('PUT', '/api/sys-control/error-logs', { groupHash: hash, resolutionStatus: 'wont_fix' })))
      const statuses = (await pg.query(`SELECT resolution_status FROM ai_error_logs WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => r.resolution_status)
      check('ignore whole group', grp.status === 200 && grp.body.updated === 2 && statuses.every((s) => s === 'wont_fix'), statuses)
      const clearNotes = await json(await updateErrors(req('PUT', '/api/sys-control/error-logs', { id: ids[0], resolutionNotes: '' })))
      const notes = (await pg.query(`SELECT resolution_notes FROM ai_error_logs WHERE id = $1`, [ids[0]])).rows[0].resolution_notes
      check('empty notes clear them', clearNotes.status === 200 && notes === null, { clearNotes: clearNotes.body, notes })
      const both = await json(await updateErrors(req('PUT', '/api/sys-control/error-logs', { id: ids[0], groupHash: hash, resolutionStatus: 'open' })))
      check('id and groupHash together → 400', both.status === 400)
      const missing = await json(await updateErrors(req('PUT', '/api/sys-control/error-logs', { id: randomUUID(), resolutionStatus: 'open' })))
      check('unknown id → 404', missing.status === 404)
      const detail = await json(await errorDetail(req('GET', `/api/sys-control/error-logs/${ids[0]}`), ctx(ids[0])))
      check('detail scrubs stack + context secrets', detail.status === 200 && !detail.body.stack.includes('hunter2') && !detail.body.stack.includes('abcdefghijklmnopqrst') && detail.body.context?.password === '[redacted]' && detail.body.groupEntries === 2, detail.body)
      const audited = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'error_log'`, [adminId])).rows[0].n
      check('error log changes audited', audited >= 3, audited)
    })

    // ============================================================ broadcasts
    await step('broadcast to a filtered vendor set', async () => {
      asAdmin()
      // a private plan holding only the two test vendors makes the filter deterministic
      const tierId = (await pg.query(`INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, is_active) VALUES ($1, 'I4 Plan', 100, 1000, true) RETURNING id`, [`i4-${tag}`])).rows[0].id
      tierIdsToDrop.push(tierId)
      await pg.query(`UPDATE subscriptions SET tier_id = $1 WHERE tenant_id = ANY($2::uuid[])`, [tierId, vendors.map((v) => v.id)])
      const base = { title: `I4 notice ${tag}`, body: 'Planned maintenance tonight 11pm–1am.', category: 'maintenance', link: '/account/billing' }
      const audience = { mode: 'filtered', tierIds: [tierId], businessTypes: ['supermarket'] }

      const bad = await json(await sendNotification(req('POST', '/api/sys-control/notifications', { ...base, channels: [], audience })))
      check('no channel → 400', bad.status === 400)
      const badLink = await json(await sendNotification(req('POST', '/api/sys-control/notifications', { ...base, link: 'javascript:alert(1)', channels: ['in_app'], audience })))
      check('unsafe link → 400', badLink.status === 400)

      const preview = await json(await sendNotification(req('POST', '/api/sys-control/notifications', { ...base, channels: ['in_app', 'account', 'email'], audience, dryRun: true })))
      check('preview: exactly the supermarket on the plan', preview.status === 200 && preview.body.preview?.vendorCount === 1 && preview.body.preview.sample?.[0]?.id === vendors[0].id && preview.body.preview.userCount === 1 && preview.body.preview.emailCount === 1, preview.body)
      const sentBefore = (await pg.query(`SELECT count(*)::int AS n FROM in_app_notifications WHERE type = 'platform_announcement' AND tenant_id = ANY($1::uuid[])`, [vendors.map((v) => v.id)])).rows[0].n
      check('preview sends nothing', sentBefore === 0)

      const sent = await json(await sendNotification(req('POST', '/api/sys-control/notifications', { ...base, channels: ['in_app', 'account', 'email'], audience })))
      const bid = sent.body.result?.id
      if (bid) broadcastIds.push(bid)
      check('send → 201 with delivery totals', sent.status === 201 && sent.body.result.vendorCount === 1 && sent.body.result.inAppCount === 1 && sent.body.result.accountCount === 1 && sent.body.result.emailLogged === 1 && sent.body.result.status === 'sent', sent.body)
      const inbox = (await pg.query(`SELECT n.tenant_id, u.email, n.data FROM in_app_notifications n JOIN users u ON u.id = n.user_id WHERE n.data->>'broadcastId' = $1`, [bid])).rows
      check('vendor app inbox row for the owner only', inbox.length === 1 && inbox[0].tenant_id === vendors[0].id && inbox[0].email === vendors[0].ownerEmail, inbox)
      const acct = (await pg.query(`SELECT a.email FROM account_notifications n JOIN accounts a ON a.id = n.account_id WHERE n.metadata->>'broadcastId' = $1`, [bid])).rows
      check('account portal notification for the owner', acct.length === 1 && acct[0].email === vendors[0].ownerEmail, acct)
      const other = (await pg.query(`SELECT count(*)::int AS n FROM in_app_notifications WHERE tenant_id = $1 AND type = 'platform_announcement'`, [vendors[1].id])).rows[0].n
      check('the restaurant on the same plan got nothing', other === 0)

      const hist = await json(await listNotifications(req('GET', '/api/sys-control/notifications?page=1&meta=1')))
      check('history lists it with status + options', hist.status === 200 && hist.body.broadcasts?.[0]?.id === bid && hist.body.broadcasts[0].status === 'sent' && Array.isArray(hist.body.tiers), hist.body.broadcasts?.[0])
      const det = await json(await broadcastDetail(req('GET', `/api/sys-control/notifications/${bid}`), ctx(bid)))
      check('detail: per-recipient delivery', det.status === 200 && det.body.recipients?.length === 1 && det.body.recipients[0].emailStatus === 'logged' && det.body.recipients[0].inAppCount === 1 && det.body.recipients[0].businessId === vendors[0].businessId, det.body.recipients)

      const sel = await json(await sendNotification(req('POST', '/api/sys-control/notifications', { ...base, channels: ['in_app'], recipientScope: 'all_staff', audience: { mode: 'selected', businessIds: [vendors[1].businessId.replace('PL', 'pl-'), 'PL-000000'] }, dryRun: true })))
      check('by Business ID: any spelling, unknown IDs reported', sel.body.preview?.vendorCount === 1 && sel.body.preview.unknownBusinessIds?.includes('PL-000000'), sel.body.preview)

      const mail = await json(await sendEmail(req('POST', '/api/sys-control/send-email', { subject: `I4 mail ${tag}`, body: 'Hello from the platform team.', audience: { mode: 'addresses', addresses: [`i4-x-${tag}@example.test`, `i4-y-${tag}@example.test`] } })))
      if (mail.body.result?.id) broadcastIds.push(mail.body.result.id)
      check('send email to addresses → 2 logged', mail.status === 201 && mail.body.result.emailLogged === 2 && mail.body.result.status === 'sent', mail.body)
      const kind = (await pg.query(`SELECT kind, channels FROM platform_broadcasts WHERE id = $1`, [mail.body.result?.id])).rows[0]
      check('stored as an email broadcast', kind?.kind === 'email' && kind.channels.join() === 'email', kind)
      const notifAudit = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'broadcast'`, [adminId])).rows[0].n
      check('broadcasts audited', notifAudit === 2, notifAudit)
    })

    // ============================================================ messages both ways
    await step('support messages: admin starts, vendor sees it', async () => {
      asAdmin()
      const start = await json(await startConversation(req('POST', '/api/sys-control/messages', { businessId: vendors[0].businessId, subject: `I4 hello ${tag}`, message: 'Welcome aboard' })))
      const convId = start.body.conversation?.id
      if (convId) conversationIds.push(convId)
      const owner = (await pg.query(`SELECT c.account_id, a.email, c.unread_by_account FROM conversations c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`, [convId])).rows[0]
      check('conversation goes to the owner account, unread for them', start.status === 201 && owner?.email === vendors[0].ownerEmail && owner.unread_by_account === true, start.body)
      // the vendor replies (as /api/account/messages/[id] POST does)
      await pg.query(`INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, content) VALUES ($1, 'account', $2, 'I4 Owner 0', 'Thanks!')`, [convId, owner.account_id])
      await pg.query(`UPDATE conversations SET unread_by_admin = true, last_message_preview = 'Thanks!' WHERE id = $1`, [convId])
      const inbox = await json(await listMessages(req('GET', `/api/sys-control/messages?unread=1&search=I4 hello ${tag}`)))
      check('vendor reply shows under "Needs reply"', inbox.body.data?.length === 1 && inbox.body.data[0].unreadByAdmin === true && typeof inbox.body.counts?.unread === 'number', inbox.body)
      const reply = await json(await replyMessage(req('POST', `/api/sys-control/messages/${convId}`, { content: 'Glad to help' }), { params: Promise.resolve({ conversationId: convId }) }))
      const c = (await pg.query(`SELECT unread_by_account, unread_by_admin FROM conversations WHERE id = $1`, [convId])).rows[0]
      check('admin reply marks it unread for the vendor', reply.status === 201 && c.unread_by_account === true && c.unread_by_admin === false, c)
    })

    // ============================================================ settings
    await step('settings: validation + save', async () => {
      asAdmin()
      const unknown = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'billing_config', value: {} })))
      check('unknown key → 400', unknown.status === 400)
      const invalid = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'bank_details', value: { bankName: 'Commercial Bank', branchName: 'Colpetty', accountName: 'POSLanka', accountNumber: 'abc', swiftCode: 'XX' } })))
      const fields = (invalid.body.details ?? []).map((d: J) => d.field)
      check('invalid bank details → 400 with field errors', invalid.status === 400 && fields.includes('accountNumber') && fields.includes('swiftCode'), invalid.body)
      const good = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'bank_details', value: { bankName: 'Commercial Bank', branchName: 'Colpetty', accountName: 'POSLanka (Pvt) Ltd', accountNumber: '1000 2345 6789', swiftCode: 'cccblklx', notes: '' } })))
      const stored = (await pg.query(`SELECT value FROM system_settings WHERE key = 'bank_details'`)).rows[0]?.value
      check('valid bank details saved (SWIFT upper-cased)', good.status === 200 && stored?.swiftCode === 'CCCBLKLX' && stored?.accountNumber === '1000 2345 6789', stored)
      const annBad = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'system_announcement', value: { enabled: true, message: '', type: 'info' } })))
      check('announcement on without text → 400', annBad.status === 400 && annBad.body.details?.[0]?.field === 'message', annBad.body)
      const overlap = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'volume_discounts', value: { tiers: [{ min: 2, max: 5, percent: 10 }, { min: 4, max: null, percent: 20 }] } })))
      check('overlapping discount tiers → 400', overlap.status === 400 && (overlap.body.details ?? []).some((d: J) => /overlaps/.test(d.message)), overlap.body)
      const tiersOk = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'volume_discounts', value: { tiers: [{ min: 2, max: 5, percent: 10 }, { min: 6, max: null, percent: 20 }] } })))
      const vt = (await pg.query(`SELECT value FROM system_settings WHERE key = 'volume_discounts'`)).rows[0]?.value
      check('open-ended last tier saved with max null', tiersOk.status === 200 && vt?.tiers?.[1]?.max === null, { tiersOk: tiersOk.body, vt })
      const offer = await json(await putSetting(req('PUT', '/api/sys-control/settings', { key: 'seasonal_offer', value: { enabled: true, title: 'Old', description: '', discountPercent: 10, validUntil: '2020-01-01', badgeText: '', applicableTiers: [], showOnLanding: true, showOnPricing: false } })))
      check('offer ending in the past → 400', offer.status === 400 && (offer.body.details ?? []).some((d: J) => d.field === 'validUntil'), offer.body)
      const all = await json(await getSettings(req('GET', '/api/sys-control/settings')))
      check('GET returns every setting + platform status in one call', all.status === 200 && all.body.settings?.bank_details?.swiftCode === 'CCCBLKLX' && !!all.body.updatedAt?.bank_details && typeof all.body.platform?.graceDays === 'number' && Array.isArray(all.body.tiers), all.body.platform)
      const audited = (await pg.query(`SELECT count(*)::int AS n FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'setting' AND details->>'key' = 'bank_details'`, [adminId])).rows[0].n
      check('setting change audited', audited === 1)
    })

    // ============================================================ impersonation
    await step('impersonation link is single-use', async () => {
      asAdmin()
      const r = await json(await impersonate(req('POST', `/api/sys-control/vendors/${vendors[0].id}/impersonate`, { reason: 'I4 support check' }), ctx(vendors[0].id)))
      const tok = r.body.impersonateToken as string
      check('issue → 200 with a recorded jti', r.status === 200 && typeof tok === 'string' && (await pg.query(`SELECT count(*)::int AS n FROM admin_impersonation_tokens WHERE vendor_id = $1 AND used_at IS NULL`, [vendors[0].id])).rows[0].n === 1, r.body)
      const first = await consumeImpersonationToken(tok, '10.1.1.1')
      check('first use accepted', first?.tenantId === vendors[0].id && first.adminId === adminId, first)
      const second = await consumeImpersonationToken(tok, '10.1.1.1')
      check('second use refused', second === null)
      const used = (await pg.query(`SELECT used_at, used_ip FROM admin_impersonation_tokens WHERE jti = $1`, [first?.jti])).rows[0]
      check('use recorded with IP', !!used?.used_at && used.used_ip === '10.1.1.1', used)

      const r2 = await json(await impersonate(req('POST', `/api/sys-control/vendors/${vendors[0].id}/impersonate`, {}), ctx(vendors[0].id)))
      const race = await Promise.all([consumeImpersonationToken(r2.body.impersonateToken), consumeImpersonationToken(r2.body.impersonateToken), consumeImpersonationToken(r2.body.impersonateToken)])
      check('concurrent use: exactly one wins', race.filter(Boolean).length === 1, race.map(Boolean))

      const jwt = (await import('jsonwebtoken')).default
      const forged = jwt.sign({ type: 'vendor-impersonate', tenantId: vendors[0].id, adminId }, process.env.NEXTAUTH_SECRET!, { expiresIn: 120, jwtid: randomUUID() })
      check('token without a recorded jti refused', (await consumeImpersonationToken(forged)) === null)
      const r3 = await json(await impersonate(req('POST', `/api/sys-control/vendors/${vendors[0].id}/impersonate`, {}), ctx(vendors[0].id)))
      await pg.query(`UPDATE admin_impersonation_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL AND vendor_id = $1`, [vendors[0].id])
      check('expired link refused', (await consumeImpersonationToken(r3.body.impersonateToken)) === null)
      check('bad signature refused', (await consumeImpersonationToken(r3.body.impersonateToken + 'x')) === null)
    })

    // ============================================================ unlock without free month
    await step('unlock does not grant free time unless chosen', async () => {
      asAdmin()
      const v = vendors[1]
      const end = new Date(Date.now() + 10 * 86_400_000)
      await pg.query(`UPDATE subscriptions SET status = 'active', current_period_end = $2 WHERE id = $1`, [v.subId, end])
      await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { lock: true, reason: 'I4 lock for unlock test' }), ctx(v.subId))
      const un = await json(await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { unlock: true }), ctx(v.subId)))
      let s = (await pg.query(`SELECT s.status, s.current_period_end, t.status AS tstatus FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`, [v.subId])).rows[0]
      check('unlock without grant: active, period end unchanged', un.status === 200 && s.status === 'active' && s.tstatus === 'active' && Math.abs(new Date(s.current_period_end).getTime() - end.getTime()) < 1000, s)

      await pg.query(`UPDATE subscriptions SET current_period_end = now() - interval '20 days' WHERE id = $1`, [v.subId])
      await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { lock: true, reason: 'I4 lock again for test' }), ctx(v.subId))
      await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { unlock: true, unlockGrantMonths: 0 }), ctx(v.subId))
      s = (await pg.query(`SELECT status, current_period_end FROM subscriptions WHERE id = $1`, [v.subId])).rows[0]
      check('unlock with a lapsed period and no grant → past due, no new period', s.status === 'past_due' && new Date(s.current_period_end) < new Date(), s)

      await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { lock: true, reason: 'I4 lock third time' }), ctx(v.subId))
      const g = await json(await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { unlock: true, unlockGrantMonths: 2, reason: 'goodwill' }), ctx(v.subId)))
      s = (await pg.query(`SELECT status, current_period_end FROM subscriptions WHERE id = $1`, [v.subId])).rows[0]
      const days = (new Date(s.current_period_end).getTime() - Date.now()) / 86_400_000
      check('explicit grant of 2 months → active, ends in ~2 months', g.status === 200 && s.status === 'active' && days > 55 && days < 63, { s, days })
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'subscription' AND resource_id = $2 AND details->>'action' = 'unlock' ORDER BY created_at`, [adminId, v.subId])).rows
      check('unlock audits the granted months', audit.length === 3 && audit[0].details.grantedMonths === 0 && audit[2].details.grantedMonths === 2, audit.map((a) => a.details.grantedMonths))
      const bad = await json(await updateSubscription(req('PUT', `/api/sys-control/subscriptions/${v.subId}`, { unlock: true, unlockGrantMonths: 24 }), ctx(v.subId)))
      check('grant over 12 months → 400', bad.status === 400)
    })
  } finally {
    if (deactivatedForTest.length) await pg.query(`UPDATE super_admins SET is_active = true WHERE id = ANY($1::uuid[])`, [deactivatedForTest])
    if (process.env.KEEP_TEST_DATA !== '1') {
      await cleanup(pg, { tenantIds, tierIds: tierIdsToDrop, adminIds, errorIds, broadcastIds, conversationIds, settingsBackup }).catch((e) => console.error('cleanup failed:', e))
    }
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

async function cleanup(pg: Client, d: {
  tenantIds: string[]; tierIds: string[]; adminIds: string[]; errorIds: string[]; broadcastIds: string[]; conversationIds: string[]
  settingsBackup: Array<{ key: string; value: unknown }>
}) {
  if (d.broadcastIds.length) {
    await pg.query(`DELETE FROM account_notifications WHERE metadata->>'broadcastId' = ANY($1::text[])`, [d.broadcastIds])
    await pg.query(`DELETE FROM platform_broadcasts WHERE id = ANY($1::uuid[])`, [d.broadcastIds])
  }
  if (d.conversationIds.length) await pg.query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [d.conversationIds])
  if (d.errorIds.length) await pg.query(`DELETE FROM ai_error_logs WHERE id = ANY($1::uuid[])`, [d.errorIds])
  await pg.query(`DELETE FROM system_settings WHERE key IN ('bank_details', 'system_announcement', 'volume_discounts')`)
  for (const s of d.settingsBackup) {
    await pg.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2)`, [s.key, JSON.stringify(s.value)])
  }
  if (d.tenantIds.length) {
    const tables = (await pg.query(
      `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
    )).rows.map((r) => r.table_name as string)
    const accountIds = (await pg.query(`SELECT DISTINCT account_id FROM account_tenants WHERE tenant_id = ANY($1::uuid[])`, [d.tenantIds])).rows.map((r) => r.account_id)
    let pending = tables
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next: string[] = []
      for (const t of pending) {
        try { await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [d.tenantIds]) } catch { next.push(t) }
      }
      pending = next
    }
    await pg.query(`DELETE FROM staff_invites WHERE tenant_assignments::text LIKE ANY($1)`, [d.tenantIds.map((id) => `%${id}%`)]).catch(() => undefined)
    await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [d.tenantIds])
    if (accountIds.length) {
      await pg.query(`DELETE FROM conversations WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM account_notifications WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
    }
  }
  if (d.tierIds.length) await pg.query(`DELETE FROM pricing_tiers WHERE id = ANY($1::uuid[])`, [d.tierIds])
  await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = ANY($1::uuid[])`, [d.adminIds])
  await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = ANY($1::uuid[])`, [d.adminIds])
  await pg.query(`DELETE FROM admin_impersonation_tokens WHERE super_admin_id = ANY($1::uuid[])`, [d.adminIds])
  await pg.query(`DELETE FROM platform_broadcasts WHERE super_admin_id = ANY($1::uuid[])`, [d.adminIds])
  await pg.query(`DELETE FROM super_admins WHERE id = ANY($1::uuid[])`, [d.adminIds])
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
