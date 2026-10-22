// Line maths for customer credit / debit notes (H2): per-line VAT from tax templates, the
// original invoice line, or (legacy clients) the flat tax the client sent.

import { inArray } from 'drizzle-orm'
import { saleItems, taxTemplates } from '@/lib/db/schema'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown, type ResolvedTaxTemplate, type TaxBreakdownItem } from '@/lib/utils/tax-template'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

export interface NoteLineInput {
  itemId?: string | null
  itemName: string
  quantity: number
  unitPrice: number
  /** Tax template to apply (the line amount qty × unitPrice is gross for inclusive templates). */
  taxTemplateId?: string | null
  /** Original invoice line: its tax template / VAT rate is reused when no template is given. */
  saleItemId?: string | null
  /** Legacy: flat tax amount and line value excl. tax sent by the client. */
  tax?: number
  total?: number
}

export interface NoteLine {
  itemId: string | null
  itemName: string
  quantity: number
  unitPrice: number
  taxTemplateId: string | null
  taxRate: number
  tax: number
  taxBreakdown: TaxBreakdownItem[] | null
  /** Value excl. VAT. */
  total: number
}

export interface NoteTotals {
  lines: NoteLine[]
  subtotal: number
  tax: number
  total: number
  taxBreakdown: TaxBreakdownItem[]
  /** True when every line's tax came from the client (legacy flat-tax path). */
  clientTax: boolean
}

function toResolved(t: { id: string; name: string; isActive: boolean; taxCategory?: string | null; items: Array<{ taxName: string; rate: string; accountId: string | null; includedInPrice: boolean }> }): ResolvedTaxTemplate {
  return {
    id: t.id,
    name: t.name,
    taxCategory: (t.taxCategory as ResolvedTaxTemplate['taxCategory']) || 'standard',
    items: t.items.map((i) => ({ taxName: i.taxName, rate: Number(i.rate), accountId: i.accountId, includedInPrice: i.includedInPrice })),
  }
}

/**
 * Compute a note's lines and totals. Throws Error('INVALID_TAX_TEMPLATE') when a referenced
 * template does not exist (RLS-scoped lookup) or is inactive, and Error('INVALID_SALE_ITEM') when
 * a saleItemId is not a line of `saleId`.
 */
export async function computeNoteLines(
  db: DbOrTx,
  inputs: NoteLineInput[],
  opts: { saleId?: string | null; taxExempt?: boolean } = {}
): Promise<NoteTotals> {
  // Original invoice lines (for their tax template / rate)
  const saleItemIds = [...new Set(inputs.map((l) => l.saleItemId).filter(Boolean) as string[])]
  const origLines = new Map<string, { saleId: string; taxTemplateId: string | null; taxRate: string; itemId: string | null }>()
  if (saleItemIds.length) {
    const rows = await db.select({ id: saleItems.id, saleId: saleItems.saleId, taxTemplateId: saleItems.taxTemplateId, taxRate: saleItems.taxRate, itemId: saleItems.itemId })
      .from(saleItems).where(inArray(saleItems.id, saleItemIds))
    for (const r of rows) origLines.set(r.id, r)
    for (const id of saleItemIds) {
      const r = origLines.get(id)
      if (!r || (opts.saleId && r.saleId !== opts.saleId)) throw new Error('INVALID_SALE_ITEM')
    }
  }

  const templateIds = new Set<string>()
  for (const l of inputs) {
    if (l.taxTemplateId) templateIds.add(l.taxTemplateId)
    else if (l.saleItemId && origLines.get(l.saleItemId)?.taxTemplateId) templateIds.add(origLines.get(l.saleItemId)!.taxTemplateId!)
  }
  const templates = new Map<string, ResolvedTaxTemplate>()
  if (templateIds.size) {
    const rows = await db.query.taxTemplates.findMany({ where: inArray(taxTemplates.id, [...templateIds]), with: { items: true } })
    for (const t of rows) templates.set(t.id, toResolved(t))
    for (const l of inputs) {
      if (!l.taxTemplateId) continue
      const t = rows.find((r: { id: string }) => r.id === l.taxTemplateId)
      if (!t || !t.isActive) throw new Error('INVALID_TAX_TEMPLATE')
    }
  }

  let clientTax = true
  const lines: NoteLine[] = inputs.map((l) => {
    const amount = roundCurrency(l.quantity * l.unitPrice)
    const orig = l.saleItemId ? origLines.get(l.saleItemId) : undefined
    const templateId = l.taxTemplateId || orig?.taxTemplateId || null
    const template = templateId ? templates.get(templateId) || null : null
    if (template) {
      clientTax = false
      const r = calculateItemTax(amount, template, !!opts.taxExempt)
      return {
        itemId: l.itemId || orig?.itemId || null, itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice,
        taxTemplateId: template.id, taxRate: roundCurrency(r.effectiveRate), tax: r.totalTax,
        taxBreakdown: r.breakdown.length ? r.breakdown : null, total: roundCurrency(r.baseAmount),
      }
    }
    if (orig && Number(orig.taxRate) > 0 && l.tax === undefined) {
      // Original line had VAT but no template: same rate, exclusive
      clientTax = false
      const rate = Number(orig.taxRate)
      const tax = opts.taxExempt ? 0 : roundCurrency(amount * rate / 100)
      return {
        itemId: l.itemId || orig.itemId || null, itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice,
        taxTemplateId: null, taxRate: rate, tax,
        taxBreakdown: tax > 0 ? [{ taxName: 'VAT', rate, amount: tax, accountId: null, includedInPrice: false }] : null,
        total: amount,
      }
    }
    // Legacy flat tax from the client
    const tax = opts.taxExempt ? 0 : roundCurrency(l.tax || 0)
    const net = roundCurrency(l.total ?? amount)
    const rate = net > 0 && tax > 0 ? roundCurrency((tax / net) * 100) : 0
    return {
      itemId: l.itemId || orig?.itemId || null, itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice,
      taxTemplateId: null, taxRate: rate, tax,
      taxBreakdown: tax > 0 ? [{ taxName: 'VAT', rate, amount: tax, accountId: null, includedInPrice: false }] : null,
      total: net,
    }
  })

  const subtotal = roundCurrency(lines.reduce((s, l) => s + l.total, 0))
  const tax = roundCurrency(lines.reduce((s, l) => s + l.tax, 0))
  const taxBreakdown = aggregateTaxBreakdown(lines.map((l) => l.taxBreakdown || []))
  return { lines, subtotal, tax, total: roundCurrency(subtotal + tax), taxBreakdown, clientTax }
}
