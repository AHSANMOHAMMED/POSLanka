/**
 * Super-admin bulk export of one vendor: readable CSV files in one streamed ZIP.
 *
 *   README.txt                              what is inside, what is left out
 *   reports/summary.csv                     all-time totals
 *   reports/items-stock-and-profit.csv      every item: stock, cost, sales, profit
 *   tables/<section>/<table>.csv            each table with rows (empty tables are left out)
 *
 * Same footing as the vendor's own backup (src/lib/backup/tenant-backup.ts): one REPEATABLE READ
 * READ ONLY snapshot, row level security on, an explicit tenant filter, rows through a server-side
 * cursor so memory stays flat. Secret columns are dropped inside the query; keys that look like
 * secrets inside JSON values are masked.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PoolClient } from 'pg'
import * as schema from '@/lib/db/schema'
import { getSharedPool } from '@/lib/db/pool'
import { ZipWriter } from '@/lib/backup/zip-writer'
import { CSV_BOM, csvRow, fileSlug } from './csv'
import { exportTables, maskJsonSecrets, type ExportTable } from './vendor-data'
import { ITEM_CSV_HEADER, itemCsvCells, resolvePeriod, summaryRows, vendorBusinessSummary, vendorItemReport } from './vendor-business'

const BATCH = 1000
const IDENT_RE = /^[a-z_][a-z0-9_]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ExportStat { table: string; rows: number }

async function openSnapshot(tenantId: string): Promise<PoolClient> {
  if (!UUID_RE.test(tenantId)) throw new Error('Invalid vendor id')
  const client = await getSharedPool().connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    await client.query(`SELECT set_config('idle_in_transaction_session_timeout', '1800000', true)`)
    // A full export can run longer than the pool's default statement_timeout
    await client.query(`SELECT set_config('statement_timeout', '0', true)`)
    const role = process.env.DATABASE_APP_ROLE
    if (role) {
      if (!IDENT_RE.test(role) || role.length > 63) throw new Error(`Invalid DATABASE_APP_ROLE: "${role}"`)
      await client.query(`SET LOCAL ROLE ${role}`)
    } else {
      await client.query(`SELECT set_config('app.rls_strict', 'on', true)`)
    }
    return client
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
    throw err
  }
}

const csvHeader = (t: ExportTable) => `${CSV_BOM}${csvRow(t.columns)}\r\n`

/** CSV text of one table in batches; yields nothing when the vendor has no rows there. */
async function* tableCsv(client: PoolClient, tenantId: string, t: ExportTable, stat: ExportStat): AsyncGenerator<string> {
  if (!IDENT_RE.test(t.dbName) || !IDENT_RE.test(t.tenantColumn)) throw new Error(`Bad table name ${t.dbName}`)
  const minus = t.secretColumns.length ? ` - ARRAY[${t.secretColumns.map((c) => `'${c}'`).join(',')}]::text[]` : ''
  // tenantId is a validated UUID; table and column names come from the schema
  await client.query(`DECLARE export_cur NO SCROLL CURSOR FOR
    SELECT (to_jsonb(t)${minus})::text AS j FROM "${t.dbName}" t WHERE t."${t.tenantColumn}" = '${tenantId}'
    ${t.hasCreatedAt ? 'ORDER BY t.created_at' : ''}`)
  for (;;) {
    const batch = await client.query<{ j: string }>(`FETCH ${BATCH} FROM export_cur`)
    if (batch.rows.length === 0) break
    let text = stat.rows === 0 ? csvHeader(t) : ''
    for (const r of batch.rows) {
      const row = JSON.parse(r.j) as Record<string, unknown>
      text += `${csvRow(t.columns.map((c) => maskJsonSecrets(row[c])))}\r\n`
    }
    stat.rows += batch.rows.length
    yield text
  }
  await client.query('CLOSE export_cur')
}

/**
 * ZIP bytes of the vendor's data. `groups` limits the tables to those console sections (default all).
 * The DB connection is released when the generator finishes, fails or is cancelled.
 */
export async function* vendorExportZip(
  tenantId: string,
  opts: { vendorName: string; businessId: string; groups?: string[]; onDone?: (stats: ExportStat[]) => void },
): AsyncGenerator<Uint8Array> {
  const period = await resolvePeriod(tenantId, { period: 'all' })
  if (!period) throw new Error('No period')
  const client = await openSnapshot(tenantId)
  const zip = new ZipWriter()
  let ok = false
  try {
    const stats: ExportStat[] = []
    const tx = drizzle(client, { schema })

    const [summary, items] = [await vendorBusinessSummary(tx, period), await vendorItemReport(tx, period, { sort: 'name', dir: 'asc' })]
    const summaryCsv = `${CSV_BOM}${[csvRow(['Section', 'Figure', 'Value']), ...summaryRows(summary).map(csvRow)].join('\r\n')}\r\n`
    for (const c of await zip.addFile('reports/summary.csv', summaryCsv)) yield c
    const itemsCsv = `${CSV_BOM}${[csvRow(ITEM_CSV_HEADER), ...items.rows.map((r) => csvRow(itemCsvCells(r)))].join('\r\n')}\r\n`
    for (const c of await zip.addFile('reports/items-stock-and-profit.csv', itemsCsv)) yield c

    const tables = exportTables().filter((t) => !opts.groups || opts.groups.includes(t.group))
    for (const t of tables) {
      const stat: ExportStat = { table: t.name, rows: 0 }
      let entry: ReturnType<ZipWriter['startEntry']>['entry'] | null = null
      for await (const text of tableCsv(client, tenantId, t, stat)) {
        if (!entry) {
          const started = zip.startEntry(`tables/${fileSlug(t.group)}/${t.name}.csv`)
          entry = started.entry
          for (const c of started.header) yield c
        }
        for (const c of await entry.write(text)) yield c
      }
      if (entry) {
        for (const c of await entry.end()) yield c
        stats.push(stat)
      }
    }

    const readme = [
      `${opts.vendorName} (${opts.businessId}) — data export of ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
      '',
      'reports/ holds all-time totals and every item with its stock, cost, sales and profit.',
      `tables/ holds ${stats.length} tables with ${stats.reduce((s, t) => s + t.rows, 0)} rows. Tables without rows are left out.`,
      'Every file opens in Excel. Dates and times in tables/ are UTC. All rows were read at one moment.',
      '',
      'Not included: passwords, PINs, API keys and other secrets; sign-in sessions; uploaded files',
      '(images and attachments stay in file storage; the files table lists them).',
      '',
    ].join('\r\n')
    for (const c of await zip.addFile('README.txt', readme)) yield c
    for (const c of zip.finish()) yield c

    await client.query('COMMIT')
    ok = true
    opts.onDone?.(stats)
  } finally {
    if (!ok) await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}

/** One table as CSV bytes (header only when it has no rows) */
export async function* vendorTableCsv(tenantId: string, tableName: string): AsyncGenerator<Uint8Array> {
  const t = exportTables().find((x) => x.name === tableName)
  if (!t) throw new Error('Unknown table')
  const client = await openSnapshot(tenantId)
  const encoder = new TextEncoder()
  let ok = false
  try {
    const stat: ExportStat = { table: t.name, rows: 0 }
    for await (const text of tableCsv(client, tenantId, t, stat)) yield encoder.encode(text)
    if (stat.rows === 0) yield encoder.encode(csvHeader(t))
    await client.query('COMMIT')
    ok = true
  } finally {
    if (!ok) await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}
