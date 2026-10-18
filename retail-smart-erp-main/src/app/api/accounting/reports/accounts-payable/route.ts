import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { purchases, suppliers, journalEntryItems, journalEntries, paymentEntryReferences, paymentEntries } from '@/lib/db/schema'
import { and, sql, ne, eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { agingReportQuerySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, agingReportQuerySchema)
    if (!parsed.success) return parsed.response
    const asOfDate = parsed.data.asOfDate || new Date().toISOString().split('T')[0]

    return await withTenant(session.user.tenantId, async (db) => {
      // Get all unpaid/partially paid purchases
      const unpaidPurchases = await db.select({
        purchaseId: purchases.id,
        purchaseNo: purchases.purchaseNo,
        purchaseDate: purchases.createdAt,
        supplierId: purchases.supplierId,
        supplierInvoiceNo: purchases.supplierInvoiceNo,
        total: purchases.total,
        paidAmount: purchases.paidAmount,
        status: purchases.status,
      })
        .from(purchases)
        .where(and(
          eq(purchases.tenantId, session.user.tenantId),
          ne(purchases.status, 'cancelled'),
          ne(purchases.status, 'paid'),
          ne(purchases.status, 'draft'),
          eq(purchases.isReturn, false),
          sql`CAST(${purchases.total} AS numeric) > CAST(${purchases.paidAmount} AS numeric)`,
          sql`${purchases.createdAt} <= ${new Date(asOfDate + 'T23:59:59')}`,
        ))

      // Get supplier names
      const supplierIds = [...new Set(unpaidPurchases.filter(p => p.supplierId).map(p => p.supplierId!))]
      const supplierMap: Record<string, string> = {}

      if (supplierIds.length > 0) {
        const supplierList = await db.select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(sql`${suppliers.id} IN (${sql.join(supplierIds.map(id => sql`${id}`), sql`,`)})`)

        for (const s of supplierList) {
          supplierMap[s.id] = s.name
        }
      }

      // Group by supplier and bucket by aging (NET: invoices minus unallocated payments)
      const supplierAging: Record<string, {
        supplierId: string | null
        supplierName: string
        current: number
        days31to60: number
        days61to90: number
        over90: number
        total: number
        invoices: {
          id: string
          purchaseNo: string | null
          supplierInvoiceNo: string | null
          date: string
          total: number
          paidAmount: number
          outstanding: number
          status: string | null
          agingBucket: string
        }[]
        payments: {
          id: string
          entryNumber: string
          sourceType: 'payment_entry' | 'journal_entry'
          date: string
          totalAmount: number
          allocatedAmount: number
          unallocated: number
          agingBucket: string
        }[]
      }> = {}

      const today = new Date(asOfDate)

      for (const purchase of unpaidPurchases) {
        const purchaseDate = new Date(purchase.purchaseDate)
        const daysDiff = Math.floor((today.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24))
        const purchaseTotal = Number(purchase.total || 0)
        const purchasePaid = Number(purchase.paidAmount || 0)
        const outstanding = Math.round((purchaseTotal - purchasePaid) * 100) / 100

        if (outstanding <= 0) continue

        const key = purchase.supplierId || 'unknown'
        if (!supplierAging[key]) {
          supplierAging[key] = {
            supplierId: purchase.supplierId,
            supplierName: purchase.supplierId ? (supplierMap[purchase.supplierId] || 'Unknown Supplier') : 'Unknown Supplier',
            current: 0,
            days31to60: 0,
            days61to90: 0,
            over90: 0,
            total: 0,
            invoices: [],
            payments: [],
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) {
          supplierAging[key].current += outstanding
          agingBucket = 'current'
        } else if (daysDiff <= 60) {
          supplierAging[key].days31to60 += outstanding
          agingBucket = '31-60'
        } else if (daysDiff <= 90) {
          supplierAging[key].days61to90 += outstanding
          agingBucket = '61-90'
        } else {
          supplierAging[key].over90 += outstanding
          agingBucket = 'over90'
        }
        supplierAging[key].total += outstanding

        supplierAging[key].invoices.push({
          id: purchase.purchaseId,
          purchaseNo: purchase.purchaseNo,
          supplierInvoiceNo: purchase.supplierInvoiceNo,
          date: purchaseDate.toISOString().split('T')[0],
          total: Math.round(purchaseTotal * 100) / 100,
          paidAmount: Math.round(purchasePaid * 100) / 100,
          outstanding,
          status: purchase.status,
          agingBucket,
        })
      }

      // Include JE-based payables (credit to AP for suppliers)
      const jePayables = await db.select({
        jeItemId: journalEntryItems.id,
        credit: journalEntryItems.credit,
        partyId: journalEntryItems.partyId,
        entryNumber: journalEntries.entryNumber,
        postingDate: journalEntries.postingDate,
      })
        .from(journalEntryItems)
        .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
        .where(and(
          eq(journalEntryItems.tenantId, session.user.tenantId),
          eq(journalEntryItems.partyType, 'supplier'),
          eq(journalEntries.status, 'submitted'),
          sql`CAST(${journalEntryItems.credit} AS numeric) > 0`,
          sql`${journalEntries.postingDate} <= ${new Date(asOfDate + 'T23:59:59')}`,
        ))

      for (const je of jePayables) {
        if (!je.partyId) continue
        const creditAmount = Number(je.credit)

        // Sum already-allocated (reconciled) amounts for this JE invoice item
        const [allocated] = await db.select({
          total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
        })
          .from(paymentEntryReferences)
          .where(and(
            eq(paymentEntryReferences.referenceType, 'journal_entry'),
            eq(paymentEntryReferences.referenceId, je.jeItemId),
          ))

        const allocatedAmount = Number(allocated?.total || 0)
        const outstanding = Math.round((creditAmount - allocatedAmount) * 100) / 100
        if (outstanding <= 0) continue

        const jeDate = new Date(je.postingDate)
        const daysDiff = Math.floor((today.getTime() - jeDate.getTime()) / (1000 * 60 * 60 * 24))

        const key = je.partyId
        if (!supplierAging[key]) {
          supplierAging[key] = {
            supplierId: je.partyId,
            supplierName: supplierMap[je.partyId] || 'Unknown Supplier',
            current: 0,
            days31to60: 0,
            days61to90: 0,
            over90: 0,
            total: 0,
            invoices: [],
            payments: [],
          }
          // Fetch supplier name if not in map yet
          if (!supplierMap[je.partyId]) {
            const [sup] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, je.partyId))
            if (sup) {
              supplierMap[je.partyId] = sup.name
              supplierAging[key].supplierName = sup.name
            }
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) {
          supplierAging[key].current += outstanding
          agingBucket = 'current'
        } else if (daysDiff <= 60) {
          supplierAging[key].days31to60 += outstanding
          agingBucket = '31-60'
        } else if (daysDiff <= 90) {
          supplierAging[key].days61to90 += outstanding
          agingBucket = '61-90'
        } else {
          supplierAging[key].over90 += outstanding
          agingBucket = 'over90'
        }
        supplierAging[key].total += outstanding

        supplierAging[key].invoices.push({
          id: je.jeItemId,
          purchaseNo: je.entryNumber + ' (JE)',
          supplierInvoiceNo: null,
          date: jeDate.toISOString().split('T')[0],
          total: Math.round(creditAmount * 100) / 100,
          paidAmount: Math.round(allocatedAmount * 100) / 100,
          outstanding,
          status: 'submitted',
          agingBucket,
        })
      }

      // --- Merge Unallocated Payments into supplier rows (as credits) ---

      // 1. Payment entries with unallocated amounts for suppliers
      const unallocatedPEs = await db.select({
        id: paymentEntries.id,
        entryNumber: paymentEntries.entryNumber,
        postingDate: paymentEntries.postingDate,
        partyId: paymentEntries.partyId,
        partyName: paymentEntries.partyName,
        paidAmount: paymentEntries.paidAmount,
        unallocatedAmount: paymentEntries.unallocatedAmount,
      })
        .from(paymentEntries)
        .where(and(
          eq(paymentEntries.tenantId, session.user.tenantId),
          eq(paymentEntries.partyType, 'supplier'),
          eq(paymentEntries.status, 'submitted'),
          sql`CAST(${paymentEntries.unallocatedAmount} AS numeric) > 0`,
          sql`${paymentEntries.postingDate} <= ${asOfDate}`,
        ))

      for (const pe of unallocatedPEs) {
        const unallocated = Number(pe.unallocatedAmount)
        if (unallocated <= 0) continue
        const peDate = new Date(pe.postingDate)
        const daysDiff = Math.floor((today.getTime() - peDate.getTime()) / (1000 * 60 * 60 * 24))

        const key = pe.partyId || 'unknown'
        if (!supplierAging[key]) {
          supplierAging[key] = {
            supplierId: pe.partyId,
            supplierName: pe.partyId ? (supplierMap[pe.partyId] || pe.partyName || 'Unknown Supplier') : 'Unknown Supplier',
            current: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0,
            invoices: [],
            payments: [],
          }
          if (pe.partyId && !supplierMap[pe.partyId]) {
            const [sup] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, pe.partyId))
            if (sup) {
              supplierMap[pe.partyId] = sup.name
              supplierAging[key].supplierName = sup.name
            }
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) { supplierAging[key].current -= unallocated; agingBucket = 'current' }
        else if (daysDiff <= 60) { supplierAging[key].days31to60 -= unallocated; agingBucket = '31-60' }
        else if (daysDiff <= 90) { supplierAging[key].days61to90 -= unallocated; agingBucket = '61-90' }
        else { supplierAging[key].over90 -= unallocated; agingBucket = 'over90' }
        supplierAging[key].total -= unallocated

        supplierAging[key].payments.push({
          id: pe.id,
          entryNumber: pe.entryNumber,
          sourceType: 'payment_entry',
          date: pe.postingDate,
          totalAmount: Math.round(Number(pe.paidAmount) * 100) / 100,
          allocatedAmount: Math.round((Number(pe.paidAmount) - unallocated) * 100) / 100,
          unallocated: Math.round(unallocated * 100) / 100,
          agingBucket,
        })
      }

      // 2. JE-based payments to suppliers (debit AP)
      const jePayments = await db.select({
        jeItemId: journalEntryItems.id,
        debit: journalEntryItems.debit,
        partyId: journalEntryItems.partyId,
        entryNumber: journalEntries.entryNumber,
        postingDate: journalEntries.postingDate,
      })
        .from(journalEntryItems)
        .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
        .where(and(
          eq(journalEntryItems.tenantId, session.user.tenantId),
          eq(journalEntryItems.partyType, 'supplier'),
          eq(journalEntries.status, 'submitted'),
          sql`CAST(${journalEntryItems.debit} AS numeric) > 0`,
          sql`${journalEntries.postingDate} <= ${asOfDate}`,
        ))

      for (const je of jePayments) {
        if (!je.partyId) continue
        const debitAmount = Number(je.debit)

        const [allocated] = await db.select({
          total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
        })
          .from(paymentEntryReferences)
          .where(eq(paymentEntryReferences.sourceJeItemId, je.jeItemId))

        const allocatedAmount = Number(allocated?.total || 0)
        const unallocated = Math.round((debitAmount - allocatedAmount) * 100) / 100
        if (unallocated <= 0) continue

        const jeDate = new Date(je.postingDate)
        const daysDiff = Math.floor((today.getTime() - jeDate.getTime()) / (1000 * 60 * 60 * 24))

        const key = je.partyId
        if (!supplierAging[key]) {
          supplierAging[key] = {
            supplierId: je.partyId,
            supplierName: supplierMap[je.partyId] || 'Unknown Supplier',
            current: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0,
            invoices: [],
            payments: [],
          }
          if (!supplierMap[je.partyId]) {
            const [sup] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, je.partyId))
            if (sup) {
              supplierMap[je.partyId] = sup.name
              supplierAging[key].supplierName = sup.name
            }
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) { supplierAging[key].current -= unallocated; agingBucket = 'current' }
        else if (daysDiff <= 60) { supplierAging[key].days31to60 -= unallocated; agingBucket = '31-60' }
        else if (daysDiff <= 90) { supplierAging[key].days61to90 -= unallocated; agingBucket = '61-90' }
        else { supplierAging[key].over90 -= unallocated; agingBucket = 'over90' }
        supplierAging[key].total -= unallocated

        supplierAging[key].payments.push({
          id: je.jeItemId,
          entryNumber: je.entryNumber + ' (JE)',
          sourceType: 'journal_entry',
          date: je.postingDate,
          totalAmount: Math.round(debitAmount * 100) / 100,
          allocatedAmount: Math.round(allocatedAmount * 100) / 100,
          unallocated: Math.round(unallocated * 100) / 100,
          agingBucket,
        })
      }

      // Build final data and totals AFTER payments have been merged
      const data = Object.values(supplierAging)
        .filter(row => row.invoices.length > 0 || row.payments.length > 0)
        .map(row => ({
          ...row,
          current: Math.round(row.current * 100) / 100,
          days31to60: Math.round(row.days31to60 * 100) / 100,
          days61to90: Math.round(row.days61to90 * 100) / 100,
          over90: Math.round(row.over90 * 100) / 100,
          total: Math.round(row.total * 100) / 100,
          invoices: row.invoices.sort((a, b) => b.date.localeCompare(a.date)),
          payments: row.payments.sort((a, b) => b.date.localeCompare(a.date)),
        }))
        .sort((a, b) => b.total - a.total)

      const totals = data.reduce((acc, row) => ({
        current: acc.current + row.current,
        days31to60: acc.days31to60 + row.days31to60,
        days61to90: acc.days61to90 + row.days61to90,
        over90: acc.over90 + row.over90,
        total: acc.total + row.total,
      }), { current: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 })

      return NextResponse.json({
        data,
        totals: {
          current: Math.round(totals.current * 100) / 100,
          days31to60: Math.round(totals.days31to60 * 100) / 100,
          days61to90: Math.round(totals.days61to90 * 100) / 100,
          over90: Math.round(totals.over90 * 100) / 100,
          total: Math.round(totals.total * 100) / 100,
        },
        filters: { asOfDate },
      })
    })
  } catch (error) {
    logError('api/accounting/reports/accounts-payable', error)
    return NextResponse.json({ error: 'Failed to generate accounts payable report' }, { status: 500 })
  }
}
