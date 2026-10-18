import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody } from '@/lib/validation/helpers'
import { paymentReconciliationAllocateSchema } from '@/lib/validation/schemas/accounting'

// POST: Auto-allocate payments to invoices using FIFO
export async function POST(request: NextRequest) {
  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permError = requirePermission(preSession, 'manageAccounting')
  if (permError) return permError

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const parsed = await validateBody(request, paymentReconciliationAllocateSchema)
  if (!parsed.success) return parsed.response

  const result = await withAuthTenant(async (_session, _db) => {
    const { payments, invoices } = parsed.data

    // Sort by posting date (FIFO)
    const sortedPayments = [...payments].sort((a: { postingDate: string }, b: { postingDate: string }) =>
      new Date(a.postingDate).getTime() - new Date(b.postingDate).getTime()
    )
    const sortedInvoices = [...invoices].sort((a: { postingDate: string }, b: { postingDate: string }) =>
      new Date(a.postingDate).getTime() - new Date(b.postingDate).getTime()
    )

    const allocations: Array<{
      paymentEntryId: string | null
      sourceJeItemId: string | null
      referenceType: string
      referenceId: string
      referenceNumber?: string
      allocatedAmount: number
    }> = []

    // Track remaining amounts
    const paymentRemaining = new Map<string, number>()
    for (const p of sortedPayments) {
      paymentRemaining.set(p.id, Number(p.unallocatedAmount))
    }

    const invoiceRemaining = new Map<string, number>()
    for (const inv of sortedInvoices) {
      invoiceRemaining.set(inv.referenceId, Number(inv.outstandingAmount))
    }

    // FIFO allocation
    for (const payment of sortedPayments) {
      let remaining = paymentRemaining.get(payment.id) || 0
      if (remaining <= 0) continue

      for (const invoice of sortedInvoices) {
        const invRemaining = invoiceRemaining.get(invoice.referenceId) || 0
        if (invRemaining <= 0) continue

        const allocateAmount = Math.min(remaining, invRemaining)
        if (allocateAmount <= 0) continue

        allocations.push({
          paymentEntryId: payment.sourceType === 'payment_entry' ? payment.id : null,
          sourceJeItemId: payment.sourceType === 'journal_entry_item' ? payment.id : null,
          referenceType: invoice.referenceType,
          referenceId: invoice.referenceId,
          referenceNumber: invoice.referenceNumber,
          allocatedAmount: Math.round(allocateAmount * 100) / 100,
        })

        remaining -= allocateAmount
        invoiceRemaining.set(invoice.referenceId, invRemaining - allocateAmount)
        paymentRemaining.set(payment.id, remaining)

        if (remaining <= 0) break
      }
    }

    return NextResponse.json({ allocations })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
