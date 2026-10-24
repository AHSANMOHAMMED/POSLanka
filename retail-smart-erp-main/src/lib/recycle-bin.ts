/**
 * Recycle bin (drizzle/0172): a vendor's "delete" never loses an important record.
 *
 *  - archive entities (master data: items, customers, suppliers, ...): the vendor's delete hides the
 *    row (is_active = false, or the entity's equivalent) and leaves a bin row with a JSON snapshot.
 *  - delete entities (disposable drafts: held sales, draft orders, ...): the route keeps its hard
 *    delete, but first records the row and its child rows here so a super admin can re-insert them.
 *
 * Only a platform super admin restores (undo) or purges (permanent delete) — see
 * /api/sys-control/vendors/[id]/recycle-bin. Everything runs under the vendor's RLS context and with
 * an explicit tenant_id filter. Table / column names come from the fixed registry below, never from
 * a request.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { withTenant, type TenantDb } from '@/lib/db'

export type RecycleMode = 'archive' | 'delete'

interface ChildDef {
  table: string
  fk: string
}

export interface RecycleEntityDef {
  table: string
  label: string
  mode: RecycleMode
  /** archive: the column that hides the row, and its "active" / "archived" values */
  activeColumn?: string
  activeValue?: string | boolean
  archivedValue?: string | boolean
  /** Snapshot columns tried in order for the bin's display name */
  nameColumns: string[]
  /** delete: child rows saved with the parent (re-inserted on restore) */
  children?: ChildDef[]
}

const A = (table: string, label: string, nameColumns: string[] = ['name'], extra: Partial<RecycleEntityDef> = {}): RecycleEntityDef =>
  ({ table, label, mode: 'archive', activeColumn: 'is_active', activeValue: true, archivedValue: false, nameColumns, ...extra })
const D = (table: string, label: string, nameColumns: string[], children: ChildDef[] = []): RecycleEntityDef =>
  ({ table, label, mode: 'delete', nameColumns, children })

export const RECYCLE_ENTITIES = {
  // ---- master data: archived ----
  item: A('items', 'Item', ['name', 'sku', 'barcode']),
  category: A('categories', 'Category'),
  customer: A('customers', 'Customer', ['name', 'phone', 'email']),
  supplier: A('suppliers', 'Supplier'),
  unit: A('units', 'Unit', ['name', 'code']),
  price_list: A('price_lists', 'Price list'),
  promotion: A('promotions', 'Promotion'),
  warehouse: A('warehouses', 'Warehouse', ['name', 'code']),
  user: A('users', 'Staff user', ['full_name', 'email']),
  service_type: A('service_types', 'Service type'),
  service_type_group: A('service_type_groups', 'Service type group'),
  recipe: A('recipes', 'Recipe'),
  modifier_group: A('modifier_groups', 'Modifier group'),
  modifier: A('modifiers', 'Modifier'),
  label_template: A('label_templates', 'Label template'),
  print_template: A('print_templates', 'Print template'),
  letter_head: A('letter_heads', 'Letter head'),
  cancellation_reason: A('cancellation_reasons', 'Cancellation reason', ['reason']),
  commission_rate: A('commission_rates', 'Commission rate', ['id']),
  custom_role: A('custom_roles', 'Custom role'),
  dealer: A('dealers', 'Dealer', ['name', 'code']),
  estimate_template: A('estimate_templates', 'Estimate template'),
  financing_option: A('financing_options', 'Financing option', ['lender_name']),
  inspection_template: A('inspection_templates', 'Inspection template'),
  insurance_assessor: A('insurance_assessors', 'Insurance assessor'),
  insurance_company: A('insurance_companies', 'Insurance company'),
  notification_template: A('notification_templates', 'Notification template'),
  restaurant_table: A('restaurant_tables', 'Restaurant table'),
  salary_component: A('salary_components', 'Salary component'),
  salary_structure: A('salary_structures', 'Salary structure'),
  vehicle_type: A('vehicle_types', 'Vehicle type'),
  vehicle_inventory: A('vehicle_inventory', 'Vehicle (stock)', ['stock_no', 'registration_no', 'description']),
  account: A('chart_of_accounts', 'Account', ['name', 'account_number']),
  bank_account: A('bank_accounts', 'Bank account', ['account_name', 'bank_name', 'account_number']),
  cost_center: A('cost_centers', 'Cost center'),
  tax_template: A('tax_templates', 'Tax template'),
  mode_of_payment: A('modes_of_payment', 'Mode of payment', ['name'], { activeColumn: 'is_enabled' }),
  payment_term: A('payment_terms', 'Payment term'),
  payment_terms_template: A('payment_terms_templates', 'Payment terms template'),
  dunning_type: A('dunning_types', 'Dunning type'),
  recurring_journal_template: A('recurring_journal_templates', 'Recurring journal'),
  pos_profile: A('pos_profiles', 'POS profile', ['name', 'code'], { activeColumn: 'status', activeValue: 'active', archivedValue: 'inactive' }),
  loyalty_program: A('loyalty_programs', 'Loyalty program', ['name'], { activeColumn: 'status', activeValue: 'active', archivedValue: 'inactive' }),

  // ---- disposable drafts / records: hard-deleted with a snapshot ----
  held_sale: D('held_sales', 'Held sale', ['hold_number', 'customer_name']),
  sales_order: D('sales_orders', 'Sales order (draft)', ['order_no', 'customer_name'], [{ table: 'sales_order_items', fk: 'sales_order_id' }]),
  purchase_order: D('purchase_orders', 'Purchase order (draft)', ['order_no'], [{ table: 'purchase_order_items', fk: 'purchase_order_id' }]),
  purchase: D('purchases', 'Purchase invoice (draft)', ['purchase_no', 'supplier_invoice_no'], [{ table: 'purchase_items', fk: 'purchase_id' }]),
  purchase_requisition: D('purchase_requisitions', 'Purchase requisition (draft)', ['requisition_no'], [{ table: 'purchase_requisition_items', fk: 'requisition_id' }]),
  supplier_quotation: D('supplier_quotations', 'Supplier quotation (draft)', ['quotation_no'], [{ table: 'supplier_quotation_items', fk: 'quotation_id' }]),
  stock_take: D('stock_takes', 'Stock take (draft)', ['count_no'], [{ table: 'stock_take_items', fk: 'stock_take_id' }]),
  stock_transfer: D('stock_transfers', 'Stock transfer (draft)', ['transfer_no'], [{ table: 'stock_transfer_items', fk: 'transfer_id' }]),
  journal_entry: D('journal_entries', 'Journal entry (draft)', ['entry_number'], [{ table: 'journal_entry_items', fk: 'journal_entry_id' }]),
  budget: D('budgets', 'Budget (draft)', ['name'], [{ table: 'budget_items', fk: 'budget_id' }]),
  period_closing_voucher: D('period_closing_vouchers', 'Period closing (draft)', ['closing_date', 'id']),
  fiscal_year: D('fiscal_years', 'Fiscal year', ['name']),
  insurance_estimate: D('insurance_estimates', 'Insurance estimate (draft)', ['estimate_no', 'claim_number'], [
    { table: 'insurance_estimate_items', fk: 'estimate_id' }, { table: 'insurance_estimate_attachments', fk: 'estimate_id' }]),
  work_order: D('work_orders', 'Work order (draft)', ['order_no', 'customer_name'], [
    { table: 'work_order_parts', fk: 'work_order_id' }, { table: 'work_order_services', fk: 'work_order_id' }]),
  restaurant_order: D('restaurant_orders', 'Restaurant order (empty)', ['order_no']),
  layaway: D('layaways', 'Layaway (no payments)', ['layaway_no'], [{ table: 'layaway_items', fk: 'layaway_id' }]),
  appointment: D('appointments', 'Appointment', ['customer_name', 'service_name']),
  gift_card: D('gift_cards', 'Gift card (unused)', ['card_number']),
  saved_report: D('saved_reports', 'Saved report', ['name']),
  collection: D('collections', 'Collection', ['name'], [{ table: 'collection_files', fk: 'collection_id' }]),
  labor_guide: D('labor_guides', 'Labor guide', ['id']),
  vehicle: D('vehicles', 'Customer vehicle', ['license_plate', 'make', 'model']),
  test_drive: D('test_drives', 'Test drive', ['customer_name', 'scheduled_date']),
  trade_in: D('trade_in_vehicles', 'Trade-in', ['make', 'model']),
  vehicle_import: D('vehicle_imports', 'Vehicle import', ['import_no']),
  vehicle_document: D('vehicle_documents', 'Vehicle document', ['name', 'document_no']),
  vehicle_expense: D('vehicle_expenses', 'Vehicle expense', ['description', 'receipt_no']),
  vehicle_warranty: D('vehicle_warranties', 'Vehicle warranty', ['policy_number']),
  vehicle_sale_detail: D('vehicle_sale_details', 'Vehicle sale details', ['id']),
} satisfies Record<string, RecycleEntityDef>

export type RecycleEntityType = keyof typeof RECYCLE_ENTITIES

export function recycleEntityDef(type: string): RecycleEntityDef | null {
  return (RECYCLE_ENTITIES as Record<string, RecycleEntityDef>)[type] ?? null
}

/** Columns never copied into a snapshot (hashes, tokens, keys) — same rule as the vendor data console */
const SECRET_RE = /(_hash$|^password$|token|secret|api_key$|^otp|_otp$|private_key)/i

function rowsOf<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]
}

function displayNameOf(def: RecycleEntityDef, row: Record<string, unknown>): string {
  for (const c of def.nameColumns) {
    const v = row[c]
    if (v !== null && v !== undefined && String(v).trim()) return String(v).slice(0, 255)
  }
  return def.label
}

function asSqlValue(v: string | boolean): SQL {
  return typeof v === 'boolean' ? (v ? sql`true` : sql`false`) : sql`${v}`
}

export class RecycleBinError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export interface RecycleOptions {
  tenantId: string
  entityType: RecycleEntityType
  entityId: string
  userId?: string | null
  userName?: string | null
}

/**
 * Vendor delete → recycle bin. Call inside the route's withTenant / transaction:
 *  - archive entities: hides the row and records it. Returns null when the row does not exist.
 *  - delete entities: only records row + children; call it BEFORE the route's own delete.
 */
export async function moveToRecycleBin(db: Pick<TenantDb, 'execute'>, opts: RecycleOptions): Promise<{ binId: string; displayName: string } | null> {
  const def = recycleEntityDef(opts.entityType)
  if (!def) throw new Error(`Unknown recycle-bin entity: ${opts.entityType}`)
  const table = sql.identifier(def.table)

  const [found] = rowsOf<{ row: Record<string, unknown> }>(await db.execute(sql`
    SELECT to_jsonb(t) AS row FROM ${table} t
    WHERE t.id = ${opts.entityId}::uuid AND t.tenant_id = ${opts.tenantId}::uuid
    FOR UPDATE
  `))
  if (!found) return null
  const row = found.row
  const displayName = displayNameOf(def, row)

  let children: Record<string, unknown[]> | null = null
  let snapshot: Record<string, unknown> = row
  if (def.mode === 'archive') {
    snapshot = Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET_RE.test(k)))
    const col = sql.identifier(def.activeColumn!)
    const hasUpdatedAt = 'updated_at' in row
    await db.execute(sql`
      UPDATE ${table} SET ${col} = ${asSqlValue(def.archivedValue!)}${hasUpdatedAt ? sql`, updated_at = now()` : sql``}
      WHERE id = ${opts.entityId}::uuid AND tenant_id = ${opts.tenantId}::uuid
    `)
    // Already in the bin (e.g. a second click): keep the first entry
    const [open] = rowsOf<{ id: string }>(await db.execute(sql`
      SELECT id FROM recycle_bin
      WHERE tenant_id = ${opts.tenantId}::uuid AND entity_type = ${opts.entityType} AND entity_id = ${opts.entityId}::uuid
        AND restored_at IS NULL AND purged_at IS NULL
      LIMIT 1
    `))
    if (open) return { binId: open.id, displayName }
  } else if (def.children?.length) {
    children = {}
    for (const c of def.children) {
      const [r] = rowsOf<{ rows: unknown[] }>(await db.execute(sql`
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) AS rows FROM ${sql.identifier(c.table)} c
        WHERE c.${sql.identifier(c.fk)} = ${opts.entityId}::uuid
      `))
      children[c.table] = r?.rows ?? []
    }
  }

  const [ins] = rowsOf<{ id: string }>(await db.execute(sql`
    INSERT INTO recycle_bin (tenant_id, entity_type, entity_table, entity_id, display_name, mode, snapshot, children, deleted_by, deleted_by_name)
    VALUES (${opts.tenantId}::uuid, ${opts.entityType}, ${def.table}, ${opts.entityId}::uuid, ${displayName}, ${def.mode},
            ${JSON.stringify(snapshot)}::jsonb, ${children ? JSON.stringify(children) : null}::jsonb,
            (SELECT u.id FROM users u WHERE u.id = ${opts.userId ?? null}::uuid), ${opts.userName ?? null})
    RETURNING id
  `))
  return { binId: ins.id, displayName }
}

/**
 * SQL condition: the row is not in the recycle bin (archived and not restored). For lists that also
 * show deactivated rows (e.g. includeInactive) so archived ones stay hidden.
 */
export function notInRecycleBin(entityType: RecycleEntityType, idColumn: PgColumn | SQL): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM recycle_bin rb WHERE rb.entity_id = ${idColumn} AND rb.entity_type = ${entityType} AND rb.restored_at IS NULL AND rb.purged_at IS NULL)`
}

// ---------------------------------------------------------------------------------------------
// Super admin side
// ---------------------------------------------------------------------------------------------

export interface BinRow {
  id: string
  entity_type: string
  entity_table: string
  entity_id: string
  display_name: string | null
  mode: RecycleMode
  snapshot: Record<string, unknown> | null
  children: Record<string, Array<Record<string, unknown>>> | null
  deleted_by: string | null
  deleted_by_name: string | null
  deleted_at: string
  restored_at: string | null
  restored_by: string | null
  purged_at: string | null
  purged_by: string | null
}

export interface BinListQuery {
  status?: 'open' | 'restored' | 'purged' | 'all'
  entityType?: string
  q?: string
  page?: number
  pageSize?: number
}

export async function listRecycleBin(tenantId: string, query: BinListQuery) {
  const page = Math.max(1, query.page || 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 25))
  const where: SQL[] = [sql`tenant_id = ${tenantId}::uuid`]
  const status = query.status ?? 'open'
  if (status === 'open') where.push(sql`restored_at IS NULL AND purged_at IS NULL`)
  else if (status === 'restored') where.push(sql`restored_at IS NOT NULL`)
  else if (status === 'purged') where.push(sql`purged_at IS NOT NULL`)
  if (query.entityType) where.push(sql`entity_type = ${query.entityType}`)
  const q = query.q?.trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    where.push(sql`(display_name ILIKE ${like} OR deleted_by_name ILIKE ${like} OR entity_id::text = ${q})`)
  }
  const cond = sql.join(where, sql` AND `)
  return withTenant(tenantId, async (db) => {
    const [{ total }] = rowsOf<{ total: number }>(await db.execute(sql`SELECT count(*)::int AS total FROM recycle_bin WHERE ${cond}`))
    const rows = rowsOf<Omit<BinRow, 'snapshot' | 'children'>>(await db.execute(sql`
      SELECT id, entity_type, entity_table, entity_id, display_name, mode, deleted_by, deleted_by_name,
             deleted_at, restored_at, restored_by, purged_at, purged_by
      FROM recycle_bin WHERE ${cond}
      ORDER BY deleted_at DESC, id
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `))
    const types = rowsOf<{ entity_type: string; n: number }>(await db.execute(sql`
      SELECT entity_type, count(*)::int AS n FROM recycle_bin
      WHERE tenant_id = ${tenantId}::uuid AND restored_at IS NULL AND purged_at IS NULL
      GROUP BY entity_type ORDER BY entity_type
    `))
    return {
      rows: rows.map((r) => ({ ...r, label: recycleEntityDef(r.entity_type)?.label ?? r.entity_type, status: binStatus(r) })),
      total,
      page,
      pageSize,
      openByType: types.map((t) => ({ type: t.entity_type, label: recycleEntityDef(t.entity_type)?.label ?? t.entity_type, count: t.n })),
    }
  })
}

function binStatus(r: { restored_at: string | null; purged_at: string | null }) {
  return r.purged_at ? 'purged' : r.restored_at ? 'restored' : 'open'
}

export async function getRecycleBinEntry(tenantId: string, binId: string) {
  return withTenant(tenantId, async (db) => {
    const [r] = rowsOf<BinRow>(await db.execute(sql`SELECT * FROM recycle_bin WHERE id = ${binId}::uuid AND tenant_id = ${tenantId}::uuid`))
    if (!r) throw new RecycleBinError('Recycle bin entry not found', 404)
    return { ...r, label: recycleEntityDef(r.entity_type)?.label ?? r.entity_type, status: binStatus(r) }
  })
}

async function lockOpenEntry(db: TenantDb, tenantId: string, binId: string) {
  const [r] = rowsOf<BinRow>(await db.execute(sql`SELECT * FROM recycle_bin WHERE id = ${binId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`))
  if (!r) throw new RecycleBinError('Recycle bin entry not found', 404)
  if (r.restored_at) throw new RecycleBinError('This entry was already restored.', 409)
  if (r.purged_at) throw new RecycleBinError('This entry was already purged.', 409)
  const def = recycleEntityDef(r.entity_type)
  if (!def || def.table !== r.entity_table) throw new RecycleBinError('Unknown record type in the recycle bin.', 400)
  return { entry: r, def }
}

/** Restore: archive → re-activate (previous state); delete → re-insert the row and its child rows. */
export async function restoreFromRecycleBin(tenantId: string, binId: string, adminId: string) {
  return withTenant(tenantId, async (db) => {
    const { entry, def } = await lockOpenEntry(db, tenantId, binId)
    const table = sql.identifier(def.table)
    if (def.mode === 'archive') {
      const col = sql.identifier(def.activeColumn!)
      const prev = entry.snapshot?.[def.activeColumn!]
      // Put back the state it had before the delete (a row that was already deactivated stays so)
      const value = prev !== undefined && prev !== null && prev !== def.archivedValue ? (prev as string | boolean) : def.activeValue!
      const res = rowsOf<{ id: string; updated: boolean }>(await db.execute(sql`
        UPDATE ${table} SET ${col} = ${asSqlValue(value)}${entry.snapshot && 'updated_at' in entry.snapshot ? sql`, updated_at = now()` : sql``}
        WHERE id = ${entry.entity_id}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING id
      `))
      if (!res.length) throw new RecycleBinError('The record no longer exists, so it cannot be restored.', 409)
      if (entry.entity_type === 'user') {
        // The vendor delete also switched off the user's company membership
        await db.execute(sql`
          UPDATE account_tenants SET is_active = true
          WHERE tenant_id = ${tenantId}::uuid
            AND account_id = (SELECT account_id FROM users WHERE id = ${entry.entity_id}::uuid AND tenant_id = ${tenantId}::uuid)
        `)
      }
    } else {
      if (!entry.snapshot) throw new RecycleBinError('This entry has no saved copy to restore.', 409)
      const [exists] = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM ${table} WHERE id = ${entry.entity_id}::uuid`))
      if (exists) throw new RecycleBinError('A record with the same id already exists.', 409)
      if (entry.snapshot.tenant_id !== tenantId) throw new RecycleBinError('The saved copy belongs to another vendor.', 400)
      await db.execute(sql`
        INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, ${JSON.stringify(entry.snapshot)}::jsonb)
      `)
      for (const c of def.children ?? []) {
        const rows = entry.children?.[c.table]
        if (!rows?.length) continue
        if (rows.some((r) => 'tenant_id' in r && r.tenant_id !== tenantId)) throw new RecycleBinError('The saved copy belongs to another vendor.', 400)
        const t = sql.identifier(c.table)
        await db.execute(sql`INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(NULL::${t}, ${JSON.stringify(rows)}::jsonb)`)
      }
    }
    await db.execute(sql`UPDATE recycle_bin SET restored_at = now(), restored_by = ${adminId}::uuid WHERE id = ${binId}::uuid`)
    return entry
  })
}

/**
 * Purge: archive → permanently delete the row (refused while other records use it; the pg error is
 * mapped by the caller); delete → the row is already gone, drop the saved copy.
 */
export async function purgeFromRecycleBin(tenantId: string, binId: string, adminId: string) {
  return withTenant(tenantId, async (db) => {
    const { entry, def } = await lockOpenEntry(db, tenantId, binId)
    if (def.mode === 'archive') {
      await db.execute(sql`DELETE FROM ${sql.identifier(def.table)} WHERE id = ${entry.entity_id}::uuid AND tenant_id = ${tenantId}::uuid`)
      if (entry.entity_type === 'item') {
        // Offline catalogs drop the item on their next delta sync
        await db.execute(sql`
          INSERT INTO item_tombstones (tenant_id, item_id, deleted_at) VALUES (${tenantId}::uuid, ${entry.entity_id}::uuid, now())
          ON CONFLICT (tenant_id, item_id) DO UPDATE SET deleted_at = now()
        `)
      }
    }
    await db.execute(sql`
      UPDATE recycle_bin SET purged_at = now(), purged_by = ${adminId}::uuid, children = NULL,
        snapshot = CASE WHEN mode = 'delete' THEN NULL ELSE snapshot END
      WHERE id = ${binId}::uuid
    `)
    return entry
  })
}
