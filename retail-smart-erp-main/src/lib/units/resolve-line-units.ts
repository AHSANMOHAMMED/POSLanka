/**
 * Server-side unit resolution for document lines (sales orders, purchase orders, purchase
 * invoices, GRNs). A line's quantity / unit price are kept in the unit it was entered in
 * (`uom`); stock, received / ordered / reserved quantities and costing use quantity × factor
 * base units (items.unit).
 *
 * The factor is never taken from the client: it is the item's own conversion (item_uoms row),
 * else a standard unit of the same measure (g on a kg item, yard on a metre item). Any other
 * unit is rejected. The base unit (or a blank unit) is stored as uom = null, factor 1 — the
 * same convention as sale_items.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { items, itemUoms } from '@/lib/db/schema'
import { normalizeUnit, standardFactor } from '@/lib/units/conversions'

export interface LineUnitRequest {
  itemId?: string | null
  uom?: string | null
  itemName?: string | null
}

export interface ResolvedLineUnit {
  /** unit code stored on the line; null = the item's base unit */
  uom: string | null
  /** base units per 1 `uom` */
  factor: number
}

export class LineUnitError extends Error {
  constructor(public readonly itemName: string, public readonly uom: string) {
    super(`"${itemName}" cannot be entered in "${uom}" (no conversion to its base unit)`)
    this.name = 'LineUnitError'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = { select: (...args: any[]) => any }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Resolve every line's unit + factor. Throws LineUnitError for an unknown unit. */
export async function resolveLineUnits(tx: AnyTx, lines: LineUnitRequest[]): Promise<ResolvedLineUnit[]> {
  const wanted = lines.filter((l) => l.itemId && (l.uom || '').trim())
  const ids = [...new Set(wanted.map((l) => l.itemId as string))]
  if (ids.length === 0) return lines.map(() => ({ uom: null, factor: 1 }))

  const itemRows: Array<{ id: string; name: string; unit: string | null }> = await tx
    .select({ id: items.id, name: items.name, unit: items.unit })
    .from(items)
    .where(inArray(items.id, ids))
  const uomRows: Array<{ itemId: string; uom: string; factor: string }> = await tx
    .select({ itemId: itemUoms.itemId, uom: itemUoms.uom, factor: itemUoms.factor })
    .from(itemUoms)
    .where(and(inArray(itemUoms.itemId, ids), eq(itemUoms.isActive, true)))
  const itemById = new Map(itemRows.map((i) => [i.id, i]))
  const convs = new Map<string, { uom: string; factor: number }>()
  for (const u of uomRows) {
    const f = Number(u.factor)
    if (!(f > 0)) continue
    convs.set(`${u.itemId}|${u.uom.trim().toLowerCase()}`, { uom: u.uom, factor: f })
    const norm = `${u.itemId}|${normalizeUnit(u.uom)}`
    if (!convs.has(norm)) convs.set(norm, { uom: u.uom, factor: f })
  }

  return lines.map((l) => {
    const raw = (l.uom || '').trim()
    if (!l.itemId || !raw) return { uom: null, factor: 1 }
    const item = itemById.get(l.itemId)
    // Unknown item: the caller's own item check reports it; keep the line in its base unit
    if (!item) return { uom: null, factor: 1 }
    const base = (item.unit || '').trim()
    if (raw.toLowerCase() === base.toLowerCase() || (base && normalizeUnit(raw) === normalizeUnit(base))) {
      return { uom: null, factor: 1 }
    }
    const conv = convs.get(`${l.itemId}|${raw.toLowerCase()}`) || convs.get(`${l.itemId}|${normalizeUnit(raw)}`)
    if (conv) return { uom: conv.uom, factor: round6(conv.factor) }
    const std = standardFactor(raw, base)
    if (std != null) return { uom: normalizeUnit(raw), factor: round6(std) }
    throw new LineUnitError(l.itemName || item.name, raw)
  })
}

/** 400 response for a LineUnitError (null for anything else, so callers can rethrow). */
export function lineUnitErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof LineUnitError) {
    return NextResponse.json({ error: err.message, code: 'UOM_NOT_FOUND' }, { status: 400 })
  }
  return null
}

/** Base units for `qty` of a line in a unit with `factor` (3 dp, like stock quantities). */
export function toBaseQty(qty: number | string, factor: number | string | null | undefined): number {
  const f = Number(factor) || 1
  return Math.round(Number(qty) * f * 1000) / 1000
}

/** Cost of one base unit from a line's unit cost (cost per box / 12 = cost per piece). */
export function perBaseUnit(unitCost: number | string, factor: number | string | null | undefined): number {
  const f = Number(factor) || 1
  return Number(unitCost) / f
}

