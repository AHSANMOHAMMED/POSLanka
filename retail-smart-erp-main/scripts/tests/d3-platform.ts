/**
 * D3 platform polish integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_d3 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/d3-platform.ts
 *
 * Covers:
 *   - per-tenant hiding of shared system defaults (vehicle types / inspection templates):
 *     hidden row excluded from lists, listed with `hidden: true` on ?includeHidden=true,
 *     restorable, other tenant unaffected, the global row itself never modified;
 *   - notify()/deliverAlert emits a per-user `inbox-notification` WebSocket event (stubbed);
 *   - 100k-row CSV parses + validates (validateImport, no writes) within time/memory bounds,
 *     the row cap and the XLSX streaming reader;
 *   - import preview warns about vehicle makes/models that will be auto-created.
 * Prints PASS/FAIL per check and exits non-zero on failure. Throw-away data is removed at the
 * end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenant } from '@/lib/db'
import { deliverAlert } from '@/lib/notifications/notify'
import type { AccountBroadcastMessage } from '@/lib/websocket/broadcast'
import { getEntityConfig } from '@/lib/import-export/entity-config'
import { mapColumns, parseCsv, parseXlsx, MAX_IMPORT_ROWS } from '@/lib/import-export/import-utils'
import { validateImport } from '@/lib/import-export/import-validate'
import { GET as listVehicleTypes } from '@/app/api/vehicle-types/route'
import { PATCH as patchVehicleType, PUT as putVehicleType } from '@/app/api/vehicle-types/[id]/route'
import { GET as listTemplates } from '@/app/api/inspection-templates/route'
import { PATCH as patchTemplate } from '@/app/api/inspection-templates/[id]/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? `${err.message}\n${err.stack}` : String(err)) }
}

// ---------------------------------------------------------------- broadcaster stub
const accountEvents: AccountBroadcastMessage[] = []
globalThis.__accountBroadcastProcessor = (msg) => { accountEvents.push(msg) }
globalThis.__broadcastProcessor = () => undefined // tenant broadcasts (logAndBroadcast) are not under test

interface Fx { tenantId: string; slug: string; userId: string }

async function makeTenant(admin: Client, label: string, businessType = 'auto_service'): Promise<Fx> {
  const tenantId = randomUUID()
  const userId = randomUUID()
  const slug = `d3t-${label}-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, `D3 test ${label}`, slug, `${slug}@example.test`, businessType])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, 'owner')`,
    [userId, tenantId, `owner-${slug}@example.test`, `Owner ${label}`])
  return { tenantId, slug, userId }
}

function session(f: Fx, businessType = 'auto_service') {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'D3', businessType,
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}

function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  if (!/@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i.test(url)) {
    throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  }
  const admin = new Client({ connectionString: url })
  await admin.connect()

  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')
  const sysTypeId = randomUUID()
  const sysTemplateId = randomUUID()
  const makeName = `D3Make${randomUUID().slice(0, 6)}`
  const knownMake = `D3Known${randomUUID().slice(0, 6)}`
  const knownMakeId = randomUUID()
  await admin.query(`INSERT INTO vehicle_types (id, tenant_id, name, body_type, wheel_count, is_system_default, is_active)
    VALUES ($1, NULL, $2, 'sedan', 4, true, true)`, [sysTypeId, `D3 System Sedan ${sysTypeId.slice(0, 6)}`])
  await admin.query(`INSERT INTO inspection_templates (id, tenant_id, vehicle_type_id, name, inspection_type, is_default, is_active)
    VALUES ($1, NULL, $2, $3, 'check_in', true, true)`, [sysTemplateId, sysTypeId, `D3 System Template ${sysTemplateId.slice(0, 6)}`])
  await admin.query(`INSERT INTO vehicle_makes (id, name) VALUES ($1, $2)`, [knownMakeId, knownMake])
  await admin.query(`INSERT INTO vehicle_models (make_id, name) VALUES ($1, 'Alpha')`, [knownMakeId])

  try {
    // ============================================================ hidden defaults
    await step('vehicle types: hide / list / restore', async () => {
      setTestSession(session(A))
      const ids = async (f: Fx, qs = '') => {
        setTestSession(session(f))
        const r = await json(await listVehicleTypes(req('GET', `/api/vehicle-types${qs}`)))
        return r.body as unknown as J[]
      }
      check('A sees system type before hiding', (await ids(A)).some((t) => t.id === sysTypeId))

      setTestSession(session(A))
      const hide = await json(await patchVehicleType(req('PATCH', `/api/vehicle-types/${sysTypeId}`, { isActive: false }), ctx(sysTypeId)))
      check('PATCH {isActive:false} on system type → 200 hidden', hide.status === 200 && hide.body.hidden === true, `status=${hide.status}`)

      const listA = await ids(A)
      check('hidden system type excluded from A list', !listA.some((t) => t.id === sysTypeId))
      const listAHidden = await ids(A, '?includeHidden=true')
      const row = listAHidden.find((t) => t.id === sysTypeId)
      check('?includeHidden=true returns it with hidden: true', !!row && row.hidden === true)
      check('other rows flagged hidden: false', listAHidden.filter((t) => t.id !== sysTypeId).every((t) => t.hidden === false))
      check('tenant B unaffected', (await ids(B)).some((t) => t.id === sysTypeId && t.hidden === false))

      const g = await admin.query(`SELECT is_active, name FROM vehicle_types WHERE id = $1`, [sysTypeId])
      check('global row still active (not modified)', g.rows[0]?.is_active === true)

      setTestSession(session(A))
      const rename = await json(await patchVehicleType(req('PATCH', `/api/vehicle-types/${sysTypeId}`, { name: 'Hacked' }), ctx(sysTypeId)))
      check('PATCH {name} on system type → 403', rename.status === 403)
      const mixed = await json(await putVehicleType(req('PUT', `/api/vehicle-types/${sysTypeId}`, { isActive: true, wheelCount: 6 }), ctx(sysTypeId)))
      check('PUT {isActive, wheelCount} on system type → 403', mixed.status === 403)
      const g2 = await admin.query(`SELECT name, wheel_count FROM vehicle_types WHERE id = $1`, [sysTypeId])
      check('global row name/wheels unchanged', g2.rows[0]?.name !== 'Hacked' && g2.rows[0]?.wheel_count === 4)

      // RLS: tenant code cannot write the global row directly either
      const updated = await withTenant(A.tenantId, async (tdb) => {
        const r = await tdb.execute(sql`UPDATE vehicle_types SET is_active = false WHERE id = ${sysTypeId} RETURNING id`)
        return (r as unknown as { rows: unknown[] }).rows.length
      }).catch(() => -1)
      check('RLS: tenant UPDATE of global row affects 0 rows / is refused', updated <= 0, `affected=${updated}`)

      // tenant B cannot see A's override row
      const seenByB = await withTenant(B.tenantId, async (tdb) => {
        const r = await tdb.execute(sql`SELECT count(*)::int AS n FROM tenant_hidden_defaults`)
        return Number((r as unknown as { rows: Array<{ n: number }> }).rows[0].n)
      })
      check('RLS: tenant B sees none of A\'s overrides', seenByB === 0)

      setTestSession(session(A))
      const show = await json(await patchVehicleType(req('PATCH', `/api/vehicle-types/${sysTypeId}`, { isActive: true }), ctx(sysTypeId)))
      check('PATCH {isActive:true} restores', show.status === 200 && show.body.hidden === false)
      check('restored type listed for A again', (await ids(A)).some((t) => t.id === sysTypeId))
      const left = await admin.query(`SELECT 1 FROM tenant_hidden_defaults WHERE tenant_id = $1`, [A.tenantId])
      check('override row removed', left.rowCount === 0)

      // own (tenant) rows keep the normal deactivate behaviour through PATCH
      const ownId = randomUUID()
      await admin.query(`INSERT INTO vehicle_types (id, tenant_id, name, body_type, is_system_default) VALUES ($1, $2, 'D3 own', 'van', false)`, [ownId, A.tenantId])
      setTestSession(session(A))
      const own = await json(await patchVehicleType(req('PATCH', `/api/vehicle-types/${ownId}`, { isActive: false }), ctx(ownId)))
      check('PATCH on own type deactivates it (is_active=false)', own.status === 200 && own.body.isActive === false)
    })

    await step('inspection templates: hide / list / restore', async () => {
      const list = async (f: Fx, qs = '') => {
        setTestSession(session(f))
        return (await json(await listTemplates(req('GET', `/api/inspection-templates${qs}`)))).body as unknown as J[]
      }
      setTestSession(session(A))
      const hide = await json(await patchTemplate(req('PATCH', `/api/inspection-templates/${sysTemplateId}`, { isActive: false }), ctx(sysTemplateId)))
      check('template: hide → 200', hide.status === 200 && hide.body.hidden === true, `status=${hide.status}`)
      check('template: excluded from A list', !(await list(A)).some((t) => t.id === sysTemplateId))
      check('template: includeHidden flags it', (await list(A, '?includeHidden=true')).some((t) => t.id === sysTemplateId && t.hidden === true))
      check('template: B unaffected', (await list(B)).some((t) => t.id === sysTemplateId))
      setTestSession(session(A))
      const bad = await json(await patchTemplate(req('PATCH', `/api/inspection-templates/${sysTemplateId}`, { name: 'x' }), ctx(sysTemplateId)))
      check('template: rename system template → 403', bad.status === 403)
      const g = await admin.query(`SELECT is_active, name FROM inspection_templates WHERE id = $1`, [sysTemplateId])
      check('template: global row unchanged', g.rows[0]?.is_active === true && g.rows[0]?.name !== 'x')
      setTestSession(session(A))
      const show = await json(await patchTemplate(req('PATCH', `/api/inspection-templates/${sysTemplateId}`, { isActive: true }), ctx(sysTemplateId)))
      check('template: restore → listed again', show.status === 200 && (await list(A)).some((t) => t.id === sysTemplateId))
    })

    // ============================================================ realtime inbox
    await step('notify emits per-user inbox event', async () => {
      accountEvents.length = 0
      const out = await deliverAlert(A.tenantId, 'low_stock', { title: 'D3 test alert', body: 'x', userIds: [A.userId] })
      check('in-app row written for the user', out.inApp.includes(A.userId))
      const ev = accountEvents.filter((e) => e.entityType === 'inbox-notification')
      const row = await admin.query(`SELECT id FROM in_app_notifications WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`, [A.tenantId, A.userId])
      check('one inbox-notification event, addressed to that user', ev.length === 1 && ev[0].userId === A.userId && ev[0].action === 'created', JSON.stringify(ev))
      check('event id = inserted notification id; carries tenantId', ev[0]?.id === row.rows[0]?.id && ev[0]?.data?.tenantId === A.tenantId)

      accountEvents.length = 0
      await deliverAlert(A.tenantId, 'low_stock', { title: 'nobody', body: '', userIds: [randomUUID()] })
      check('no recipients → no event', accountEvents.length === 0)
    })

    // ============================================================ import limits
    const items = getEntityConfig('items')!
    await step('100k-row CSV validates', async () => {
      const N = MAX_IMPORT_ROWS
      const parts: string[] = ['Name,SKU,Selling Price,Cost Price,Unit']
      for (let i = 0; i < N; i++) parts.push(`D3 Item ${i},D3SKU-${i},${(i % 500) + 10}.50,${(i % 500) + 5},pcs`)
      const csv = parts.join('\n')
      if (global.gc) global.gc()
      const heap0 = process.memoryUsage().heapUsed
      const t0 = Date.now()
      const rows = parseCsv(csv)
      const tParse = Date.now() - t0
      check('parsed 100,000 rows', rows.length === N, `rows=${rows.length} in ${tParse}ms`)
      const mapping = mapColumns(Object.keys(rows[0]), items, 'retail')
      const t1 = Date.now()
      const v = await withTenant(A.tenantId, (db) => validateImport(db, {
        tenantId: A.tenantId, entityConfig: items, rawRows: rows, columnMapping: mapping, mode: 'insert', businessType: 'retail',
      }))
      const tValidate = Date.now() - t1
      const heapMb = (process.memoryUsage().heapUsed - heap0) / 1024 / 1024
      check('validated 100,000 rows, all inserts', v.counts.total === N && v.counts.insert === N && v.counts.error === 0,
        JSON.stringify(v.counts))
      check('no row-cap warning at exactly 100,000', !v.warnings.some((w) => w.row === 0))
      check('parse+validate under 60s', tParse + tValidate < 60_000, `parse=${tParse}ms validate=${tValidate}ms`)
      check('heap growth under 1.5 GB', heapMb < 1536, `~${heapMb.toFixed(0)} MB`)

      // cap: rows beyond the limit are not kept, validation warns
      const over = parseCsv(csv + '\nExtra 1,EX-1,1,1,pcs\nExtra 2,EX-2,1,1,pcs\nExtra 3,EX-3,1,1,pcs')
      check('parser keeps at most limit + 1 rows', over.length === N + 1, `rows=${over.length}`)
      const capped = await withTenant(A.tenantId, (db) => validateImport(db, {
        tenantId: A.tenantId, entityConfig: items, rawRows: over, columnMapping: mapping, mode: 'insert', businessType: 'retail',
      }))
      check('over-limit file: 100,000 processed + warning', capped.counts.total === N && capped.warnings.some((w) => w.row === 0 && /100,000/.test(w.message)))
    })

    await step('XLSX streaming reader', async () => {
      const mod = await import('exceljs')
      const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Items')
      ws.addRow(['Name *', 'SKU', 'Selling Price', 'Expiry'])
      ws.addRow(['Required', 'Unique', 'Number', 'YYYY-MM-DD'])
      ws.addRow(['Rich', { richText: [{ text: 'R' }, { text: '-1' }] }, 12.5, new Date(Date.UTC(2026, 0, 15))])
      ws.addRow([])
      ws.addRow(['Formula', 'F-1', { formula: '1+2', result: 3 }, null])
      const buf = await wb.xlsx.writeBuffer()
      // exceljs types writeBuffer() as its own Buffer (an ArrayBuffer); copy the bytes into a
      // fresh ArrayBuffer without casting between Buffer / ArrayBuffer types
      const bytes = Uint8Array.from(new Uint8Array(buf))
      const ab: ArrayBuffer = bytes.buffer
      const rows = await parseXlsx(ab)
      check('xlsx: header marker stripped, instruction + empty rows skipped', rows.length === 2 && 'Name' in rows[0], JSON.stringify(rows))
      check('xlsx: rich text / date / formula result converted',
        rows[0]?.SKU === 'R-1' && rows[0]?.Expiry === '2026-01-15' && rows[1]?.['Selling Price'] === '3', JSON.stringify(rows))
      const capped = await parseXlsx(ab, 1)
      check('xlsx: row cap honoured', capped.length === 2)
    })

    // ============================================================ preview: makes/models
    await step('preview warns about auto-created makes/models', async () => {
      const csv = [
        'Name,Selling Price,Compatible Models,Compatible Make,Compatible Model',
        `Brake pad,100,${makeName} Corolla 2010-2015; ${knownMake} Alpha,,`,
        `Filter,50,${makeName} Corolla,,`,
        `Wiper,20,,${knownMake},Beta`,
      ].join('\n')
      const rows = parseCsv(csv)
      const mapping = mapColumns(Object.keys(rows[0]), items, 'auto_service')
      const v = await withTenant(A.tenantId, (db) => validateImport(db, {
        tenantId: A.tenantId, entityConfig: items, rawRows: rows, columnMapping: mapping, mode: 'insert', businessType: 'auto_service',
      }))
      const msgs = v.warnings.map((w) => w.message)
      check('warns new make once', msgs.filter((m) => m.includes(`Make "${makeName}" not found`)).length === 1, JSON.stringify(msgs))
      check('warns new model once', msgs.filter((m) => m.includes(`Model "${makeName} Corolla" not found`)).length === 1)
      check('no warning for existing make/model', !msgs.some((m) => m.includes(`"${knownMake}"`) || m.includes(`${knownMake} Alpha`)))
      check('warns new model of an existing make (separate columns)', msgs.some((m) => m.includes(`Model "${knownMake} Beta" not found`)))
      check('warnings attached to the row', v.rows[0].warnings.some((w) => w.includes(makeName)))
      check('preview rows still valid inserts', v.counts.insert === 3 && v.counts.error === 0, JSON.stringify(v.counts))
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await admin.query(`DELETE FROM inspection_templates WHERE id = $1`, [sysTemplateId]).catch(() => undefined)
      await admin.query(`DELETE FROM tenant_hidden_defaults WHERE tenant_id = ANY($1)`, [[A.tenantId, B.tenantId]]).catch(() => undefined)
      await admin.query(`SET session_replication_role = replica`)
      const tables = await admin.query(`SELECT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='tenant_id' AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public')`)
      for (const t of [A, B]) {
        for (const { table_name } of tables.rows) {
          await admin.query(`DELETE FROM "${table_name}" WHERE tenant_id=$1`, [t.tenantId]).catch(() => undefined)
        }
        await admin.query(`DELETE FROM tenants WHERE id = $1`, [t.tenantId]).catch((e) => console.warn('cleanup tenant:', e.message))
      }
      await admin.query(`SET session_replication_role = origin`)
      await admin.query(`DELETE FROM vehicle_types WHERE id = $1`, [sysTypeId]).catch(() => undefined)
      await admin.query(`DELETE FROM vehicle_models WHERE make_id = $1`, [knownMakeId]).catch(() => undefined)
      await admin.query(`DELETE FROM vehicle_makes WHERE id = $1`, [knownMakeId]).catch(() => undefined)
    }
    await admin.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
