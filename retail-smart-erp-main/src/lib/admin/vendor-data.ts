/**
 * Super-admin "Vendor data" console: browse, search and change any table that holds a vendor's
 * data, one vendor at a time, without going to the database.
 *
 * Tables come from the Drizzle schema: every table with a tenant_id column, plus the vendor's own
 * row in `tenants` ("business_profile"). All reads and writes run under withTenant (RLS) AND with an
 * explicit tenant_id filter; inserts always get the vendor's tenant_id. Secret columns (password /
 * PIN hashes, tokens, keys) are never returned or written. Logs and bookkeeping tables are read-only;
 * so are tables without an `id` column. Values are coerced per column type before they reach SQL.
 */
import { and, asc, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm'
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core'
import * as schema from '@/lib/db/schema'
import { withTenant, type TenantDb } from '@/lib/db'

export class DataError extends Error {
  constructor(message: string, public status: number, public field?: string) { super(message) }
}

export type ColumnKind = 'text' | 'number' | 'decimal' | 'boolean' | 'datetime' | 'date' | 'json' | 'uuid' | 'enum' | 'array'

export interface ColumnInfo {
  /** Database column name (what the API speaks) */
  name: string
  kind: ColumnKind
  required: boolean
  hasDefault: boolean
  /** Hidden and never written (hashes, tokens, keys) */
  secret: boolean
  /** Not editable (id, tenant_id, created/updated timestamps, generated) */
  readOnly: boolean
  enumValues?: string[]
  /** Table this column points at (foreign key), when it is one of this vendor's tables */
  references?: string
}

export interface TableInfo {
  name: string
  label: string
  group: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  /** Why the table is read-only, if it is */
  readOnlyReason?: string
}

interface TableDef {
  table: PgTable
  info: TableInfo
  /** db name → { jsKey, column } */
  columns: Map<string, { key: string; column: PgColumn }>
  idKey: string | null
  tenantKey: string | null
  orderKey: string | null
  isProfile: boolean
  /** column → referenced console table (single-column foreign keys) */
  refs: Map<string, string>
}

export const PROFILE_TABLE = 'business_profile'

/** Logs, counters and bookkeeping the app keeps itself — viewable, not editable here */
const READ_ONLY_TABLES = new Set([
  'activity_logs', 'ai_error_logs', 'file_audit_logs', 'item_change_log', 'notification_logs', 'lockout_events',
  'account_sessions', 'alert_dedupe', 'audit_runs', 'tenant_usage', 'notification_usage', 'item_tombstones',
  'supplier_balance_audit', 'tenant_sequences', 'gl_entries', 'payment_ledger', 'serial_number_movements',
  'item_cost_history', 'storage_alerts', 'subscriptions', 'subscription_payments',
  'messaging_subscriptions', 'messaging_credit_ledger',
])
const READ_ONLY_REASON: Record<string, string> = {
  gl_entries: 'Ledger entries are written by posting documents; change the document or post a journal entry instead.',
  payment_ledger: 'Written by payments; change the payment instead.',
  subscriptions: 'Use the vendor’s Billing actions (extend, change plan).',
  subscription_payments: 'Use the Payments page.',
  messaging_subscriptions: 'Use the vendor’s Messaging page (credits are topped up with an audit entry).',
  messaging_credit_ledger: 'Written by messaging top-ups.',
}

const SECRET_RE = /(_hash$|^password$|token|secret|api_key$|^otp|_otp$|private_key)/i
const SYSTEM_COLUMNS = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'is_super_admin'])
/** business_profile columns that must go through vendor actions (lifecycle side effects) */
const PROFILE_LOCKED = new Set(['id', 'business_id', 'slug', 'status', 'plan', 'plan_expires_at', 'locked_at', 'locked_reason',
  'primary_owner_id', 'deletion_scheduled_at', 'created_at', 'updated_at'])

const GROUPS: Array<[string, RegExp]> = [
  ['Business & settings', /^(settings|accounting_settings|email_settings|sms_settings|letter_heads|print_templates|label_templates|workspace_configs|setup_progress|module_access|custom_roles|role_permission_overrides|tenant_|notification_|in_app_notifications|saved_reports|api_keys|user_devices|users|user_warehouses|account_tenants)/],
  ['POS & shifts', /^(pos_|held_sales|day_end_sessions|modes_of_payment|cancellation_reasons)/],
  ['Sales', /^(sales|sale_|quotation|refunds|payments$|layaway|gift_card|promotion|credit_note|collections|payment_requests|commission)/],
  ['Customers & loyalty', /^(customer|loyalty|reservations|appointments|document_comments)/],
  ['Items & stock', /^(items|item_|categories|units|warehouse|stock_|price_list|recipe|modifier|waste_log|landed_cost)/],
  ['Purchasing & suppliers', /^(purchase|supplier|debit_note)/],
  ['Accounting', /^(chart_of_accounts|journal|gl_entries|fiscal_years|cost_centers|budget|bank_|payment_|period_closing|recurring_journal|tax_|dunning|einvoice)/],
  ['HR & payroll', /^(employee|salary|payroll|advance_recovery)/],
  ['Restaurant', /^(restaurant_|kitchen_|table_)/],
  ['Vehicles & workshop', /^(vehicle|work_order|inspection|insurance|labor_guides|part_compatibility|core_returns|service_type|estimate_templates|dealer|dealership|test_drives|trade_in|financing)/],
  ['Files & messages', /^(files|file_|staff_chat|ai_|import_)/],
]

function groupFor(name: string): string {
  for (const [g, re] of GROUPS) if (re.test(name)) return g
  return 'Other'
}

function labelFor(name: string): string {
  const s = name.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function kindOf(c: PgColumn): ColumnKind {
  const t = c.columnType
  if (c.enumValues && c.enumValues.length && t === 'PgEnumColumn') return 'enum'
  if (t === 'PgUUID') return 'uuid'
  if (t === 'PgBoolean') return 'boolean'
  if (t === 'PgNumeric') return 'decimal'
  if (t === 'PgInteger' || t === 'PgSmallInt' || t === 'PgSerial' || t === 'PgBigInt53' || t === 'PgDoublePrecision' || t === 'PgReal' || t === 'PgBigSerial53') return 'number'
  if (t === 'PgTimestamp' || t === 'PgTimestampString') return 'datetime'
  if (t === 'PgDate' || t === 'PgDateString') return 'date'
  if (t === 'PgJsonb' || t === 'PgJson') return 'json'
  if (t === 'PgArray') return 'array'
  if (c.enumValues && c.enumValues.length) return 'enum'
  return 'text'
}

let registry: Map<string, TableDef> | null = null

function buildRegistry(): Map<string, TableDef> {
  const out = new Map<string, TableDef>()
  const tenantTableNames = new Set<string>()
  const tables: PgTable[] = []
  for (const v of Object.values(schema)) {
    if (!(v instanceof PgTable)) continue
    const cfg = getTableConfig(v)
    if (cfg.name === 'tenants' || cfg.columns.some((c) => c.name === 'tenant_id')) {
      tables.push(v)
      tenantTableNames.add(cfg.name)
    }
  }
  for (const table of tables) {
    const cfg = getTableConfig(table)
    const isProfile = cfg.name === 'tenants'
    const name = isProfile ? PROFILE_TABLE : cfg.name
    const columns = new Map<string, { key: string; column: PgColumn }>()
    for (const [key, column] of Object.entries(getTableColumns(table))) columns.set(column.name, { key, column: column as PgColumn })
    const idKey = columns.get('id')?.key ?? null
    const readOnlyTable = READ_ONLY_TABLES.has(name) || !idKey
    const info: TableInfo = isProfile
      ? { name, label: 'Business profile', group: 'Business & settings', canCreate: false, canEdit: true, canDelete: false }
      : {
          name, label: labelFor(name), group: groupFor(name),
          canCreate: !readOnlyTable, canEdit: !readOnlyTable, canDelete: !readOnlyTable,
          ...(readOnlyTable ? { readOnlyReason: READ_ONLY_REASON[name] ?? (idKey ? 'Kept by the app (log or bookkeeping); view only.' : 'This table has no row id; view only.') } : {}),
        }
    out.set(name, {
      table, info, columns, idKey,
      tenantKey: isProfile ? null : columns.get('tenant_id')?.key ?? null,
      orderKey: columns.get('created_at')?.key ?? idKey,
      isProfile,
      refs: new Map(),
    })
  }
  // Foreign keys → referenced table names (only to tables in this console)
  for (const def of out.values()) {
    const cfg = getTableConfig(def.table)
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference()
      const target = getTableConfig(ref.foreignTable).name
      if (!tenantTableNames.has(target) || ref.columns.length !== 1) continue
      def.refs.set(ref.columns[0].name, target === 'tenants' ? PROFILE_TABLE : target)
    }
  }
  return out
}

function defs(): Map<string, TableDef> {
  if (!registry) registry = buildRegistry()
  return registry
}

function getDef(name: string): TableDef {
  const d = defs().get(name)
  if (!d) throw new DataError('Unknown table', 404)
  return d
}

function columnInfo(def: TableDef): ColumnInfo[] {
  const refs = def.refs
  return Array.from(def.columns.entries()).map(([name, { column }]) => {
    const secret = SECRET_RE.test(name)
    const readOnly = secret || (def.isProfile ? PROFILE_LOCKED.has(name) : SYSTEM_COLUMNS.has(name)) || column.columnType === 'PgSerial'
    return {
      name,
      kind: kindOf(column),
      required: column.notNull && !column.hasDefault && !readOnly,
      hasDefault: column.hasDefault,
      secret,
      readOnly,
      ...(column.enumValues?.length ? { enumValues: [...column.enumValues] } : {}),
      ...(refs.get(name) && !secret ? { references: refs.get(name) } : {}),
    }
  })
}

export function listVendorTables(): TableInfo[] {
  return Array.from(defs().values()).map((d) => d.info)
    .sort((a, b) => (a.name === PROFILE_TABLE ? -1 : b.name === PROFILE_TABLE ? 1 : a.group.localeCompare(b.group) || a.label.localeCompare(b.label)))
}

function serialize(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, { key }] of def.columns) {
    if (SECRET_RE.test(name)) { out[name] = row[key] == null ? null : '••••••'; continue }
    const v = row[key]
    out[name] = v instanceof Date ? v.toISOString() : v
  }
  return out
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function coerce(info: ColumnInfo, raw: unknown): unknown {
  if (raw === undefined) return undefined
  const blank = raw === null || (typeof raw === 'string' && raw.trim() === '' && info.kind !== 'text')
  if (blank) {
    if (info.required) throw new DataError(`${info.name} is required`, 400, info.name)
    return null
  }
  const bad = (what: string) => new DataError(`${info.name}: ${what}`, 400, info.name)
  switch (info.kind) {
    case 'text': return String(raw)
    case 'uuid': {
      const s = String(raw).trim()
      if (!UUID_RE.test(s)) throw bad('must be an id (uuid)')
      return s
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n)) throw bad('must be a number')
      return n
    }
    case 'decimal': {
      const s = String(raw).trim()
      if (!/^-?\d+(\.\d+)?$/.test(s)) throw bad('must be a number')
      return s
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      if (raw === 'true' || raw === '1' || raw === 1) return true
      if (raw === 'false' || raw === '0' || raw === 0) return false
      throw bad('must be true or false')
    }
    case 'datetime': {
      const d = new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw bad('must be a date and time')
      return d
    }
    case 'date': {
      const s = String(raw).trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) throw bad('must be a date (YYYY-MM-DD)')
      return s
    }
    case 'enum': {
      const s = String(raw)
      if (info.enumValues && !info.enumValues.includes(s)) throw bad(`must be one of ${info.enumValues.join(', ')}`)
      return s
    }
    case 'json':
    case 'array': {
      if (typeof raw !== 'string') return raw
      try { return JSON.parse(raw) } catch { throw bad('must be valid JSON') }
    }
  }
}

/** Database values → JS keys for drizzle, coercing types; rejects secret / read-only / unknown columns */
function toValues(def: TableDef, input: Record<string, unknown>, mode: 'insert' | 'update'): Record<string, unknown> {
  const infos = new Map(columnInfo(def).map((c) => [c.name, c]))
  const values: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(input)) {
    const info = infos.get(name)
    if (!info) throw new DataError(`Unknown column ${name}`, 400, name)
    if (info.readOnly) continue
    const v = coerce(info, raw)
    if (v !== undefined) values[def.columns.get(name)!.key] = v
  }
  if (mode === 'insert') {
    for (const info of infos.values()) {
      if (info.required && values[def.columns.get(info.name)!.key] == null) throw new DataError(`${info.name} is required`, 400, info.name)
    }
  }
  if (Object.keys(values).length === 0) throw new DataError('Nothing to change (hidden and system columns cannot be written)', 400)
  if (mode === 'update' && def.columns.has('updated_at')) values[def.columns.get('updated_at')!.key] = new Date()
  return values
}

function scope(def: TableDef, tenantId: string): SQL {
  const t = def.table as unknown as Record<string, PgColumn>
  return def.isProfile ? eq(t[def.idKey!], tenantId) : eq(t[def.tenantKey!], tenantId)
}

function byId(def: TableDef, tenantId: string, id: string): SQL {
  if (!def.idKey) throw new DataError('This table has no row id', 400)
  if (!UUID_RE.test(id) && def.columns.get('id')?.column.columnType === 'PgUUID') throw new DataError('Row not found', 404)
  const t = def.table as unknown as Record<string, PgColumn>
  return and(scope(def, tenantId), eq(t[def.idKey], id))!
}

/** Map Postgres errors to messages an admin can act on */
export function pgErrorToDataError(err: unknown): DataError | null {
  const e = err as { code?: string; detail?: string; constraint?: string; column?: string; cause?: { code?: string; detail?: string; constraint?: string; column?: string } }
  const code = e?.code ?? e?.cause?.code
  const detail = e?.detail ?? e?.cause?.detail
  const constraint = e?.constraint ?? e?.cause?.constraint
  if (code === '23503') {
    const usedBy = detail?.match(/referenced from table "([^"]+)"/)?.[1]
    if (usedBy) return new DataError(`This row is still used by ${usedBy.replace(/_/g, ' ')}. Change or remove those rows first.`, 409)
    const col = detail?.match(/Key \(([^)]+)\)/)?.[1]
    return new DataError(`${col ?? 'A reference'} points at a record that does not exist for this vendor.`, 400, col)
  }
  if (code === '23505') return new DataError(`A row with the same value already exists${detail ? ` (${detail})` : constraint ? ` (${constraint})` : ''}.`, 409)
  if (code === '23502') return new DataError(`${e?.column ?? e?.cause?.column ?? 'A required value'} is required.`, 400)
  if (code === '23514') return new DataError(`The values break a rule of this table${constraint ? ` (${constraint})` : ''}.`, 400)
  if (code === '22P02' || code === '22007' || code === '22008' || code === '22003') return new DataError(`A value has the wrong format${detail ? ` (${detail})` : ''}.`, 400)
  return null
}

async function run<T>(tenantId: string, fn: (tdb: TenantDb) => Promise<T>): Promise<T> {
  try {
    return await withTenant(tenantId, fn)
  } catch (err) {
    if (err instanceof DataError) throw err
    const mapped = pgErrorToDataError(err)
    if (mapped) throw mapped
    throw err
  }
}

export interface RowsQuery { q?: string; page?: number; pageSize?: number; sort?: string; dir?: 'asc' | 'desc'; filterColumn?: string; filterValue?: string }

export async function listRows(tenantId: string, tableName: string, query: RowsQuery) {
  const def = getDef(tableName)
  const columns = columnInfo(def)
  const t = def.table as unknown as Record<string, PgColumn>
  const page = Math.max(1, query.page || 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50))
  const where: SQL[] = [scope(def, tenantId)]

  if (query.filterColumn && query.filterValue !== undefined) {
    const c = def.columns.get(query.filterColumn)
    if (!c || SECRET_RE.test(query.filterColumn)) throw new DataError('Unknown filter column', 400)
    where.push(sql`${c.column}::text = ${query.filterValue}`)
  }
  const q = query.q?.trim()
  if (q) {
    const searchable = columns.filter((c) => !c.secret && ['text', 'uuid', 'enum', 'decimal', 'number', 'date'].includes(c.kind))
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    const parts = searchable.map((c) => sql`${def.columns.get(c.name)!.column}::text ILIKE ${like}`)
    if (parts.length) where.push(sql`(${sql.join(parts, sql` OR `)})`)
  }
  const sortCol = query.sort && def.columns.get(query.sort) && !SECRET_RE.test(query.sort) ? def.columns.get(query.sort)!.column : def.orderKey ? t[def.orderKey] : null
  const order = sortCol ? [(query.dir === 'asc' ? asc : desc)(sortCol)] : []

  const { rows, total } = await run(tenantId, async (tdb) => {
    const cond = and(...where)
    const [rowsRes, countRes] = await Promise.all([
      tdb.select().from(def.table).where(cond).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
      tdb.select({ n: sql<number>`count(*)::int` }).from(def.table).where(cond),
    ])
    return { rows: rowsRes as Record<string, unknown>[], total: countRes[0]?.n ?? 0 }
  })
  return { table: def.info, columns, rows: rows.map((r) => serialize(def, r)), total, page, pageSize }
}

export async function getRow(tenantId: string, tableName: string, id: string) {
  const def = getDef(tableName)
  const [row] = await run(tenantId, (tdb) => tdb.select().from(def.table).where(byId(def, tenantId, id)).limit(1))
  if (!row) throw new DataError('Row not found', 404)
  return serialize(def, row as Record<string, unknown>)
}

export async function insertRow(tenantId: string, tableName: string, input: Record<string, unknown>) {
  const def = getDef(tableName)
  if (!def.info.canCreate) throw new DataError(def.info.readOnlyReason || 'Rows cannot be added to this table here', 400)
  const values = toValues(def, input, 'insert')
  if (def.tenantKey) values[def.tenantKey] = tenantId
  const [row] = await run(tenantId, (tdb) => tdb.insert(def.table).values(values).returning())
  return serialize(def, row as Record<string, unknown>)
}

export async function updateRow(tenantId: string, tableName: string, id: string, input: Record<string, unknown>) {
  const def = getDef(tableName)
  if (!def.info.canEdit) throw new DataError(def.info.readOnlyReason || 'This table cannot be changed here', 400)
  const values = toValues(def, input, 'update')
  return run(tenantId, async (tdb) => {
    const [before] = await tdb.select().from(def.table).where(byId(def, tenantId, id)).limit(1)
    if (!before) throw new DataError('Row not found', 404)
    const [after] = await tdb.update(def.table).set(values).where(byId(def, tenantId, id)).returning()
    return { before: serialize(def, before as Record<string, unknown>), after: serialize(def, after as Record<string, unknown>) }
  })
}

export async function deleteRow(tenantId: string, tableName: string, id: string) {
  const def = getDef(tableName)
  if (!def.info.canDelete) throw new DataError(def.info.readOnlyReason || 'Rows cannot be deleted from this table here', 400)
  return run(tenantId, async (tdb) => {
    const [before] = await tdb.delete(def.table).where(byId(def, tenantId, id)).returning()
    if (!before) throw new DataError('Row not found', 404)
    return serialize(def, before as Record<string, unknown>)
  })
}

/** Rows per table for this vendor (one query; tables are small per tenant, tenant_id is indexed) */
export async function countRows(tenantId: string): Promise<Record<string, number>> {
  const list = Array.from(defs().values()).filter((d) => !d.isProfile)
  const parts = list.map((d) => sql`SELECT ${d.info.name}::text AS t, count(*)::int AS n FROM ${d.table} WHERE ${scope(d, tenantId)}`)
  const res = await run(tenantId, (tdb) => tdb.execute(sql.join(parts, sql` UNION ALL `)))
  const out: Record<string, number> = { [PROFILE_TABLE]: 1 }
  for (const r of (res as unknown as { rows: Array<{ t: string; n: number }> }).rows ?? (res as unknown as Array<{ t: string; n: number }>)) out[r.t] = Number(r.n)
  return out
}

/** Copy for the audit log: secrets masked, long values cut */
export function auditCopy(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && v.length > 300) out[k] = `${v.slice(0, 300)}…`
    else if (v && typeof v === 'object') { const s = JSON.stringify(v); out[k] = s.length > 300 ? `${s.slice(0, 300)}…` : v }
    else out[k] = v
  }
  return out
}
