/**
 * W3 stock intake integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w3 \
 *   DATABASE_APP_ROLE=app_user npx tsx scripts/tests/w3-intake.ts
 *
 * Creates throw-away tenants (as the connecting superuser), runs every check
 * through the RLS-enforced tenant helpers, prints PASS/FAIL per check and exits
 * non-zero on any failure. Test tenants are removed unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { sql } from 'drizzle-orm'
import { withTenant, withTenantTransaction, closeAllPools } from '@/lib/db'
import { createItem } from '@/lib/inventory/create-item'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import {
  addIntakeLines, createIntakeBatch, getIntakeBatchDetail, IntakeError, loadIntakeBatch,
  updateIntakeBatch, updateIntakeLine, validateIntakeBatch, type IntakeLineInput,
} from '@/lib/inventory/stock-intake'
import { syncIntakeBatch } from '@/lib/inventory/stock-intake-sync'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    check(name, false, err instanceof Error ? `${err.message}\n${err.stack}` : String(err))
  }
}

interface Fixture { tenantId: string; warehouseId: string; userId: string }

async function makeTenant(admin: Client, label: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const warehouseId = randomUUID()
  const userId = randomUUID()
  const slug = `w3t-${label}-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)`,
    [tenantId, `W3 test ${label}`, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`,
    [warehouseId, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Kamal Silva', 'owner')`,
    [userId, tenantId, `owner-${slug}@example.test`])
  return { tenantId, warehouseId, userId }
}

async function stockOf(admin: Client, f: Fixture, itemId: string): Promise<number> {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.warehouseId, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}

async function newItem(f: Fixture, name: string, extra: Record<string, unknown> = {}, opening = 0) {
  return withTenantTransaction(f.tenantId, async (tx) => {
    const { item } = await createItem(tx, {
      tenantId: f.tenantId, userId: f.userId, source: 'manual',
      data: { name, sellingPrice: '100', costPrice: '50', ...extra },
      openingStock: opening ? [{ warehouseId: f.warehouseId, qty: opening }] : undefined,
    })
    return item
  })
}

const mkBatch = (f: Fixture, extra: Partial<Parameters<typeof createIntakeBatch>[1]> = {}) =>
  withTenant(f.tenantId, (db) => createIntakeBatch(db, { tenantId: f.tenantId, userId: f.userId, warehouseId: f.warehouseId, ...extra }))
const add = (f: Fixture, batchId: string, lines: IntakeLineInput[]) =>
  withTenant(f.tenantId, (db) => addIntakeLines(db, { tenantId: f.tenantId, userId: f.userId, batchId, lines }))
const sync = (f: Fixture, batchId: string, key?: string) =>
  syncIntakeBatch({ tenantId: f.tenantId, userId: f.userId, batchId, idempotencyKey: key })

async function movementsFor(admin: Client, batchId: string): Promise<number> {
  const r = await admin.query(`SELECT count(*)::int AS n FROM stock_movements WHERE reference_type='stock_intake' AND reference_id=$1`, [batchId])
  return r.rows[0].n
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()

  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')

  try {
    // fixtures: 8 existing items with barcodes, 5 in stock each
    const existing = [] as Awaited<ReturnType<typeof newItem>>[]
    for (let i = 0; i < 8; i++) {
      existing.push(await newItem(A, `Existing ${i}`, { barcode: `47900000000${String(i).padStart(2, '0')}`, sku: `EX-${i}` }, 5))
    }

    let mainBatchId = ''
    let invalidLineId = ''

    await step('create batch', async () => {
      const clientBatchId = randomUUID()
      const r1 = await mkBatch(A, { clientBatchId, notes: 'Delivery 1', source: 'mobile' })
      const r2 = await mkBatch(A, { clientBatchId })
      mainBatchId = r1.batch.id
      check('create batch: INT-000001 number', r1.created && /^INT-\d{6}$/.test(r1.batch.batchNo), r1.batch.batchNo)
      check('create batch: repeat clientBatchId returns the same batch', !r2.created && r2.batch.id === r1.batch.id)
      check('create batch: source mobile recorded', r1.batch.source === 'mobile')
    })

    await step('add lines', async () => {
      const lines: IntakeLineInput[] = existing.map((it, i) => ({ clientLineId: randomUUID(), mode: 'receive', barcode: it.barcode, quantity: i + 1 }))
      lines.push({ clientLineId: randomUUID(), mode: 'receive', barcode: existing[0].barcode, quantity: 2 }) // duplicate → merge
      lines.push({ clientLineId: randomUUID(), mode: 'receive', sku: 'NEW-SKU-1', quantity: 7, name: 'Brand new soap', sellingPrice: 120, costPrice: 80 })
      lines.push({ clientLineId: randomUUID(), mode: 'receive', barcode: '4791111111111', quantity: 4 }) // new without name
      const r = await add(A, mainBatchId, lines)
      const detail = await withTenant(A.tenantId, (db) => getIntakeBatchDetail(db, A.tenantId, mainBatchId))
      check('add lines: 11 input lines → 10 stored (duplicate barcode merged)', detail.lines.length === 10, `stored=${detail.lines.length}`)
      const merged = detail.lines.find((l) => l.barcode === existing[0].barcode)
      check('add lines: merged line quantity 1 + 2 = 3', merged !== undefined && Number(merged.quantity) === 3, merged?.quantity)
      check('add lines: outcome says merged', r.outcomes[8].action === 'merged')
      check('add lines: preview shows matched item + current stock',
        merged?.match.status === 'matched' && merged.match.item?.id === existing[0].id && merged.match.item?.currentStock === 5)
      const invalid = detail.lines.find((l) => l.barcode === '4791111111111')
      invalidLineId = invalid?.id || ''
      check('add lines: new item without name warned', !!invalid && invalid.match.status === 'new' && invalid.warnings.some((w) => /name/.test(w)))
      check('add lines: warnings returned', r.warnings.some((w) => w.lineId === invalidLineId))
      check('add lines: batch counters', detail.batch.totalLines === 10)
    })

    await step('validate', async () => {
      const v = await withTenant(A.tenantId, (db) => validateIntakeBatch(db, A.tenantId, mainBatchId))
      check('validate: 8 willAdd, 1 willCreate, 1 error, 0 conflicts',
        v.willAdd.length === 8 && v.willCreate.length === 1 && v.errors.length === 1 && v.conflicts.length === 0,
        JSON.stringify(v.totals))
      const add0 = v.willAdd.find((w) => w.itemId === existing[0].id)
      check('validate: delta/after preview', add0?.delta === 3 && add0?.after === 8)
      check('validate: canSync false while errors exist', v.canSync === false)
      const nothing = await movementsFor(admin, mainBatchId)
      check('validate: dry run wrote no stock', nothing === 0)
    })

    await step('sync #1', async () => {
      const r = await sync(A, mainBatchId, 'key-1')
      check('sync #1: 9 posted, 1 error, partially_posted', r.posted === 9 && r.errors.length === 1 && r.status === 'partially_posted',
        `${r.status} posted=${r.posted} errors=${JSON.stringify(r.errors)}`)
      check('sync #1: error line is the nameless new item', r.errors[0]?.lineId === invalidLineId && /name/i.test(r.errors[0]?.error || ''))
      const s0 = await stockOf(admin, A, existing[0].id)
      const s7 = await stockOf(admin, A, existing[7].id)
      check('sync #1: merged item stock 5 + 3 = 8', s0 === 8, String(s0))
      check('sync #1: item 7 stock 5 + 8 = 13', s7 === 13, String(s7))
      check('sync #1: 9 ledger movements', (await movementsFor(admin, mainBatchId)) === 9)
      check('sync #1: one item created', r.createdItems.length === 1)
      const c = r.createdItems[0]
      check('sync #1: new item has ITM code + generated EAN-13 barcode', !!c && /^ITM-\d{6}$/.test(c.itemCode) && /^2\d{12}$/.test(c.barcode || ''),
        `${c?.itemCode} ${c?.barcode}`)
      if (c) {
        check('sync #1: new item stock 7', (await stockOf(admin, A, c.itemId)) === 7)
        const it = await admin.query(`SELECT selling_price::float AS sp, cost_price::float AS cp, sku FROM items WHERE id=$1`, [c.itemId])
        check('sync #1: new item prices + sku from the line', it.rows[0].sp === 120 && it.rows[0].cp === 80 && it.rows[0].sku === 'NEW-SKU-1')
        const log = await admin.query(`SELECT count(*)::int AS n FROM item_change_log WHERE item_id=$1 AND intake_batch_id=$2 AND source='intake'`, [c.itemId, mainBatchId])
        check('sync #1: item_change_log create with intake batch id', log.rows[0].n === 1)
      }
      const mv = await admin.query(`SELECT DISTINCT source FROM stock_movements WHERE reference_id=$1`, [mainBatchId])
      check('sync #1: movement source mobile', mv.rows.length === 1 && mv.rows[0].source === 'mobile')
    })

    await step('sync replay same key', async () => {
      const r = await sync(A, mainBatchId, 'key-1')
      check('replay key-1: returns stored result', r.replayed === true && r.posted === 9)
      check('replay key-1: no new movements', (await movementsFor(admin, mainBatchId)) === 9)
    })

    await step('fix invalid line + re-sync', async () => {
      await withTenant(A.tenantId, (db) => updateIntakeLine(db, {
        tenantId: A.tenantId, batchId: mainBatchId, lineId: invalidLineId, patch: { name: 'Named later', sellingPrice: 99 },
      }))
      const before0 = await stockOf(admin, A, existing[0].id)
      const r = await sync(A, mainBatchId, 'key-2')
      check('re-sync: posts only the fixed line', r.posted === 1 && r.errors.length === 0 && r.status === 'posted', `${r.status} posted=${r.posted}`)
      check('re-sync: earlier lines untouched', (await stockOf(admin, A, existing[0].id)) === before0)
      check('re-sync: 10 movements total', (await movementsFor(admin, mainBatchId)) === 10)
      const created = r.createdItems[0]
      check('re-sync: new item uses scanned barcode', created?.barcode === '4791111111111')
      const r2 = await sync(A, mainBatchId, 'key-2')
      check('re-sync replay key-2', r2.replayed === true && r2.posted === 1)
      const r3 = await sync(A, mainBatchId, 'key-3')
      check('sync on posted batch with new key is a no-op', r3.noop === true && r3.status === 'posted' && r3.posted === 0)
      check('posted batch: still 10 movements', (await movementsFor(admin, mainBatchId)) === 10)
      let blocked = false
      try { await add(A, mainBatchId, [{ barcode: existing[1].barcode, quantity: 1 }]) } catch (e) { blocked = e instanceof IntakeError && e.status === 409 }
      check('posted batch: adding lines is rejected (409)', blocked)
    })

    await step('concurrent syncs', async () => {
      const { batch } = await mkBatch(A)
      const item = await newItem(A, 'Concurrent target', { barcode: '4792222222222' })
      const lines: IntakeLineInput[] = []
      for (let i = 0; i < 40; i++) {
        const it = await newItem(A, `Conc ${i}`, { barcode: `48800000000${String(i).padStart(2, '0')}` })
        lines.push({ barcode: it.barcode, quantity: 1 })
      }
      lines.push({ barcode: item.barcode, quantity: 5 })
      await add(A, batch.id, lines)
      const outs = await Promise.allSettled([sync(A, batch.id, 'c-1'), sync(A, batch.id, 'c-2')])
      const ok = outs.filter((o) => o.status === 'fulfilled')
      const busy = outs.filter((o) => o.status === 'rejected' && o.reason instanceof IntakeError && o.reason.status === 409)
      check('concurrent syncs: one succeeds, one 409 SYNC_IN_PROGRESS', ok.length === 1 && busy.length === 1,
        outs.map((o) => (o.status === 'fulfilled' ? `ok:${o.value.status}` : `err:${(o.reason as Error).message}`)).join(' | '))
      check('concurrent syncs: stock applied exactly once', (await stockOf(admin, A, item.id)) === 5)
      check('concurrent syncs: 41 movements', (await movementsFor(admin, batch.id)) === 41)
      const st = await withTenant(A.tenantId, (db) => loadIntakeBatch(db, A.tenantId, batch.id))
      check('concurrent syncs: batch posted, not stuck in syncing', st.status === 'posted', st.status)
    })

    await step('small chunks persist progress', async () => {
      const { batch } = await mkBatch(A)
      await add(A, batch.id, existing.slice(0, 5).map((it) => ({ barcode: it.barcode, quantity: 1 })))
      const r = await syncIntakeBatch({ tenantId: A.tenantId, userId: A.userId, batchId: batch.id, chunkSize: 2 })
      check('chunked sync (size 2): all 5 posted', r.posted === 5 && r.status === 'posted')
    })

    await step('count mode keeps later sales', async () => {
      const item = await newItem(A, 'Counted item', { barcode: '4793333333333' }, 10)
      const { batch } = await mkBatch(A)
      const r = await add(A, batch.id, [{ mode: 'count', barcode: item.barcode, quantity: 8 }])
      check('count: snapshot = system stock 10', Number(r.lines[0].systemQtySnapshot) === 10)
      // a sale after the count
      await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: -2,
        referenceType: 'sale', source: 'pos', userId: A.userId,
      }))
      const v = await withTenant(A.tenantId, (db) => validateIntakeBatch(db, A.tenantId, batch.id))
      check('count: validate delta -2 from current 8 → 6', v.willAdd[0]?.delta === -2 && v.willAdd[0]?.after === 6, JSON.stringify(v.willAdd[0]))
      const s = await sync(A, batch.id)
      check('count: sync posted', s.status === 'posted')
      const now = await stockOf(admin, A, item.id)
      check('count: stock = 8 counted − 2 sold = 6', now === 6, String(now))
      // count replaces on rescan
      const { batch: b2 } = await mkBatch(A)
      await add(A, b2.id, [{ mode: 'count', barcode: item.barcode, quantity: 3 }])
      const r2 = await add(A, b2.id, [{ mode: 'count', barcode: item.barcode, quantity: 4 }])
      const d2 = await withTenant(A.tenantId, (db) => getIntakeBatchDetail(db, A.tenantId, b2.id))
      check('count: rescan replaces quantity (one line, qty 4)', d2.lines.length === 1 && Number(d2.lines[0].quantity) === 4 && r2.outcomes[0].action === 'replaced')
    })

    await step('clientLineId idempotency', async () => {
      const { batch } = await mkBatch(A)
      const c1 = randomUUID()
      const c2 = randomUUID()
      const bc = existing[2].barcode
      await add(A, batch.id, [{ clientLineId: c1, barcode: bc, quantity: 2 }])
      await add(A, batch.id, [{ clientLineId: c1, barcode: bc, quantity: 2 }])
      let d = await withTenant(A.tenantId, (db) => getIntakeBatchDetail(db, A.tenantId, batch.id))
      check('idempotent: replay of c1 keeps 1 line qty 2', d.lines.length === 1 && Number(d.lines[0].quantity) === 2)
      await add(A, batch.id, [{ clientLineId: c2, barcode: bc, quantity: 3 }])
      await add(A, batch.id, [{ clientLineId: c2, barcode: bc, quantity: 3 }])
      await add(A, batch.id, [{ clientLineId: c1, barcode: bc, quantity: 2 }])
      d = await withTenant(A.tenantId, (db) => getIntakeBatchDetail(db, A.tenantId, batch.id))
      check('idempotent: merge c2 then replays of c1/c2 → qty 5', d.lines.length === 1 && Number(d.lines[0].quantity) === 5, d.lines.map((l) => l.quantity).join(','))
    })

    await step('conflict detection', async () => {
      const { batch } = await mkBatch(A)
      await add(A, batch.id, [{ barcode: existing[3].barcode, sku: existing[4].sku, quantity: 1 }])
      const v = await withTenant(A.tenantId, (db) => validateIntakeBatch(db, A.tenantId, batch.id))
      check('conflict: validate reports conflict', v.conflicts.length === 1 && v.conflicts[0].barcodeItem.id === existing[3].id && v.conflicts[0].skuItem.id === existing[4].id)
      const before = await stockOf(admin, A, existing[3].id)
      const r = await sync(A, batch.id)
      check('conflict: sync marks line error, no stock change', r.errors.length === 1 && /conflict/i.test(r.errors[0].error) && (await stockOf(admin, A, existing[3].id)) === before && r.status === 'draft',
        `${r.status} ${JSON.stringify(r.errors)}`)
    })

    await step('concurrent new item creators never duplicate', async () => {
      const b1 = (await mkBatch(A)).batch
      const b2 = (await mkBatch(A)).batch
      await add(A, b1.id, [{ barcode: '4794444444444', quantity: 2, name: 'Race item', sellingPrice: 10 }])
      await add(A, b2.id, [{ barcode: '4794444444444', quantity: 3, name: 'Race item', sellingPrice: 10 }])
      const [r1, r2] = await Promise.all([sync(A, b1.id), sync(A, b2.id)])
      const cnt = await admin.query(`SELECT id FROM items WHERE tenant_id=$1 AND barcode='4794444444444'`, [A.tenantId])
      check('race: exactly one item with the barcode', cnt.rows.length === 1)
      check('race: both lines posted', r1.status === 'posted' && r2.status === 'posted', `${r1.status}/${r2.status} ${JSON.stringify([r1.errors, r2.errors])}`)
      if (cnt.rows[0]) check('race: stock 2 + 3 = 5', (await stockOf(admin, A, cnt.rows[0].id)) === 5)
    })

    await step('weighted average cost update', async () => {
      const item = await newItem(A, 'Costed item', { barcode: '4795555555555', costPrice: '100' }, 10)
      const { batch } = await mkBatch(A, { updateCost: true })
      await add(A, batch.id, [{ barcode: item.barcode, quantity: 10, costPrice: 120 }])
      await sync(A, batch.id)
      const it = await admin.query(`SELECT cost_price::float AS cp FROM items WHERE id=$1`, [item.id])
      check('cost: (10×100 + 10×120)/20 = 110', it.rows[0].cp === 110, String(it.rows[0].cp))
      const h = await admin.query(`SELECT source, previous_cost_price::float AS p, new_cost_price::float AS n FROM item_cost_history WHERE item_id=$1`, [item.id])
      check('cost: item_cost_history row (stock_intake)', h.rows.length === 1 && h.rows[0].source === 'stock_intake' && h.rows[0].n === 110)
    })

    await step('selling price changes need confirmation', async () => {
      const item = await newItem(A, 'Priced item', { barcode: '4796666666666', sellingPrice: '200' }, 5)
      const { batch } = await mkBatch(A)
      await add(A, batch.id, [{ barcode: item.barcode, quantity: 3, sellingPrice: 250 }])
      const v = await withTenant(A.tenantId, (db) => validateIntakeBatch(db, A.tenantId, batch.id))
      check('price: validate lists the change 200 → 250, undecided', v.priceChanges.length === 1 && v.priceChanges[0].currentPrice === 200 && v.priceChanges[0].newPrice === 250 && v.priceChanges[0].decision === null, JSON.stringify(v.priceChanges))
      check('price: canSync false until decided', v.canSync === false)
      await sync(A, batch.id)
      const kept = await admin.query(`SELECT selling_price::float AS sp FROM items WHERE id=$1`, [item.id])
      check('price: no decision → item keeps 200 (data untouched), stock still added', kept.rows[0].sp === 200 && (await stockOf(admin, A, item.id)) === 8, String(kept.rows[0].sp))

      const { batch: b2 } = await mkBatch(A)
      const added = await add(A, b2.id, [{ barcode: item.barcode, quantity: 1, sellingPrice: 260 }])
      const lineId = (added as { outcomes?: Array<{ lineId: string }> }).outcomes?.[0]?.lineId
        ?? (await withTenant(A.tenantId, (db) => getIntakeBatchDetail(db, A.tenantId, b2.id))).lines[0].id
      await withTenant(A.tenantId, (db) => updateIntakeLine(db, { tenantId: A.tenantId, batchId: b2.id, lineId, patch: { priceDecision: 'apply' } }))
      const v2 = await withTenant(A.tenantId, (db) => validateIntakeBatch(db, A.tenantId, b2.id))
      check('price: confirmed → canSync', v2.canSync === true && v2.priceChanges[0]?.decision === 'apply')
      await sync(A, b2.id)
      const applied = await admin.query(`SELECT selling_price::float AS sp FROM items WHERE id=$1`, [item.id])
      check('price: confirmed → item price 260', applied.rows[0].sp === 260, String(applied.rows[0].sp))
      const log = await admin.query(`SELECT 1 FROM item_change_log WHERE item_id=$1 AND source='intake' AND action='update'`, [item.id])
      check('price: change logged', (log.rowCount ?? 0) >= 1)
    })

    await step('header version + status rules', async () => {
      const { batch } = await mkBatch(A)
      let conflict = false
      try {
        await withTenant(A.tenantId, (db) => updateIntakeBatch(db, { tenantId: A.tenantId, userId: A.userId, batchId: batch.id, expectedVersion: 99, notes: 'x', canPost: true }))
      } catch (e) { conflict = e instanceof IntakeError && e.status === 409 && e.code === 'VERSION_CONFLICT' }
      check('patch: stale version → 409', conflict)
      let empty = false
      try {
        await withTenant(A.tenantId, (db) => updateIntakeBatch(db, { tenantId: A.tenantId, userId: A.userId, batchId: batch.id, expectedVersion: 1, status: 'submitted', canPost: false }))
      } catch (e) { empty = e instanceof IntakeError && e.code === 'EMPTY_BATCH' }
      check('patch: cannot submit an empty batch', empty)
      await add(A, batch.id, [{ barcode: existing[5].barcode, quantity: 1 }])
      const sub = await withTenant(A.tenantId, (db) => updateIntakeBatch(db, { tenantId: A.tenantId, userId: A.userId, batchId: batch.id, expectedVersion: 1, status: 'submitted', canPost: false }))
      check('patch: submit → submitted, version 2', sub.status === 'submitted' && sub.version === 2 && !!sub.submittedAt)
      let forbidden = false
      try {
        await withTenant(A.tenantId, (db) => updateIntakeBatch(db, { tenantId: A.tenantId, userId: A.userId, batchId: batch.id, expectedVersion: 2, status: 'cancelled', canPost: false }))
      } catch (e) { forbidden = e instanceof IntakeError && e.status === 403 }
      check('patch: cancel needs post permission', forbidden)
      const can = await withTenant(A.tenantId, (db) => updateIntakeBatch(db, { tenantId: A.tenantId, userId: A.userId, batchId: batch.id, expectedVersion: 2, status: 'cancelled', canPost: true }))
      check('patch: cancel with permission', can.status === 'cancelled')
    })

    await step('RLS isolation', async () => {
      const visible = await withTenant(B.tenantId, async (db) => {
        const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM stock_intake_batches WHERE id = ${mainBatchId}`)
        const l = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM stock_intake_lines WHERE batch_id = ${mainBatchId}`)
        return r.rows[0].n + l.rows[0].n
      })
      check('RLS: tenant B sees no batch / lines of tenant A', visible === 0)
      let notFound = false
      try {
        await withTenant(B.tenantId, (db) => getIntakeBatchDetail(db, B.tenantId, mainBatchId))
      } catch (e) { notFound = e instanceof IntakeError && e.status === 404 }
      check('RLS: detail lookup from tenant B → 404', notFound)
      let syncBlocked = false
      try { await syncIntakeBatch({ tenantId: B.tenantId, userId: B.userId, batchId: mainBatchId }) } catch (e) { syncBlocked = e instanceof IntakeError && e.status === 404 }
      check('RLS: tenant B cannot sync tenant A batch', syncBlocked)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await admin.query(`SET session_replication_role = replica`)
      for (const f of [A, B]) {
        const t = f.tenantId
        await admin.query(`DELETE FROM stock_intake_lines WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM stock_intake_batches WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM item_cost_history WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM stock_movements WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM warehouse_stock WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM item_change_log WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM activity_logs WHERE tenant_id=$1`, [t]).catch(() => undefined)
        await admin.query(`DELETE FROM items WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM tenant_sequences WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM users WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM warehouses WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM tenant_usage WHERE tenant_id=$1`, [t]).catch(() => undefined)
        await admin.query(`DELETE FROM tenants WHERE id=$1`, [t]).catch((e) => console.warn('cleanup tenant:', e.message))
      }
    }
    await admin.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
