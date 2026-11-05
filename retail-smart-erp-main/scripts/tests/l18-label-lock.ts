/**
 * L18 — the shop's label print setup and its lock, through the real routes
 * (GET/PUT /api/label-settings/print-setup, /api/label-settings, sticker-setups).
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l18-label-lock.ts
 *
 * Saved setup survives (stored in label_settings next to the code word / rolls), lock is stamped,
 * a locked setup cannot be changed (owner 409 until Unlock, cashier 403), the other label
 * settings routes keep the stored print setup. Throw-away tenant removed unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { GET, PUT } from '@/app/api/label-settings/print-setup/route'
import { GET as GET_SETTINGS, PUT as PUT_SETTINGS } from '@/app/api/label-settings/route'
import { PUT as PUT_ROLLS } from '@/app/api/label-settings/sticker-setups/route'
import { presetFields } from '@/lib/labels/print-setup'

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

const req = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const put = async (body: unknown) => {
  const res = await PUT(req('/api/label-settings/print-setup', body))
  return { status: res.status, body: (await res.json().catch(() => ({}))) as J }
}
const get = async () => {
  const res = await GET()
  return { status: res.status, body: (await res.json().catch(() => ({}))) as J }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  const pg = new Client({ connectionString: url })
  await pg.connect()
  const tenantId = randomUUID()
  const ownerId = randomUUID()
  const cashierId = randomUUID()
  const slug = `l18-${randomBytes(3).toString('hex')}`
  const owner = { user: { id: ownerId, tenantId, role: 'owner', email: `${slug}-owner@example.test`, name: 'L18 Owner', fullName: 'L18 Owner', tenantSlug: slug, isSuperAdmin: false } }
  const cashier = { user: { id: cashierId, tenantId, role: 'cashier', email: `${slug}-cash@example.test`, name: 'L18 Cashier', fullName: 'L18 Cashier', tenantSlug: slug, isSuperAdmin: false } }
  try {
    await pg.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'L18 test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
    await pg.query(`INSERT INTO users (id, tenant_id, email, full_name, role, password_hash) VALUES ($1, $2, $3, 'L18 Owner', 'owner', 'x'), ($4, $2, $5, 'L18 Cashier', 'cashier', 'x')`, [
      ownerId,
      tenantId,
      owner.user.email,
      cashierId,
      cashier.user.email,
    ])

    setTestSession(owner as never)
    const empty = await get()
    check('nothing saved yet → printSetup null, owner can manage', empty.status === 200 && empty.body.printSetup === null && empty.body.canManage === true, empty.body)

    // the code word saved first must survive print setup saves
    await PUT_SETTINGS(req('/api/label-settings', { codeWord: 'MAKEPROFIT' }))

    const setup = {
      printer: { brand: 'tsc', language: 'tspl', dpi: 300, darkness: 10, speed: null, renderMode: 'exact' },
      media: { labelWidthMm: 38, labelHeightMm: 25, rowGapMm: 2, columns: 2, columnGapMm: 2, marginLeftMm: 1, offsetXMm: 0, offsetYMm: 0.5 },
      chrome: { pageSize: 'Label', sheetGapMm: 3, noGapSensing: false, rowGapMm: null, offsetYMm: 0 },
      layout: {
        templateId: 'preset-retail-38x25-barcode-2up',
        setupId: '38x25x2',
        source: 'quick',
        preset: 'standard',
        presets: { standard: { fields: { ...presetFields('standard'), showBarcodeText: false }, tweaks: { 'dyn-name': { dy: 0.5, font: 1 } } } },
        templateTweaks: {},
      },
    }
    const s1 = await put({ action: 'save', printSetup: setup })
    check('owner saves the setup (nulls in the body are fine) → 200', s1.status === 200 && s1.body.printSetup?.printer?.dpi === 300 && s1.body.printSetup?.printer?.speed === null && !s1.body.printSetup.locked, s1.body)
    const g1 = await get()
    check('GET returns it (other browser / after sign-out)', g1.body.printSetup?.layout?.presets?.standard?.tweaks?.['dyn-name']?.dy === 0.5 && g1.body.printSetup.layout.presets.standard.fields.showBarcodeText === false, g1.body)
    const settings1 = (await (await GET_SETTINGS()).json()) as J
    check('code word kept next to the print setup', settings1.codeWord === 'MAKEPROFIT' && settings1.printSetup?.printer?.brand === 'tsc', settings1)

    setTestSession(cashier as never)
    const c0 = await put({ action: 'save', printSetup: { ...setup, printer: { ...setup.printer, dpi: 203 } } })
    check('cashier cannot change the shop setup → 403', c0.status === 403, c0)
    const cg = await get()
    check('cashier reads the shop setup (canManage false)', cg.status === 200 && cg.body.canManage === false && cg.body.printSetup?.printer?.dpi === 300, cg.body)

    setTestSession(owner as never)
    const l1 = await put({ action: 'lock', printSetup: setup })
    check('owner locks → stamped with name and time', l1.status === 200 && l1.body.printSetup?.locked === true && l1.body.printSetup.lockedBy === 'L18 Owner' && !!l1.body.printSetup.lockedAt, l1.body)

    const o409 = await put({ action: 'save', printSetup: { ...setup, printer: { ...setup.printer, darkness: 20 } } })
    check('owner cannot save a change while locked → 409', o409.status === 409 && /unlock/i.test(o409.body.error || ''), o409)

    setTestSession(cashier as never)
    const c1 = await put({ action: 'save', printSetup: { ...setup, printer: { ...setup.printer, darkness: 20 } } })
    check('cashier cannot change a locked setup → 403', c1.status === 403, c1)
    const c2 = await put({ action: 'unlock' })
    check('cashier cannot unlock → 403', c2.status === 403, c2)

    const row = await pg.query(`SELECT value FROM settings WHERE tenant_id = $1 AND key = 'label_settings'`, [tenantId])
    const stored = JSON.parse(row.rows[0]?.value || '{}')
    check('stored row still locked with the locked values', stored.printSetup?.locked === true && stored.printSetup.printer.darkness === 10, stored.printSetup)

    // other label-settings writers keep the print setup
    setTestSession(owner as never)
    await PUT_SETTINGS(req('/api/label-settings', { codeWord: 'BLACKHORSE' }))
    const r = await PUT_ROLLS(req('/api/label-settings/sticker-setups', { stickerSetups: [] }))
    const after = (await get()).body
    check('code word / roll saves keep the locked print setup', r.status === 200 && after.printSetup?.locked === true && after.printSetup.printer.darkness === 10, after)

    const u = await put({ action: 'unlock' })
    check('owner unlocks → values kept, lock cleared', u.status === 200 && u.body.printSetup?.locked === false && u.body.printSetup.lockedBy === null && u.body.printSetup.printer.darkness === 10, u.body)
    const s2 = await put({ action: 'save', printSetup: { ...setup, printer: { ...setup.printer, darkness: 20 } } })
    check('after unlock the owner can change it', s2.status === 200 && s2.body.printSetup?.printer?.darkness === 20, s2.body)

    const bad = await put({ action: 'explode' })
    check('unknown action → 400', bad.status === 400, bad)
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
  const tables = (
    await pg.query(
      `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`
    )
  ).rows.map((r) => r.table_name as string)
  let pending = tables
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: string[] = []
    for (const t of pending) {
      try {
        await pg.query(`DELETE FROM "${t}" WHERE tenant_id = $1`, [tenantId])
      } catch {
        next.push(t)
      }
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
