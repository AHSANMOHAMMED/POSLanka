/**
 * Quotation → sale linkage: when a sale is created from a quotation (POS ?fromQuotation, or the
 * back-office invoice form prefilled from one), the quotation is marked converted and points at
 * that sale (quotations.converted_sale_id). Runs inside the sale transaction so an aborted sale
 * leaves the quotation unlinked. One quotation → one sale.
 */
import { and, eq } from 'drizzle-orm'
import { quotations } from '@/lib/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Throws QUOTATION_NOT_FOUND (not this tenant's), QUOTATION_NOT_CONVERTIBLE (cancelled / rejected)
 * or QUOTATION_ALREADY_CONVERTED (already linked to another sale).
 */
export async function linkQuotationToSale(db: Db, tenantId: string, quotationId: string, saleId: string): Promise<void> {
  const [quote] = await db.select({ id: quotations.id, status: quotations.status, convertedSaleId: quotations.convertedSaleId })
    .from(quotations)
    .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId)))
    .for('update')
  if (!quote) throw new Error('QUOTATION_NOT_FOUND')
  if (quote.convertedSaleId && quote.convertedSaleId !== saleId) throw new Error('QUOTATION_ALREADY_CONVERTED')
  if (quote.status === 'cancelled' || quote.status === 'rejected') throw new Error('QUOTATION_NOT_CONVERTIBLE')
  await db.update(quotations)
    .set({ status: 'converted', convertedSaleId: saleId, updatedAt: new Date() })
    .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId)))
}
