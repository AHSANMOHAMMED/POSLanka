/**
 * H4: full tenant backup — every tenant-scoped table as JSON Lines inside one ZIP, streamed.
 *
 *   manifest.json            format, tenant, snapshot time, per-table row counts, redactions
 *   tenant.json              the company row (tenants)
 *   tables/<table>.jsonl     one JSON object per row (column names as in PostgreSQL)
 *   FILES.txt                note: uploaded binaries (R2 / object storage) are NOT included;
 *                            their metadata is in tables/files.jsonl (+ file_versions)
 *
 * Consistency: one REPEATABLE READ READ ONLY transaction (a single snapshot for all tables).
 * Isolation: app.tenant_id + SET LOCAL ROLE <DATABASE_APP_ROLE> exactly like withTenant() (RLS),
 * plus an explicit `tenant_id = <id>` filter as a second fence.
 * Secrets (password / PIN hashes, API key hashes, SMTP / SMS / mail provider credentials, session
 * and push tokens) are removed from the rows. Rows stream through a server-side cursor in batches,
 * so memory stays flat for any tenant size.
 *
 * Restore is intentionally not automated — see deploy/backup/README.md ("Tenant export").
 */
import type { PoolClient } from 'pg'
import { getSharedPool } from '@/lib/db/pool'
import { ZipWriter } from './zip-writer'

export const BACKUP_FORMAT = 'poslanka-tenant-backup'
export const BACKUP_FORMAT_VERSION = 1
const BATCH = 1000

/** Tables never exported (per-device sessions; no business value, pure secrets). */
const EXCLUDED_TABLES = new Set(['account_sessions'])

/** Column names whose values are secrets. */
const SECRET_COLUMN_RE = /^(password_hash|pin_hash|key_hash|pin|smtp_password|session_token|push_token)$|(_api_key|_api_token|_auth_token|_secret|_password)$/

const IDENT_RE = /^[a-z_][a-z0-9_]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BackupTableStat { table: string; file: string; rows: number; redactedColumns: string[] }
export interface BackupSummary { tables: BackupTableStat[]; totalRows: number }

function appRole(): string | undefined {
  const r = process.env.DATABASE_APP_ROLE || undefined
  if (r && (!IDENT_RE.test(r) || r.length > 63)) throw new Error(`Invalid DATABASE_APP_ROLE: "${r}"`)
  return r
}

/**
 * Async generator of ZIP bytes. `onDone` receives the summary after the last byte.
 * The DB connection is released when the generator finishes, fails or is cancelled (return()).
 */
export async function* tenantBackupZip(
  tenantId: string,
  opts: { requestedBy?: string; onDone?: (summary: BackupSummary) => void } = {},
): AsyncGenerator<Uint8Array> {
  if (!UUID_RE.test(tenantId)) throw new Error('Invalid tenant id')
  const client: PoolClient = await getSharedPool().connect()
  const zip = new ZipWriter()
  const stats: BackupTableStat[] = []
  let ok = false
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    await client.query(`SELECT set_config('idle_in_transaction_session_timeout', '1800000', true)`)

    const tenantRow = await client.query(`SELECT row_to_json(t)::text AS j FROM tenants t WHERE t.id = $1`, [tenantId])
    if (tenantRow.rows.length === 0) throw new Error('Tenant not found')

    const { rows: tableRows } = await client.query<{ table_name: string }>(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`)
    const tables = tableRows.map((r) => r.table_name).filter((t) => IDENT_RE.test(t) && !EXCLUDED_TABLES.has(t))

    const { rows: colRows } = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [tables])
    const secretCols = new Map<string, string[]>()
    for (const r of colRows) {
      if (SECRET_COLUMN_RE.test(r.column_name)) {
        secretCols.set(r.table_name, [...(secretCols.get(r.table_name) || []), r.column_name])
      }
    }

    // From here on every read is subject to row level security, like withTenant().
    const role = appRole()
    if (role) await client.query(`SET LOCAL ROLE ${role}`)
    else await client.query(`SELECT set_config('app.rls_strict', 'on', true)`)

    for (const c of await zip.addFile('tenant.json', JSON.stringify(redactTenant(JSON.parse(tenantRow.rows[0].j)), null, 2))) yield c

    for (const table of tables) {
      const redacted = secretCols.get(table) || []
      const file = `tables/${table}.jsonl`
      const { header, entry } = zip.startEntry(file)
      for (const c of header) yield c
      const minus = redacted.length ? ` - ARRAY[${redacted.map((c) => `'${c}'`).join(',')}]::text[]` : ''
      // tenantId is a validated UUID and table names come from the catalog (validated identifiers).
      await client.query(`DECLARE backup_cur NO SCROLL CURSOR FOR
        SELECT (to_jsonb(t)${minus})::text AS j FROM "${table}" t WHERE t.tenant_id = '${tenantId}'`)
      let rows = 0
      for (;;) {
        const batch = await client.query<{ j: string }>(`FETCH ${BATCH} FROM backup_cur`)
        if (batch.rows.length === 0) break
        rows += batch.rows.length
        let text = ''
        for (const r of batch.rows) text += r.j + '\n'
        for (const c of await entry.write(text)) yield c
      }
      await client.query('CLOSE backup_cur')
      for (const c of await entry.end()) yield c
      stats.push({ table, file, rows, redactedColumns: redacted })
    }

    const totalRows = stats.reduce((s, t) => s + t.rows, 0)
    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      tenantId,
      tenantSlug: JSON.parse(tenantRow.rows[0].j).slug ?? null,
      snapshotAt: new Date().toISOString(),
      requestedBy: opts.requestedBy || null,
      encoding: 'JSON Lines (UTF-8), one object per row; decimals as numbers, timestamps as ISO strings (UTC, no zone)',
      excludedTables: [...EXCLUDED_TABLES],
      files: 'Uploaded binaries are not included; see tables/files.jsonl for their storage keys.',
      totalRows,
      tables: stats,
    }
    for (const c of await zip.addFile('FILES.txt',
      'Uploaded files (item images, attachments, logos) live in object storage (R2 / Spaces) and are NOT in this archive.\n' +
      'tables/files.jsonl and tables/file_versions.jsonl list every file with its storage key so they can be copied separately.\n')) yield c
    for (const c of await zip.addFile('manifest.json', JSON.stringify(manifest, null, 2))) yield c
    for (const c of zip.finish()) yield c

    await client.query('COMMIT')
    ok = true
    opts.onDone?.({ tables: stats, totalRows })
  } finally {
    if (!ok) await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}

function redactTenant(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    const col = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
    if (!SECRET_COLUMN_RE.test(col)) out[k] = v
  }
  return out
}

/** Wrap the generator as a web ReadableStream with backpressure (pull-based) and cancellation. */
export function backupStream(gen: AsyncGenerator<Uint8Array>, onError?: (err: unknown) => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (err) {
        onError?.(err)
        controller.error(err)
      }
    },
    async cancel() {
      await gen.return(undefined)
    },
  })
}
