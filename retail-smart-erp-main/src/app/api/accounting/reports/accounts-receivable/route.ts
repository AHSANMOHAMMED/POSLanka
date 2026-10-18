import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { sales, customers, journalEntryItems, journalEntries, paymentEntryReferences, paymentEntries } from '@/lib/db/schema'
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
      // Get all unpaid/partially paid sales
      // Outstanding = total - paidAmount
      const unpaidSales = await db.select({
        saleId: sales.id,
        invoiceNo: sales.invoiceNo,
        saleDate: sales.createdAt,
        customerId: sales.customerId,
        customerName: sales.customerName,
        total: sales.total,
        paidAmount: sales.paidAmount,
        status: sales.status,
      })
        .from(sales)
        .where(and(
          eq(sales.tenantId, session.user.tenantId),
          ne(sales.status, 'void'),
          eq(sales.isReturn, false),
          sql`CAST(${sales.total} AS numeric) > CAST(${sales.paidAmount} AS numeric)`,
          sql`${sales.createdAt} <= ${new Date(asOfDate + 'T23:59:59')}`,
        ))

      // Look up customer names from the customers table
      const customerIds = [...new Set(unpaidSales.filter(s => s.customerId).map(s => s.customerId!))]
      const customerMap: Record<string, string> = {}

      if (customerIds.length > 0) {
        const customerList = await db.select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(sql`${customers.id} IN (${sql.join(customerIds.map(id => sql`${id}`), sql`,`)})`)

        for (const c of customerList) {
          customerMap[c.id] = c.name
        }
      }

      // Group by customer and bucket by aging (NET: invoices minus unallocated payments)
      const customerAging: Record<string, {
        customerId: string | null
        customerName: string
        current: number
        days31to60: number
        days61to90: number
        over90: number
        total: number
        invoices: {
          id: string
          invoiceNo: string | null
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

      for (const sale of unpaidSales) {
        const saleDate = new Date(sale.saleDate)
        const daysDiff = Math.floor((today.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24))
        const saleTotal = Number(sale.total || 0)
        const salePaid = Number(sale.paidAmount || 0)
        const outstanding = Math.round((saleTotal - salePaid) * 100) / 100

        if (outstanding <= 0) continue

        const key = sale.customerId || 'walk-in'
        if (!customerAging[key]) {
          customerAging[key] = {
            customerId: sale.customerId,
            customerName: sale.customerId ? (customerMap[sale.customerId] || sale.customerName || 'Unknown Customer') : 'Walk-in Customer',
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
          customerAging[key].current += outstanding
          agingBucket = 'current'
        } else if (daysDiff <= 60) {
          customerAging[key].days31to60 += outstanding
          agingBucket = '31-60'
        } else if (daysDiff <= 90) {
          customerAging[key].days61to90 += outstanding
          agingBucket = '61-90'
        } else {
          customerAging[key].over90 += outstanding
          agingBucket = 'over90'
        }
        customerAging[key].total += outstanding

        customerAging[key].invoices.push({
          id: sale.saleId,
          invoiceNo: sale.invoiceNo,
          date: saleDate.toISOString().split('T')[0],
          total: Math.round(saleTotal * 100) / 100,
          paidAmount: Math.round(salePaid * 100) / 100,
          outstanding,
          status: sale.status,
          agingBucket,
        })
      }

      // Include JE-based receivables (debit to AR for customers)
      const jeReceivables = await db.select({
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
          eq(journalEntryItems.partyType, 'customer'),
          eq(journalEntries.status, 'submitted'),
          sql`CAST(${journalEntryItems.debit} AS numeric) > 0`,
          sql`${journalEntries.postingDate} <= ${new Date(asOfDate + 'T23:59:59')}`,
        ))

      for (const je of jeReceivables) {
        if (!je.partyId) continue
        const debitAmount = Number(je.debit)

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
        const outstanding = Math.round((debitAmount - allocatedAmount) * 100) / 100
        if (outstanding <= 0) continue

        const jeDate = new Date(je.postingDate)
        const daysDiff = Math.floor((today.getTime() - jeDate.getTime()) / (1000 * 60 * 60 * 24))

        const key = je.partyId
        if (!customerAging[key]) {
          customerAging[key] = {
            customerId: je.partyId,
            customerName: 'Unknown Customer',
            current: 0,
            days31to60: 0,
            days61to90: 0,
            over90: 0,
            total: 0,
            invoices: [],
            payments: [],
          }
          // Fetch customer name if not in map yet
          if (!customerMap[je.partyId]) {
            const [cust] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, je.partyId))
            if (cust) {
              customerMap[je.partyId] = cust.name
              customerAging[key].customerName = cust.name
            }
          } else {
            customerAging[key].customerName = customerMap[je.partyId]
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) {
          customerAging[key].current += outstanding
          agingBucket = 'current'
        } else if (daysDiff <= 60) {
          customerAging[key].days31to60 += outstanding
          agingBucket = '31-60'
        } else if (daysDiff <= 90) {
          customerAging[key].days61to90 += outstanding
          agingBucket = '61-90'
        } else {
          customerAging[key].over90 += outstanding
          agingBucket = 'over90'
        }
        customerAging[key].total += outstanding

        customerAging[key].invoices.push({
          id: je.jeItemId,
          invoiceNo: je.entryNumber + ' (JE)',
          date: jeDate.toISOString().split('T')[0],
          total: Math.round(debitAmount * 100) / 100,
          paidAmount: Math.round(allocatedAmount * 100) / 100,
          outstanding,
          status: 'submitted',
          agingBucket,
        })
      }

      // --- Merge Unallocated Payments into customer rows (as credits) ---

      // 1. Payment entries with unallocated amounts for customers
      const unallocatedPEs = await db.select({
        id: paymentEntries.id,
        entryNumber: paymentEntries.entryNumber,
        postingDate: paymentEntries.postingDate,
        partyId: paymentEntries.partyId,
        partyName: paymentEntries.partyName,
        receivedAmount: paymentEntries.receivedAmount,
        unallocatedAmount: paymentEntries.unallocatedAmount,
      })
        .from(paymentEntries)
        .where(and(
          eq(paymentEntries.tenantId, session.user.tenantId),
          eq(paymentEntries.partyType, 'customer'),
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
        if (!customerAging[key]) {
          customerAging[key] = {
            customerId: pe.partyId,
            customerName: pe.partyId ? (customerMap[pe.partyId] || pe.partyName || 'Unknown Customer') : 'Unknown Customer',
            current: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0,
            invoices: [],
            payments: [],
          }
          if (pe.partyId && !customerMap[pe.partyId]) {
            const [cust] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, pe.partyId))
            if (cust) {
              customerMap[pe.partyId] = cust.name
              customerAging[key].customerName = cust.name
            }
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) { customerAging[key].current -= unallocated; agingBucket = 'current' }
        else if (daysDiff <= 60) { customerAging[key].days31to60 -= unallocated; agingBucket = '31-60' }
        else if (daysDiff <= 90) { customerAging[key].days61to90 -= unallocated; agingBucket = '61-90' }
        else { customerAging[key].over90 -= unallocated; agingBucket = 'over90' }
        customerAging[key].total -= unallocated

        customerAging[key].payments.push({
          id: pe.id,
          entryNumber: pe.entryNumber,
          sourceType: 'payment_entry',
          date: pe.postingDate,
          totalAmount: Math.round(Number(pe.receivedAmount) * 100) / 100,
          allocatedAmount: Math.round((Number(pe.receivedAmount) - unallocated) * 100) / 100,
          unallocated: Math.round(unallocated * 100) / 100,
          agingBucket,
        })
      }

      // 2. JE-based payments from customers (credit AR)
      const jePayments = await db.select({
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
          eq(journalEntryItems.partyType, 'customer'),
          eq(journalEntries.status, 'submitted'),
          sql`CAST(${journalEntryItems.credit} AS numeric) > 0`,
          sql`${journalEntries.postingDate} <= ${asOfDate}`,
        ))

      for (const je of jePayments) {
        if (!je.partyId) continue
        const creditAmount = Number(je.credit)

        const [allocated] = await db.select({
          total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
        })
          .from(paymentEntryReferences)
          .where(eq(paymentEntryReferences.sourceJeItemId, je.jeItemId))

        const allocatedAmount = Number(allocated?.total || 0)
        const unallocated = Math.round((creditAmount - allocatedAmount) * 100) / 100
        if (unallocated <= 0) continue

        const jeDate = new Date(je.postingDate)
        const daysDiff = Math.floor((today.getTime() - jeDate.getTime()) / (1000 * 60 * 60 * 24))

        const key = je.partyId
        if (!customerAging[key]) {
          customerAging[key] = {
            customerId: je.partyId,
            customerName: customerMap[je.partyId] || 'Unknown Customer',
            current: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0,
            invoices: [],
            payments: [],
          }
          if (!customerMap[je.partyId]) {
            const [cust] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, je.partyId))
            if (cust) {
              customerMap[je.partyId] = cust.name
              customerAging[key].customerName = cust.name
            }
          }
        }

        let agingBucket: string
        if (daysDiff <= 30) { customerAging[key].current -= unallocated; agingBucket = 'current' }
        else if (daysDiff <= 60) { customerAging[key].days31to60 -= unallocated; agingBucket = '31-60' }
        else if (daysDiff <= 90) { customerAging[key].days61to90 -= unallocated; agingBucket = '61-90' }
        else { customerAging[key].over90 -= unallocated; agingBucket = 'over90' }
        customerAging[key].total -= unallocated

        customerAging[key].payments.push({
          id: je.jeItemId,
          entryNumber: je.entryNumber + ' (JE)',
          sourceType: 'journal_entry',
          date: je.postingDate,
          totalAmount: Math.round(creditAmount * 100) / 100,
          allocatedAmount: Math.round(allocatedAmount * 100) / 100,
          unallocated: Math.round(unallocated * 100) / 100,
          agingBucket,
        })
      }

      // Build final data and totals AFTER payments have been merged
      const data = Object.values(customerAging)
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
    logError('api/accounting/reports/accounts-receivable', error)
    return NextResponse.json({ error: 'Failed to generate accounts receivable report' }, { status: 500 })
  }
}
