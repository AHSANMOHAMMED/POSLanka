/**
 * VAT treatment of a supply (H2). Stored on tax_templates.tax_category so a sale line's
 * tax_template_id tells the VAT schedules whether a 0% line is zero-rated (VAT at 0%, input VAT
 * recoverable) or exempt (outside the VAT charge, input VAT not recoverable).
 *
 * Pure module: safe for client components.
 */

export const TAX_CATEGORIES = ['standard', 'zero_rated', 'exempt', 'out_of_scope'] as const
export type TaxCategory = (typeof TAX_CATEGORIES)[number]

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  standard: 'Standard rated',
  zero_rated: 'Zero-rated (0%)',
  exempt: 'Exempt',
  out_of_scope: 'Out of scope',
}

export function isTaxCategory(v: unknown): v is TaxCategory {
  return typeof v === 'string' && (TAX_CATEGORIES as readonly string[]).includes(v)
}

/** Schedule bucket a line falls into. `other` = untaxed line without a classifying template. */
export type VatBucket = 'standard' | 'zero_rated' | 'exempt' | 'other'

/**
 * Classify one document line for the VAT schedules.
 * A line that carries VAT is standard-rated whatever its template says; a tax-exempt customer's
 * untaxed lines are exempt; otherwise the template category decides (standard-category lines
 * with no VAT — e.g. a 0% "VAT" template that was never re-categorised — land in `other`).
 */
export function classifyVatLine(opts: {
  taxAmount: number
  category: TaxCategory | null | undefined
  customerTaxExempt?: boolean | null
}): VatBucket {
  if (Math.abs(opts.taxAmount) >= 0.005) return 'standard'
  if (opts.category === 'zero_rated') return 'zero_rated'
  if (opts.category === 'exempt') return 'exempt'
  if (opts.customerTaxExempt) return 'exempt'
  return 'other'
}
