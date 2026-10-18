import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentEntries } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { validateSearchParams } from '@/lib/validation/helpers'
import { unallocatedPaymentsQuerySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, unallocatedPaymentsQuerySchema)
    if (!parsed.success) return parsed.response
    const { partyType, partyId } = parsed.data

    const unallocated = await db.select({
      id: paymentEntries.id,
      entryNumber: paymentEntries.entryNumber,
      postingDate: paymentEntries.postingDate,
      paidAmount: paymentEntries.paidAmount,
      totalAllocatedAmount: paymentEntries.totalAllocatedAmount,
      unallocatedAmount: paymentEntries.unallocatedAmount,
      referenceNo: paymentEntries.referenceNo,
    })
      .from(paymentEntries)
      .where(and(
        eq(paymentEntries.partyType, partyType as 'customer' | 'supplier'),
        eq(paymentEntries.partyId, partyId),
        eq(paymentEntries.status, 'submitted'),
        sql`CAST(${paymentEntries.unallocatedAmount} AS numeric) > 0`,
      ))

    return NextResponse.json(unallocated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
