/**
 * Shared document tax recalculation utility
 * Centralizes the tax template resolution + per-item calculation pattern
 * used by work orders, restaurant orders, insurance estimates,
 * purchases, purchase orders, sales orders, layaways, and supplier quotations.
 */

import { roundCurrency } from './currency'
import { calculateItemTax, aggregateTaxBreakdown, type TaxBreakdownItem } from './tax-template'
import {
  resolveTaxTemplatesForItems,
  getDefaultTaxTemplate,
  getDefaultPurchaseTaxTemplate,
  getEffectiveTaxTemplate,
  resolveTransactionTaxTemplate,
} from './tax-template-resolver'

// Accept any drizzle DB or transaction instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any

export interface LineItemInput {
  /** Item ID from the items table (null for services or non-inventory items) */
  itemId: string | null
  /** Line total (qty * unitPrice) before tax */
  lineTotal: number
}

export interface PerItemTaxResult {
  itemId: string | null
  taxRate: number       // effective combined rate as percentage
  taxAmount: number     // total tax for this line
  taxBreakdown: TaxBreakdownItem[] | null
  baseAmount: number    // amount before exclusive tax
  totalAmount: number   // baseAmount + exclusive taxes
}

export interface DocumentTaxResult {
  /** Sum of line totals before tax */
  subtotal: number
  /** Total tax across all items */
  totalTax: number
  /** Aggregated tax breakdown for GL posting */
  taxBreakdown: TaxBreakdownItem[] | null
  /** Only exclusive tax (not included in prices) */
  exclusiveTax: number
  /** subtotal + exclusive tax */
  total: number
  /** Per-item tax details */
  perItemTax: PerItemTaxResult[]
}

export interface RecalculateOptions {
  /** 'sales' uses defaultTaxTemplate, 'purchase' uses defaultPurchaseTaxTemplate */
  type: 'sales' | 'purchase'
  /** Transaction-level template override ID (takes priority over item + default) */
  transactionTaxTemplateId?: string | null
  /** Customer or supplier tax exempt flag */
  taxExempt?: boolean
}

/**
 * Recalculate tax for a document's line items using the tax template system.
 *
 * Resolution priority per item:
 * 1. Transaction-level template (if provided)
 * 2. Item-level template (from items.taxTemplateId)
 * 3. Default tenant template (sales or purchase based on type)
 * 4. null → zero tax
 */
export async function recalculateDocumentTax(
  db: DbLike,
  tenantId: string,
  lineItems: LineItemInput[],
  options: RecalculateOptions,
): Promise<DocumentTaxResult> {
  const { type, transactionTaxTemplateId, taxExempt = false } = options

  // 1. Resolve transaction-level template (if specified)
  const txTemplate = await resolveTransactionTaxTemplate(db, transactionTaxTemplateId)

  // 2. Resolve default template based on document type
  const defaultTemplate = txTemplate
    ? null // If transaction template is set, no need for default
    : type === 'purchase'
      ? await getDefaultPurchaseTaxTemplate(db, tenantId)
      : await getDefaultTaxTemplate(db, tenantId)

  // 3. Batch-resolve item-level templates (only if no transaction override)
  const itemIds = txTemplate
    ? [] // Transaction template overrides everything, skip item lookup
    : lineItems.map(li => li.itemId).filter((id): id is string => !!id)
  const itemTemplateMap = itemIds.length > 0
    ? await resolveTaxTemplatesForItems(db, itemIds)
    : new Map<string, null>()

  // 4. Calculate per-item tax
  const allBreakdowns: TaxBreakdownItem[][] = []
  const perItemTax: PerItemTaxResult[] = []
  let subtotal = 0
  let totalTax = 0

  for (const lineItem of lineItems) {
    const lineTotal = roundCurrency(lineItem.lineTotal)
    subtotal += lineTotal

    if (lineTotal <= 0) {
      perItemTax.push({
        itemId: lineItem.itemId,
        taxRate: 0,
        taxAmount: 0,
        taxBreakdown: null,
        baseAmount: lineTotal,
        totalAmount: lineTotal,
      })
      continue
    }

    // Resolution: transaction template > item template > default template
    const template = txTemplate
      || getEffectiveTaxTemplate(itemTemplateMap, lineItem.itemId, defaultTemplate)

    const taxResult = calculateItemTax(lineTotal, template, taxExempt)
    totalTax += taxResult.totalTax

    if (taxResult.breakdown.length > 0) {
      allBreakdowns.push(taxResult.breakdown)
    }

    perItemTax.push({
      itemId: lineItem.itemId,
      taxRate: taxResult.effectiveRate,
      taxAmount: taxResult.totalTax,
      taxBreakdown: taxResult.breakdown.length > 0 ? taxResult.breakdown : null,
      baseAmount: taxResult.baseAmount,
      totalAmount: taxResult.totalAmount,
    })
  }

  subtotal = roundCurrency(subtotal)
  totalTax = roundCurrency(totalTax)

  const taxBreakdown = allBreakdowns.length > 0 ? aggregateTaxBreakdown(allBreakdowns) : null

  // Only exclusive tax is added to total (inclusive is already in subtotal)
  const exclusiveTax = roundCurrency(
    (taxBreakdown || []).filter(b => !b.includedInPrice).reduce((s, b) => s + b.amount, 0)
  )
  const total = roundCurrency(subtotal + exclusiveTax)

  return {
    subtotal,
    totalTax,
    taxBreakdown,
    exclusiveTax,
    total,
    perItemTax,
  }
}
