import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentEntries, paymentEntryReferences, paymentEntryDeductions, accountingSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postPaymentEntryToGL, updateInvoiceOutstanding, createPaymentLedgerEntries } from '@/lib/accounting/payment-entry'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permError = requirePermission(preSession, 'manageAccounting')
  if (permError) return permError

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const tenantId = session.user.tenantId

    // Fetch entry
    const [entry] = await tx.select().from(paymentEntries).where(eq(paymentEntries.id, id)).for('update')
    if (!entry) return NextResponse.json({ error: 'Payment entry not found' }, { status: 404 })
    if (entry.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft entries can be submitted' }, { status: 400 })
    }

    // Validate accounts are set
    if (!entry.paidFromAccountId || !entry.paidToAccountId) {
      return NextResponse.json({ error: 'Both paid from and paid to accounts must be set' }, { status: 400 })
    }

    // Fetch references and deductions
    const references = await tx.select().from(paymentEntryReferences).where(eq(paymentEntryReferences.paymentEntryId, id))
    const deductions = await tx.select().from(paymentEntryDeductions).where(eq(paymentEntryDeductions.paymentEntryId, id))

    // Fetch accounting config for payment ledger
    const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)

    // Build data for GL posting
    const data = {
      id: entry.id,
      tenantId,
      entryNumber: entry.entryNumber,
      paymentType: entry.paymentType,
      postingDate: entry.postingDate,
      partyType: entry.partyType,
      partyId: entry.partyId,
      paidFromAccountId: entry.paidFromAccountId,
      paidToAccountId: entry.paidToAccountId,
      paidAmount: Number(entry.paidAmount),
      receivedAmount: Number(entry.receivedAmount),
      totalAllocatedAmount: Number(entry.totalAllocatedAmount),
      unallocatedAmount: Number(entry.unallocatedAmount),
      writeOffAmount: Number(entry.writeOffAmount),
      references: references.map(r => ({
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        referenceNumber: r.referenceNumber,
        totalAmount: Number(r.totalAmount),
        outstandingAmount: Number(r.outstandingAmount),
        allocatedAmount: Number(r.allocatedAmount),
        paymentScheduleId: r.paymentScheduleId,
      })),
      deductions: deductions.map(d => ({
        accountId: d.accountId,
        costCenterId: d.costCenterId,
        amount: Number(d.amount),
        description: d.description,
      })),
    }

    // 1. Create GL entries
    await postPaymentEntryToGL(tx, data)

    // 2. Update invoice outstanding amounts
    if (references.length > 0) {
      await updateInvoiceOutstanding(tx, data.references)
    }

    // 3. Create payment ledger entries
    const config = settings ? {
      defaultReceivableAccountId: settings.defaultReceivableAccountId,
      defaultPayableAccountId: settings.defaultPayableAccountId,
      defaultCashAccountId: settings.defaultCashAccountId,
      defaultBankAccountId: settings.defaultBankAccountId,
      defaultWriteOffAccountId: settings.defaultWriteOffAccountId,
      defaultAdvanceReceivedAccountId: settings.defaultAdvanceReceivedAccountId,
      defaultAdvancePaidAccountId: settings.defaultAdvancePaidAccountId,
      currentFiscalYearId: settings.currentFiscalYearId,
    } : null
    await createPaymentLedgerEntries(tx, data, config)

    // 4. Update entry status
    const [updated] = await tx.update(paymentEntries).set({
      status: 'submitted',
      submittedAt: new Date(),
      submittedBy: session.user.id,
      updatedAt: new Date(),
    }).where(eq(paymentEntries.id, id)).returning()

    logAndBroadcast(tenantId, 'payment-entry', 'updated', id)
    // Also broadcast sale/purchase updates
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
