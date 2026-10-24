/**
 * W1 staff accounts — core logic tests for createStaffUser / assignment helpers.
 *
 * Run:
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w1 DATABASE_APP_ROLE=app_user \
 *     npx tsx scripts/tests/w1-staff.ts
 *
 * Creates throwaway tenants, exercises the logic under RLS (withTenant + app role), then cleans up.
 */
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { withTenant, closeAllPools } from '../../src/lib/db'
import {
  createStaffUser,
  replaceUserPosProfiles,
  StaffError,
} from '../../src/lib/users/create-staff'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`, detail ?? '')
  }
}

async function expectStaffError(name: string, status: number, fn: () => Promise<unknown>) {
  try {
    await fn()
    check(name, false, 'expected an error, got success')
  } catch (err) {
    check(name, err instanceof StaffError && err.status === status, err instanceof Error ? `${err.name}: ${err.message} (${(err as StaffError).status})` : err)
  }
}

const tag = crypto.randomBytes(4).toString('hex')
const created: { tenants: string[]; accounts: string[] } = { tenants: [], accounts: [] }

async function makeTenant(label: string, warehouses: Array<{ name: string; counters: string[] }>) {
  const t = await pool.query(
    `INSERT INTO tenants (name, slug, email) VALUES ($1, $2, $3) RETURNING id`,
    [`W1 ${label}`, `w1${label}${tag}`.toLowerCase(), `w1-${label}-${tag}@test.local`]
  )
  const tenantId: string = t.rows[0].id
  created.tenants.push(tenantId)
  const result: { tenantId: string; warehouses: Array<{ id: string; counters: string[] }> } = { tenantId, warehouses: [] }
  let i = 0
  for (const w of warehouses) {
    const wr = await pool.query(
      `INSERT INTO warehouses (tenant_id, name, code, is_default) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, w.name, `W${i}`, i === 0]
    )
    const counters: string[] = []
    for (const c of w.counters) {
      const pr = await pool.query(
        `INSERT INTO pos_profiles (tenant_id, name, warehouse_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, c, wr.rows[0].id]
      )
      counters.push(pr.rows[0].id)
    }
    result.warehouses.push({ id: wr.rows[0].id, counters })
    i++
  }
  return result
}

const PASSWORD = 'Cashier123'

async function main() {
  // Only run against a local throwaway test database (it creates and deletes tenants).
  const url = process.env.DATABASE_URL || ''
  if (!/@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i.test(url)) {
    throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  }
  console.log(`W1 staff tests (tag ${tag}, app role: ${process.env.DATABASE_APP_ROLE || 'none'})`)

  // Tenant A: one branch with one counter. Tenant B: two branches, branch 1 has two counters.
  const A = await makeTenant('a', [{ name: 'Main', counters: ['Counter 1'] }])
  const B = await makeTenant('b', [
    { name: 'Colombo', counters: ['C-1', 'C-2'] },
    { name: 'Kandy', counters: ['K-1'] },
  ])

  const create = (tenantId: string, actorRole: string, extra: Partial<Parameters<typeof createStaffUser>[1]> = {}) =>
    withTenant(tenantId, (tx) =>
      createStaffUser(tx, {
        tenantId,
        actorRole,
        email: `staff-${crypto.randomBytes(3).toString('hex')}@test.local`,
        fullName: 'Test Staff',
        role: 'cashier',
        password: PASSWORD,
        ...extra,
      })
    )

  console.log('\nRole hierarchy')
  await expectStaffError('manager cannot create owner (400)', 400, () => create(A.tenantId, 'manager', { role: 'owner' }))
  await expectStaffError('owner cannot create owner via staff API (400)', 400, () => create(A.tenantId, 'owner', { role: 'owner' }))
  await expectStaffError('system_manager cannot create manager (403)', 403, () => create(A.tenantId, 'system_manager', { role: 'manager' }))
  await expectStaffError('cashier cannot create stock_manager (403)', 403, () => create(A.tenantId, 'cashier', { role: 'stock_manager' }))
  const mgrMadeMgr = await create(A.tenantId, 'manager', { role: 'manager' })
  check('manager can create manager (same level)', mgrMadeMgr.role === 'manager')
  const sysMadeStock = await create(A.tenantId, 'system_manager', { role: 'stock_manager' })
  check('system_manager can create stock_manager', sysMadeStock.role === 'stock_manager')

  console.log('\nValidation')
  await expectStaffError('password under 4 characters rejected (400)', 400, () => create(A.tenantId, 'owner', { password: 'abc' }))
  await expectStaffError('bad PIN rejected (400)', 400, () => create(A.tenantId, 'owner', { pin: '12' }))
  await expectStaffError('counter from another tenant rejected (400)', 400, () =>
    create(A.tenantId, 'owner', { posProfileIds: [B.warehouses[0].counters[0]] }))
  await expectStaffError('branch from another tenant rejected (400)', 400, () =>
    create(A.tenantId, 'owner', { warehouseIds: [B.warehouses[0].id] }))

  console.log('\nName + role only')
  const minimal = await create(A.tenantId, 'owner', { email: undefined, password: undefined, fullName: 'Ruwan Jayasinghe' })
  const tSlug = (await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [A.tenantId])).rows[0].slug
  check('no email → login from the name and the web address', minimal.email === `ruwan.jayasinghe@${tSlug}.poslanka.local`, minimal.email)
  check('no password → a simple 6-digit one is generated', typeof minimal.generatedPassword === 'string' && /^\d{6}$/.test(minimal.generatedPassword!))
  const minRow = (await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [minimal.id])).rows[0]
  check('generated password verifies', await bcrypt.compare(minimal.generatedPassword!, minRow.password_hash))
  const minimal2 = await create(A.tenantId, 'owner', { email: null, password: null, fullName: 'Ruwan Jayasinghe' })
  check('same name → next free login', minimal2.email === `ruwan.jayasinghe2@${tSlug}.poslanka.local`, minimal2.email)
  const given = await create(A.tenantId, 'owner')
  check('password given → nothing generated', given.generatedPassword === null)

  console.log('\nCashier auto-assignment + credentials')
  const email = `Cashier-${tag}@Test.Local`
  const cashier = await create(A.tenantId, 'manager', { email, pin: '4321', fullName: '  Kamal Silva ' })
  check('email normalised to lower-case', cashier.email === email.toLowerCase(), cashier.email)
  check('full name trimmed', cashier.fullName === 'Kamal Silva', cashier.fullName)
  check('single branch auto-assigned', cashier.warehouseIds.length === 1 && cashier.warehouseIds[0] === A.warehouses[0].id, cashier.warehouseIds)
  check('single counter auto-assigned', cashier.posProfileIds.length === 1 && cashier.posProfileIds[0] === A.warehouses[0].counters[0], cashier.posProfileIds)
  check('result exposes no hashes', !('passwordHash' in cashier) && !('pinHash' in cashier))

  const row = (await pool.query(
    `SELECT u.password_hash, u.pin_hash, u.is_active, u.password_changed_at, u.account_id,
            (SELECT count(*) FROM user_warehouses uw WHERE uw.user_id = u.id)::int AS wh,
            (SELECT count(*) FROM pos_profile_users pu WHERE pu.user_id = u.id AND pu.is_default)::int AS def_pp
       FROM users u WHERE u.id = $1`, [cashier.id])).rows[0]
  check('user is active', row.is_active === true)
  check('password_changed_at set', !!row.password_changed_at)
  check('password verifies (login bcrypt.compare)', await bcrypt.compare(PASSWORD, row.password_hash))
  check('wrong password rejected', !(await bcrypt.compare('Wrong1234', row.password_hash)))
  check('PIN verifies', !!row.pin_hash && await bcrypt.compare('4321', row.pin_hash))
  check('password hashed with cost 12', bcrypt.getRounds(row.password_hash) === 12)
  check('user_warehouses row persisted', row.wh === 1)
  check('counter assignment is default', row.def_pp === 1)

  console.log('\nDuplicates')
  await expectStaffError('duplicate email (same case) → 409', 409, () => create(A.tenantId, 'owner', { email: email.toLowerCase() }))
  await expectStaffError('duplicate email (different case) → 409', 409, () => create(A.tenantId, 'owner', { email: email.toUpperCase() }))
  const otherTenant = await create(B.tenantId, 'owner', { email })
  check('same email allowed in a different tenant', otherTenant.email === email.toLowerCase())
  let uniqueIdx = false
  try {
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, 'x', 'dup', 'cashier', true)`,
      [A.tenantId, email.toUpperCase()]
    )
  } catch (err) {
    uniqueIdx = (err as { code?: string }).code === '23505'
  }
  check('DB unique index blocks duplicate active email (case-insensitive)', uniqueIdx)

  console.log('\nMulti-branch tenant')
  const noBranch = await create(B.tenantId, 'owner', { role: 'cashier' })
  check('2 branches: no branch auto-assigned', noBranch.warehouseIds.length === 0, noBranch.warehouseIds)
  check('2 branches: no counter auto-assigned', noBranch.posProfileIds.length === 0, noBranch.posProfileIds)
  const twoCounters = await create(B.tenantId, 'owner', { role: 'cashier', warehouseIds: [B.warehouses[0].id] })
  check('branch with 2 counters: no counter auto-assigned', twoCounters.posProfileIds.length === 0)
  const kandy = await create(B.tenantId, 'owner', { role: 'pos_user', warehouseIds: [B.warehouses[1].id] })
  check('pos_user gets the branch\'s only counter', kandy.posProfileIds[0] === B.warehouses[1].counters[0])
  const viaCounter = await create(B.tenantId, 'owner', { role: 'cashier', posProfileIds: [B.warehouses[1].counters[0]] })
  check('counter auto-adds its branch', viaCounter.warehouseIds.includes(B.warehouses[1].id), viaCounter.warehouseIds)
  const mgr = await create(B.tenantId, 'owner', { role: 'manager', warehouseIds: [B.warehouses[1].id] })
  check('manager role: counter not auto-assigned', mgr.posProfileIds.length === 0)

  console.log('\nCounter replacement (per user)')
  await withTenant(B.tenantId, (tx) =>
    replaceUserPosProfiles(tx, B.tenantId, twoCounters.id, B.warehouses[0].counters, B.warehouses[0].counters[1]))
  await withTenant(B.tenantId, (tx) =>
    replaceUserPosProfiles(tx, B.tenantId, noBranch.id, [B.warehouses[0].counters[0]]))
  const rows = (await pool.query(
    `SELECT user_id, pos_profile_id, is_default FROM pos_profile_users WHERE tenant_id = $1 AND user_id = ANY($2)`,
    [B.tenantId, [twoCounters.id, noBranch.id]])).rows
  const tc = rows.filter(r => r.user_id === twoCounters.id)
  check('replace sets both counters for user', tc.length === 2)
  check('explicit default honoured', tc.find(r => r.is_default)?.pos_profile_id === B.warehouses[0].counters[1])
  check('other user\'s rows untouched', rows.filter(r => r.user_id === noBranch.id).length === 1)
  await withTenant(B.tenantId, (tx) => replaceUserPosProfiles(tx, B.tenantId, twoCounters.id, []))
  const after = (await pool.query(`SELECT count(*)::int n FROM pos_profile_users WHERE user_id = ANY($1)`, [[twoCounters.id, noBranch.id]])).rows[0].n
  check('clearing one user leaves the other', after === 1, after)
  await expectStaffError('default must be among assigned counters', 400, () => withTenant(B.tenantId, (tx) =>
    replaceUserPosProfiles(tx, B.tenantId, twoCounters.id, [B.warehouses[0].counters[0]], B.warehouses[0].counters[1])))

  console.log('\nGlobal account linking')
  const accEmail = `acct-${tag}@test.local`
  const accHash = await bcrypt.hash('AccountPass1', 4)
  const acc = await pool.query(
    `INSERT INTO accounts (email, password_hash, full_name, phone) VALUES ($1, $2, 'Acct', $3) RETURNING id`,
    [accEmail, accHash, `+9477${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`]
  )
  created.accounts.push(acc.rows[0].id)
  const linked = await create(A.tenantId, 'owner', { email: accEmail })
  check('existing account linked via accountId', linked.accountId === acc.rows[0].id)
  const accAfter = (await pool.query(`SELECT password_hash FROM accounts WHERE id = $1`, [acc.rows[0].id])).rows[0]
  check('account password unchanged', accAfter.password_hash === accHash)

  console.log(`\n${passed} passed, ${failed} failed`)
}

async function cleanup() {
  for (const tenantId of created.tenants) {
    try {
      await pool.query('BEGIN')
      // Test DB only: skip storage-usage triggers (they re-insert tenant_usage rows while the
      // tenant is being deleted). Every dependent table is deleted explicitly below.
      await pool.query(`SET LOCAL session_replication_role = replica`)
      await pool.query(`DELETE FROM pos_profile_users WHERE tenant_id = $1`, [tenantId])
      await pool.query(`DELETE FROM user_warehouses WHERE tenant_id = $1`, [tenantId])
      await pool.query(`DELETE FROM pos_profiles WHERE tenant_id = $1`, [tenantId])
      await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId])
      await pool.query(`DELETE FROM warehouses WHERE tenant_id = $1`, [tenantId])
      // FK cascades are triggers too (disabled above), so delete cascading children by hand.
      const cascades = await pool.query(
        `SELECT conrelid::regclass::text AS t FROM pg_constraint
          WHERE confrelid = 'tenants'::regclass AND confdeltype = 'c' AND conrelid <> 'tenant_usage'::regclass`)
      for (const { t } of cascades.rows as Array<{ t: string }>) {
        await pool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId])
      }
      await pool.query(`DELETE FROM tenant_usage WHERE tenant_id = $1`, [tenantId])
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      console.log(`  (cleanup of tenant ${tenantId} incomplete: ${(err as Error).message})`)
    }
  }
  for (const id of created.accounts) {
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [id]).catch(() => {})
  }
}

main()
  .catch((err) => {
    failed++
    console.error('Test run crashed:', err)
  })
  .finally(async () => {
    await cleanup()
    await pool.end()
    await closeAllPools()
    process.exit(failed > 0 ? 1 : 0)
  })
