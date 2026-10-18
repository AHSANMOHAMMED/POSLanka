import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db as rawDb, withTenant } from '@/lib/db'
import { sales, payments, customers, customerCreditTransactions, paymentEntryReferences, paymentEntries, journalEntryItems, journalEntries } from '@/lib/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { postPaymentToGL, postCreditPaymentToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addSalePaymentSchema } from '@/lib/validation/schemas/sales'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET payments for a sale
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: saleId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get sale (RLS scopes to tenant)
      const sale = await db.query.sales.findFirst({
        where: eq(sales.id, saleId),
      })

      if (!sale) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      // Get payments (RLS scopes to tenant)
      const salePayments = await db.query.payments.findMany({
        where: eq(payments.saleId, saleId),
        with: {
          receivedByUser: true,
        },
      })

      const activePayments = salePayments.filter(p => !p.voidedAt)
      const directPaid = roundCurrency(activePayments.reduce((sum, p) => sum + parseFloat(p.amount), 0))

      // Fetch PE-based payment entry references for this sale
      const peRefs = await db
        .select({
          id: paymentEntryReferences.id,
          paymentEntryId: paymentEntryReferences.paymentEntryId,
          allocatedAmount: paymentEntryReferences.allocatedAmount,
          createdAt: paymentEntryReferences.createdAt,
          entryNumber: paymentEntries.entryNumber,
          paymentType: paymentEntries.paymentType,
          postingDate: paymentEntries.postingDate,
          status: paymentEntries.status,
          paidAmount: paymentEntries.paidAmount,
        })
        .from(paymentEntryReferences)
        .innerJoin(paymentEntries, eq(paymentEntryReferences.paymentEntryId, paymentEntries.id))
        .where(
          and(
            eq(paymentEntryReferences.referenceType, 'sale'),
            eq(paymentEntryReferences.referenceId, saleId),
            eq(paymentEntries.status, 'submitted')
          )
        )

      // Fetch JE-based payment references (from journal entry reconciliation)
      const jeRefs = await db
        .select({
          id: paymentEntryReferences.id,
          sourceJeItemId: paymentEntryReferences.sourceJeItemId,
          allocatedAmount: paymentEntryReferences.allocatedAmount,
          createdAt: paymentEntryReferences.createdAt,
          entryNumber: journalEntries.entryNumber,
          postingDate: journalEntries.postingDate,
        })
        .from(paymentEntryReferences)
        .innerJoin(journalEntryItems, eq(paymentEntryReferences.sourceJeItemId, journalEntryItems.id))
        .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
        .where(
          and(
            eq(paymentEntryReferences.referenceType, 'sale'),
            eq(paymentEntryReferences.referenceId, saleId),
            isNotNull(paymentEntryReferences.sourceJeItemId)
          )
        )

      // Compute totalPaid from all three sources
      const peAllocated = roundCurrency(peRefs.reduce((sum, pe) => sum + parseFloat(pe.allocatedAmount), 0))
      const jeAllocated = roundCurrency(jeRefs.reduce((sum, je) => sum + parseFloat(je.allocatedAmount), 0))
      const totalPaid = roundCurrency(directPaid + peAllocated + jeAllocated)
      const balanceDue = roundCurrency(Math.max(0, parseFloat(sale.total) - totalPaid))

      return NextResponse.json({
        sale: {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          total: sale.total,
          paidAmount: sale.paidAmount,
          status: sale.status,
        },
        payments: salePayments.map(p => {
          const receivedByUser = Array.isArray(p.receivedByUser) ? p.receivedByUser[0] : p.receivedByUser
          return {
            id: p.id,
            amount: p.amount,
            method: p.method,
            reference: p.reference,
            receivedBy: receivedByUser?.fullName || null,
            createdAt: p.createdAt,
          }
        }),
        paymentEntries: peRefs.map(pe => ({
          id: pe.id,
          paymentEntryId: pe.paymentEntryId,
          entryNumber: pe.entryNumber,
          paymentType: pe.paymentType,
          postingDate: pe.postingDate,
          status: pe.status,
          allocatedAmount: pe.allocatedAmount,
          paidAmount: pe.paidAmount,
          createdAt: pe.createdAt,
        })),
        journalEntryAllocations: jeRefs.map(je => ({
          id: je.id,
          sourceJeItemId: je.sourceJeItemId,
          entryNumber: je.entryNumber,
          postingDate: je.postingDate,
          allocatedAmount: je.allocatedAmount,
          createdAt: je.createdAt,
        })),
        totalPaid: String(totalPaid),
        balanceDue: String(balanceDue),
      })
    })
  } catch (error) {
    logError('api/sales/[id]/payments', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

// POST add payment to sale
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    // Pre-validate accounting config before starting transaction
    const acctError = await requireAccountingConfig(rawDb, session.user.tenantId, 'payment')
    if (acctError) return acctError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: saleId } = paramsParsed.data
    const parsed = await validateBody(request, addSalePaymentSchema)
    if (!parsed.success) return parsed.response
    const { amount, method, reference, creditAmount, addOverpaymentToCredit } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const cashCardAmount = amount
      const creditUsed = creditAmount
      const totalPayment = cashCardAmount + creditUsed

      if (totalPayment <= 0) {
        return NextResponse.json({ error: 'Payment amount is required' }, { status: 400 })
      }

      // Create payment in transaction with row-level locking
      // All balance checks are INSIDE the transaction to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock sale row to prevent concurrent payment processing
        const [sale] = await tx
          .select()
          .from(sales)
          .where(eq(sales.id, saleId))
          .for('update')

        if (!sale) {
          throw new Error('NOT_FOUND')
        }

        // Calculate current balance from non-voided payments (inside transaction with lock)
        const existingPayments = await tx.query.payments.findMany({
          where: eq(payments.saleId, saleId),
        })
        const activePayments = existingPayments.filter(p => !p.voidedAt)
        const currentPaid = roundCurrency(activePayments.reduce((sum, p) => sum + parseFloat(p.amount), 0))
        const balanceDue = roundCurrency(parseFloat(sale.total) - currentPaid)

        if (balanceDue <= 0) {
          throw new Error('ALREADY_PAID')
        }

        // Reject payment that exceeds remaining balance unless overpayment-to-credit is explicitly requested
        if (totalPayment > balanceDue && !addOverpaymentToCredit) {
          throw new Error(`OVERPAYMENT:${balanceDue}`)
        }

        const newTotalPaid = roundCurrency(currentPaid + totalPayment)
        const overpayment = roundCurrency(Math.max(0, newTotalPaid - parseFloat(sale.total)))
        const isFullyPaid = newTotalPaid >= parseFloat(sale.total)

        // Lock and verify customer credit balance inside transaction to prevent race conditions
        if (creditUsed > 0 && sale.customerId) {
          const [lockedCustomer] = await tx
            .select()
            .from(customers)
            .where(eq(customers.id, sale.customerId))
            .for('update') // Row-level lock prevents concurrent credit deductions

          if (!lockedCustomer || parseFloat(lockedCustomer.balance) < creditUsed) {
            throw new Error('Insufficient customer credit balance')
          }
        }

        // Create cash/card payment record
        if (cashCardAmount > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId,
            amount: String(cashCardAmount),
            method: method || 'cash',
            reference: reference || null,
            receivedBy: session.user.id,
          })
        }

        // Create credit payment record
        if (creditUsed > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId,
            amount: String(creditUsed),
            method: 'credit',
            reference: null,
            receivedBy: session.user.id,
          })
        }

        // Handle customer credit transactions (customer already locked above if credit used)
        if (sale.customerId && (creditUsed > 0 || (overpayment > 0 && addOverpaymentToCredit))) {
          const [customer] = await tx
            .select()
            .from(customers)
            .where(eq(customers.id, sale.customerId))
            .for('update') // Lock row to prevent concurrent balance modifications

          if (customer) {
            let newBalance = parseFloat(customer.balance)

            // Deduct credit if used (re-verify balance with locked row)
            if (creditUsed > 0) {
              if (newBalance < creditUsed) {
                throw new Error('Insufficient customer credit balance')
              }
              newBalance -= creditUsed
              await tx.insert(customerCreditTransactions).values({
                tenantId: session.user.tenantId,
                customerId: sale.customerId,
                type: 'use',
                amount: String(creditUsed),
                balanceAfter: String(newBalance),
                referenceType: 'sale',
                referenceId: saleId,
                notes: `Payment for ${sale.invoiceNo}`,
                createdBy: session.user.id,
              })
            }

            // Add overpayment as credit (only if customer requested)
            if (overpayment > 0 && addOverpaymentToCredit) {
              newBalance += overpayment
              await tx.insert(customerCreditTransactions).values({
                tenantId: session.user.tenantId,
                customerId: sale.customerId,
                type: 'overpayment',
                amount: String(overpayment),
                balanceAfter: String(newBalance),
                referenceType: 'sale',
                referenceId: saleId,
                notes: `Overpayment for ${sale.invoiceNo}`,
                createdBy: session.user.id,
              })
            }

            // Update customer balance
            await tx.update(customers)
              .set({
                balance: String(newBalance),
                updatedAt: new Date(),
              })
              .where(eq(customers.id, sale.customerId))
          }
        }

        // Update sale paid amount and status
        // Issue #13: Use 'partial' status for partially-paid sales
        const newStatus = isFullyPaid ? 'completed' : newTotalPaid > 0 ? 'partial' : 'pending'

        await tx.update(sales)
          .set({
            paidAmount: String(Math.min(newTotalPaid, parseFloat(sale.total))),
            status: newStatus,
          })
          .where(eq(sales.id, saleId))

        // Post payment to GL (account resolved from Modes of Payment in auto-post)
        if (cashCardAmount > 0) {
          await postPaymentToGL(tx, session.user.tenantId, {
            paymentId: saleId, // Use sale ID as voucher reference
            paymentDate: new Date().toISOString().split('T')[0],
            amount: cashCardAmount,
            paymentMethod: method || 'cash',
            partyType: 'customer',
            partyId: sale.customerId || null, // null for walk-in sales
            referenceNumber: sale.invoiceNo,
            costCenterId: sale.costCenterId,
          })
        }

        // Post credit portion to GL: Dr Customer Advance, Cr Accounts Receivable
        if (creditUsed > 0 && sale.customerId) {
          await postCreditPaymentToGL(tx, session.user.tenantId, {
            saleId,
            paymentDate: new Date().toISOString().split('T')[0],
            amount: creditUsed,
            customerId: sale.customerId,
            referenceNumber: sale.invoiceNo,
            costCenterId: sale.costCenterId,
          })
        }

        return {
          totalPaid: newTotalPaid,
          balanceDue: roundCurrency(Math.max(0, parseFloat(sale.total) - newTotalPaid)),
          status: newStatus,
          customerId: sale.customerId,
        }
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'sale', 'updated', saleId)
      if (result.customerId) {
        logAndBroadcast(session.user.tenantId, 'customer', 'updated', result.customerId)
      }

      return NextResponse.json(result)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }
    if (message === 'ALREADY_PAID') {
      return NextResponse.json({ error: 'Sale is already fully paid' }, { status: 400 })
    }
    if (message.startsWith('OVERPAYMENT:')) {
      const remaining = message.replace('OVERPAYMENT:', '')
      return NextResponse.json({
        error: `Payment amount exceeds remaining balance. Remaining balance is ${remaining}. Reduce the payment amount or enable overpayment to credit.`,
        code: 'OVERPAYMENT',
        remainingBalance: remaining,
      }, { status: 400 })
    }
    if (message === 'Insufficient customer credit balance') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logError('api/sales/[id]/payments', error)
    return NextResponse.json({ error: 'Failed to add payment' }, { status: 500 })
  }
}
