/**
 * Pharmacy substitutes: other brands of the same medicine.
 *
 * A substitute has the same generic name and strength (compared without case and spaces, so
 * "500 mg" = "500mg") and, when both items say, the same dosage form (tablet ≠ syrup). The POS
 * shows them when a brand is out of stock or the patient asks for a cheaper one; one click puts
 * the substitute in the cart instead.
 */
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { items } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db'

type Db = Pick<TenantDb, 'select'>

export interface SubstituteRow {
  id: string
  name: string
  genericName: string | null
  strength: string | null
  dosageForm: string | null
  drugSchedule: string | null
  sellingPrice: string
  unit: string | null
  trackStock: boolean
  availableStock: number
  /** false when this item or the original has no dosage form recorded */
  sameForm: boolean
}

/** "500 mg" → "500mg" (strength / form compared without case or spaces) */
export const normalizeStrength = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, '')

export async function findSubstitutes(db: Db, tenantId: string, itemId: string, warehouseId: string | null): Promise<{
  item: { id: string; name: string; genericName: string | null; strength: string | null; dosageForm: string | null } | null
  substitutes: SubstituteRow[]
}> {
  const [item] = await db.select({
    id: items.id, name: items.name, genericName: items.genericName, strength: items.strength, dosageForm: items.dosageForm,
  }).from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId))).limit(1)
  if (!item) return { item: null, substitutes: [] }
  if (!item.genericName?.trim()) return { item, substitutes: [] }

  const strength = normalizeStrength(item.strength)
  const form = normalizeStrength(item.dosageForm)
  const conds = [
    eq(items.tenantId, tenantId),
    ne(items.id, item.id),
    eq(items.isActive, true),
    sql`lower(trim(${items.genericName})) = ${item.genericName.trim().toLowerCase()}`,
    sql`regexp_replace(lower(coalesce(${items.strength}, '')), '\\s+', '', 'g') = ${strength}`,
  ]
  if (form) conds.push(sql`(${items.dosageForm} IS NULL OR regexp_replace(lower(${items.dosageForm}), '\\s+', '', 'g') = ${form})`)

  // Correlated on "items"."id" written out: drizzle leaves columns unqualified in a single-table select
  const stockExpr = warehouseId
    ? sql<string>`coalesce((SELECT ws.current_stock - ws.reserved_stock FROM warehouse_stock ws
        WHERE ws.item_id = "items"."id" AND ws.warehouse_id = ${warehouseId}::uuid), 0)`
    : sql<string>`coalesce((SELECT sum(ws.current_stock - ws.reserved_stock) FROM warehouse_stock ws
        WHERE ws.item_id = "items"."id"), 0)`
  const rows = await db.select({
    id: items.id, name: items.name, genericName: items.genericName, strength: items.strength, dosageForm: items.dosageForm,
    drugSchedule: items.drugSchedule, sellingPrice: items.sellingPrice, unit: items.unit, trackStock: items.trackStock,
    stock: stockExpr,
  }).from(items).where(and(...conds)).orderBy(asc(items.sellingPrice), asc(items.name)).limit(50)

  const substitutes = rows.map((r) => ({
    id: r.id, name: r.name, genericName: r.genericName, strength: r.strength, dosageForm: r.dosageForm,
    drugSchedule: r.drugSchedule, sellingPrice: r.sellingPrice, unit: r.unit, trackStock: r.trackStock,
    availableStock: Math.round(Number(r.stock) * 10000) / 10000,
    sameForm: !!form && normalizeStrength(r.dosageForm) === form,
  }))
  // Sellable first (in stock, or not stock-tracked), then cheapest
  substitutes.sort((a, b) => {
    const sa = !a.trackStock || a.availableStock > 0 ? 0 : 1
    const sb = !b.trackStock || b.availableStock > 0 ? 0 : 1
    return sa - sb || Number(a.sellingPrice) - Number(b.sellingPrice) || a.name.localeCompare(b.name)
  })
  return { item, substitutes }
}
