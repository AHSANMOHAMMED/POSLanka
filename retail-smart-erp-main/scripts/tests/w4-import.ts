/**
 * W4 bulk import / export integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w4 \
 *   DATABASE_APP_ROLE=app_user npx tsx scripts/tests/w4-import.ts
 *
 * Creates a throw-away tenant, drives the validate + apply functions directly
 * (the same ones the API routes use), prints PASS/FAIL per check and exits
 * non-zero on failure. The tenant is removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { withTenant, withTenantTransaction, closeAllPools } from '@/lib/db'
import { createItem } from '@/lib/inventory/create-item'
import { getEntityConfig, type ImportMode, type StockImportMode } from '@/lib/import-export/entity-config'
import { mapColumns, parseCsv, isInstructionRow } from '@/lib/import-export/import-utils'
import { validateImport, type ImportValidationResult } from '@/lib/import-export/import-validate'
import { createImportJob, getJob, getJobView, effectiveStatus, type ImportJobRecord } from '@/lib/import-export/import-job-store'
import { runImportJob } from '@/lib/import-export/run-import-job'
import { buildErrorsCsv } from '@/lib/import-export/import-errors-csv'
import { createExportStream } from '@/lib/import-export/export-stream'

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

interface Fixture { tenantId: string; mainId: string; wh2Id: string; userId: string }

async function makeTenant(admin: Client): Promise<Fixture> {
  const tenantId = randomUUID()
  const mainId = randomUUID()
  const wh2Id = randomUUID()
  const userId = randomUUID()
  const slug = `w4t-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)`,
    [tenantId, 'W4 import test', slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main Store', 'MAIN', true)`, [mainId, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Back Room', 'WH2', false)`, [wh2Id, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Kamala Silva', 'owner')`,
    [userId, tenantId, `owner-${slug}@example.test`])
  return { tenantId, mainId, wh2Id, userId }
}

const items = getEntityConfig('items')!

async function validate(f: Fixture, rawRows: Record<string, string>[], mode: ImportMode, options: { matchBy?: string[]; stockMode?: StockImportMode } = {}): Promise<{ v: ImportValidationResult; mapping: Record<string, string> }> {
  const mapping = mapColumns(Object.keys(rawRows[0]), items)
  const v = await withTenant(f.tenantId, (db) => validateImport(db, {
    tenantId: f.tenantId, entityConfig: items, rawRows, columnMapping: mapping, mode, options,
  }))
  return { v, mapping }
}

async function startJob(f: Fixture, rawRows: Record<string, string>[], mode: ImportMode, options: { matchBy?: string[]; stockMode?: StockImportMode } = {}, fileHash = randomUUID().replace(/-/g, '')) {
  const { v, mapping } = await validate(f, rawRows, mode, options)
  const created = await createImportJob({
    tenantId: f.tenantId, userId: f.userId, entityName: 'items', mode,
    options: { ...options, matchBy: v.matchBy, headers: Object.keys(rawRows[0]), columnMapping: mapping, blankPolicy: 'keep' },
    fileName: 'test.csv', fileHash, rows: v.rows,
  })
  if (!created.ok) throw new Error('job conflict')
  return { job: created.job, v }
}

async function q<T = Record<string, unknown>>(admin: Client, text: string, params: unknown[] = []): Promise<T[]> {
  return (await admin.query(text, params)).rows as T[]
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader()
  const parts: Buffer[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    parts.push(Buffer.from(value))
  }
  return Buffer.concat(parts)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  const f = await makeTenant(admin)

  try {
    // Existing item that the insert file conflicts with
    await withTenantTransaction(f.tenantId, (tx) => createItem(tx, {
      tenantId: f.tenantId, userId: f.userId, source: 'manual',
      data: { name: 'Existing', sku: 'EXIST-1', sellingPrice: '10', costPrice: '5' },
    }))

    // ---------------------------------------------------------------- 1. insert 500 rows
    let insertJob: ImportJobRecord | null = null
    let insertValidation: ImportValidationResult | null = null
    await step('insert 500 rows', async () => {
      const rows: Record<string, string>[] = []
      for (let i = 1; i <= 500; i++) {
        rows.push({
          Name: `Item ${i}`,
          SKU: i === 250 ? 'EXIST-1' : i === 400 ? 'T1-10' : `T1-${i}`,
          'Selling Price': String(100 + i),
          'Cost Price': i === 1 ? '50' : '',
          Brand: i === 1 ? 'BrandX' : '',
          Description: i === 1 ? 'first description' : '',
          Category: i % 2 ? 'Drinks' : 'Snacks',
        })
      }
      const { job, v } = await startJob(f, rows, 'insert')
      insertValidation = v
      check('validate: 498 insert / 1 skip / 1 error', v.counts.insert === 498 && v.counts.skip === 1 && v.counts.error === 1,
        JSON.stringify(v.counts))
      const dupRow = v.rows.find(r => r.rowIndex === 400)
      check('in-file duplicate reported as "duplicate of row 10"', !!dupRow && dupRow.status === 'error' && /duplicate of row 10/.test(dupRow.error || ''), dupRow?.error || '')
      const existRow = v.rows.find(r => r.rowIndex === 250)
      check('existing SKU row → skipped "already exists"', existRow?.status === 'skipped' && /already exists/.test(existRow.error || ''), existRow?.error || '')

      const final = await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      insertJob = final
      check('job done with 498 inserted, 1 skipped, 1 failed, 500 processed',
        final?.status === 'done' && final.inserted === 498 && final.skipped === 1 && final.failed === 1 && final.processed === 500,
        JSON.stringify({ s: final?.status, i: final?.inserted, sk: final?.skipped, f: final?.failed, p: final?.processed }))
      const [{ n }] = await q<{ n: string }>(admin, `SELECT count(*) n FROM items WHERE tenant_id=$1 AND sku LIKE 'T1-%'`, [f.tenantId])
      check('498 items in DB (nothing else lost)', Number(n) === 498, `count=${n}`)
      const [{ c }] = await q<{ c: string }>(admin, `SELECT count(DISTINCT item_code) c FROM items WHERE tenant_id=$1 AND sku LIKE 'T1-%'`, [f.tenantId])
      check('every imported item has a unique item_code', Number(c) === 498, `codes=${c}`)
      const [{ cats }] = await q<{ cats: string }>(admin, `SELECT count(*) cats FROM categories WHERE tenant_id=$1`, [f.tenantId])
      check('lookups auto-created once (2 categories)', Number(cats) === 2 && final?.autoCreated === 2, `categories=${cats} autoCreated=${final?.autoCreated}`)
      const [{ logs }] = await q<{ logs: string }>(admin, `SELECT count(*) logs FROM item_change_log WHERE tenant_id=$1 AND import_job_id=$2 AND action='create' AND source='import'`, [f.tenantId, job.id])
      check('item_change_log create rows tagged with import job', Number(logs) === 498, `logs=${logs}`)
      const [{ pending }] = await q<{ pending: string }>(admin, `SELECT count(*) pending FROM import_job_rows WHERE job_id=$1 AND status='pending'`, [job.id])
      check('no pending rows left', Number(pending) === 0)
    })

    // ---------------------------------------------------------------- 2. preview == runner
    await step('preview actions equal runner actions', async () => {
      if (!insertJob || !insertValidation) throw new Error('insert job missing')
      const v = insertValidation as ImportValidationResult
      const dbRows = await q<{ row_index: number; status: string; action: string }>(admin,
        `SELECT row_index, status, action FROM import_job_rows WHERE job_id=$1 ORDER BY row_index`, [(insertJob as ImportJobRecord).id])
      const expected = new Map(v.rows.map(r => [r.rowIndex, r.action === 'insert' ? 'done:insert' : r.action === 'skip' ? 'skipped:skip' : 'error:none']))
      const mismatches = dbRows.filter(r => expected.get(r.row_index) !== `${r.status}:${r.action}`)
      check('every row ended with its previewed action', mismatches.length === 0 && dbRows.length === 500,
        mismatches.slice(0, 3).map(m => JSON.stringify(m)).join(' '))
    })

    // ---------------------------------------------------------------- 3. one bad row at apply time does not lose the chunk
    await step('apply-time failure isolated by savepoints', async () => {
      const rows: Record<string, string>[] = []
      for (let i = 1; i <= 300; i++) {
        rows.push({ Name: `Bulk ${i}`, SKU: `T3-${i}`, 'Selling Price': '5', Brand: i === 77 ? 'B'.repeat(150) : 'ok' })
      }
      const { job, v } = await startJob(f, rows, 'insert')
      check('validation passes all 300 (error only detectable at apply)', v.counts.insert === 300, JSON.stringify(v.counts))
      const final = await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      check('299 inserted, 1 failed', final?.inserted === 299 && final.failed === 1, JSON.stringify({ i: final?.inserted, f: final?.failed }))
      const [{ n }] = await q<{ n: string }>(admin, `SELECT count(*) n FROM items WHERE tenant_id=$1 AND sku LIKE 'T3-%'`, [f.tenantId])
      check('299 T3 items in DB', Number(n) === 299, `count=${n}`)
      const [bad] = await q<{ status: string; error: string }>(admin, `SELECT status, error FROM import_job_rows WHERE job_id=$1 AND row_index=77`, [job.id])
      check('row 77 marked error with a message', bad?.status === 'error' && !!bad.error, bad?.error)
    })

    // ---------------------------------------------------------------- 4. update mode keeps blank cells
    await step('update mode: blanks keep values, __CLEAR__ clears', async () => {
      const [before] = await q<{ id: string; version: number }>(admin, `SELECT id, version FROM items WHERE tenant_id=$1 AND sku='T1-1'`, [f.tenantId])
      const rows = [
        { SKU: 'T1-1', Name: '', 'Selling Price': '999', 'Cost Price': '', Brand: '', Description: '__CLEAR__', Category: '' },
        { SKU: 'NOPE-1', Name: '', 'Selling Price': '1', 'Cost Price': '', Brand: '', Description: '', Category: '' },
      ]
      const { job, v } = await startJob(f, rows, 'update')
      check('validate: 1 update / 1 error (no match)', v.counts.update === 1 && v.counts.error === 1 && /No matching record/.test(v.rows[1].error || ''), JSON.stringify(v.counts))
      const final = await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      check('job: 1 updated, 1 failed', final?.updated === 1 && final.failed === 1)
      const [after] = await q<Record<string, unknown>>(admin,
        `SELECT name, selling_price, cost_price, brand, description, version, updated_by, category_id FROM items WHERE id=$1`, [before.id])
      check('selling price updated', Number(after.selling_price) === 999, String(after.selling_price))
      check('blank cells kept (name, cost, brand, category)',
        after.name === 'Item 1' && Number(after.cost_price) === 50 && after.brand === 'BrandX' && after.category_id !== null,
        JSON.stringify(after))
      check('__CLEAR__ set description to null', after.description === null)
      check('version bumped + updated_by set', Number(after.version) === Number(before.version) + 1 && after.updated_by === f.userId)
      const [log] = await q<{ changes: Record<string, unknown>; price_changed: boolean }>(admin,
        `SELECT changes, price_changed FROM item_change_log WHERE item_id=$1 AND import_job_id=$2 AND action='update'`, [before.id, job.id])
      check('price history entry for import update', !!log && log.price_changed === true && 'sellingPrice' in log.changes, JSON.stringify(log?.changes))
    })

    // ---------------------------------------------------------------- 5. upsert + stock columns, idempotent
    await step('upsert with stock:<CODE> columns', async () => {
      const [t12] = await q<{ id: string }>(admin, `SELECT id FROM items WHERE tenant_id=$1 AND sku='T1-2'`, [f.tenantId])
      const rows = [
        { SKU: 'T1-2', Name: '', 'Selling Price': '', 'stock:MAIN': '5', 'stock:WH2': '', Warehouse: '', 'Min Stock': '' },
        { SKU: 'UP-1', Name: 'Upsert New', 'Selling Price': '20', 'stock:MAIN': '7', 'stock:WH2': '3', Warehouse: 'MAIN', 'Min Stock': '2' },
        { SKU: 'UP-2', Name: '', 'Selling Price': '20', 'stock:MAIN': '', 'stock:WH2': '', Warehouse: '', 'Min Stock': '' },
      ]
      const { job, v } = await startJob(f, rows, 'upsert', { stockMode: 'add' })
      check('validate: 1 update, 1 insert, 1 error (new row missing Name)', v.counts.update === 1 && v.counts.insert === 1 && v.counts.error === 1, JSON.stringify(v.counts))
      const final = await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      check('job: 1 inserted, 1 updated', final?.inserted === 1 && final.updated === 1 && final.status === 'done')
      const [up1] = await q<{ id: string }>(admin, `SELECT id FROM items WHERE tenant_id=$1 AND sku='UP-1'`, [f.tenantId])
      const stock = await q<{ item_id: string; warehouse_id: string; current_stock: string; min_stock: string }>(admin,
        `SELECT item_id, warehouse_id, current_stock, min_stock FROM warehouse_stock WHERE tenant_id=$1 AND item_id = ANY($2)`, [f.tenantId, [t12.id, up1.id]])
      const s = (item: string, wh: string) => stock.find(x => x.item_id === item && x.warehouse_id === wh)
      check('existing item MAIN += 5', Number(s(t12.id, f.mainId)?.current_stock) === 5)
      check('new item MAIN = 7, WH2 = 3, min stock 2',
        Number(s(up1.id, f.mainId)?.current_stock) === 7 && Number(s(up1.id, f.wh2Id)?.current_stock) === 3 && Number(s(up1.id, f.mainId)?.min_stock) === 2,
        JSON.stringify(stock))
      const moves = await q<{ item_id: string; qty_change: string; stock_before: string; stock_after: string; reference_type: string; reference_id: string; idempotency_key: string }>(admin,
        `SELECT item_id, qty_change, stock_before, stock_after, reference_type, reference_id, idempotency_key FROM stock_movements WHERE tenant_id=$1 AND reference_id=$2`, [f.tenantId, job.id])
      check('3 ledger movements with before/after, reference import/jobId',
        moves.length === 3 && moves.every(m => m.reference_type === 'import' && Number(m.stock_after) === Number(m.stock_before) + Number(m.qty_change) && m.idempotency_key.startsWith(`import:${job.id}:`)),
        JSON.stringify(moves))

      // Re-run (resume) — finished job: nothing happens
      await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      // Simulate a lost status write: put the rows back to pending and resume
      await admin.query(`UPDATE import_job_rows SET status='pending' WHERE job_id=$1 AND status='done'`, [job.id])
      await admin.query(`UPDATE import_jobs SET status='processing', heartbeat_at = now() - interval '10 minutes' WHERE id=$1`, [job.id])
      await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      const [again] = await q<{ current_stock: string }>(admin, `SELECT current_stock FROM warehouse_stock WHERE item_id=$1 AND warehouse_id=$2`, [t12.id, f.mainId])
      const [{ n }] = await q<{ n: string }>(admin, `SELECT count(*) n FROM stock_movements WHERE tenant_id=$1 AND reference_id=$2`, [f.tenantId, job.id])
      check('re-running the job does not double stock (idempotency key)', Number(again.current_stock) === 5 && Number(n) === 3, `stock=${again.current_stock} moves=${n}`)
      const [{ dupes }] = await q<{ dupes: string }>(admin, `SELECT count(*) dupes FROM items WHERE tenant_id=$1 AND sku='UP-1'`, [f.tenantId])
      check('re-run did not create a duplicate item', Number(dupes) === 1)
    })

    // ---------------------------------------------------------------- 6. interruption + resume
    await step('interrupt after first chunk, resume completes', async () => {
      const rows: Record<string, string>[] = []
      for (let i = 1; i <= 450; i++) rows.push({ Name: `Resume ${i}`, SKU: `T6-${i}`, 'Selling Price': '3', 'stock:MAIN': '2' })
      const { job } = await startJob(f, rows, 'insert')
      const partial = await runImportJob({ jobId: job.id, tenantId: f.tenantId, maxChunks: 1 })
      check('first chunk applied (200 processed)', partial?.processed === 200 && partial.inserted === 200, `processed=${partial?.processed}`)
      await admin.query(`UPDATE import_jobs SET heartbeat_at = now() - interval '5 minutes' WHERE id=$1`, [job.id])
      const view = await getJobView(f.tenantId, job.id)
      check('stale heartbeat reported as interrupted', view?.status === 'interrupted' && view.canResume, view?.status)
      const done = await runImportJob({ jobId: job.id, tenantId: f.tenantId })
      check('resume finished with exact counts', done?.status === 'done' && done.inserted === 450 && done.processed === 450 && done.failed === 0,
        JSON.stringify({ s: done?.status, i: done?.inserted, p: done?.processed }))
      const [{ n }] = await q<{ n: string }>(admin, `SELECT count(*) n FROM items WHERE tenant_id=$1 AND sku LIKE 'T6-%'`, [f.tenantId])
      const [{ m }] = await q<{ m: string }>(admin, `SELECT count(*) m FROM stock_movements WHERE tenant_id=$1 AND reference_id=$2`, [f.tenantId, job.id])
      check('450 items, 450 opening-stock movements', Number(n) === 450 && Number(m) === 450, `items=${n} moves=${m}`)
      const after = await getJob(f.tenantId, job.id)
      check('effective status done', !!after && effectiveStatus(after) === 'done')
    })

    // ---------------------------------------------------------------- 7. same file concurrently → conflict
    await step('same file twice concurrently → conflict', async () => {
      const rows = [{ Name: 'Conc', SKU: 'CONC-1', 'Selling Price': '1' }]
      const hash = 'a'.repeat(64)
      const first = await startJob(f, rows, 'insert', {}, hash)
      let conflict = false
      try { await startJob(f, rows, 'insert', {}, hash) } catch (e) { conflict = (e as Error).message === 'job conflict' }
      check('second job with same file hash rejected while first is active', conflict)
      await runImportJob({ jobId: first.job.id, tenantId: f.tenantId })
      const again = await startJob(f, rows, 'insert', {}, hash)
      check('allowed again after the first finished', !!again.job.id)
      await runImportJob({ jobId: again.job.id, tenantId: f.tenantId })
    })

    // ---------------------------------------------------------------- 8. errors CSV
    await step('errors CSV contains the bad rows', async () => {
      if (!insertJob) throw new Error('insert job missing')
      const job = await getJob(f.tenantId, (insertJob as ImportJobRecord).id)
      const csv = await buildErrorsCsv(f.tenantId, job!)
      const parsed = parseCsv(csv)
      check('2 rows (skipped + error) in errors CSV', parsed.length === 2, `rows=${parsed.length}`)
      check('original columns + Error column', parsed[0]?.SKU === 'EXIST-1' && parsed[1]?.SKU === 'T1-10' && /already exists/.test(parsed[0]?.Error || '') && /duplicate of row 10/.test(parsed[1]?.Error || ''),
        JSON.stringify(parsed))
      const remap = mapColumns(Object.keys(parsed[0]), items)
      check('re-upload maps original columns (Error ignored)', remap.SKU === 'sku' && remap.Name === 'name' && !remap.Error)
    })

    // ---------------------------------------------------------------- 9. instruction-row detection never drops data
    await step('parser keeps data rows that mention "number"/"required"', async () => {
      const csv = 'Name,Description\nPart number 5,"required, fragile"\nOther,x\n'
      check('both data rows kept', parseCsv(csv).length === 2)
      check('template instruction row still detected', isInstructionRow(['Required', 'Required, Unique', 'Number', 'Yes/No', 'string']))
    })

    // ---------------------------------------------------------------- 9b. non-item entity (customers)
    await step('customers: fast path + savepoint fallback + update keeps blanks', async () => {
      const customers = getEntityConfig('customers')!
      const rows: Record<string, string>[] = []
      for (let i = 1; i <= 250; i++) {
        rows.push({ Name: `Cust ${i}`, Email: `c${i}@w4.test`, Phone: '', City: i === 1 ? 'Kandy' : '', 'Postal Code': i === 120 ? 'X'.repeat(40) : '' })
      }
      const mapping = mapColumns(Object.keys(rows[0]), customers)
      const v = await withTenant(f.tenantId, (db) => validateImport(db, { tenantId: f.tenantId, entityConfig: customers, rawRows: rows, columnMapping: mapping, mode: 'insert' }))
      const created = await createImportJob({ tenantId: f.tenantId, userId: f.userId, entityName: 'customers', mode: 'insert',
        options: { columnMapping: mapping, headers: Object.keys(rows[0]), matchBy: v.matchBy }, fileHash: randomUUID().replace(/-/g, ''), rows: v.rows })
      if (!created.ok) throw new Error('conflict')
      const final = await runImportJob({ jobId: created.job.id, tenantId: f.tenantId })
      check('customers: 249 inserted, 1 failed (too-long postal code)', final?.inserted === 249 && final.failed === 1, JSON.stringify({ i: final?.inserted, f: final?.failed }))
      const [{ n }] = await q<{ n: string }>(admin, `SELECT count(*) n FROM customers WHERE tenant_id=$1`, [f.tenantId])
      check('249 customers in DB', Number(n) === 249, `count=${n}`)

      const upd = [{ Name: '', Email: 'C1@w4.test', Phone: '0771234567', City: '', 'Postal Code': '' }]
      const m2 = mapColumns(Object.keys(upd[0]), customers)
      const v2 = await withTenant(f.tenantId, (db) => validateImport(db, { tenantId: f.tenantId, entityConfig: customers, rawRows: upd, columnMapping: m2, mode: 'update', options: { matchBy: ['email'] } }))
      const c2 = await createImportJob({ tenantId: f.tenantId, userId: f.userId, entityName: 'customers', mode: 'update',
        options: { columnMapping: m2, headers: Object.keys(upd[0]), matchBy: v2.matchBy }, fileHash: randomUUID().replace(/-/g, ''), rows: v2.rows })
      if (!c2.ok) throw new Error('conflict')
      const f2 = await runImportJob({ jobId: c2.job.id, tenantId: f.tenantId })
      const [c1] = await q<{ name: string; phone: string; city: string }>(admin, `SELECT name, phone, city FROM customers WHERE tenant_id=$1 AND email='c1@w4.test'`, [f.tenantId])
      check('customer update by email (case-insensitive) keeps blank name/city', f2?.updated === 1 && c1.name === 'Cust 1' && c1.city === 'Kandy' && c1.phone === '0771234567', JSON.stringify(c1))
      await admin.query(`SET session_replication_role = replica`)
      await admin.query(`DELETE FROM customers WHERE tenant_id=$1`, [f.tenantId])
      await admin.query(`SET session_replication_role = DEFAULT`)
    })

    // ---------------------------------------------------------------- 10. export 6000+ items, streamed
    await step('export of 6000 items returns all rows', async () => {
      await admin.query(`
        INSERT INTO items (tenant_id, name, sku, selling_price)
        SELECT $1, 'Export ' || g, 'EXP-' || g, 10 FROM generate_series(1, 6000) g`, [f.tenantId])
      const [{ total }] = await q<{ total: string }>(admin, `SELECT count(*) total FROM items WHERE tenant_id=$1`, [f.tenantId])
      const csvRes = await createExportStream({ tenantId: f.tenantId, entityName: 'items', format: 'csv' })
      const csvText = (await readStream(csvRes.stream)).toString('utf8')
      const parsed = parseCsv(csvText)
      check('CSV export row count == items in DB', parsed.length === Number(total) && (await csvRes.done) === Number(total), `csv=${parsed.length} db=${total}`)
      const headers = Object.keys(parsed[0] || {})
      check('items export has Item Code, Updated By, Updated At, stock:MAIN, stock:WH2',
        ['Item Code', 'Updated By', 'Updated At', 'stock:MAIN', 'stock:WH2'].every(h => headers.includes(h)), headers.join('|'))
      const up1 = parsed.find(r => r.SKU === 'UP-1')
      check('per-warehouse stock exported', up1?.['stock:MAIN'] === '7' && up1?.['stock:WH2'] === '3', JSON.stringify(up1))
      check('item codes unique in export', new Set(parsed.map(r => r['Item Code'])).size === parsed.length)
      const remap = mapColumns(headers, items)
      check('export headers round-trip to import fields', remap['Item Code'] === 'itemCode' && remap['stock:MAIN'] === 'stock:MAIN' && remap['SKU'] === 'sku')

      const xlsxRes = await createExportStream({ tenantId: f.tenantId, entityName: 'items', format: 'xlsx' })
      const buf = await readStream(xlsxRes.stream)
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buf, { type: 'buffer' })
      const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[]
      check('XLSX (streamed) export row count == items in DB', sheetRows.length === Number(total), `xlsx=${sheetRows.length}`)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await admin.query(`SET session_replication_role = replica`)
      const t = f.tenantId
      for (const stmt of [
        `DELETE FROM import_job_rows WHERE tenant_id=$1`,
        `DELETE FROM import_jobs WHERE tenant_id=$1`,
        `DELETE FROM stock_movements WHERE tenant_id=$1`,
        `DELETE FROM warehouse_stock WHERE tenant_id=$1`,
        `DELETE FROM item_change_log WHERE tenant_id=$1`,
        `DELETE FROM items WHERE tenant_id=$1`,
        `DELETE FROM categories WHERE tenant_id=$1`,
        `DELETE FROM tenant_sequences WHERE tenant_id=$1`,
        `DELETE FROM activity_logs WHERE tenant_id=$1`,
        `DELETE FROM users WHERE tenant_id=$1`,
        `DELETE FROM warehouses WHERE tenant_id=$1`,
        `DELETE FROM tenant_usage WHERE tenant_id=$1`,
        `DELETE FROM tenants WHERE id=$1`,
      ]) {
        await admin.query(stmt, [t]).catch((e) => console.warn('cleanup:', e.message))
      }
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
