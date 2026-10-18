import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentEntries, paymentEntryReferences, sales, purchases, paymentLedger } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation/helpers'
import { paymentReconciliationUnreconcileSchema } from '@/lib/validation/schemas/accounting'

// POST: Reverse a reconciliation (unallocate a payment entry reference)
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, paymentReconciliationUnreconcileSchema)
  if (!parsed.success) return parsed.response

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const tenantId = session.user.tenantId
    const { paymentEntryReferenceIds } = parsed.data

    let unreconciled = 0

    for (const refId of paymentEntryReferenceIds) {
      // Get the reference
      const [ref] = await tx.select().from(paymentEntryReferences).where(eq(paymentEntryReferences.id, refId))
      if (!ref) continue

      const allocatedAmount = Number(ref.allocatedAmount)

      // Reverse payment entry amounts (only if PE-based)
      if (ref.paymentEntryId) {
        await tx.update(paymentEntries).set({
          totalAllocatedAmount: sql`CAST(CAST(${paymentEntries.totalAllocatedAmount} AS numeric) - ${allocatedAmount} AS numeric(15,2))`,
          unallocatedAmount: sql`CAST(CAST(${paymentEntries.unallocatedAmount} AS numeric) + ${allocatedAmount} AS numeric(15,2))`,
          updatedAt: new Date(),
        }).where(eq(paymentEntries.id, ref.paymentEntryId))
      }
      // For JE-based (sourceJeItemId): no PE to update, allocation tracked via references

      // Reverse invoice outstanding
      if (ref.referenceType === 'sale') {
        await tx.update(sales).set({
          paidAmount: sql`CAST(GREATEST(CAST(${sales.paidAmount} AS numeric) - ${allocatedAmount}, 0) AS numeric(12,2))`,
          status: sql`CASE
            WHEN CAST(GREATEST(CAST(${sales.paidAmount} AS numeric) - ${allocatedAmount}, 0) AS numeric(12,2)) <= 0 THEN 'pending'
            WHEN CAST(GREATEST(CAST(${sales.paidAmount} AS numeric) - ${allocatedAmount}, 0) AS numeric(12,2)) < CAST(${sales.total} AS numeric) THEN 'partial'
            ELSE ${sales.status}
          END`,
        }).where(eq(sales.id, ref.referenceId))
      } else if (ref.referenceType === 'purchase') {
        await tx.update(purchases).set({
          paidAmount: sql`CAST(GREATEST(CAST(${purchases.paidAmount} AS numeric) - ${allocatedAmount}, 0) AS numeric(12,2))`,
          status: sql`CASE
            WHEN CAST(GREATEST(CAST(${purchases.paidAmount} AS numeric) - ${allocatedAmount}, 0) AS numeric(12,2)) <= 0 THEN 'received'
            WHEN CAST(GREATEST(CAST(${purchases.paidAmount} AS numeric) - ${allocatedAmount}, 0) AS numeric(12,2)) < CAST(${purchases.total} AS numeric) THEN 'partial'
            ELSE ${purchases.status}
          END`,
        }).where(eq(purchases.id, ref.referenceId))
      }

      // Delete payment ledger entries for this allocation
      if (ref.paymentEntryId) {
        await tx.delete(paymentLedger).where(
          and(
            eq(paymentLedger.voucherId, ref.paymentEntryId),
            eq(paymentLedger.againstVoucherId, ref.referenceId),
          )
        )
      } else if (ref.sourceJeItemId) {
        // For JE-based: voucherId is the journal entry ID (parent of the JE item)
        await tx.delete(paymentLedger).where(
          and(
            eq(paymentLedger.againstVoucherId, ref.referenceId),
            eq(paymentLedger.voucherType, 'journal_entry'),
          )
        )
      }

      // Delete the reference
      await tx.delete(paymentEntryReferences).where(eq(paymentEntryReferences.id, refId))

      if (ref.paymentEntryId) {
        logAndBroadcast(tenantId, 'payment-entry', 'updated', ref.paymentEntryId)
      }
      if (ref.sourceJeItemId) {
        logAndBroadcast(tenantId, 'journal-entry', 'updated', ref.sourceJeItemId)
      }
      if (ref.referenceType === 'sale') {
        logAndBroadcast(tenantId, 'sale', 'updated', ref.referenceId)
      } else if (ref.referenceType === 'purchase') {
        logAndBroadcast(tenantId, 'purchase', 'updated', ref.referenceId)
      } else if (ref.referenceType === 'journal_entry') {
        logAndBroadcast(tenantId, 'journal-entry', 'updated', ref.referenceId)
      }
      unreconciled++
    }

    return NextResponse.json({ success: true, unreconciled })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
