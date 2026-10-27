/**
 * POS print-studio size lines (pure, shared by SizeEntryDialog and the POS page; tested by
 * scripts/tests/l5-loose-ends.ts).
 */
import {
  calculateSizeLine, formatSize, round2, AREA_UNIT_LABEL, LENGTH_UNIT_LABEL, FINISHING_BY_CODE,
  type FinishingInput,
} from '@/lib/print-jobs/size-pricing'
import type { CartSizeSpec } from './types'

/** "Flex — 6 × 3 ft × 2 (36 sq ft) + Lamination, Eyelets" */
export function sizeLineName(spec: CartSizeSpec, billQty: number): string {
  const size = formatSize(spec.width, spec.pricingMode === 'length' ? null : spec.height, spec.sizeUnit)
  const qtyLabel = spec.pricingMode === 'length' ? LENGTH_UNIT_LABEL[spec.areaUnit] : AREA_UNIT_LABEL[spec.areaUnit]
  const addOns = (spec.finishing || []).map((f) => (f.label && f.label.trim()) || FINISHING_BY_CODE[f.code]?.label || f.code)
  const name = `${spec.baseName} — ${size}${spec.pieces !== 1 ? ` × ${spec.pieces}` : ''}${spec.sides === 2 ? ' · 2 sides' : ''} (${round2(billQty)} ${qtyLabel})${addOns.length ? ` + ${addOns.join(', ')}` : ''}`
  return name.slice(0, 255)
}

/**
 * Cart line of a size spec: quantity = billable area / length (what stock moves), unit price =
 * (print + finishing add-ons) ÷ quantity. POST /api/sales requires an item on every line, so the
 * add-ons are folded into the media line's price (a price above the catalog needs no approval);
 * `notes` carries the per-add-on breakdown. The unit price is searched to the cent so that
 * price × quantity equals the calculated amount; otherwise it is the nearest cent.
 */
export function foldSizeLine(spec: CartSizeSpec, rate: number): { billQty: number; unitPrice: number; total: number; amount: number; notes: string | undefined } {
  const calc = calculateSizeLine({
    pricingMode: spec.pricingMode,
    width: spec.width,
    height: spec.height,
    sizeUnit: spec.sizeUnit,
    quantity: spec.pieces,
    rate,
    areaUnit: spec.areaUnit,
    minChargeArea: spec.minChargeArea,
    sides: spec.sides,
    finishing: spec.finishing as FinishingInput[] | undefined,
  })
  const qty = calc.billQty
  if (!(qty > 0)) return { billQty: qty, unitPrice: rate, total: 0, amount: 0, notes: undefined }
  let unitPrice = round2(rate)
  if (calc.finishing.length > 0) {
    const base = round2(calc.amount / qty)
    const candidates = [0, 1, 2, 3, 4, 5].flatMap((k) => (k === 0 ? [base] : [round2(base + k / 100), round2(base - k / 100)]))
    unitPrice = candidates.find((p) => p >= 0 && round2(p * qty) === calc.amount) ?? base
  }
  const notes = calc.finishing.length > 0
    ? [`Print ${calc.baseAmount.toFixed(2)}`, ...calc.finishing.map((f) => `${f.label} ${round2(f.qty)} × ${f.rate.toFixed(2)} = ${f.amount.toFixed(2)}`)].join('; ').slice(0, 500)
    : undefined
  return { billQty: qty, unitPrice, total: round2(unitPrice * qty), amount: calc.amount, notes }
}
