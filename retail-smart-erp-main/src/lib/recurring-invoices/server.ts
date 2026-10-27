/**
 * Recurring invoice profile helpers for the API routes (drizzle/0185). Server-only.
 */
import { sql } from 'drizzle-orm'
import { recurringInvoiceItems, recurringInvoices } from '@/lib/db/schema'
import { roundCurrency } from '@/lib/utils/currency'
import type { z } from 'zod'
import type { recurringLineSchema } from '@/lib/validation/schemas/recurring-invoices'

type LineInput = z.infer<typeof recurringLineSchema>

export function lineRows(tenantId: string, profileId: string, lines: LineInput[]) {
  return lines.map((l, i) => ({
    tenantId,
    recurringInvoiceId: profileId,
    itemId: l.itemId,
    itemName: l.itemName,
    quantity: String(Math.round(l.quantity * 1000) / 1000),
    unitPrice: String(roundCurrency(l.unitPrice)),
    discount: String(roundCurrency(l.discount || 0)),
    uom: l.uom || null,
    uomFactor: String(l.uomFactor || 1),
    sortOrder: i,
  }))
}

/** Σ(qty × price − discount) of a profile's lines (before tax / promotions) */
export function profileAmountSql() {
  return sql<string>`(SELECT COALESCE(SUM(ROUND(${recurringInvoiceItems.quantity} * ${recurringInvoiceItems.unitPrice} - ${recurringInvoiceItems.discount}, 2)), 0)::text
    FROM ${recurringInvoiceItems} WHERE ${recurringInvoiceItems.recurringInvoiceId} = ${recurringInvoices.id})`
}
