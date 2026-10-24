/**
 * W6 offline selling integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_c2 DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/w6-offline.ts
 *
 * Covers: catalog delta sync (lib + route), tombstones written by DELETE /api/items/[id], stock
 * changes surfacing in the delta, tenant isolation, offline bundle, and offline sale ingestion
 * (price differences accepted + flagged, tax tolerance, stock shortfall, offlineRef replay/conflict).
 * Uses two throw-away tenants; prints PASS/FAIL per check and exits non-zero on failure.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenant } from '@/lib/db'
import { fetchItemSyncPage, decodeCursor, encodeCursor, InvalidCursorError, type ItemSyncPage } from '@/lib/inventory/item-sync'
import { GET as getItemSync } from '@/app/api/items/sync/route'
import { GET as getOfflineBundle } from '@/app/api/pos/offline-bundle/route'
import { DELETE as deleteItem } from '@/app/api/items/[id]/route'
import { POST as postSale } from '@/app/api/sales/route'
import { POST as postOfflineRejected } from '@/app/api/sales/offline-rejected/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string }

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}

function session(f: Fx, role = 'owner') {
  return {
    user: {
      id: f.userId, accountId: null, email: `${role}-${f.slug}@example.test`, name: 'Owner', role,
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'W6 offline', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
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

async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `w6${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'W6 offline', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  return f
}

async function cleanup(admin: Client, tenantId: string) {
  await new Promise((r) => setTimeout(r, 500))
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

/** Inserts n items (code prefix) updated an hour ago; every 3rd has branch stock. */
async function seedItems(admin: Client, f: Fx, n: number, prefix: string) {
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, barcode, cost_price, selling_price, track_stock, created_at, updated_at)
     SELECT gen_random_uuid(), $1, $2 || lpad(g::text, 6, '0'), 'Item ' || g, $3 || lpad(g::text, 8, '0'), 50, 100, true,
            now() - interval '2 hours', now() - interval '1 hour' - (g || ' milliseconds')::interval
     FROM generate_series(1, $4) g`,
    [f.tenantId, prefix, prefix === 'A-' ? '9' : '8', n])
  await admin.query(
    `INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock, updated_at)
     SELECT tenant_id, $2, id, 10, now() - interval '1 hour'
     FROM items WHERE tenant_id = $1 AND (substring(item_code from 3)::int % 3) = 0`,
    [f.tenantId, f.wh])
}

async function syncAll(tenantId: string, wh: string, cursor: string | null, limit: number) {
  const pages: ItemSyncPage[] = []
  let cur = cursor
  for (let i = 0; i < 50; i++) {
    const page = await withTenant(tenantId, (db) => fetchItemSyncPage(db, { tenantId, warehouseId: wh, cursor: cur, limit }))
    pages.push(page)
    cur = page.nextCursor
    if (!page.hasMore) break
  }
  return { pages, cursor: cur!, items: pages.flatMap((p) => p.items), deleted: pages.flatMap((p) => p.deleted) }
}

async function idOf(admin: Client, f: Fx, code: string): Promise<string> {
  return (await admin.query(`SELECT id FROM items WHERE tenant_id=$1 AND item_code=$2`, [f.tenantId, code])).rows[0].id
}

async function runSyncTests(admin: Client, A: Fx, B: Fx) {
  await seedItems(admin, A, 2500, 'A-')
  await seedItems(admin, B, 10, 'B-')
  // one inactive item in A (not part of a full snapshot)
  await admin.query(
    `INSERT INTO items (tenant_id, item_code, name, selling_price, is_active, updated_at) VALUES ($1, 'A-INACTIVE', 'Old', 1, false, now() - interval '3 hours')`,
    [A.tenantId])

  // ---- full snapshot paging
  const full = await syncAll(A.tenantId, A.wh, null, 1000)
  check('full snapshot: 3 pages of ≤1000', full.pages.length === 3 && full.pages[0].items.length === 1000 && full.pages[2].items.length === 500,
    full.pages.map((p) => p.items.length).join(','))
  check('full snapshot: hasMore true,true,false', full.pages.map((p) => p.hasMore).join() === 'true,true,false')
  check('full snapshot: flagged full', full.pages.every((p) => p.full))
  const ids = new Set(full.items.map((i) => i.id))
  check('full snapshot: 2500 distinct active items, no duplicates', ids.size === 2500 && full.items.length === 2500, `${ids.size}/${full.items.length}`)
  check('full snapshot: inactive item excluded', !full.items.some((i) => i.itemCode === 'A-INACTIVE'))
  check('full snapshot: never another tenant\'s item', !full.items.some((i) => i.itemCode.startsWith('B-')))
  const withStock = full.items.find((i) => i.itemCode === 'A-000003')
  const noStock = full.items.find((i) => i.itemCode === 'A-000001')
  check('full snapshot: availableStock for the warehouse', withStock?.availableStock === 10 && noStock?.availableStock === 0,
    `${withStock?.availableStock}/${noStock?.availableStock}`)
  check('item shape: code/barcode/price/tax/unit/flags', !!withStock && withStock.sellingPrice === '100.00' && withStock.barcode === '900000003'
    && withStock.unit === 'pcs' && withStock.isWeighable === false && withStock.trackStock === true && 'taxTemplateId' in withStock && !!withStock.updatedAt)
  check('final cursor switches to delta mode', decodeCursor(full.cursor).f === undefined)

  // ---- delta with no changes
  const none = await syncAll(A.tenantId, A.wh, full.cursor, 1000)
  check('delta without changes: empty', none.items.length === 0 && none.deleted.length === 0, `${none.items.length}/${none.deleted.length}`)

  // ---- changes: 3 price updates, 2 stock updates, 1 deactivation, 1 hard delete (route → tombstone)
  const priceIds = await Promise.all(['A-000010', 'A-000020', 'A-000030'].map((c) => idOf(admin, A, c)))
  await admin.query(`UPDATE items SET selling_price = 125 WHERE id = ANY($1::uuid[])`, [priceIds])
  const stockIds = await Promise.all(['A-000006', 'A-000009'].map((c) => idOf(admin, A, c)))
  await admin.query(`UPDATE warehouse_stock SET current_stock = 4 WHERE item_id = ANY($1::uuid[]) AND warehouse_id = $2`, [stockIds, A.wh])
  const deactivated = await idOf(admin, A, 'A-000040')
  await admin.query(`UPDATE items SET is_active = false WHERE id = $1`, [deactivated])
  const deletedId = await idOf(admin, A, 'A-000050')
  setTestSession(session(A))
  const del = await json(await deleteItem(req('DELETE', `/api/items/${deletedId}`), { params: Promise.resolve({ id: deletedId }) }))
  check('DELETE /api/items/[id] still works', del.status === 200, JSON.stringify(del.body))
  // Vendor delete = archive (recycle bin): the item stays, inactive; a tombstone only on purge
  const arch = await admin.query(`SELECT is_active FROM items WHERE tenant_id=$1 AND id=$2`, [A.tenantId, deletedId])
  check('DELETE archives the item (inactive, restorable)', arch.rows[0]?.is_active === false)
  // other tenant change must not leak
  await admin.query(`UPDATE items SET selling_price = 7 WHERE tenant_id = $1`, [B.tenantId])

  const delta = await syncAll(A.tenantId, A.wh, full.cursor, 1000)
  const got = new Set(delta.items.map((i) => i.id))
  const expected = new Set([...priceIds, ...stockIds, deactivated, deletedId])
  check('delta: exactly the changed items (price, stock, deactivated)', got.size === expected.size && [...expected].every((id) => got.has(id)),
    `${delta.items.map((i) => i.itemCode).join(',')}`)
  check('delta: new prices', delta.items.filter((i) => priceIds.includes(i.id)).every((i) => i.sellingPrice === '125.00'))
  check('delta: stock changes surface with new availableStock', delta.items.filter((i) => stockIds.includes(i.id)).every((i) => i.availableStock === 4))
  check('delta: deactivated item delivered as inactive', delta.items.find((i) => i.id === deactivated)?.isActive === false)
  check('delta: archived item delivered as inactive (devices drop it)', delta.items.find((i) => i.id === deletedId)?.isActive === false, JSON.stringify(delta.deleted))
  check('delta: no other tenant items', !delta.items.some((i) => i.itemCode.startsWith('B-')))

  // small pages still deliver everything once
  const paged = await syncAll(A.tenantId, A.wh, full.cursor, 2)
  check('delta paged (limit 2): same set, no duplicates', paged.items.length === expected.size && new Set(paged.items.map((i) => i.id)).size === expected.size,
    `${paged.items.length}`)

  // ---- isolation
  const crossA = await withTenant(B.tenantId, (db) => fetchItemSyncPage(db, { tenantId: A.tenantId, warehouseId: A.wh, limit: 2000 }))
  check('RLS: tenant B context cannot read tenant A items', crossA.items.length === 0)
  const bFull = await syncAll(B.tenantId, B.wh, null, 2000)
  check('tenant B snapshot: only its 10 items', bFull.items.length === 10 && bFull.items.every((i) => i.itemCode.startsWith('B-')))
  const bDelta = await syncAll(B.tenantId, B.wh, full.cursor, 2000)
  check('tenant B delta: never sees tenant A tombstones', !bDelta.deleted.includes(deletedId))

  // ---- cursor validation
  let invalid = false
  try { decodeCursor('not-a-cursor') } catch (e) { invalid = e instanceof InvalidCursorError }
  check('invalid cursor rejected', invalid)
  const bad = encodeCursor({ t: "2026-01-01 00:00:00'; DROP TABLE items; --", i: randomUUID() })
  let invalid2 = false
  try { decodeCursor(bad) } catch (e) { invalid2 = e instanceof InvalidCursorError }
  check('cursor with injected timestamp rejected', invalid2)

  // ---- route
  setTestSession(session(A, 'cashier'))
  const r1 = await json(await getItemSync(req('GET', `/api/items/sync?warehouseId=${A.wh}&limit=2000`)))
  check('GET /api/items/sync (cashier): 200, 2000 items, hasMore', r1.status === 200 && r1.body.items.length === 2000 && r1.body.hasMore === true && !!r1.body.nextCursor,
    `${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`)
  const r2 = await json(await getItemSync(req('GET', `/api/items/sync?cursor=${encodeURIComponent(r1.body.nextCursor)}&warehouseId=${A.wh}&limit=2000`)))
  check('GET /api/items/sync page 2: rest of the snapshot', r2.status === 200 && r2.body.items.length === 498 && r2.body.hasMore === false, `${r2.status} ${r2.body.items?.length}`)
  const r3 = await json(await getItemSync(req('GET', `/api/items/sync?limit=5000`)))
  check('GET /api/items/sync limit > 2000 → 400', r3.status === 400)
  const r4 = await json(await getItemSync(req('GET', `/api/items/sync?cursor=garbage`)))
  check('GET /api/items/sync bad cursor → 400 INVALID_CURSOR', r4.status === 400 && r4.body.code === 'INVALID_CURSOR')
  setTestSession(session(A, 'stock_manager'))
  const r5 = await json(await getItemSync(req('GET', `/api/items/sync`)))
  check('GET /api/items/sync without createSales/managePOS → 403', r5.status === 403, String(r5.status))
}

async function runBundleTests(admin: Client, A: Fx) {
  const tt = randomUUID()
  await admin.query(`INSERT INTO tax_templates (id, tenant_id, name) VALUES ($1, $2, 'VAT 18')`, [tt, A.tenantId])
  await admin.query(`INSERT INTO tax_template_items (tenant_id, tax_template_id, tax_name, rate, included_in_price) VALUES ($1, $2, 'VAT', 18, false)`, [A.tenantId, tt])
  await admin.query(`UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb) || '{"scaleBarcode":{"enabled":true,"prefixes":["21"]}}'::jsonb WHERE id = $1`, [A.tenantId])
  await admin.query(`INSERT INTO categories (tenant_id, name) VALUES ($1, 'Grocery')`, [A.tenantId])
  setTestSession(session(A, 'cashier'))
  const r = await json(await getOfflineBundle())
  check('GET /api/pos/offline-bundle (cashier): 200', r.status === 200, JSON.stringify(r.body).slice(0, 300))
  const t = (r.body.taxTemplates || []).find((x: J) => x.id === tt)
  check('bundle: tax templates in mobile shape', !!t && t.items.length === 1 && t.items[0].taxName === 'VAT' && Number(t.items[0].rate) === 18 && t.items[0].includedInPrice === false)
  check('bundle: accountingSettings + scaleBarcode + categories + serverTime',
    'defaultTaxTemplateId' in (r.body.accountingSettings || {}) && r.body.scaleBarcode?.enabled === true && r.body.scaleBarcode?.prefixes?.[0] === '21'
    && r.body.categories?.some((c: J) => c.name === 'Grocery') && !!r.body.serverTime && r.body.shift === null)
  return tt
}

async function runSaleTests(admin: Client, A: Fx, taxTemplateId: string) {
  setTestSession(session(A))
  const mk = async (code: string, price: number, stock: number, tax?: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, tax_template_id) VALUES ($1,$2,$3,$4,10,$5,true,$6)`,
      [id, A.tenantId, code, `Sale ${code}`, price, tax || null])
    await admin.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1,$2,$3,$4)`, [A.tenantId, A.wh, id, stock])
    return id
  }
  const P = await mk('S-PRICE', 120, 50) // catalog now 120; the phone sold at cached 100
  const T = await mk('S-TAX', 100, 50, taxTemplateId)
  const S = await mk('S-SHORT', 30, 1)

  const sale = (lines: Array<{ itemId: string; quantity: number; unitPrice: number }>, extra: Record<string, unknown>) => {
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
    const tax = Number(extra.tax || 0)
    const total = subtotal + tax
    return postSale(req('POST', '/api/sales', {
      cartItems: lines.map((l) => ({ ...l, name: 'x', discount: 0 })),
      paymentMethod: 'cash', subtotal, discount: 0, tax, total, amountPaid: total, creditAmount: 0, warehouseId: A.wh,
      ...extra,
    })).then(json)
  }

  // price difference accepted + flagged
  const cs1 = randomUUID()
  const s1 = await sale([{ itemId: P, quantity: 2, unitPrice: 100 }], { offlineRef: 'OFF-TEST-00001', clientSaleId: cs1 })
  check('offline sale at old price: accepted', s1.status === 200, JSON.stringify(s1.body).slice(0, 300))
  const f1 = (await admin.query(`SELECT flags, total FROM sales WHERE id=$1`, [s1.body.id])).rows[0]?.flags
  check('offline sale: flags.offline + priceDifferences {sold 100, catalog 120}',
    f1?.offline === true && f1?.priceDifferences?.length === 1 && f1.priceDifferences[0].itemId === P && f1.priceDifferences[0].sold === 100 && f1.priceDifferences[0].catalog === 120,
    JSON.stringify(f1))
  // replay: same clientSaleId / same offlineRef → same sale
  const s1b = await sale([{ itemId: P, quantity: 2, unitPrice: 100 }], { offlineRef: 'OFF-TEST-00001', clientSaleId: cs1 })
  check('replay with same clientSaleId+offlineRef returns the same sale', s1b.status === 200 && s1b.body.id === s1.body.id)
  const s1c = await sale([{ itemId: P, quantity: 2, unitPrice: 100 }], { offlineRef: 'OFF-TEST-00001' })
  check('replay with same offlineRef (no clientSaleId) returns the same sale', s1c.status === 200 && s1c.body.id === s1.body.id)
  const s1d = await sale([{ itemId: P, quantity: 1, unitPrice: 100 }], { offlineRef: 'OFF-TEST-00001', clientSaleId: randomUUID() })
  check('same offlineRef from a different sale → 409 OFFLINE_REF_CONFLICT', s1d.status === 409 && s1d.body.code === 'OFFLINE_REF_CONFLICT', JSON.stringify(s1d.body))
  const count = (await admin.query(`SELECT count(*)::int AS n FROM sales WHERE tenant_id=$1 AND offline_ref='OFF-TEST-00001'`, [A.tenantId])).rows[0].n
  check('only one sale stored for the offlineRef', count === 1)
  const stockP = Number((await admin.query(`SELECT current_stock FROM warehouse_stock WHERE item_id=$1`, [P])).rows[0].current_stock)
  check('replays did not double-decrement stock', stockP === 48, String(stockP))

  // online sale behaviour unchanged: no flags
  const s2 = await sale([{ itemId: P, quantity: 1, unitPrice: 120 }], { clientSaleId: randomUUID() })
  const f2 = (await admin.query(`SELECT flags FROM sales WHERE id=$1`, [s2.body.id])).rows[0]?.flags
  check('online sale: accepted, flags empty', s2.status === 200 && f2 && Object.keys(f2).length === 0, JSON.stringify(f2))

  // tax: server says 18.00 (VAT 18% of 100); device sends 18.60 with its breakdown (≤ 1.00)
  const s3 = await sale([{ itemId: T, quantity: 1, unitPrice: 100 }], {
    offlineRef: 'OFF-TEST-00002', clientSaleId: randomUUID(), tax: 18.6,
    taxBreakdown: [{ taxName: 'VAT', rate: 18, amount: 18.6, accountId: null, includedInPrice: false }],
  })
  const f3 = (await admin.query(`SELECT flags, tax_amount FROM sales WHERE id=$1`, [s3.body.id])).rows[0]
  check('offline sale with tax difference 0.60: accepted', s3.status === 200, JSON.stringify(s3.body).slice(0, 300))
  check('flags.taxDifference recorded (client 18.6 / server 18 / within tolerance)',
    f3?.flags?.taxDifference?.client === 18.6 && f3?.flags?.taxDifference?.server === 18 && f3?.flags?.taxDifference?.withinTolerance === true && Number(f3.tax_amount) === 18.6,
    JSON.stringify(f3))
  // offline sale from an old app without breakdown: 0.80 off → still accepted
  const s4 = await sale([{ itemId: T, quantity: 1, unitPrice: 100 }], { offlineRef: 'OFF-TEST-00003', clientSaleId: randomUUID(), tax: 18.8 })
  check('offline sale without breakdown, tax off by 0.80: accepted + flagged', s4.status === 200
    && (await admin.query(`SELECT flags FROM sales WHERE id=$1`, [s4.body.id])).rows[0]?.flags?.taxDifference?.withinTolerance === true, JSON.stringify(s4.body).slice(0, 200))
  // online sale without breakdown and a 0.80 mismatch is still rejected (existing behaviour)
  const s5 = await sale([{ itemId: T, quantity: 1, unitPrice: 100 }], { clientSaleId: randomUUID(), tax: 18.8 })
  check('online sale with tax mismatch still rejected (400)', s5.status === 400 && /Tax calculation mismatch/.test(String(s5.body.error)), JSON.stringify(s5.body))
  // inconsistent offline payload (breakdown 10 vs tax 18) is a bug, not rounding → 400
  const s6 = await sale([{ itemId: T, quantity: 1, unitPrice: 100 }], {
    offlineRef: 'OFF-TEST-00004', clientSaleId: randomUUID(), tax: 18,
    taxBreakdown: [{ taxName: 'VAT', rate: 18, amount: 10, accountId: null, includedInPrice: false }],
  })
  check('offline sale whose breakdown disagrees with its own tax by >1 → 400', s6.status === 400)

  // stock shortfall: goods already left during the outage
  const s7 = await sale([{ itemId: S, quantity: 3, unitPrice: 30 }], { offlineRef: 'OFF-TEST-00005', clientSaleId: randomUUID() })
  const f7 = (await admin.query(`SELECT flags FROM sales WHERE id=$1`, [s7.body.id])).rows[0]?.flags
  const stockS = Number((await admin.query(`SELECT current_stock FROM warehouse_stock WHERE item_id=$1`, [S])).rows[0].current_stock)
  check('offline sale beyond stock: accepted, stock goes negative, flags.stockShortfall',
    s7.status === 200 && stockS === -2 && f7?.stockShortfall?.[0]?.itemId === S, `${s7.status} ${stockS} ${JSON.stringify(f7)}`)
  const s8 = await sale([{ itemId: S, quantity: 1, unitPrice: 30 }], { clientSaleId: randomUUID() })
  check('online sale beyond stock still rejected', s8.status === 400 && /Insufficient stock/i.test(String(s8.body.error)))

  // lookup by the printed offline receipt number still works
  const { GET: lookup } = await import('@/app/api/sales/lookup/route')
  const lk = await json(await lookup(req('GET', '/api/sales/lookup?code=OFF-TEST-00001')))
  check('GET /api/sales/lookup?code=OFF-… finds the synced sale', lk.status === 200 && JSON.stringify(lk.body).includes(String(s1.body.id)), `${lk.status}`)

  // offline-rejected report
  const rj = await json(await postOfflineRejected(req('POST', '/api/sales/offline-rejected', {
    clientSaleId: randomUUID(), offlineRef: 'OFF-TEST-00099', error: 'Invalid items in cart', status: 400, summary: { total: 250, itemCount: 2 },
  })))
  check('POST /api/sales/offline-rejected records it', rj.status === 200 && rj.body.recorded === true, JSON.stringify(rj.body))
  await new Promise((r) => setTimeout(r, 300))
  const act = await admin.query(`SELECT count(*)::int AS n FROM activity_logs WHERE tenant_id=$1 AND entity_name='OFF-TEST-00099'`, [A.tenantId])
  check('offline-rejected writes an activity log', act.rows[0].n === 1)
  const rj2 = await json(await postOfflineRejected(req('POST', '/api/sales/offline-rejected', { clientSaleId: cs1, offlineRef: 'OFF-TEST-00001', error: 'x' })))
  check('offline-rejected for a sale that exists → recorded:false + sale', rj2.status === 200 && rj2.body.recorded === false && rj2.body.sale?.id === s1.body.id)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { return await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)); return undefined }
  }
  try {
    console.log('— catalog sync —')
    await step('sync tests', () => runSyncTests(admin, A, B))
    console.log('— offline bundle —')
    const tt = await step('bundle tests', () => runBundleTests(admin, A)) as string | undefined
    console.log('— offline sale ingestion —')
    if (tt) await step('sale tests', () => runSaleTests(admin, A, tt))
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await cleanup(admin, A.tenantId)
      await cleanup(admin, B.tenantId)
    }
    await admin.end()
  }
  await closeAllPools()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
