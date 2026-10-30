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
// Exact international definitions: 1 yd = 0.9144 m, 1 ft = 0.3048 m, 1 in = 0.0254 m,
// 1 lb = 0.45359237 kg, 1 oz = 1/16 lb. `short` is what the cashier sees on a chip / receipt.
const STANDARD: Record<string, { measure: 'mass' | 'volume' | 'length'; toRef: number; label: string; short: string }> = {
  kg: { measure: 'mass', toRef: 1000, label: 'Kilogram', short: 'kg' },
  g: { measure: 'mass', toRef: 1, label: 'Gram', short: 'g' },
  mg: { measure: 'mass', toRef: 0.001, label: 'Milligram', short: 'mg' },
  lb: { measure: 'mass', toRef: 453.59237, label: 'Pound', short: 'lb' },
  oz: { measure: 'mass', toRef: 28.349523125, label: 'Ounce', short: 'oz' },
  l: { measure: 'volume', toRef: 1000, label: 'Litre', short: 'L' },
  ml: { measure: 'volume', toRef: 1, label: 'Millilitre', short: 'ml' },
  m: { measure: 'length', toRef: 1000, label: 'Metre', short: 'm' },
  cm: { measure: 'length', toRef: 10, label: 'Centimetre', short: 'cm' },
  mm: { measure: 'length', toRef: 1, label: 'Millimetre', short: 'mm' },
  yard: { measure: 'length', toRef: 914.4, label: 'Yard', short: 'yd' },
  ft: { measure: 'length', toRef: 304.8, label: 'Foot', short: 'ft' },
  inch: { measure: 'length', toRef: 25.4, label: 'Inch', short: 'in' },
}

/**
 * Decimal places kept for stock quantities (warehouse_stock.current_stock, stock_movements,
 * batches: numeric(14,4) since 0189). 1.5 yd = 1.3716 m exactly, 0.5 in = 0.0127 m.
 */
export const STOCK_QTY_DP = 4
/** Decimal places kept for a unit factor (sale_items.uom_factor / item_uoms.factor: numeric(14,6)). */
export const UOM_FACTOR_DP = 6
/**
 * Decimal places kept for a unit price derived by a factor (sale_items.unit_price: numeric(14,4)
 * since 0189): 345 / kg sold by the gram is 0.345 / g, so 250 g = 86.25, not 250 × 0.35 = 87.50.
 * Line totals are still money (2 dp): round2(unit price × quantity).
 */
export const UNIT_PRICE_DP = 4

/** Round a unit price to UNIT_PRICE_DP (prices typed in cents are unchanged). */
export function roundUnitPrice(n: number): number {
  const p = 10 ** UNIT_PRICE_DP
  return Math.round((n + Math.sign(n) * Number.EPSILON) * p) / p
}

const ALIASES: Record<string, string> = {
  kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg', kilogramme: 'kg',
  gram: 'g', grams: 'g', gramme: 'g', grammes: 'g', gm: 'g', gms: 'g', gr: 'g', grm: 'g', grms: 'g',
  milligram: 'mg', milligrams: 'mg', mgs: 'mg',
  ltr: 'l', ltrs: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', lt: 'l', lit: 'l',
  millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml', mls: 'ml',
  meter: 'm', metre: 'm', meters: 'm', metres: 'm', mtr: 'm', mtrs: 'm',
  centimetre: 'cm', centimeter: 'cm', centimetres: 'cm', centimeters: 'cm', cms: 'cm',
  millimetre: 'mm', millimeter: 'mm', millimetres: 'mm', millimeters: 'mm',
  yd: 'yard', yds: 'yard', yards: 'yard', yaar: 'yard',
  feet: 'ft', foot: 'ft',
  in: 'inch', inches: 'inch',
  lbs: 'lb', pound: 'lb', pounds: 'lb',
  ounce: 'oz', ounces: 'oz',
}

export function normalizeUnit(code: string | null | undefined): string {
  const c = (code || '').trim().toLowerCase().replace(/\.$/, '')
  return ALIASES[c] || c
}

/** Short name a cashier reads ("yd", "in", "L"); other codes come back as given. */
export function unitShortName(code: string | null | undefined): string {
  const std = STANDARD[normalizeUnit(code)]
  return std ? std.short : (code || '').trim()
}

/** Round a stock (base-unit) quantity to the precision the stock columns keep. */
export function roundStockQty(n: number): number {
  const p = 10 ** STOCK_QTY_DP
  return Math.round((n + Math.sign(n) * Number.EPSILON) * p) / p
}

/** Base units moved by `qty` of a unit with `factor` (1.5 yd x 0.9144 = 1.3716 m). */
export function baseQtyFor(qty: number | string, factor: number | string | null | undefined): number {
  const f = Number(factor) || 1
  return roundStockQty(Number(qty) * f)
}

function trimNum(n: number, dp: number): string {
  const p = 10 ** dp
  return String(Math.round(n * p) / p)
}

/**
 * "1.5 yd = 1.3716 m" for a line sold in another unit; null for the base unit (or factor 1).
 */
export function conversionText(
  qty: number | string,
  uom: string | null | undefined,
  factor: number | string | null | undefined,
  baseUnit: string | null | undefined,
): string | null {
  const f = Number(factor) || 1
  if (!uom || Math.abs(f - 1) < 1e-12) return null
  if (baseUnit && normalizeUnit(uom) === normalizeUnit(baseUnit)) return null
  return `${trimNum(Number(qty) || 0, 3)} ${unitShortName(uom)} = ${trimNum(baseQtyFor(qty, f), STOCK_QTY_DP)} ${unitShortName(baseUnit) || 'base units'}`
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
 * Factor of `from` in base units `to`, rounded the way it is stored on a line (6 dp), or null
 * when the units don't share a measure. Stock moves always use this stored factor, so a sale
 * and its void / return move the same base quantity.
 */
export function storedStandardFactor(from: string, to: string): number | null {
  const f = standardFactor(from, to)
  return f == null ? null : round6(f)
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
    out.push({ uom: u.uom, factor: round6(factor), price: Number.isFinite(price) ? price : null, isBase: false, label: `${unitShortName(u.uom)} (${round6(factor)} ${unitShortName(base)})` })
  }
  const baseStd = STANDARD[normalizeUnit(base)]
  if (baseStd) {
    for (const [code, def] of Object.entries(STANDARD)) {
      if (def.measure !== baseStd.measure || seen.has(code)) continue
      const factor = standardFactor(code, base)!
      seen.add(code)
      out.push({ uom: code, factor: round6(factor), price: null, isBase: false, label: `${def.short} (${round6(factor)} ${unitShortName(base)})` })
    }
  }
  return out
}

/** Unit price of one `option` given the base-unit price (base × factor, 4 dp, when it has no price of its own). */
export function unitPriceFor(option: UnitOption, basePrice: number): number {
  if (option.price != null) return option.price
  return roundUnitPrice(basePrice * option.factor)
}
