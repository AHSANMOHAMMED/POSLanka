/**
 * W6: catalog delta sync for offline POS devices (GET /api/items/sync) and the offline bundle
 * (GET /api/pos/offline-bundle).
 *
 * Keyset: every item row gets a sync timestamp = GREATEST(items.updated_at, warehouse_stock.updated_at
 * for the requested warehouse). Pages are ordered by (sync_ts, id), so price/name changes AND stock
 * movements surface in the same stream. The cursor is opaque base64url JSON:
 *   { t: '<timestamp text, microseconds>', i: '<item uuid>', f: 1 while a full snapshot is paging }
 *
 * - No cursor  → full snapshot (active items only), paged.
 * - Delta      → every item whose row or branch stock changed after the cursor (inactive included,
 *                so the device can hide deactivated items) + tombstones of hard-deleted items.
 * - The final cursor of a run (hasMore=false) is held back 30 s behind the server clock so rows
 *   committed by slightly older, still-open transactions are picked up next time (re-delivery is
 *   harmless: the device upserts).
 *
 * All queries run on a tenant-scoped (RLS) connection and also filter tenant_id explicitly.
 */
import { sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db/tenant-context'
import type { CompanySession } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { normalizeScaleConfig, type ScaleBarcodeConfig } from './barcode-parse'

/** Sellers (createSales) and POS operators (managePOS) may download the catalog / offline bundle. */
export function canSyncCatalog(session: CompanySession): boolean {
  return !requirePermission(session, 'createSales') || !requirePermission(session, 'managePOS')
}

export const ITEM_SYNC_MAX_LIMIT = 2000
export const ITEM_SYNC_DEFAULT_LIMIT = 500
const SAFETY_LAG_SECONDS = 30
const MAX_TOMBSTONES = 10000
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/

export interface SyncCursor {
  /** timestamp (without time zone) as Postgres text, microsecond precision */
  t: string
  i: string
  /** 1 while a full snapshot is still paging */
  f?: 1
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid sync cursor')
    this.name = 'InvalidCursorError'
  }
}

export function encodeCursor(c: SyncCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): SyncCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<SyncCursor>
    if (typeof parsed.t !== 'string' || !TS_RE.test(parsed.t)) throw new Error('t')
    if (typeof parsed.i !== 'string' || !UUID_RE.test(parsed.i)) throw new Error('i')
    return { t: parsed.t, i: parsed.i, ...(parsed.f === 1 ? { f: 1 as const } : {}) }
  } catch {
    throw new InvalidCursorError()
  }
}

export interface SyncItem {
  id: string
  itemCode: string
  name: string
  barcode: string | null
  pluCode: string | null
  /** Pharmacy: generic name (searchable on the device) */
  genericName: string | null
  sku: string | null
  sellingPrice: string
  taxTemplateId: string | null
  unit: string | null
  isWeighable: boolean
  trackStock: boolean
  trackSerialNumbers: boolean
  isGiftCard: boolean
  categoryId: string | null
  categoryName: string | null
  imageUrl: string | null
  /** current - reserved at the requested warehouse (null when no warehouse was given) */
  availableStock: number | null
  isActive: boolean
  updatedAt: string
}

export interface ItemSyncPage {
  items: SyncItem[]
  deleted: string[]
  nextCursor: string
  hasMore: boolean
  /** true when this page belongs to a full snapshot (device should sweep items it did not receive) */
  full: boolean
  serverTime: string
}

export interface ItemSyncOptions {
  tenantId: string
  warehouseId?: string | null
  cursor?: string | null
  limit?: number
}

interface Row {
  id: string
  item_code: string
  name: string
  barcode: string | null
  plu_code: string | null
  generic_name: string | null
  sku: string | null
  selling_price: string
  tax_template_id: string | null
  unit: string | null
  is_weighable: boolean
  track_stock: boolean
  track_serial_numbers: boolean
  is_gift_card: boolean
  category_id: string | null
  category_name: string | null
  image_url: string | null
  is_active: boolean
  updated_at: string
  current_stock: string | null
  has_variants: boolean
  reserved_stock: string | null
  sync_ts: string
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || (Array.isArray(res) ? (res as T[]) : [])
}

export async function fetchItemSyncPage(db: TenantDb, opts: ItemSyncOptions): Promise<ItemSyncPage> {
  const limit = Math.max(1, Math.min(ITEM_SYNC_MAX_LIMIT, Math.floor(opts.limit || ITEM_SYNC_DEFAULT_LIMIT)))
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null
  const full = !cursor || cursor.f === 1
  const warehouseId = opts.warehouseId && UUID_RE.test(opts.warehouseId) ? opts.warehouseId : null
  const fromTs = cursor?.t ?? null
  const fromId = cursor?.i ?? ZERO_UUID

  const [{ server_time: serverTime, safe_ts: safeTs }] = rowsOf<{ server_time: string; safe_ts: string }>(await db.execute(sql`
    SELECT now()::timestamp::text AS server_time,
           (now() - make_interval(secs => ${SAFETY_LAG_SECONDS}))::timestamp::text AS safe_ts
  `))

  const wsJoin = warehouseId
    ? sql`LEFT JOIN warehouse_stock ws ON ws.item_id = i.id AND ws.warehouse_id = ${warehouseId}::uuid AND ws.tenant_id = ${opts.tenantId}::uuid`
    : sql`LEFT JOIN warehouse_stock ws ON false`

  const filters = [sql`i.tenant_id = ${opts.tenantId}::uuid`]
  if (full) filters.push(sql`i.is_active = true`)
  if (fromTs) filters.push(sql`(i.updated_at >= ${fromTs}::timestamp OR ws.updated_at >= ${fromTs}::timestamp OR v.child_updated_at >= ${fromTs}::timestamp)`)

  const keyset = fromTs
    ? sql`WHERE (c.sync_key, c.id) > (${fromTs}::timestamp, ${fromId}::uuid)`
    : sql``

  const rows = rowsOf<Row>(await db.execute(sql`
    WITH c AS (
      SELECT i.id, i.item_code, i.name, i.barcode, i.plu_code, i.generic_name, i.sku, i.selling_price::text AS selling_price,
             i.tax_template_id, i.unit, i.is_weighable, i.track_stock, i.track_serial_numbers, i.is_gift_card,
             i.category_id, cat.name AS category_name, i.image_url, i.is_active,
             i.updated_at AS item_updated_at,
             ws.current_stock::text AS current_stock, ws.reserved_stock::text AS reserved_stock,
             v.child_updated_at IS NOT NULL AS has_variants,
             GREATEST(i.updated_at, COALESCE(ws.updated_at, i.updated_at), COALESCE(v.child_updated_at, i.updated_at)) AS sync_key
      FROM items i
      ${wsJoin}
      -- A product with sizes / colours is sold through its variants (each its own item): it is sent
      -- as not sellable, and again whenever a variant is added or changed
      LEFT JOIN LATERAL (
        SELECT MAX(ch.updated_at) AS child_updated_at FROM items ch
        WHERE ch.parent_item_id = i.id AND ch.tenant_id = i.tenant_id AND ch.is_active = true
      ) v ON true
      LEFT JOIN categories cat ON cat.id = i.category_id
      WHERE ${sql.join(filters, sql` AND `)}
    )
    SELECT c.id, c.item_code, c.name, c.barcode, c.plu_code, c.generic_name, c.sku, c.selling_price, c.tax_template_id, c.unit,
           c.is_weighable, c.track_stock, c.track_serial_numbers, c.is_gift_card, c.category_id, c.category_name,
           c.image_url, c.is_active, c.has_variants, c.current_stock, c.reserved_stock,
           to_char(c.item_updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS updated_at,
           c.sync_key::text AS sync_ts
    FROM c
    ${keyset}
    ORDER BY c.sync_key, c.id
    LIMIT ${limit + 1}
  `))

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  let deleted: string[] = []
  if (!full && fromTs) {
    deleted = rowsOf<{ item_id: string }>(await db.execute(sql`
      SELECT item_id FROM item_tombstones
      WHERE tenant_id = ${opts.tenantId}::uuid AND deleted_at > ${fromTs}::timestamp
      ORDER BY deleted_at
      LIMIT ${MAX_TOMBSTONES}
    `)).map((r) => r.item_id)
  }

  let next: SyncCursor
  const last = page[page.length - 1]
  if (hasMore) {
    next = { t: last.sync_ts, i: last.id, ...(full ? { f: 1 as const } : {}) }
  } else {
    // Run finished: switch to delta mode, held back by the safety lag.
    const lastTs = last?.sync_ts ?? fromTs
    if (!lastTs) {
      next = { t: safeTs, i: ZERO_UUID }
    } else {
      const [{ keep }] = rowsOf<{ keep: boolean }>(await db.execute(sql`SELECT ${lastTs}::timestamp <= ${safeTs}::timestamp AS keep`))
      next = keep ? { t: lastTs, i: last ? last.id : fromId } : { t: safeTs, i: ZERO_UUID }
    }
  }

  return {
    items: page.map((r) => ({
      id: r.id,
      itemCode: r.item_code,
      name: r.name,
      barcode: r.barcode,
      pluCode: r.plu_code,
      genericName: r.generic_name,
      sku: r.sku,
      sellingPrice: r.selling_price,
      taxTemplateId: r.tax_template_id,
      unit: r.unit,
      isWeighable: r.is_weighable,
      trackStock: r.track_stock,
      trackSerialNumbers: r.track_serial_numbers,
      isGiftCard: r.is_gift_card,
      categoryId: r.category_id,
      categoryName: r.category_name,
      imageUrl: r.image_url,
      availableStock: warehouseId
        ? Math.round(((Number(r.current_stock) || 0) - (Number(r.reserved_stock) || 0)) * 1000) / 1000
        : null,
      isActive: r.is_active && !r.has_variants,
      updatedAt: r.updated_at,
    })),
    deleted,
    nextCursor: encodeCursor(next),
    hasMore,
    full,
    serverTime,
  }
}

// ---------------------------------------------------------------------------
// Offline bundle: everything the phone needs to keep selling without a server
// ---------------------------------------------------------------------------

export interface OfflineTaxTemplate {
  id: string
  name: string
  isActive: boolean
  items: Array<{ taxName: string; rate: string; accountId: string | null; includedInPrice: boolean }>
}

export interface OfflineBundle {
  taxTemplates: OfflineTaxTemplate[]
  accountingSettings: { defaultTaxTemplateId: string | null }
  scaleBarcode: ScaleBarcodeConfig
  shift: Record<string, unknown> | null
  posProfile: Record<string, unknown> | null
  categories: Array<{ id: string; name: string; parentId: string | null }>
  serverTime: string
}

export async function buildOfflineBundle(db: TenantDb, opts: { tenantId: string; userId: string }): Promise<OfflineBundle> {
  const { tenantId, userId } = opts

  const templateRows = rowsOf<{
    id: string; name: string; is_active: boolean
    tax_name: string | null; rate: string | null; account_id: string | null; included_in_price: boolean | null
  }>(await db.execute(sql`
    SELECT t.id, t.name, t.is_active, ti.tax_name, ti.rate::text AS rate, ti.account_id, ti.included_in_price
    FROM tax_templates t
    LEFT JOIN tax_template_items ti ON ti.tax_template_id = t.id
    WHERE t.tenant_id = ${tenantId}::uuid
    ORDER BY t.name, ti.id
  `))
  const templates = new Map<string, OfflineTaxTemplate>()
  for (const r of templateRows) {
    let t = templates.get(r.id)
    if (!t) {
      t = { id: r.id, name: r.name, isActive: r.is_active, items: [] }
      templates.set(r.id, t)
    }
    if (r.tax_name !== null) {
      t.items.push({ taxName: r.tax_name, rate: r.rate ?? '0', accountId: r.account_id, includedInPrice: !!r.included_in_price })
    }
  }

  const [settings] = rowsOf<{ default_tax_template_id: string | null }>(await db.execute(sql`
    SELECT default_tax_template_id FROM accounting_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `))

  const [tenant] = rowsOf<{ settings: Record<string, unknown> | null }>(await db.execute(sql`
    SELECT settings FROM tenants WHERE id = ${tenantId}::uuid
  `))
  const scaleBarcode = normalizeScaleConfig(
    ((tenant?.settings || {}) as { scaleBarcode?: Partial<ScaleBarcodeConfig> }).scaleBarcode,
  )

  const shift = await db.query.posOpeningEntries.findFirst({
    where: (e, { and, eq }) => and(eq(e.userId, userId), eq(e.status, 'open')),
    with: {
      posProfile: { with: { warehouse: true, paymentMethods: true } },
      warehouse: true,
      balances: true,
    },
  })

  const categories = rowsOf<{ id: string; name: string; parent_id: string | null }>(await db.execute(sql`
    SELECT id, name, parent_id FROM categories
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true
    ORDER BY name
  `)).map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id }))

  const [{ server_time: serverTime }] = rowsOf<{ server_time: string }>(await db.execute(sql`SELECT now()::timestamp::text AS server_time`))

  return {
    taxTemplates: [...templates.values()],
    accountingSettings: { defaultTaxTemplateId: settings?.default_tax_template_id ?? null },
    scaleBarcode,
    shift: (shift as unknown as Record<string, unknown>) || null,
    posProfile: ((shift?.posProfile as unknown) as Record<string, unknown>) || null,
    categories,
    serverTime,
  }
}
