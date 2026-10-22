import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { DbTx } from '@/lib/inventory/db-types'

/**
 * A supplier's bill number identifies one bill: entering the same bill twice doubles the
 * payable. Returns the existing (non-cancelled, non-return) purchase invoice of the same
 * supplier carrying the same bill number (trimmed, case-insensitive), or null.
 *
 * Pass `lock: true` on submit paths: it takes a transaction-scoped advisory lock on
 * (tenant, supplier, bill number) so two concurrent submits cannot both pass the check.
 */
export async function findDuplicateSupplierInvoice(
  tx: DbTx,
  opts: {
    tenantId: string
    supplierId: string | null | undefined
    supplierInvoiceNo: string | null | undefined
    excludePurchaseId?: string | null
    lock?: boolean
  },
): Promise<{ id: string; purchaseNo: string } | null> {
  const billNo = (opts.supplierInvoiceNo || '').trim()
  if (!billNo || !opts.supplierId) return null
  if (opts.lock) {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-bill:${opts.tenantId}:${opts.supplierId}:${billNo.toLowerCase()}`}, 0))
    `)
  }
  const exclude = opts.excludePurchaseId || null
  const res = await tx.execute(sql`
    SELECT id, purchase_no FROM purchases
    WHERE tenant_id = ${opts.tenantId}
      AND supplier_id = ${opts.supplierId}
      AND is_return = false
      AND status <> 'cancelled'
      AND lower(btrim(supplier_invoice_no)) = ${billNo.toLowerCase()}
      AND (${exclude}::uuid IS NULL OR id <> ${exclude}::uuid)
    LIMIT 1
  `)
  const row = ((res as unknown as { rows?: { id: string; purchase_no: string }[] }).rows || [])[0]
  return row ? { id: row.id, purchaseNo: row.purchase_no } : null
}

export function duplicateSupplierInvoiceResponse(billNo: string, existing: { id: string; purchaseNo: string }): NextResponse {
  return NextResponse.json({
    error: `Supplier invoice # ${billNo.trim()} is already recorded on purchase ${existing.purchaseNo} for this supplier`,
    code: 'DUPLICATE_SUPPLIER_INVOICE',
    existingPurchaseId: existing.id,
  }, { status: 409 })
}
