import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { paymentEntries, paymentEntryReferences, paymentSchedules, sales, purchases, paymentLedger } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { validateBody } from '@/lib/validation'
import { cancelPaymentEntrySchema } from '@/lib/validation/schemas/accounting'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  // Validate body before auth/quota checks
  const parsed = await validateBody(request, cancelPaymentEntrySchema)
  if (!parsed.success) return parsed.response
  const { cancellationReason } = parsed.data

  // Check quota before starting transaction
  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const tenantId = session.user.tenantId

    const [entry] = await tx.select().from(paymentEntries).where(eq(paymentEntries.id, id)).for('update')
    if (!entry) return NextResponse.json({ error: 'Payment entry not found' }, { status: 404 })
    if (entry.status !== 'submitted') {
      return NextResponse.json({ error: 'Only submitted entries can be cancelled' }, { status: 400 })
    }

    // Fetch references
    const references = await tx.select().from(paymentEntryReferences).where(eq(paymentEntryReferences.paymentEntryId, id))

    // 1. Reverse GL entries
    await reverseGLEntries(tx, tenantId, 'payment_entry', id, entry.postingDate)

    // 2. Reverse invoice outstanding updates
    for (const ref of references) {
      if (ref.referenceType === 'sale') {
        await tx.update(sales).set({
          paidAmount: sql`CAST(GREATEST(0, CAST(${sales.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(12,2))`,
          status: sql`CASE
            WHEN CAST(GREATEST(0, CAST(${sales.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(12,2)) <= 0 THEN 'pending'
            WHEN CAST(GREATEST(0, CAST(${sales.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(12,2)) < CAST(${sales.total} AS numeric) THEN 'partial'
            ELSE ${sales.status}
          END`,
        }).where(eq(sales.id, ref.referenceId))
      } else if (ref.referenceType === 'purchase') {
        await tx.update(purchases).set({
          paidAmount: sql`CAST(GREATEST(0, CAST(${purchases.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(12,2))`,
          status: sql`CASE
            WHEN CAST(GREATEST(0, CAST(${purchases.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(12,2)) <= 0 THEN 'pending'
            WHEN CAST(GREATEST(0, CAST(${purchases.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(12,2)) < CAST(${purchases.total} AS numeric) THEN 'partial'
            ELSE ${purchases.status}
          END`,
        }).where(eq(purchases.id, ref.referenceId))
      }

      // Reverse payment schedule updates
      if (ref.paymentScheduleId) {
        await tx.update(paymentSchedules).set({
          paidAmount: sql`CAST(GREATEST(0, CAST(${paymentSchedules.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(15,2))`,
          outstanding: sql`CAST(CAST(${paymentSchedules.outstanding} AS numeric) + ${Number(ref.allocatedAmount)} AS numeric(15,2))`,
          status: sql`CASE
            WHEN CAST(GREATEST(0, CAST(${paymentSchedules.paidAmount} AS numeric) - ${Number(ref.allocatedAmount)}) AS numeric(15,2)) <= 0 THEN 'unpaid'
            ELSE 'partly_paid'
          END`,
        }).where(eq(paymentSchedules.id, ref.paymentScheduleId))
      }
    }

    // 3. Delete payment ledger entries for this PE
    await tx.delete(paymentLedger).where(
      and(
        eq(paymentLedger.voucherType, 'payment_entry'),
        eq(paymentLedger.voucherId, id),
      )
    )

    // 4. Update entry status
    const [updated] = await tx.update(paymentEntries).set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: session.user.id,
      cancellationReason,
      updatedAt: new Date(),
    }).where(eq(paymentEntries.id, id)).returning()

    logAndBroadcast(tenantId, 'payment-entry', 'updated', id)
    for (const ref of references) {
      if (ref.referenceType === 'sale') {
        logAndBroadcast(tenantId, 'sale', 'updated', ref.referenceId)
      } else if (ref.referenceType === 'purchase') {
        logAndBroadcast(tenantId, 'purchase', 'updated', ref.referenceId)
      }
    }

    return NextResponse.json(updated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
