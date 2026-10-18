import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentEntries, paymentEntryReferences, paymentEntryDeductions, modesOfPayment } from '@/lib/db/schema'
import { eq, desc, and, ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { generateEntryNumber } from '@/lib/accounting/payment-entry'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { paymentEntriesListSchema, createPaymentEntrySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const parsedParams = validateSearchParams(request, paymentEntriesListSchema)
  if (!parsedParams.success) return parsedParams.response
  const { search, status, paymentType, partyType, partyId, fromDate, toDate, page, pageSize } = parsedParams.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const conditions = []
    if (search) {
      const escaped = escapeLikePattern(search)
      conditions.push(or(
        ilike(paymentEntries.entryNumber, `%${escaped}%`),
        ilike(paymentEntries.partyName, `%${escaped}%`),
        ilike(paymentEntries.referenceNo, `%${escaped}%`),
      ))
    }
    if (status) conditions.push(eq(paymentEntries.status, status))
    if (paymentType) conditions.push(eq(paymentEntries.paymentType, paymentType))
    if (partyType) conditions.push(eq(paymentEntries.partyType, partyType))
    if (partyId) conditions.push(eq(paymentEntries.partyId, partyId))
    if (fromDate) conditions.push(sql`${paymentEntries.postingDate} >= ${fromDate}`)
    if (toDate) conditions.push(sql`${paymentEntries.postingDate} <= ${toDate}`)

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(paymentEntries).where(where)
    const data = await db.select({
      id: paymentEntries.id,
      entryNumber: paymentEntries.entryNumber,
      paymentType: paymentEntries.paymentType,
      postingDate: paymentEntries.postingDate,
      partyType: paymentEntries.partyType,
      partyId: paymentEntries.partyId,
      partyName: paymentEntries.partyName,
      paidAmount: paymentEntries.paidAmount,
      receivedAmount: paymentEntries.receivedAmount,
      totalAllocatedAmount: paymentEntries.totalAllocatedAmount,
      unallocatedAmount: paymentEntries.unallocatedAmount,
      status: paymentEntries.status,
      referenceNo: paymentEntries.referenceNo,
      modeOfPaymentId: paymentEntries.modeOfPaymentId,
      createdAt: paymentEntries.createdAt,
      modeName: modesOfPayment.name,
    })
      .from(paymentEntries)
      .leftJoin(modesOfPayment, eq(paymentEntries.modeOfPaymentId, modesOfPayment.id))
      .where(where)
      .orderBy(desc(paymentEntries.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({
      data,
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function POST(request: NextRequest) {
  const result = await withAuthTenantTransaction(async (session, tx) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createPaymentEntrySchema)
    if (!parsed.success) return parsed.response
    const {
      paymentType, postingDate, partyType, partyId, partyName,
      paidFromAccountId, paidToAccountId, modeOfPaymentId,
      paidAmount, receivedAmount,
      referenceNo, referenceDate, bankAccountId,
      remarks,
      references = [],
      deductions = [],
    } = parsed.data
    const tenantId = session.user.tenantId

    if (paymentType !== 'internal_transfer' && !partyType) {
      return NextResponse.json({ error: 'Party type is required for receive/pay entries' }, { status: 400 })
    }

    // Validate party type matches payment type
    if (paymentType === 'receive' && partyType !== 'customer') {
      return NextResponse.json({ error: 'Party type must be "customer" for receive payments' }, { status: 400 })
    }
    if (paymentType === 'pay' && partyType !== 'supplier') {
      return NextResponse.json({ error: 'Party type must be "supplier" for pay payments' }, { status: 400 })
    }

    const entryNumber = await generateEntryNumber(tx, tenantId)

    // Calculate allocated and unallocated amounts
    const totalAllocated = references.reduce((sum, ref) => sum + ref.allocatedAmount, 0)
    const totalDeductions = deductions.reduce((sum, d) => sum + Math.abs(d.amount), 0)

    // Validate allocation amounts
    if (Math.round((totalAllocated + totalDeductions) * 100) / 100 > paidAmount) {
      return NextResponse.json({
        error: `Total allocated (${totalAllocated}) + deductions (${totalDeductions}) exceeds paid amount (${paidAmount})`,
      }, { status: 400 })
    }

    for (const ref of references) {
      if (ref.allocatedAmount > ref.outstandingAmount) {
        return NextResponse.json({
          error: `Allocated amount (${ref.allocatedAmount}) exceeds outstanding amount (${ref.outstandingAmount}) for reference ${ref.referenceNumber || ref.referenceId}`,
        }, { status: 400 })
      }
    }

    const unallocated = Math.round((paidAmount - totalAllocated - totalDeductions) * 100) / 100

    const [entry] = await tx.insert(paymentEntries).values({
      tenantId,
      entryNumber,
      paymentType,
      postingDate,
      partyType: partyType || null,
      partyId: partyId || null,
      partyName: partyName || null,
      paidFromAccountId: paidFromAccountId || null,
      paidToAccountId: paidToAccountId || null,
      modeOfPaymentId: modeOfPaymentId || null,
      paidAmount: String(paidAmount),
      receivedAmount: String(receivedAmount || paidAmount),
      totalAllocatedAmount: String(totalAllocated),
      unallocatedAmount: String(Math.max(0, unallocated)),
      writeOffAmount: String(totalDeductions),
      referenceNo: referenceNo || null,
      referenceDate: referenceDate || null,
      bankAccountId: bankAccountId || null,
      status: 'draft',
      remarks: remarks || null,
      createdBy: session.user.id,
    }).returning()

    // Insert references
    if (references.length > 0) {
      await tx.insert(paymentEntryReferences).values(
        references.map((ref) => ({
          tenantId,
          paymentEntryId: entry.id,
          referenceType: ref.referenceType,
          referenceId: ref.referenceId,
          referenceNumber: ref.referenceNumber || null,
          totalAmount: String(ref.totalAmount),
          outstandingAmount: String(ref.outstandingAmount),
          allocatedAmount: String(ref.allocatedAmount),
          paymentScheduleId: ref.paymentScheduleId || null,
        }))
      )
    }

    // Insert deductions
    if (deductions.length > 0) {
      await tx.insert(paymentEntryDeductions).values(
        deductions.map((d) => ({
          tenantId,
          paymentEntryId: entry.id,
          accountId: d.accountId,
          costCenterId: d.costCenterId || null,
          amount: String(d.amount),
          description: d.description || null,
        }))
      )
    }

    logAndBroadcast(tenantId, 'payment-entry', 'created', entry.id)
    return NextResponse.json(entry, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
