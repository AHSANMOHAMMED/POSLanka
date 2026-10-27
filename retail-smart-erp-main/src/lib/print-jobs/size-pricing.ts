/**
 * Print & photo studio size pricing (drizzle/0182). Pure functions — shared by the print job API,
 * the print job pages and (later) the POS size-entry dialog, so a quote, the job order and the
 * invoice always compute the same numbers.
 *
 *   pricing mode 'unit'   → amount = qty × rate (rate per piece)
 *   pricing mode 'area'   → billable area per piece = max(w × h in sq ft / sq m, min charge),
 *                           amount = billable area per piece × qty × sides × rate
 *   pricing mode 'length' → billable length per piece = max(width in ft / m, min charge),
 *                           amount = length per piece × qty × sides × rate (e.g. vinyl by running ft)
 *
 * Areas / lengths are rounded to 2 dp per piece before multiplying (what the customer sees on the
 * ticket is what is charged). Money is rounded to 2 dp.
 *
 * Self-check: npx tsx scripts/tests/print-size-pricing.ts
 */

export type SizeUnit = 'inch' | 'ft' | 'cm' | 'mm' | 'm'
export type AreaUnit = 'sqft' | 'sqm'
export type PricingMode = 'unit' | 'area' | 'length'

export const SIZE_UNITS: Array<{ value: SizeUnit; label: string }> = [
  { value: 'inch', label: 'in' },
  { value: 'ft', label: 'ft' },
  { value: 'cm', label: 'cm' },
  { value: 'mm', label: 'mm' },
  { value: 'm', label: 'm' },
]

export const AREA_UNIT_LABEL: Record<AreaUnit, string> = { sqft: 'sq ft', sqm: 'sq m' }
/** Running length unit that goes with an area unit (sq ft → ft, sq m → m). */
export const LENGTH_UNIT_LABEL: Record<AreaUnit, string> = { sqft: 'ft', sqm: 'm' }

const METRES_PER: Record<SizeUnit, number> = { inch: 0.0254, ft: 0.3048, cm: 0.01, mm: 0.001, m: 1 }

export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Convert a length to feet (areaUnit sqft) or metres (sqm). Not rounded. */
export function toLinear(value: number, from: SizeUnit, areaUnit: AreaUnit): number {
  const metres = num(value) * (METRES_PER[from] ?? 1)
  return areaUnit === 'sqm' ? metres : metres / 0.3048
}

/** Area of one piece in sq ft / sq m, rounded to 2 dp (0 when a side is missing). */
export function pieceArea(width: number, height: number, unit: SizeUnit, areaUnit: AreaUnit): number {
  const w = toLinear(width, unit, areaUnit)
  const h = toLinear(height, unit, areaUnit)
  if (w <= 0 || h <= 0) return 0
  return round2(w * h)
}

/** Perimeter of one piece in ft / m (frame moulding), rounded to 2 dp. */
export function piecePerimeter(width: number, height: number, unit: SizeUnit, areaUnit: AreaUnit): number {
  const w = toLinear(width, unit, areaUnit)
  const h = toLinear(height, unit, areaUnit)
  if (w <= 0 || h <= 0) return 0
  return round2(2 * (w + h))
}

// ==================== PRESETS ====================

export interface SizePreset { code: string; label: string; width: number; height: number; unit: SizeUnit; group: 'photo' | 'paper' }

/** Standard photo / frame sizes (inches) and ISO paper sizes (mm). */
export const SIZE_PRESETS: SizePreset[] = [
  { code: '4x6', label: '4 × 6 in', width: 4, height: 6, unit: 'inch', group: 'photo' },
  { code: '5x7', label: '5 × 7 in', width: 5, height: 7, unit: 'inch', group: 'photo' },
  { code: '8x10', label: '8 × 10 in', width: 8, height: 10, unit: 'inch', group: 'photo' },
  { code: '8x12', label: '8 × 12 in', width: 8, height: 12, unit: 'inch', group: 'photo' },
  { code: '10x12', label: '10 × 12 in', width: 10, height: 12, unit: 'inch', group: 'photo' },
  { code: '12x18', label: '12 × 18 in', width: 12, height: 18, unit: 'inch', group: 'photo' },
  { code: '16x20', label: '16 × 20 in', width: 16, height: 20, unit: 'inch', group: 'photo' },
  { code: '20x30', label: '20 × 30 in', width: 20, height: 30, unit: 'inch', group: 'photo' },
  { code: '24x36', label: '24 × 36 in', width: 24, height: 36, unit: 'inch', group: 'photo' },
  { code: 'A4', label: 'A4 (210 × 297 mm)', width: 210, height: 297, unit: 'mm', group: 'paper' },
  { code: 'A3', label: 'A3 (297 × 420 mm)', width: 297, height: 420, unit: 'mm', group: 'paper' },
  { code: 'A2', label: 'A2 (420 × 594 mm)', width: 420, height: 594, unit: 'mm', group: 'paper' },
]

// ==================== FINISHING ADD-ONS ====================

/**
 * How an add-on's quantity is derived:
 *  area      — billable area of the line (× sides for lamination), rate per sq ft / sq m
 *  count     — count per piece × pieces (eyelets per piece, pole/pocket per side)
 *  perimeter — perimeter per piece × pieces, rate per running ft / m (frame moulding)
 *  fixed     — count (default 1) × rate (design fee, other)
 */
export type FinishingBasis = 'area' | 'count' | 'perimeter' | 'fixed'

export interface FinishingDef {
  code: string
  label: string
  basis: FinishingBasis
  /** For 'count' / 'fixed': what the count means and its default */
  countLabel?: string
  defaultCount?: number
  /** Area add-ons charged on every printed side (lamination) */
  perSide?: boolean
  rateHint: string
}

export const FINISHING_ADDONS: FinishingDef[] = [
  { code: 'lamination', label: 'Lamination', basis: 'area', perSide: true, rateHint: 'per sq ft / sq m' },
  { code: 'eyelets', label: 'Eyelets', basis: 'count', countLabel: 'Eyelets per piece', defaultCount: 4, rateHint: 'per eyelet' },
  { code: 'pole_pocket', label: 'Pole / pocket', basis: 'count', countLabel: 'Sides per piece', defaultCount: 2, rateHint: 'per side' },
  { code: 'frame', label: 'Frame moulding', basis: 'perimeter', rateHint: 'per running ft / m of perimeter' },
  { code: 'mounting', label: 'Mounting board', basis: 'area', rateHint: 'per sq ft / sq m' },
  { code: 'design_fee', label: 'Design fee', basis: 'fixed', defaultCount: 1, countLabel: 'Count', rateHint: 'fixed' },
  { code: 'other', label: 'Other', basis: 'fixed', defaultCount: 1, countLabel: 'Count', rateHint: 'fixed' },
]

export const FINISHING_BY_CODE: Record<string, FinishingDef> = Object.fromEntries(FINISHING_ADDONS.map((f) => [f.code, f]))

export interface FinishingInput {
  code: string
  /** Display label (defaults to the add-on's label; required for 'other') */
  label?: string | null
  rate: number
  /** count per piece ('count'), or multiplier ('fixed'); ignored for area / perimeter */
  count?: number | null
}

export interface FinishingResult { code: string; label: string; qty: number; rate: number; amount: number }

// ==================== LINE CALCULATION ====================

export interface SizeLineInput {
  pricingMode: PricingMode
  width?: number | null
  height?: number | null
  sizeUnit?: SizeUnit | null
  quantity: number
  rate: number
  areaUnit?: AreaUnit | null
  /** Minimum billable area (area mode) or length (length mode) per piece */
  minChargeArea?: number | null
  sides?: number | null
  finishing?: FinishingInput[] | null
}

export interface SizeLineResult {
  /** Actual area of one piece (0 without a size) */
  areaPerPiece: number
  /** Billable area / length per piece after the minimum charge (area / length modes; else = areaPerPiece) */
  billablePerPiece: number
  /** Billable area / length for all pieces (and sides) — the sale line quantity for area/length items */
  billableTotal: number
  perimeterPerPiece: number
  /** Print charge before finishing */
  baseAmount: number
  finishing: FinishingResult[]
  finishingAmount: number
  amount: number
  /** Quantity and unit price the invoice line uses (amount = billQty × rate, before finishing) */
  billQty: number
  minChargeApplied: boolean
}

export function calculateSizeLine(input: SizeLineInput): SizeLineResult {
  const mode: PricingMode = input.pricingMode === 'area' || input.pricingMode === 'length' ? input.pricingMode : 'unit'
  const unit: SizeUnit = input.sizeUnit && METRES_PER[input.sizeUnit] ? input.sizeUnit : 'inch'
  const areaUnit: AreaUnit = input.areaUnit === 'sqm' ? 'sqm' : 'sqft'
  const qty = Math.max(0, num(input.quantity))
  const rate = Math.max(0, num(input.rate))
  const sides = Math.min(2, Math.max(1, Math.round(num(input.sides) || 1)))
  const width = Math.max(0, num(input.width))
  const height = Math.max(0, num(input.height))
  const minCharge = Math.max(0, num(input.minChargeArea))

  const areaPerPiece = pieceArea(width, height, unit, areaUnit)
  const perimeterPerPiece = piecePerimeter(width, height, unit, areaUnit)

  let billablePerPiece = areaPerPiece
  let minChargeApplied = false
  let billQty = qty
  if (mode === 'area') {
    if (minCharge > 0 && areaPerPiece < minCharge) { billablePerPiece = round2(minCharge); minChargeApplied = true }
    billQty = round2(billablePerPiece * qty * sides)
  } else if (mode === 'length') {
    const len = width > 0 ? round2(toLinear(width, unit, areaUnit)) : 0
    billablePerPiece = len
    if (minCharge > 0 && len < minCharge) { billablePerPiece = round2(minCharge); minChargeApplied = true }
    billQty = round2(billablePerPiece * qty * sides)
  }
  const billableTotal = mode === 'unit' ? round2(areaPerPiece * qty) : billQty
  const baseAmount = round2(billQty * rate)

  // Area the area-based add-ons are charged on: billable area when area-priced, else actual area
  const areaForAddons = round2((mode === 'area' ? billablePerPiece : areaPerPiece) * qty)
  const finishing: FinishingResult[] = []
  for (const f of input.finishing || []) {
    const def = FINISHING_BY_CODE[f.code] || FINISHING_BY_CODE.other
    const fRate = Math.max(0, num(f.rate))
    let fQty = 0
    switch (def.basis) {
      case 'area': fQty = round2(areaForAddons * (def.perSide ? sides : 1)); break
      case 'perimeter': fQty = round2(perimeterPerPiece * qty); break
      case 'count': fQty = round2(Math.max(0, num(f.count ?? def.defaultCount ?? 1)) * qty); break
      case 'fixed': fQty = round2(Math.max(0, num(f.count ?? def.defaultCount ?? 1))); break
    }
    const label = (f.label && String(f.label).trim()) || def.label
    finishing.push({ code: def.code, label, qty: fQty, rate: fRate, amount: round2(fQty * fRate) })
  }
  const finishingAmount = round2(finishing.reduce((s, f) => s + f.amount, 0))

  return {
    areaPerPiece,
    billablePerPiece,
    billableTotal,
    perimeterPerPiece,
    baseAmount,
    finishing,
    finishingAmount,
    amount: round2(baseAmount + finishingAmount),
    billQty,
    minChargeApplied,
  }
}

/** "6 × 3 ft" / "A4" style size text for tickets and invoice lines. */
export function formatSize(width: number | string | null | undefined, height: number | string | null | undefined, unit: SizeUnit | string | null | undefined): string {
  const w = num(width)
  const h = num(height)
  if (w <= 0 && h <= 0) return ''
  const u = SIZE_UNITS.find((s) => s.value === unit)?.label || (unit || '')
  const preset = SIZE_PRESETS.find((p) => p.unit === unit && ((p.width === w && p.height === h) || (p.width === h && p.height === w)))
  if (preset?.group === 'paper') return preset.code
  const fmt = (n: number) => String(round2(n))
  return h > 0 ? `${fmt(w)} × ${fmt(h)} ${u}` : `${fmt(w)} ${u}`
}
