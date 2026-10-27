'use client'

/**
 * Unit choices for back-office document lines (sales invoice / order, purchase
 * order / invoice). Item conversions (GET /api/items/[id]/uoms) are fetched
 * lazily and cached per item for the session; standard units of the same
 * measure (kg <-> g, m <-> yard ...) come from src/lib/units/conversions.ts.
 */
import { useEffect, useState } from 'react'
import { normalizeUnit, unitOptionsFor, type UnitOption } from '@/lib/units/conversions'

export interface ItemUomRow {
  uom: string
  factor: number | string
  sellingPrice?: number | string | null
  isActive?: boolean
}

const uomCache = new Map<string, Promise<ItemUomRow[]>>()

/** Item's own unit conversions (cached; [] on error). */
export function fetchItemUoms(itemId: string): Promise<ItemUomRow[]> {
  let p = uomCache.get(itemId)
  if (!p) {
    p = fetch(`/api/items/${itemId}/uoms`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => (Array.isArray(d) ? (d as ItemUomRow[]) : []))
      .catch(() => {
        uomCache.delete(itemId)
        return []
      })
    uomCache.set(itemId, p)
  }
  return p
}

export interface ItemUnitOptionsState {
  options: UnitOption[]
  /** Units that are the item's own item_uoms rows (standard units of the same measure are accepted too). */
  itemUomCodes: Set<string>
  loading: boolean
}

export function useItemUnitOptions(itemId: string | null | undefined, baseUnit: string | null | undefined): ItemUnitOptionsState {
  const [rows, setRows] = useState<{ itemId: string; rows: ItemUomRow[] } | null>(null)
  useEffect(() => {
    if (!itemId) return
    let cancelled = false
    fetchItemUoms(itemId).then((r) => {
      if (!cancelled) setRows({ itemId, rows: r })
    })
    return () => {
      cancelled = true
    }
  }, [itemId])
  const current = rows && rows.itemId === itemId ? rows.rows : []
  return {
    options: unitOptionsFor(baseUnit, current),
    itemUomCodes: new Set(current.filter((r) => r.isActive !== false).map((r) => normalizeUnit(r.uom))),
    loading: !!itemId && (!rows || rows.itemId !== itemId),
  }
}

/** Unit fields kept on an editable document line. */
export interface LineUnitFields {
  /** items.unit of the line's item */
  baseUnit?: string | null
  /** chosen unit code ('' / undefined = base unit) */
  uom?: string | null
  /** base units per 1 chosen unit */
  uomFactor?: number
  /** chosen unit is one of the item's item_uoms rows */
  uomIsItemUom?: boolean
  /** base-unit price (selling or cost) the unit price is derived from */
  basePrice?: number
}
