/**
 * Selling-unit choices for a line (POS cart, sales invoice/order, quotation).
 *
 * An item is stocked in its base unit (items.unit). A line can be sold in another unit:
 *  - one of the item's own conversions (item_uoms: 1 uom = factor × base unit), or
 *  - a standard unit of the same measure (kg ↔ g, m ↔ yard, l ↔ ml …), so a "kg" item can
 *    be sold "250 g" without anyone setting up a conversion first.
 *
 * Quantities stay in the chosen unit; stock moves qty × factor base units. The unit price of
 * a line in another unit is the uom's own selling price when it has one, else base price × factor.
 */

export interface UnitOption {
  /** unit code as stored on the line (sale_items.uom); the base unit uses its own code */
  uom: string
  /** base units per 1 of this unit */
  factor: number
  /** fixed unit price for this unit (item_uoms.selling_price), when set */
  price: number | null
  /** true for the item's base unit */
  isBase: boolean
  label: string
}

/** Standard units per measure, as a factor of that measure's reference unit. */
const STANDARD: Record<string, { measure: 'mass' | 'volume' | 'length'; toRef: number; label: string }> = {
  kg: { measure: 'mass', toRef: 1000, label: 'Kilogram' },
  g: { measure: 'mass', toRef: 1, label: 'Gram' },
  mg: { measure: 'mass', toRef: 0.001, label: 'Milligram' },
  lb: { measure: 'mass', toRef: 453.59237, label: 'Pound' },
  oz: { measure: 'mass', toRef: 28.349523125, label: 'Ounce' },
  l: { measure: 'volume', toRef: 1000, label: 'Litre' },
  ml: { measure: 'volume', toRef: 1, label: 'Millilitre' },
  m: { measure: 'length', toRef: 1000, label: 'Metre' },
  cm: { measure: 'length', toRef: 10, label: 'Centimetre' },
  mm: { measure: 'length', toRef: 1, label: 'Millimetre' },
  yard: { measure: 'length', toRef: 914.4, label: 'Yard' },
  ft: { measure: 'length', toRef: 304.8, label: 'Foot' },
  inch: { measure: 'length', toRef: 25.4, label: 'Inch' },
}

const ALIASES: Record<string, string> = {
  kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  gram: 'g', grams: 'g', gm: 'g', gms: 'g', gr: 'g',
  ltr: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', lt: 'l',
  millilitre: 'ml', milliliter: 'ml',
  meter: 'm', metre: 'm', meters: 'm', metres: 'm', mtr: 'm',
  yd: 'yard', yds: 'yard', yards: 'yard', yaar: 'yard',
  feet: 'ft', foot: 'ft',
  in: 'inch', inches: 'inch',
  lbs: 'lb', pound: 'lb', pounds: 'lb',
}

export function normalizeUnit(code: string | null | undefined): string {
  const c = (code || '').trim().toLowerCase()
  return ALIASES[c] || c
}

/** True when a quantity in this unit may have decimals (weights, volumes, lengths). */
export function unitAllowsFraction(code: string | null | undefined): boolean {
  return normalizeUnit(code) in STANDARD
}

/** Factor that converts 1 `from` into base units `to`, or null when the units don't share a measure. */
export function standardFactor(from: string, to: string): number | null {
  const a = STANDARD[normalizeUnit(from)]
  const b = STANDARD[normalizeUnit(to)]
  if (!a || !b || a.measure !== b.measure) return null
  return a.toRef / b.toRef
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Units a line of this item can be sold in, base unit first.
 * `itemUoms` are the item's own conversions (inactive ones are skipped); they win over a
 * standard unit with the same code.
 */
export function unitOptionsFor(
  baseUnit: string | null | undefined,
  itemUoms: Array<{ uom: string; factor: number | string; sellingPrice?: number | string | null; isActive?: boolean }> = [],
): UnitOption[] {
  const base = (baseUnit || 'pcs').trim() || 'pcs'
  const out: UnitOption[] = [{ uom: base, factor: 1, price: null, isBase: true, label: base }]
  const seen = new Set([normalizeUnit(base)])
  for (const u of itemUoms) {
    if (u.isActive === false) continue
    const factor = Number(u.factor)
    const key = normalizeUnit(u.uom)
    if (!u.uom || !(factor > 0) || seen.has(key)) continue
    seen.add(key)
    const price = u.sellingPrice == null || u.sellingPrice === '' ? null : Number(u.sellingPrice)
    out.push({ uom: u.uom, factor: round6(factor), price: Number.isFinite(price) ? price : null, isBase: false, label: `${u.uom} (${round6(factor)} ${base})` })
  }
  const baseStd = STANDARD[normalizeUnit(base)]
  if (baseStd) {
    for (const [code, def] of Object.entries(STANDARD)) {
      if (def.measure !== baseStd.measure || seen.has(code)) continue
      const factor = standardFactor(code, base)!
      seen.add(code)
      out.push({ uom: code, factor: round6(factor), price: null, isBase: false, label: `${code} (${round6(factor)} ${base})` })
    }
  }
  return out
}

/** Unit price of one `option` given the base-unit price. */
export function unitPriceFor(option: UnitOption, basePrice: number): number {
  if (option.price != null) return option.price
  return Math.round(basePrice * option.factor * 100) / 100
}
