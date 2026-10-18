import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentEntries, paymentEntryReferences, sales, purchases, paymentLedger, accountingSettings, journalEntryItems, journalEntries } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody } from '@/lib/validation/helpers'
import { paymentReconciliationReconcileSchema } from '@/lib/validation/schemas/accounting'

// POST: Execute reconciliation - allocate payments to invoices
export async function POST(request: NextRequest) {

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permError = requirePermission(preSession, 'manageAccounting')
  if (permError) return permError

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const parsed = await validateBody(request, paymentReconciliationReconcileSchema)
  if (!parsed.success) return parsed.response

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const tenantId = session.user.tenantId
    const { allocations } = parsed.data

    const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)

    for (const alloc of allocations) {
      const { paymentEntryId, sourceJeItemId, referenceType, referenceId, referenceNumber, allocatedAmount } = alloc
      if ((!paymentEntryId && !sourceJeItemId) || !referenceType || !referenceId || !allocatedAmount) continue

      // Variables for payment ledger entry
      let partyType: 'customer' | 'supplier' | null = null
      let partyId: string | null = null
      let postingDate: string = new Date().toISOString().split('T')[0]
      let voucherType: string
      let voucherId: string

      if (paymentEntryId) {
        // === Payment Entry-based allocation (existing flow) ===
        const [pe] = await tx.select().from(paymentEntries).where(eq(paymentEntries.id, paymentEntryId))
        if (!pe || pe.status !== 'submitted') continue
        if (Number(pe.unallocatedAmount) < allocatedAmount) continue

        partyType = pe.partyType as 'customer' | 'supplier'
        partyId = pe.partyId
        postingDate = pe.postingDate
        voucherType = 'payment_entry'
        voucherId = pe.id

        // Get invoice total for reference
        let totalAmount = 0
        let outstandingAmount = 0
        if (referenceType === 'sale') {
          const [sale] = await tx.select().from(sales).where(eq(sales.id, referenceId))
          if (!sale) continue
          totalAmount = Number(sale.total)
          outstandingAmount = Math.round((Number(sale.total) - Number(sale.paidAmount)) * 100) / 100
        } else if (referenceType === 'purchase') {
          const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, referenceId))
          if (!purchase) continue
          totalAmount = Number(purchase.total)
          outstandingAmount = Math.round((Number(purchase.total) - Number(purchase.paidAmount)) * 100) / 100
        } else if (referenceType === 'journal_entry') {
          const [jeItem] = await tx.select().from(journalEntryItems).where(eq(journalEntryItems.id, referenceId))
          if (!jeItem) continue
          const jeAmount = pe.partyType === 'customer' ? Number(jeItem.debit) : Number(jeItem.credit)
          const [allocated] = await tx.select({
            total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
          })
            .from(paymentEntryReferences)
            .where(and(
              eq(paymentEntryReferences.referenceType, 'journal_entry'),
              eq(paymentEntryReferences.referenceId, referenceId),
            ))
          const alreadyAllocated = Number(allocated?.total || 0)
          totalAmount = jeAmount
          outstandingAmount = Math.round((jeAmount - alreadyAllocated) * 100) / 100
        }

        // Create payment entry reference
        await tx.insert(paymentEntryReferences).values({
          tenantId,
          paymentEntryId,
          sourceJeItemId: null,
          referenceType,
          referenceId,
          referenceNumber: referenceNumber || null,
          totalAmount: String(totalAmount),
          outstandingAmount: String(outstandingAmount),
          allocatedAmount: String(allocatedAmount),
        })

        // Update payment entry amounts
        await tx.update(paymentEntries).set({
          totalAllocatedAmount: sql`CAST(CAST(${paymentEntries.totalAllocatedAmount} AS numeric) + ${allocatedAmount} AS numeric(15,2))`,
          unallocatedAmount: sql`CAST(CAST(${paymentEntries.unallocatedAmount} AS numeric) - ${allocatedAmount} AS numeric(15,2))`,
          updatedAt: new Date(),
        }).where(eq(paymentEntries.id, paymentEntryId))

        logAndBroadcast(tenantId, 'payment-entry', 'updated', paymentEntryId)
      } else if (sourceJeItemId) {
        // === JE-based payment allocation (new flow) ===
        const [jeItem] = await tx.select({
          id: journalEntryItems.id,
          debit: journalEntryItems.debit,
          credit: journalEntryItems.credit,
          partyType: journalEntryItems.partyType,
          partyId: journalEntryItems.partyId,
          accountId: journalEntryItems.accountId,
          jeStatus: journalEntries.status,
          jePostingDate: journalEntries.postingDate,
          journalEntryId: journalEntryItems.journalEntryId,
        })
          .from(journalEntryItems)
          .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
          .where(eq(journalEntryItems.id, sourceJeItemId))

        if (!jeItem || jeItem.jeStatus !== 'submitted') continue

        partyType = jeItem.partyType as 'customer' | 'supplier'
        partyId = jeItem.partyId
        postingDate = jeItem.jePostingDate
        voucherType = 'journal_entry'
        voucherId = jeItem.journalEntryId

        // Payment amount: credit for customers, debit for suppliers
        const jePaymentAmount = partyType === 'customer' ? Number(jeItem.credit) : Number(jeItem.debit)

        // Check already-allocated from existing references
        const [allocated] = await tx.select({
          total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
        })
          .from(paymentEntryReferences)
          .where(eq(paymentEntryReferences.sourceJeItemId, sourceJeItemId))

        const alreadyAllocated = Number(allocated?.total || 0)
        const remaining = Math.round((jePaymentAmount - alreadyAllocated) * 100) / 100
        if (remaining < allocatedAmount) continue

        // Get invoice total for reference
        let totalAmount = 0
        let outstandingAmount = 0
        if (referenceType === 'sale') {
          const [sale] = await tx.select().from(sales).where(eq(sales.id, referenceId))
          if (!sale) continue
          totalAmount = Number(sale.total)
          outstandingAmount = Math.round((Number(sale.total) - Number(sale.paidAmount)) * 100) / 100
        } else if (referenceType === 'purchase') {
          const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, referenceId))
          if (!purchase) continue
          totalAmount = Number(purchase.total)
          outstandingAmount = Math.round((Number(purchase.total) - Number(purchase.paidAmount)) * 100) / 100
        } else if (referenceType === 'journal_entry') {
          const [invJeItem] = await tx.select().from(journalEntryItems).where(eq(journalEntryItems.id, referenceId))
          if (!invJeItem) continue
          const jeAmount = partyType === 'customer' ? Number(invJeItem.debit) : Number(invJeItem.credit)
          const [invAllocated] = await tx.select({
            total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
          })
            .from(paymentEntryReferences)
            .where(and(
              eq(paymentEntryReferences.referenceType, 'journal_entry'),
              eq(paymentEntryReferences.referenceId, referenceId),
            ))
          totalAmount = jeAmount
          outstandingAmount = Math.round((jeAmount - Number(invAllocated?.total || 0)) * 100) / 100
        }

        // Create payment entry reference with sourceJeItemId
        await tx.insert(paymentEntryReferences).values({
          tenantId,
          paymentEntryId: null,
          sourceJeItemId,
          referenceType,
          referenceId,
          referenceNumber: referenceNumber || null,
          totalAmount: String(totalAmount),
          outstandingAmount: String(outstandingAmount),
          allocatedAmount: String(allocatedAmount),
        })

        logAndBroadcast(tenantId, 'journal-entry', 'updated', jeItem.journalEntryId)
      } else {
        continue
      }

      // Update invoice outstanding (same for both PE and JE-based)
      if (referenceType === 'sale') {
        await tx.update(sales).set({
          paidAmount: sql`CAST(CAST(${sales.paidAmount} AS numeric) + ${allocatedAmount} AS numeric(12,2))`,
          status: sql`CASE
            WHEN CAST(CAST(${sales.paidAmount} AS numeric) + ${allocatedAmount} AS numeric(12,2)) >= CAST(${sales.total} AS numeric) THEN 'completed'
            WHEN CAST(CAST(${sales.paidAmount} AS numeric) + ${allocatedAmount} AS numeric(12,2)) > 0 THEN 'partial'
            ELSE ${sales.status}
          END`,
        }).where(eq(sales.id, referenceId))
        logAndBroadcast(tenantId, 'sale', 'updated', referenceId)
      } else if (referenceType === 'purchase') {
        await tx.update(purchases).set({
          paidAmount: sql`CAST(CAST(${purchases.paidAmount} AS numeric) + ${allocatedAmount} AS numeric(12,2))`,
          status: sql`CASE
            WHEN CAST(CAST(${purchases.paidAmount} AS numeric) + ${allocatedAmount} AS numeric(12,2)) >= CAST(${purchases.total} AS numeric) THEN 'paid'
            WHEN CAST(CAST(${purchases.paidAmount} AS numeric) + ${allocatedAmount} AS numeric(12,2)) > 0 THEN 'partial'
            ELSE ${purchases.status}
          END`,
        }).where(eq(purchases.id, referenceId))
        logAndBroadcast(tenantId, 'purchase', 'updated', referenceId)
      } else if (referenceType === 'journal_entry') {
        logAndBroadcast(tenantId, 'journal-entry', 'updated', referenceId)
      }

      // Create payment ledger entry
      if (partyType && partyId) {
        const accountType = partyType === 'customer' ? 'receivable' : 'payable'
        const accountId = partyType === 'customer'
          ? settings?.defaultReceivableAccountId
          : settings?.defaultPayableAccountId

        if (accountId) {
          await tx.insert(paymentLedger).values({
            tenantId,
            postingDate,
            accountType,
            accountId,
            partyType,
            partyId,
            voucherType: voucherType!,
            voucherId: voucherId!,
            againstVoucherType: referenceType,
            againstVoucherId: referenceId,
            amount: String(-allocatedAmount),
          })
        }
      }
    }

    return NextResponse.json({ success: true, reconciled: allocations.length })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
