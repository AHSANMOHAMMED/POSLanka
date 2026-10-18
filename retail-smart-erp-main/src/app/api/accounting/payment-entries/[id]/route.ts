import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentEntries, paymentEntryReferences, paymentEntryDeductions, chartOfAccounts, modesOfPayment, users } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePaymentEntrySchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const [entry] = await db.select({
      id: paymentEntries.id,
      tenantId: paymentEntries.tenantId,
      entryNumber: paymentEntries.entryNumber,
      paymentType: paymentEntries.paymentType,
      postingDate: paymentEntries.postingDate,
      partyType: paymentEntries.partyType,
      partyId: paymentEntries.partyId,
      partyName: paymentEntries.partyName,
      paidFromAccountId: paymentEntries.paidFromAccountId,
      paidToAccountId: paymentEntries.paidToAccountId,
      modeOfPaymentId: paymentEntries.modeOfPaymentId,
      paidAmount: paymentEntries.paidAmount,
      receivedAmount: paymentEntries.receivedAmount,
      totalAllocatedAmount: paymentEntries.totalAllocatedAmount,
      unallocatedAmount: paymentEntries.unallocatedAmount,
      writeOffAmount: paymentEntries.writeOffAmount,
      referenceNo: paymentEntries.referenceNo,
      referenceDate: paymentEntries.referenceDate,
      bankAccountId: paymentEntries.bankAccountId,
      clearanceDate: paymentEntries.clearanceDate,
      status: paymentEntries.status,
      remarks: paymentEntries.remarks,
      submittedAt: paymentEntries.submittedAt,
      submittedBy: paymentEntries.submittedBy,
      cancelledAt: paymentEntries.cancelledAt,
      cancellationReason: paymentEntries.cancellationReason,
      createdBy: paymentEntries.createdBy,
      createdAt: paymentEntries.createdAt,
      updatedAt: paymentEntries.updatedAt,
      modeName: modesOfPayment.name,
    })
      .from(paymentEntries)
      .leftJoin(modesOfPayment, eq(paymentEntries.modeOfPaymentId, modesOfPayment.id))
      .where(eq(paymentEntries.id, id))

    if (!entry) return NextResponse.json({ error: 'Payment entry not found' }, { status: 404 })

    // Fetch references
    const references = await db.select().from(paymentEntryReferences)
      .where(eq(paymentEntryReferences.paymentEntryId, id))
      .orderBy(asc(paymentEntryReferences.createdAt))

    // Fetch deductions
    const deductions = await db.select({
      id: paymentEntryDeductions.id,
      accountId: paymentEntryDeductions.accountId,
      costCenterId: paymentEntryDeductions.costCenterId,
      amount: paymentEntryDeductions.amount,
      description: paymentEntryDeductions.description,
      accountName: chartOfAccounts.name,
      accountNumber: chartOfAccounts.accountNumber,
    })
      .from(paymentEntryDeductions)
      .leftJoin(chartOfAccounts, eq(paymentEntryDeductions.accountId, chartOfAccounts.id))
      .where(eq(paymentEntryDeductions.paymentEntryId, id))

    // Fetch account names for display
    const [paidFromAccount] = entry.paidFromAccountId
      ? await db.select({ name: chartOfAccounts.name, accountNumber: chartOfAccounts.accountNumber })
          .from(chartOfAccounts).where(eq(chartOfAccounts.id, entry.paidFromAccountId))
      : [null]
    const [paidToAccount] = entry.paidToAccountId
      ? await db.select({ name: chartOfAccounts.name, accountNumber: chartOfAccounts.accountNumber })
          .from(chartOfAccounts).where(eq(chartOfAccounts.id, entry.paidToAccountId))
      : [null]

    // Fetch creator and submitter names
    let createdByName: string | null = null
    let submittedByName: string | null = null
    if (entry.createdBy) {
      const [creator] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, entry.createdBy))
      createdByName = creator?.fullName || null
    }
    if (entry.submittedBy) {
      const [submitter] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, entry.submittedBy))
      submittedByName = submitter?.fullName || null
    }

    return NextResponse.json({
      ...entry,
      paidFromAccount,
      paidToAccount,
      modeOfPayment: entry.modeName ? { name: entry.modeName } : null,
      references,
      deductions,
      createdByName,
      submittedByName,
    })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenantTransaction(async (session, tx) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    // Can only update draft entries
    const [existing] = await tx.select().from(paymentEntries).where(eq(paymentEntries.id, id))
    if (!existing) return NextResponse.json({ error: 'Payment entry not found' }, { status: 404 })
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft entries can be updated' }, { status: 400 })
    }

    const parsed = await validateBody(request, updatePaymentEntrySchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Optimistic locking: check for concurrent modifications
    if (body.expectedUpdatedAt) {
      const clientTime = new Date(body.expectedUpdatedAt).getTime()
      const serverTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0
      if (serverTime > clientTime) {
        return NextResponse.json({
          error: 'This payment entry was modified by another user. Please refresh and try again.',
          code: 'CONFLICT',
        }, { status: 409 })
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyAny = body as Record<string, any>
    const fields = ['paymentType', 'postingDate', 'partyType', 'partyId', 'partyName',
      'paidFromAccountId', 'paidToAccountId', 'modeOfPaymentId',
      'paidAmount', 'receivedAmount', 'referenceNo', 'referenceDate',
      'bankAccountId', 'remarks']

    for (const field of fields) {
      if (bodyAny[field] !== undefined) {
        if (['paidAmount', 'receivedAmount'].includes(field)) {
          updateData[field] = String(bodyAny[field])
        } else {
          updateData[field] = bodyAny[field] || null
        }
      }
    }

    // Recalculate amounts if references/deductions changed
    if (body.references !== undefined) {
      const totalAllocated = body.references.reduce((sum, ref) => sum + Number(ref.allocatedAmount), 0)
      updateData.totalAllocatedAmount = String(totalAllocated)

      // Delete and re-insert references (atomic within transaction)
      await tx.delete(paymentEntryReferences).where(eq(paymentEntryReferences.paymentEntryId, id))
      if (body.references.length > 0) {
        await tx.insert(paymentEntryReferences).values(
          body.references.map((ref) => ({
            tenantId: session.user.tenantId,
            paymentEntryId: id,
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
    }

    if (body.deductions !== undefined) {
      const totalDeductions = body.deductions.reduce((sum, d) => sum + Math.abs(Number(d.amount)), 0)
      updateData.writeOffAmount = String(totalDeductions)

      await tx.delete(paymentEntryDeductions).where(eq(paymentEntryDeductions.paymentEntryId, id))
      if (body.deductions.length > 0) {
        await tx.insert(paymentEntryDeductions).values(
          body.deductions.map((d) => ({
            tenantId: session.user.tenantId,
            paymentEntryId: id,
            accountId: d.accountId,
            costCenterId: d.costCenterId || null,
            amount: String(d.amount),
            description: d.description || null,
          }))
        )
      }
    }

    // Recalculate unallocated
    const paidAmount = Number(body.paidAmount ?? existing.paidAmount)
    const totalAllocated = Number(updateData.totalAllocatedAmount ?? existing.totalAllocatedAmount)
    const writeOff = Number(updateData.writeOffAmount ?? existing.writeOffAmount)
    updateData.unallocatedAmount = String(Math.max(0, Math.round((paidAmount - totalAllocated - writeOff) * 100) / 100))

    const [updated] = await tx.update(paymentEntries).set(updateData).where(eq(paymentEntries.id, id)).returning()

    logAndBroadcast(session.user.tenantId, 'payment-entry', 'updated', id)
    return NextResponse.json(updated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
