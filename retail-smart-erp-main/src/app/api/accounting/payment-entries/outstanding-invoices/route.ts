import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { sales, purchases, journalEntries, journalEntryItems, paymentEntryReferences } from '@/lib/db/schema'
import { eq, and, sql, ne } from 'drizzle-orm'
import { validateSearchParams } from '@/lib/validation/helpers'
import { outstandingInvoicesQuerySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, outstandingInvoicesQuerySchema)
    if (!parsed.success) return parsed.response
    const { partyType, partyId } = parsed.data

    const invoices: Array<{
      referenceType: string
      referenceId: string
      referenceNumber: string
      postingDate: string
      totalAmount: number
      paidAmount: number
      outstandingAmount: number
    }> = []

    if (partyType === 'customer') {
      // Outstanding sales invoices
      const outstandingSales = await db.select({
        id: sales.id,
        invoiceNo: sales.invoiceNo,
        createdAt: sales.createdAt,
        total: sales.total,
        paidAmount: sales.paidAmount,
      })
        .from(sales)
        .where(and(
          eq(sales.customerId, partyId),
          ne(sales.status, 'void'),
          sql`CAST(${sales.total} AS numeric) > CAST(${sales.paidAmount} AS numeric)`,
          eq(sales.isReturn, false),
        ))

      for (const sale of outstandingSales) {
        invoices.push({
          referenceType: 'sale',
          referenceId: sale.id,
          referenceNumber: sale.invoiceNo,
          postingDate: new Date(sale.createdAt).toISOString().split('T')[0],
          totalAmount: Number(sale.total),
          paidAmount: Number(sale.paidAmount),
          outstandingAmount: Math.round((Number(sale.total) - Number(sale.paidAmount)) * 100) / 100,
        })
      }

      // Sales returns (credit notes) - unrefunded returns as negative
      const salesReturns = await db.select({
        id: sales.id,
        invoiceNo: sales.invoiceNo,
        createdAt: sales.createdAt,
        total: sales.total,
        paidAmount: sales.paidAmount,
      })
        .from(sales)
        .where(and(
          eq(sales.customerId, partyId),
          ne(sales.status, 'void'),
          eq(sales.isReturn, true),
          sql`CAST(${sales.paidAmount} AS numeric) < CAST(${sales.total} AS numeric)`,
        ))

      for (const ret of salesReturns) {
        const unrefunded = Math.round((Number(ret.total) - Number(ret.paidAmount)) * 100) / 100
        if (unrefunded > 0) {
          invoices.push({
            referenceType: 'sale',
            referenceId: ret.id,
            referenceNumber: `${ret.invoiceNo} (Return)`,
            postingDate: new Date(ret.createdAt).toISOString().split('T')[0],
            totalAmount: -Number(ret.total),
            paidAmount: -Number(ret.paidAmount),
            outstandingAmount: -unrefunded,
          })
        }
      }
    } else if (partyType === 'supplier') {
      // Outstanding purchase invoices
      const outstandingPurchases = await db.select({
        id: purchases.id,
        purchaseNo: purchases.purchaseNo,
        createdAt: purchases.createdAt,
        total: purchases.total,
        paidAmount: purchases.paidAmount,
      })
        .from(purchases)
        .where(and(
          eq(purchases.supplierId, partyId),
          ne(purchases.status, 'cancelled'),
          ne(purchases.status, 'draft'),
          sql`CAST(${purchases.total} AS numeric) > CAST(${purchases.paidAmount} AS numeric)`,
          eq(purchases.isReturn, false),
        ))

      for (const purchase of outstandingPurchases) {
        invoices.push({
          referenceType: 'purchase',
          referenceId: purchase.id,
          referenceNumber: purchase.purchaseNo,
          postingDate: new Date(purchase.createdAt).toISOString().split('T')[0],
          totalAmount: Number(purchase.total),
          paidAmount: Number(purchase.paidAmount),
          outstandingAmount: Math.round((Number(purchase.total) - Number(purchase.paidAmount)) * 100) / 100,
        })
      }

      // Purchase returns (debit notes) - unrefunded returns as negative
      const purchaseReturns = await db.select({
        id: purchases.id,
        purchaseNo: purchases.purchaseNo,
        createdAt: purchases.createdAt,
        total: purchases.total,
        paidAmount: purchases.paidAmount,
      })
        .from(purchases)
        .where(and(
          eq(purchases.supplierId, partyId),
          ne(purchases.status, 'cancelled'),
          eq(purchases.isReturn, true),
          sql`CAST(${purchases.paidAmount} AS numeric) < CAST(${purchases.total} AS numeric)`,
        ))

      for (const ret of purchaseReturns) {
        const unrefunded = Math.round((Number(ret.total) - Number(ret.paidAmount)) * 100) / 100
        if (unrefunded > 0) {
          invoices.push({
            referenceType: 'purchase',
            referenceId: ret.id,
            referenceNumber: `${ret.purchaseNo} (Return)`,
            postingDate: new Date(ret.createdAt).toISOString().split('T')[0],
            totalAmount: -Number(ret.total),
            paidAmount: -Number(ret.paidAmount),
            outstandingAmount: -unrefunded,
          })
        }
      }
    }

    // Journal entries with party (receivables/payables)
    const jeItems = await db.select({
      id: journalEntryItems.id,
      debit: journalEntryItems.debit,
      credit: journalEntryItems.credit,
      entryNumber: journalEntries.entryNumber,
      postingDate: journalEntries.postingDate,
    })
      .from(journalEntryItems)
      .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
      .where(and(
        eq(journalEntryItems.partyType, partyType as 'customer' | 'supplier'),
        eq(journalEntryItems.partyId, partyId),
        eq(journalEntries.status, 'submitted'),
        partyType === 'customer'
          ? sql`CAST(${journalEntryItems.debit} AS numeric) > 0`
          : sql`CAST(${journalEntryItems.credit} AS numeric) > 0`,
      ))

    for (const jeItem of jeItems) {
      const amount = partyType === 'customer' ? Number(jeItem.debit) : Number(jeItem.credit)
      if (amount <= 0) continue

      const [allocated] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
      })
        .from(paymentEntryReferences)
        .where(and(
          eq(paymentEntryReferences.referenceType, 'journal_entry'),
          eq(paymentEntryReferences.referenceId, jeItem.id),
        ))

      const allocatedAmount = Number(allocated?.total || 0)
      const outstanding = Math.round((amount - allocatedAmount) * 100) / 100

      if (outstanding > 0) {
        invoices.push({
          referenceType: 'journal_entry',
          referenceId: jeItem.id,
          referenceNumber: jeItem.entryNumber,
          postingDate: jeItem.postingDate,
          totalAmount: amount,
          paidAmount: allocatedAmount,
          outstandingAmount: outstanding,
        })
      }
    }

    return NextResponse.json(invoices)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
