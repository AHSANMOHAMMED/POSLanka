/**
 * Unit text for a sold line: "" for the base unit, "Box" for a named unit, and the conversion
 * ("1 Box = 12 pcs") when it was sold in a non-base unit. Quantities on the line are in `uom`.
 * Shared by the return screen and the printed receipts so both say the same thing.
 */
export function lineUnit(l: { uom?: string | null; uomFactor?: string | number | null; baseUnit?: string | null }): { unit: string; conversion: string | null } {
  const factor = Number(l.uomFactor)
  const uom = (l.uom || '').trim()
  const nonBase = (Number.isFinite(factor) && factor > 0 && Math.abs(factor - 1) > 1e-9) || (!!uom && !!l.baseUnit && uom.toLowerCase() !== String(l.baseUnit).toLowerCase())
  if (!uom) return { unit: '', conversion: null }
  if (!nonBase) return { unit: uom, conversion: null }
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  const fText = Number.isInteger(f) ? String(f) : String(Math.round(f * 1000) / 1000)
  return { unit: uom, conversion: `1 ${uom} = ${fText}${l.baseUnit ? ` ${l.baseUnit}` : ' base units'}` }
}
