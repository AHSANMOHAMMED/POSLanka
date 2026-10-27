/**
 * H5 catalog helpers: units of measure, per-item unit conversions and additional barcodes
 * (drizzle/0161_pricing_catalog.sql).
 *
 * Barcode uniqueness across items.barcode / item_barcodes / item_uoms is enforced by the
 * catalog_barcode_guard trigger (23505, constraint items_tenant_barcode_unique → toApiError
 * maps it to 409 DUPLICATE field 'barcode').
 */
import { sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db/tenant-context'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || (Array.isArray(res) ? (res as T[]) : [])
}

export const DEFAULT_UNITS: Array<{ code: string; name: string; allowFraction: boolean }> = [
  { code: 'pcs', name: 'Pieces', allowFraction: false },
  { code: 'kg', name: 'Kilogram', allowFraction: true },
  { code: 'g', name: 'Gram', allowFraction: true },
  { code: 'l', name: 'Litre', allowFraction: true },
  { code: 'ml', name: 'Millilitre', allowFraction: true },
  { code: 'box', name: 'Box', allowFraction: false },
  { code: 'pack', name: 'Pack', allowFraction: false },
  { code: 'dozen', name: 'Dozen', allowFraction: false },
]

/** Extra units seeded for some business types (on top of DEFAULT_UNITS). */
export const BUSINESS_TYPE_UNITS: Record<string, Array<{ code: string; name: string; allowFraction: boolean }>> = {
  // Hardware & building supplies: cement by the bag, sand / metal by the cube, steel by the kg,
  // wire / pipe by the metre or foot, roofing / plywood by the sheet, paint by the litre
  hardware: [
    { code: 'm', name: 'Metre', allowFraction: true },
    { code: 'ft', name: 'Feet', allowFraction: true },
    { code: 'yard', name: 'Yard', allowFraction: true },
    { code: 'bag', name: 'Bag', allowFraction: false },
    { code: 'cube', name: 'Cube', allowFraction: true },
    { code: 'sheet', name: 'Sheet', allowFraction: false },
    { code: 'roll', name: 'Roll', allowFraction: false },
    { code: 'length', name: 'Length', allowFraction: false },
    { code: 'sqft', name: 'Square Feet', allowFraction: true },
  ],
  // Printing & photo studio: prints by the sheet, banners by the square foot
  print_studio: [
    { code: 'sheet', name: 'Sheet', allowFraction: false },
    { code: 'sqft', name: 'Square Feet', allowFraction: true },
    { code: 'set', name: 'Set', allowFraction: false },
    { code: 'ream', name: 'Ream', allowFraction: false },
  ],
  electronics: [
    { code: 'set', name: 'Set', allowFraction: false },
    { code: 'unit', name: 'Unit', allowFraction: false },
  ],
  office: [
    { code: 'hour', name: 'Hour', allowFraction: true },
    { code: 'month', name: 'Month', allowFraction: false },
  ],
}

/** The units a new tenant of this business type starts with. */
export function defaultUnitsFor(businessType?: string | null): Array<{ code: string; name: string; allowFraction: boolean }> {
  const extra = (businessType && BUSINESS_TYPE_UNITS[businessType]) || []
  const seen = new Set(DEFAULT_UNITS.map((u) => u.code))
  return [...DEFAULT_UNITS, ...extra.filter((u) => !seen.has(u.code))]
}

/** Seed the default units for a tenant that has none yet (tenants created after drizzle/0161). */
export async function ensureDefaultUnits(db: TenantDb, tenantId: string, businessType?: string | null): Promise<void> {
  const [{ c }] = rowsOf<{ c: number }>(await db.execute(sql`SELECT count(*)::int AS c FROM units WHERE tenant_id = ${tenantId}::uuid`))
  if (c > 0) return
  let bt = businessType ?? null
  if (!bt) {
    const [t] = rowsOf<{ bt: string | null }>(await db.execute(sql`SELECT business_type::text AS bt FROM tenants WHERE id = ${tenantId}::uuid`))
    bt = t?.bt ?? null
  }
  await db.execute(sql`
    INSERT INTO units (tenant_id, code, name, allow_fraction)
    VALUES ${sql.join(defaultUnitsFor(bt).map((u) => sql`(${tenantId}::uuid, ${u.code}, ${u.name}, ${u.allowFraction})`), sql`, `)}
    ON CONFLICT DO NOTHING
  `)
}

export interface ExtraBarcodeMatch {
  source: 'item_barcode' | 'uom_barcode'
  itemId: string
  barcode: string
  /** null = base unit */
  uom: string | null
  /** base units per 1 uom */
  factor: number
  /** quantity (in uom) one scan adds */
  packQty: number
  /** item_barcodes.price_override: unit price (per uom) when sold through this code */
  priceOverride: number | null
  /** item_uoms.selling_price of the uom */
  uomPrice: number | null
  label: string | null
}

/** Look scanned values up in item_barcodes and item_uoms.barcode. */
export async function findExtraBarcodes(db: TenantDb, tenantId: string, values: string[]): Promise<ExtraBarcodeMatch[]> {
  const vals = [...new Set(values.filter(Boolean))]
  if (vals.length === 0) return []
  const list = sql.join(vals.map((v) => sql`${v}`), sql`, `)
  const rows = rowsOf<{
    source: ExtraBarcodeMatch['source']; item_id: string; barcode: string; uom: string | null; factor: string | null
    pack_qty: string; price_override: string | null; uom_price: string | null; label: string | null
  }>(await db.execute(sql`
    SELECT 'item_barcode' AS source, b.item_id, b.barcode, b.uom, u.factor::text AS factor, b.pack_qty::text AS pack_qty,
           b.price_override::text AS price_override, u.selling_price::text AS uom_price, b.label
    FROM item_barcodes b
    LEFT JOIN item_uoms u ON u.item_id = b.item_id AND lower(u.uom) = lower(b.uom) AND u.is_active = true
    WHERE b.tenant_id = ${tenantId}::uuid AND b.barcode IN (${list})
    UNION ALL
    SELECT 'uom_barcode', u.item_id, u.barcode, u.uom, u.factor::text, '1', NULL, u.selling_price::text, NULL
    FROM item_uoms u
    WHERE u.tenant_id = ${tenantId}::uuid AND u.is_active = true AND u.barcode IN (${list})
  `))
  return rows.map((r) => ({
    source: r.source,
    itemId: r.item_id,
    barcode: r.barcode,
    uom: r.uom ? r.uom.toLowerCase() : null,
    // a barcode naming a unit the item has no (active) conversion for counts as base unit
    factor: r.factor != null ? Number(r.factor) : 1,
    packQty: Number(r.pack_qty) || 1,
    priceOverride: r.price_override != null ? Number(r.price_override) : null,
    uomPrice: r.uom_price != null ? Number(r.uom_price) : null,
    label: r.label,
  }))
}

export interface ItemBarcodeInput { barcode: string; uom?: string; packQty?: number; priceOverride?: number; label?: string }
export interface ItemUomInput { uom: string; factor: number; barcode?: string; sellingPrice?: number; isActive?: boolean }

export class CatalogValidationError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message)
    this.name = 'CatalogValidationError'
  }
}

async function knownUnits(db: TenantDb, tenantId: string): Promise<Set<string>> {
  await ensureDefaultUnits(db, tenantId)
  return new Set(rowsOf<{ code: string }>(await db.execute(sql`
    SELECT lower(code) AS code FROM units WHERE tenant_id = ${tenantId}::uuid AND is_active = true
  `)).map((r) => r.code))
}

/** Replace an item's unit conversions (inside a transaction). */
export async function replaceItemUoms(db: TenantDb, tenantId: string, itemId: string, baseUnit: string | null, uoms: ItemUomInput[]) {
  const units = await knownUnits(db, tenantId)
  const seen = new Set<string>()
  const base = (baseUnit || '').trim().toLowerCase()
  for (const u of uoms) {
    const code = u.uom.toLowerCase()
    if (!units.has(code)) throw new CatalogValidationError(`Unknown unit "${u.uom}"`, 'uom')
    if (code === base) throw new CatalogValidationError(`"${u.uom}" is the item's base unit`, 'uom')
    if (seen.has(code)) throw new CatalogValidationError(`Unit "${u.uom}" listed twice`, 'uom')
    seen.add(code)
  }
  const orphan = rowsOf<{ barcode: string; uom: string }>(await db.execute(sql`
    SELECT barcode, uom FROM item_barcodes
    WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND uom IS NOT NULL
  `)).find((b) => !seen.has(b.uom.toLowerCase()))
  if (orphan) throw new CatalogValidationError(`Barcode ${orphan.barcode} is for unit "${orphan.uom}"; remove that barcode first`, 'uom')
  await db.execute(sql`DELETE FROM item_uoms WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid`)
  if (uoms.length === 0) return
  await db.execute(sql`
    INSERT INTO item_uoms (tenant_id, item_id, uom, factor, barcode, selling_price, is_active)
    VALUES ${sql.join(uoms.map((u) => sql`(${tenantId}::uuid, ${itemId}::uuid, ${u.uom.toLowerCase()}, ${String(u.factor)}::numeric,
      ${u.barcode || null}, ${u.sellingPrice ?? null}::numeric, ${u.isActive ?? true})`), sql`, `)}
  `)
}

/**
 * Replace an item's additional barcodes (inside a transaction). A barcode's unit must be the
 * item's base unit (stored as null) or one of its unit conversions (save those first).
 */
export async function replaceItemBarcodes(db: TenantDb, tenantId: string, itemId: string, baseUnit: string | null, barcodes: ItemBarcodeInput[]) {
  const base = (baseUnit || '').trim().toLowerCase()
  const itemUnits = new Set(rowsOf<{ uom: string }>(await db.execute(sql`
    SELECT lower(uom) AS uom FROM item_uoms WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid
  `)).map((r) => r.uom))
  const seen = new Set<string>()
  for (const b of barcodes) {
    if (b.uom && b.uom.toLowerCase() === base) b.uom = undefined
    if (b.uom && !itemUnits.has(b.uom.toLowerCase())) {
      throw new CatalogValidationError(`Add a "${b.uom}" unit conversion before giving it a barcode`, 'uom')
    }
    if (seen.has(b.barcode)) throw new CatalogValidationError(`Barcode ${b.barcode} listed twice`, 'barcode')
    seen.add(b.barcode)
  }
  await db.execute(sql`DELETE FROM item_barcodes WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid`)
  if (barcodes.length === 0) return
  await db.execute(sql`
    INSERT INTO item_barcodes (tenant_id, item_id, barcode, uom, pack_qty, price_override, label)
    VALUES ${sql.join(barcodes.map((b) => sql`(${tenantId}::uuid, ${itemId}::uuid, ${b.barcode}, ${b.uom ? b.uom.toLowerCase() : null},
      ${String(b.packQty ?? 1)}::numeric, ${b.priceOverride ?? null}::numeric, ${b.label || null})`), sql`, `)}
  `)
}

export async function listItemBarcodes(db: TenantDb, tenantId: string, itemId: string) {
  return rowsOf<{ id: string; barcode: string; uom: string | null; packQty: string; priceOverride: string | null; label: string | null }>(await db.execute(sql`
    SELECT id, barcode, uom, pack_qty::text AS "packQty", price_override::text AS "priceOverride", label
    FROM item_barcodes WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid ORDER BY created_at, barcode
  `))
}

export async function listItemUoms(db: TenantDb, tenantId: string, itemId: string) {
  return rowsOf<{ id: string; uom: string; factor: string; barcode: string | null; sellingPrice: string | null; isActive: boolean }>(await db.execute(sql`
    SELECT id, uom, factor::text AS factor, barcode, selling_price::text AS "sellingPrice", is_active AS "isActive"
    FROM item_uoms WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid ORDER BY factor, uom
  `))
}
