/**
 * P2 — super admin → Business types: per-type overview, vendors × features with 30-day usage,
 * bulk on / off for existing vendors and for the preset new vendors start with.
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/p2-business-types.ts
 *
 * Only touches the vendors it creates (bulk changes are sent with `tenantIds`), and puts the saved
 * preset overrides back the way they were.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { closeAllPools } from '@/lib/db'
import { POST as createVendor, GET as listVendors } from '@/app/api/sys-control/vendors/route'
import { GET as overviewGET } from '@/app/api/sys-control/business-types/route'
import { GET as detailGET } from '@/app/api/sys-control/business-types/[type]/route'
import { PUT as applyPUT, DELETE as resetDELETE } from '@/app/api/sys-control/business-types/[type]/features/route'
import { PRESET_SETTINGS_KEY } from '@/lib/admin/business-type-features'
import { defaultFeatureFlagsForBusinessType } from '@/lib/features/flags'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

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
  const addr = `10.48.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
const ctx = (type: string) => ({ params: Promise.resolve({ type }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

const TYPE = 'textile'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const adminIds: string[] = []
  const savedPresets = (await pg.query(`SELECT value FROM system_settings WHERE key = $1`, [PRESET_SETTINGS_KEY])).rows[0]?.value ?? null

  const session = async (role: string) => {
    const id = randomUUID()
    const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'P2 Admin', $3)`, [id, `p2-${role}-${tag}@example.test`, role])
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    adminIds.push(id)
    return { id, use: () => setTestCookie('admin_session', token) }
  }
  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const tier = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-')) ?? tiers[0]
  const owner = await session('owner')
  const support = await session('support')
  const viewer = await session('viewer')

  const makeVendor = async (n: number, businessType = TYPE) => {
    owner.use()
    const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
      name: `P2 Shop ${n} ${tag}`, slug: `p2-shop-${n}-${tag}`, email: `p2-shop-${n}-${tag}@example.test`,
      phone: `+9477${String(Date.now() + n).slice(-7)}`, address: 'Colombo', businessType,
      tierId: tier.id, billingCycle: 'monthly', ownerName: 'P2 Owner', ownerEmail: `p2-owner-${n}-${tag}@example.test`, ownerPassword: 'Owner@12345',
    })))
    if (res.status !== 200) throw new Error(`create vendor failed: ${JSON.stringify(res.body)}`)
    tenantIds.push(res.body.vendor.id)
    return res.body.vendor.id as string
  }
  const flagsOf = async (id: string) => (await pg.query(`SELECT settings FROM tenants WHERE id = $1`, [id])).rows[0].settings as J

  try {
    // start from the code preset for the type under test
    await pg.query(`UPDATE system_settings SET value = value - $2 WHERE key = $1`, [PRESET_SETTINGS_KEY, TYPE])
    const a = await makeVendor(1)
    const b = await makeVendor(2)
    const r = await makeVendor(3, 'retail')

    await step('overview', async () => {
      viewer.use()
      const res = await json(await overviewGET())
      check('overview: viewer can read (200)', res.status === 200, res)
      const t = (res.body.types as J[]).find((x) => x.type === TYPE)
      check('overview: every business type listed', (res.body.types as J[]).length >= 12 && (res.body.types as J[]).some((x) => x.type === 'mall'))
      check('overview: textile counts our two vendors', !!t && t.tenantCount >= 2, t)
      check('overview: enabledCounts per switch', !!t && typeof t.enabledCounts.variants === 'number' && t.enabledCounts.variants >= 2, t?.enabledCounts)
      check('overview: preset = code preset', !!t && t.preset.variants === true && JSON.stringify(t.presetOverridden) === '[]', t?.preset)
      check('overview: feature catalogue + groups', (res.body.features as J[]).length > 30 && (res.body.groups as string[]).includes('Stock'))
    })

    await step('detail + usage', async () => {
      // a second active warehouse = multi_warehouse is in use for vendor a
      await pg.query(`INSERT INTO warehouses (tenant_id, name, code, is_active) VALUES ($1, 'P2 Second', $2, true)`, [a, `P2${tag}`.slice(0, 20)])
      viewer.use()
      const res = await json(await detailGET(req('GET', `/api/sys-control/business-types/${TYPE}`), ctx(TYPE)))
      check('detail: 200', res.status === 200, res)
      const ta = (res.body.tenants as J[]).find((x) => x.id === a)
      const tb = (res.body.tenants as J[]).find((x) => x.id === b)
      check('detail: lists the vendors of the type only', !!ta && !!tb && !(res.body.tenants as J[]).some((x) => x.id === r))
      check('detail: vendor has effective flags + enabledCount', !!ta && typeof ta.featureFlags.loyalty === 'boolean' && ta.enabledCount > 0, ta)
      check('detail: usage detected (2 warehouses → multi_warehouse used)', !!ta && ta.usedFeatures.includes('multi_warehouse') && !tb?.usedFeatures.includes('multi_warehouse'), ta?.usedFeatures)
      const mw = (res.body.features as J[]).find((f) => f.key === 'multi_warehouse')
      check('detail: feature usedCount counts vendors', !!mw && mw.usageTracked === true && mw.usedCount >= 1, mw)
      const v = (res.body.features as J[]).find((f) => f.key === 'variants')
      check('detail: untracked feature has usedCount null', !!v && v.usageTracked === false && v.usedCount === null, v)
      check('detail: unusedEnabled lists switches on but idle', !!tb && Array.isArray(tb.unusedEnabled) && tb.unusedEnabled.includes('loyalty') === tb.featureFlags.loyalty, tb?.unusedEnabled)
      const bad = await json(await detailGET(req('GET', '/api/sys-control/business-types/nope'), ctx('nope')))
      check('detail: unknown type → 404', bad.status === 404, bad)
    })

    await step('permissions + validation', async () => {
      viewer.use()
      const v = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: { loyalty: false }, tenantIds: [a] }), ctx(TYPE)))
      check('apply: viewer refused (403)', v.status === 403, v)
      support.use()
      const s = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: { loyalty: false }, tenantIds: [a] }), ctx(TYPE)))
      check('apply: support refused (403, needs vendors.manage)', s.status === 403, s)
      owner.use()
      const k = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: { not_a_flag: false } }), ctx(TYPE)))
      check('apply: unknown switch → 400', k.status === 400, k)
      const e = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: {} }), ctx(TYPE)))
      check('apply: empty changes → 400', e.status === 400, e)
      const n = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: { loyalty: false }, applyToExisting: false, applyToNew: false }), ctx(TYPE)))
      check('apply: neither existing nor new → 400', n.status === 400, n)
    })

    await step('apply to existing vendors (subset)', async () => {
      const before = await flagsOf(a)
      owner.use()
      const res = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, {
        changes: { loyalty: false, gift_cards: false }, tenantIds: [a, r], applyToNew: false,
      }), ctx(TYPE)))
      check('apply: 200, only vendors of the type updated (retail id ignored)', res.status === 200 && res.body.updatedTenants === 1, res.body)
      const after = await flagsOf(a)
      check('apply: switches changed on the vendor', after.featureFlags.loyalty === false && after.featureFlags.gift_cards === false, after.featureFlags)
      check('apply: other switches and settings kept', after.featureFlags.variants === before.featureFlags.variants && after.vatRegistered === before.vatRegistered, after)
      check('apply: vendor b untouched', (await flagsOf(b)).featureFlags.loyalty !== false || before.featureFlags.loyalty === false)
      check('apply: retail vendor untouched', (await flagsOf(r)).featureFlags.loyalty !== false)
      check('apply: preset not changed (applyToNew false)', res.body.preset.loyalty === defaultFeatureFlagsForBusinessType(TYPE).loyalty, res.body.preset)
      const audit = (await pg.query(`SELECT details FROM admin_audit_logs WHERE super_admin_id = $1 AND resource = 'business_type_features' ORDER BY created_at DESC LIMIT 1`, [owner.id])).rows[0]
      check('apply: audited with the changes and count', !!audit && JSON.stringify(audit.details).includes('"updatedTenants":1'), audit)
      // turn back on
      const back = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: { loyalty: true, gift_cards: true }, tenantIds: [a], applyToNew: false }), ctx(TYPE)))
      check('apply: turn back on', back.status === 200 && (await flagsOf(a)).featureFlags.loyalty === true)
    })

    await step('preset for new vendors', async () => {
      owner.use()
      const res = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, {
        changes: { gift_cards: false, print_jobs: true }, applyToExisting: false,
      }), ctx(TYPE)))
      check('preset: 200, no vendors changed', res.status === 200 && res.body.updatedTenants === 0, res.body)
      check('preset: new preset returned + marked overridden', res.body.preset.gift_cards === false && res.body.presetOverridden.includes('gift_cards'), res.body)
      const c = await makeVendor(4)
      const cf = (await flagsOf(c)).featureFlags
      check('preset: a NEW vendor of the type starts with it', cf.gift_cards === false && cf.print_jobs === true, cf)
      check('preset: existing vendors unchanged', (await flagsOf(b)).featureFlags.gift_cards !== false)
      owner.use()
      const list = await json(await listVendors(req('GET', '/api/sys-control/vendors?page=1&pageSize=1')))
      check('preset: create-form typeDefaults follow it', list.body.typeDefaults?.[TYPE]?.gift_cards === false, list.body.typeDefaults?.[TYPE])
      const d = await makeVendor(5, 'retail')
      check('preset: other types not affected', (await flagsOf(d)).featureFlags.gift_cards === true)
      // setting a switch back to its code default drops the override
      const same = await json(await applyPUT(req('PUT', `/api/sys-control/business-types/${TYPE}/features`, { changes: { gift_cards: true }, applyToExisting: false }), ctx(TYPE)))
      check('preset: back to code default → no longer overridden', !same.body.presetOverridden.includes('gift_cards') && same.body.presetOverridden.includes('print_jobs'), same.body)
      const reset = await json(await resetDELETE(req('DELETE', `/api/sys-control/business-types/${TYPE}/features`), ctx(TYPE)))
      check('preset: reset → code preset, nothing overridden', reset.status === 200 && reset.body.presetOverridden.length === 0 && reset.body.preset.print_jobs === defaultFeatureFlagsForBusinessType(TYPE).print_jobs, reset.body)
      viewer.use()
      const vr = await json(await resetDELETE(req('DELETE', `/api/sys-control/business-types/${TYPE}/features`), ctx(TYPE)))
      check('preset: viewer cannot reset (403)', vr.status === 403, vr)
    })
  } finally {
    if (savedPresets === null) await pg.query(`DELETE FROM system_settings WHERE key = $1`, [PRESET_SETTINGS_KEY])
    else await pg.query(`UPDATE system_settings SET value = $2 WHERE key = $1`, [PRESET_SETTINGS_KEY, JSON.stringify(savedPresets)])
    await cleanup(pg, tenantIds, adminIds)
    await pg.end()
    await closeAllPools().catch(() => undefined)
  }
  const passed = results.filter((x) => x.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exit(1)
}

async function cleanup(pg: Client, tenantIds: string[], adminIds: string[]) {
  if (tenantIds.length) {
    const { rows } = await pg.query(`SELECT table_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`)
    let pending = rows.map((r) => r.table_name as string)
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
