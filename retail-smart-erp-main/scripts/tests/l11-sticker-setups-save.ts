/**
 * L11 — saving sticker roll setups (PUT /api/label-settings/sticker-setups).
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l11-sticker-setups-save.ts
 *
 * Regression: validateBody drops null values, so a new roll (language / darkness / speed / branch
 * "not set") was refused with "Validation failed". Covers every preset, set values, a branch, bad input.
 * Throw-away tenant removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { GET, PUT } from '@/app/api/label-settings/sticker-setups/route'
import { STICKER_PRESETS, setupFromPreset } from '@/lib/labels/sticker-stock'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail).slice(0, 600)}` : ''}`)
}

globalThis.__broadcastProcessor = () => undefined

const put = async (list: unknown) => {
  const res = await PUT(new NextRequest('http://localhost/api/label-settings/sticker-setups', {
    method: 'PUT', body: JSON.stringify({ stickerSetups: list }), headers: { 'content-type': 'application/json' },
  }))
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  const pg = new Client({ connectionString: url })
  await pg.connect()
  const tenantId = randomUUID()
  const userId = randomUUID()
  const warehouseId = randomUUID()
  const slug = `l11-${randomBytes(3).toString('hex')}`
  try {
    await pg.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'L11 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
    await pg.query(`INSERT INTO users (id, tenant_id, email, full_name, role, password_hash) VALUES ($1, $2, $3, 'L11 Owner', 'owner', 'x')`, [userId, tenantId, `${slug}-owner@example.test`])
    await pg.query(`INSERT INTO warehouses (id, tenant_id, name, code) VALUES ($1, $2, 'Main', 'MAIN')`, [warehouseId, tenantId])
    setTestSession({ user: { id: userId, tenantId, role: 'owner', email: `${slug}-owner@example.test`, name: 'L11 Owner', fullName: 'L11 Owner', tenantSlug: slug, isSuperAdmin: false } } as never)

    const all = STICKER_PRESETS.map((p, i) => setupFromPreset(p, { isDefault: i === 0 }))
    const r1 = await put(all)
    check('every preset (language / darkness / speed / branch not set) saves → 200', r1.status === 200 && r1.body.stickerSetups?.length === all.length, r1.body)
    check('unset values come back as null', r1.body.stickerSetups?.every((s: J) => s.language === null && s.darkness === null && s.speed === null && s.warehouseId === null))

    const set = { ...all[0], language: 'zpl', darkness: 12, speed: 3, warehouseId, rowGapMm: 3 }
    const r2 = await put([set])
    const got = r2.body.stickerSetups?.[0]
    check('set values + branch saved', r2.status === 200 && got?.language === 'zpl' && got?.darkness === 12 && got?.speed === 3 && got?.warehouseId === warehouseId && got?.rowGapMm === 3, r2.body)
    const back = await (await GET()).json() as J
    check('GET returns the saved roll', back.stickerSetups?.[0]?.id === set.id && back.stickerSetups[0].darkness === 12, back)

    const r3 = await put([{ ...set, darkness: null, speed: '' }])
    check('clearing darkness / speed → saved as not set', r3.status === 200 && r3.body.stickerSetups?.[0]?.darkness === null && r3.body.stickerSetups[0].speed === null, r3.body)

    const bad = await put([{ ...set, labelWidthMm: 0 }])
    check('label width 0 → 400 naming the field', bad.status === 400 && JSON.stringify(bad.body).includes('labelWidthMm'), bad.body)
  } finally {
    if (!process.env.KEEP_TEST_DATA) await cleanup(pg, tenantId).catch((e) => console.error('cleanup:', e.message))
    await pg.end()
    await closeAllPools()
  }
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
}

/** Remove the throw-away tenant: activity logs are written just after each save, so wait, then delete every tenant-scoped row (retrying in FK order). */
async function cleanup(pg: Client, tenantId: string) {
  await new Promise((r) => setTimeout(r, 1500))
  const tables = (await pg.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
  )).rows.map((r) => r.table_name as string)
  let pending = tables
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: string[] = []
    for (const t of pending) {
      try { await pg.query(`DELETE FROM "${t}" WHERE tenant_id = $1`, [tenantId]) } catch { next.push(t) }
    }
    pending = next
  }
  await pg.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
