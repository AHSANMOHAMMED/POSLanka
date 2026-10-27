/**
 * Quotation payloads + server-side line math (shared by POST /api/quotations and PUT /api/quotations/[id]).
 *
 * Lines accept the studio's field names (itemName, total, tax) and the POS "Save as quotation"
 * names (name), plus the unit sold (uom / uomFactor — quantity is in `uom`), a tax rate (%) and
 * warranty months (drizzle/0179). Totals are always recomputed here:
 *   gross   = quantity × unitPrice
 *   net     = gross − line discount
 *   tax     = net × rate/100 (tax-exclusive tenants) | net − net/(1+rate/100) (tax-inclusive)
 *   line total = net (+ tax when exclusive)
 *   quotation: subtotal = Σ gross, discount = Σ line discounts (or the header discount when larger),
 *              tax = Σ tax, total = subtotal − discount (+ tax when exclusive)
 * A line without a rate keeps a legacy absolute `tax` amount when one is sent.
 */
import { z } from 'zod'
import { roundCurrency } from '@/lib/utils/currency'

export const quotationLineSchema = z.object({
  itemId: z.string().uuid().optional().nullable(),
  itemName: z.string().trim().max(255).optional(),
  name: z.string().trim().max(255).optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  uom: z.string().trim().max(20).optional().nullable(),
  uomFactor: z.coerce.number().positive().max(1_000_000).optional().nullable(),
  warrantyMonths: z.coerce.number().int().min(0).max(600).optional().nullable(),
  total: z.coerce.number().optional(),
}).refine((l) => !!(l.itemName || l.name), { message: 'Item name is required', path: ['itemName'] })

export const quotationHeaderSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(255).optional(),
  customerPhone: z.string().max(50).optional(),
  customerEmail: z.string().email().optional().or(z.literal('')),
  notes: z.string().max(10000).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid date').optional().or(z.literal('')),
  discount: z.coerce.number().min(0).optional(),
  // Client totals are accepted for backward compatibility but recomputed server-side
  subtotal: z.coerce.number().optional(),
  tax: z.coerce.number().optional(),
  total: z.coerce.number().optional(),
})

export const createQuotationSchema = quotationHeaderSchema.extend({
  items: z.array(quotationLineSchema).min(1).max(200),
})

export const updateQuotationSchema = quotationHeaderSchema.extend({
  items: z.array(quotationLineSchema).min(1).max(200).optional(),
})

export const quotationStatusChangeSchema = z.object({
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'cancelled']),
})

export type QuotationLineInput = z.infer<typeof quotationLineSchema>

export interface ComputedQuotation {
  lines: Array<{
    itemId: string | null
    itemName: string
    quantity: string
    unitPrice: string
    discount: string
    tax: string
    taxRate: string
    total: string
    uom: string | null
    uomFactor: string
    warrantyMonths: number | null
  }>
  subtotal: number
  discount: number
  tax: number
  total: number
}

export function computeQuotation(
  items: QuotationLineInput[],
  opts: { taxInclusive: boolean; headerDiscount?: number },
): ComputedQuotation {
  let subtotal = 0
  let lineDiscounts = 0
  let taxSum = 0
  const lines = items.map((l) => {
    const gross = roundCurrency(l.quantity * l.unitPrice)
    const discount = Math.min(roundCurrency(l.discount || 0), gross)
    const net = roundCurrency(gross - discount)
    const rate = l.taxRate != null && l.taxRate > 0 ? l.taxRate : 0
    let tax: number
    if (rate > 0) {
      tax = opts.taxInclusive ? roundCurrency(net - net / (1 + rate / 100)) : roundCurrency((net * rate) / 100)
    } else {
      tax = roundCurrency(l.tax || 0)
    }
    const total = opts.taxInclusive ? net : roundCurrency(net + tax)
    subtotal += gross
    lineDiscounts += discount
    taxSum += tax
    return {
      itemId: l.itemId || null,
      itemName: (l.itemName || l.name || '').trim(),
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      discount: String(discount),
      tax: String(tax),
      taxRate: String(rate),
      total: String(total),
      uom: l.uom?.trim() || null,
      uomFactor: String(l.uomFactor && l.uomFactor > 0 ? l.uomFactor : 1),
      warrantyMonths: l.warrantyMonths && l.warrantyMonths > 0 ? l.warrantyMonths : null,
    }
  })
  subtotal = roundCurrency(subtotal)
  taxSum = roundCurrency(taxSum)
  const discount = roundCurrency(Math.min(subtotal, Math.max(lineDiscounts, opts.headerDiscount || 0)))
  const total = roundCurrency(Math.max(0, subtotal - discount + (opts.taxInclusive ? 0 : taxSum)))
  return { lines, subtotal, discount, tax: taxSum, total }
}
