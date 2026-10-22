/**
 * H3 — structured reason codes for stock adjustments (manual / bulk adjustments, stock takes,
 * waste). Stored in stock_movements.reason_code (and stock_take_items / waste_log.reason_code);
 * the free-text note is kept alongside. Each code can map to its own GL account
 * (accounting_settings.stock_adjustment_reason_accounts), falling back to the default Stock
 * Adjustment account.
 */
export const ADJUSTMENT_REASON_CODES = [
  'shrinkage', 'damage', 'theft', 'expiry', 'count_correction', 'internal_use', 'sample', 'other',
] as const

export type AdjustmentReasonCode = typeof ADJUSTMENT_REASON_CODES[number]

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReasonCode, string> = {
  shrinkage: 'Shrinkage',
  damage: 'Damage',
  theft: 'Theft',
  expiry: 'Expiry',
  count_correction: 'Count correction',
  internal_use: 'Internal use',
  sample: 'Sample',
  other: 'Other',
}

export function isAdjustmentReasonCode(v: unknown): v is AdjustmentReasonCode {
  return typeof v === 'string' && (ADJUSTMENT_REASON_CODES as readonly string[]).includes(v)
}

/**
 * Best-effort mapping of a legacy free-text waste reason to a code (waste entries made before
 * reason codes, or clients that still only send text).
 */
export function wasteReasonCode(reason: string | null | undefined): AdjustmentReasonCode {
  const r = (reason || '').toLowerCase()
  if (/expir|spoil|stale|rotten|out of date/.test(r)) return 'expiry'
  if (/damag|broken|spill|burn|drop/.test(r)) return 'damage'
  if (/theft|stolen/.test(r)) return 'theft'
  if (/sample|tasting/.test(r)) return 'sample'
  if (/staff|internal|meal/.test(r)) return 'internal_use'
  return 'other'
}
