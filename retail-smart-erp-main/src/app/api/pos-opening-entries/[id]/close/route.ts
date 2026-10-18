import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db as rawDb, withTenantTransaction } from '@/lib/db'
import { requireQuota } from '@/lib/db/storage-quota'
import {
  posOpeningEntries,
  posClosingEntries,
  posClosingReconciliation,
} from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { postPosShiftVarianceToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import type { PaymentMethod } from '@/lib/db/schema'
import {
  calculateExpectedAmount,
  validatePaymentBreakdown,
  getPaymentMethodLabel,
  type PaymentMethodTotal,
} from '@/lib/utils/pos-calculations'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { closePosShiftSchema } from '@/lib/validation/schemas/pos'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST close a shift with enhanced payment method validation and optimistic locking
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
    const acctError = await requireAccountingConfig(rawDb, session.user.tenantId, 'pos_shift_close')
    if (acctError) return acctError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, closePosShiftSchema)
    if (!parsed.success) return parsed.response
    const { actualAmounts, notes, version: _version } = parsed.data

    return await withTenantTransaction(session.user.tenantId, async (db) => {
      // Get the opening entry with optimistic locking check
      const openingEntry = await db.query.posOpeningEntries.findFirst({
        where: and(
          eq(posOpeningEntries.id, id),
          eq(posOpeningEntries.status, 'open') // Ensure it's still open
        ),
        with: {
          posProfile: true,
          warehouse: true,
          balances: true,
          sales: {
            with: {
              payments: true,
            },
          },
        },
      })

      if (!openingEntry) {
        return NextResponse.json({ 
          error: 'Opening entry not found or already closed' 
        }, { status: 404 })
      }

      // Only the owner of the shift or manager/owner can close
      if (openingEntry.userId !== session.user.id && !['owner', 'manager'].includes(session.user.role)) {
        return NextResponse.json({ error: 'You can only close your own shifts' }, { status: 403 })
      }

      // Validate all payment methods from opening balances are accounted for
      const openingBalanceMap: Record<PaymentMethod, number> = {} as Record<PaymentMethod, number>
      const openingPaymentMethods: PaymentMethod[] = []
      
      for (const balance of openingEntry.balances) {
        const method = balance.paymentMethod as PaymentMethod
        if (method) {
          openingBalanceMap[method] = parseFloat(balance.openingAmount.toString())
          openingPaymentMethods.push(method)
        }
      }

      // Validate that all opening payment methods are present in closing
      const actualAmountsMap: Record<PaymentMethod, number> = {} as Record<PaymentMethod, number>
      const closingPaymentMethods: PaymentMethod[] = []
      
      for (const item of actualAmounts) {
        const method = item.paymentMethod as PaymentMethod
        if (method) {
          actualAmountsMap[method] = item.amount
          closingPaymentMethods.push(method)
        }
      }

      // Check for missing payment methods
      const missingMethods = openingPaymentMethods.filter(method => !closingPaymentMethods.includes(method))
      if (missingMethods.length > 0) {
        return NextResponse.json({
          error: `Missing actual amounts for payment methods: ${missingMethods.join(', ')}`,
          missingMethods: missingMethods.map(method => ({
            paymentMethod: method,
            label: getPaymentMethodLabel(method as PaymentMethod),
          })),
        }, { status: 400 })
      }

      // Calculate sales by payment method from both sales.paymentMethod and payments table
      const salesByPaymentMethod: Record<PaymentMethod, {
        totalSales: number
        totalReturns: number
        netSales: number
        transactionCount: number
      }> = {} as Record<PaymentMethod, {
        totalSales: number
        totalReturns: number
        netSales: number
        transactionCount: number
      }>

      // Initialize all payment methods from opening
      openingPaymentMethods.forEach(method => {
        salesByPaymentMethod[method] = {
          totalSales: 0,
          totalReturns: 0,
          netSales: 0,
          transactionCount: 0,
        }
      })

      // Process sales
      for (const sale of openingEntry.sales) {
        const saleAmount = parseFloat(sale.total)
        
        // First, use the sale's paymentMethod if available
        const salePaymentMethod = sale.paymentMethod as PaymentMethod
        if (salePaymentMethod && salesByPaymentMethod[salePaymentMethod]) {
          if (sale.isReturn) {
            salesByPaymentMethod[salePaymentMethod].totalReturns += Math.abs(saleAmount)
            salesByPaymentMethod[salePaymentMethod].netSales -= Math.abs(saleAmount)
          } else {
            salesByPaymentMethod[salePaymentMethod].totalSales += saleAmount
            salesByPaymentMethod[salePaymentMethod].netSales += saleAmount
          }
          salesByPaymentMethod[salePaymentMethod].transactionCount++
        }
        
        // Also process payments if they exist (for split payments or legacy data)
        for (const payment of sale.payments) {
          const paymentMethod = payment.method as PaymentMethod
          const paymentAmount = parseFloat(payment.amount)
          
          if (paymentMethod && salesByPaymentMethod[paymentMethod]) {
            // If we already counted this sale via sale.paymentMethod, adjust for split payments
            // For returns, payments are negative
            const amount = sale.isReturn ? -paymentAmount : paymentAmount
            salesByPaymentMethod[paymentMethod].netSales += amount
            if (sale.isReturn) {
              salesByPaymentMethod[paymentMethod].totalReturns += Math.abs(paymentAmount)
            } else {
              salesByPaymentMethod[paymentMethod].totalSales += paymentAmount
            }
          }
        }
      }

      // Calculate totals
      let totalSales = 0
      let totalReturns = 0
      
      Object.values(salesByPaymentMethod).forEach(breakdown => {
        totalSales += breakdown.totalSales
        totalReturns += breakdown.totalReturns
      })

      const netSales = totalSales - totalReturns

      // Validate payment breakdown matches overall totals
      const validation = validatePaymentBreakdown(
        {
          openingBalances: openingBalanceMap,
          salesByMethod: Object.fromEntries(
            Object.entries(salesByPaymentMethod).map(([method, data]) => [
              method as PaymentMethod,
              {
                paymentMethod: method as PaymentMethod,
                totalSales: data.totalSales,
                totalReturns: data.totalReturns,
                netSales: data.netSales,
                transactionCount: data.transactionCount,
              }
            ])
          ) as Record<PaymentMethod, PaymentMethodTotal>,
          expectedAmounts: {} as Record<PaymentMethod, number>,
          varianceByMethod: {} as Record<PaymentMethod, number>,
          totalVariance: 0,
        },
        {
          totalSales,
          totalReturns,
          netSales,
          totalTransactions: openingEntry.sales.length,
        }
      )

      if (!validation.isValid) {
        return NextResponse.json({
          error: 'Payment breakdown validation failed',
          discrepancies: validation.discrepancies,
        }, { status: 400 })
      }

      // Calculate expected amounts and variances
      const reconciliationValues = openingPaymentMethods.map(method => {
        const openingAmount = openingBalanceMap[method] || 0
        const expectedAmount = calculateExpectedAmount(openingAmount, salesByPaymentMethod[method]?.totalSales || 0, salesByPaymentMethod[method]?.totalReturns || 0)
        const actualAmount = actualAmountsMap[method] || 0

        return {
          tenantId: session.user.tenantId,
          closingEntryId: '', // Will be set after closing entry is created
          paymentMethod: method,
          openingAmount: String(Math.round(openingAmount * 100) / 100),
          expectedAmount: String(Math.round(expectedAmount * 100) / 100),
          actualAmount: String(Math.round(actualAmount * 100) / 100),
        }
      })

      // Calculate total variance
      const totalVariance = reconciliationValues.reduce((sum, item) => {
        return sum + (parseFloat(item.actualAmount) - parseFloat(item.expectedAmount))
      }, 0)

      // Generate closing entry number
      const today = new Date()
      const datePrefix = `CLOSE-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
      const [{ count: closeCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(posClosingEntries)
      const entryNumber = `${datePrefix}-${String(closeCount + 1).padStart(3, '0')}`

      // Create closing entry
      const [closingEntry] = await db.insert(posClosingEntries).values({
        tenantId: session.user.tenantId,
        entryNumber,
        openingEntryId: id,
        posProfileId: openingEntry.posProfileId,
        userId: session.user.id,
        openingTime: openingEntry.openingTime,
        closingTime: new Date(),
        totalSales: String(totalSales),
        totalReturns: String(totalReturns),
        netSales: String(netSales),
        totalTransactions: openingEntry.sales.length,
        status: 'submitted', // Use submitted instead of draft for completed closures
        submittedAt: new Date(),
        submittedBy: session.user.id,
        notes: notes || null,
      }).returning()

      // Update reconciliation values with closing entry ID
      const finalReconciliationValues = reconciliationValues.map(item => ({
        ...item,
        closingEntryId: closingEntry.id,
      }))

      // Insert reconciliation records
      if (finalReconciliationValues.length > 0) {
        await db.insert(posClosingReconciliation).values(finalReconciliationValues)
      }

      // Post cash over/short to GL if there's a variance
      if (totalVariance !== 0) {
        await postPosShiftVarianceToGL(db, session.user.tenantId, {
          closingEntryId: closingEntry.id,
          postingDate: new Date().toISOString().split('T')[0],
          totalVariance: Math.round(totalVariance * 100) / 100,
          notes: `POS shift ${entryNumber}: cash ${totalVariance > 0 ? 'overage' : 'shortage'} of ${Math.abs(Math.round(totalVariance * 100) / 100)}`,
        })
      }

      // Update opening entry status with optimistic locking
      const updateResult = await db.update(posOpeningEntries)
        .set({ 
          status: 'closed',
        })
        .where(and(
          eq(posOpeningEntries.id, id),
          eq(posOpeningEntries.status, 'open') // Optimistic lock: ensure it's still open
        ))
        .returning({ updatedId: posOpeningEntries.id })

      if (updateResult.length === 0) {
        throw new Error('Shift was modified concurrently. Please refresh and try again.')
      }

      // Fetch complete closing entry with reconciliation
      const completeClosing = await db.query.posClosingEntries.findFirst({
        where: eq(posClosingEntries.id, closingEntry.id),
        with: {
          openingEntry: {
            with: {
              balances: true,
              sales: {
                with: {
                  payments: true,
                },
              },
            },
          },
          posProfile: true,
          user: true,
          reconciliation: true,
        },
      })

      // Calculate variances for response
      const reconciliationWithVariance = completeClosing?.reconciliation.map(rec => ({
        ...rec,
        difference: parseFloat(rec.actualAmount) - parseFloat(rec.expectedAmount),
        variance: parseFloat(rec.actualAmount) - parseFloat(rec.expectedAmount),
      }))

      logAndBroadcast(session.user.tenantId, 'pos-shift', 'updated', id)
      logAndBroadcast(session.user.tenantId, 'pos-closing', 'created', closingEntry.id)

      return NextResponse.json({
        success: true,
        closingEntry: completeClosing,
        reconciliation: reconciliationWithVariance,
        summary: {
          totalSales,
          totalReturns,
          netSales,
          totalTransactions: openingEntry.sales.length,
          totalVariance: Math.round(totalVariance * 100) / 100,
        },
        paymentMethodBreakdown: {
          openingBalances: openingBalanceMap,
          salesByMethod: salesByPaymentMethod,
          expectedAmounts: finalReconciliationValues.reduce((acc, item) => {
            acc[item.paymentMethod] = parseFloat(item.expectedAmount)
            return acc
          }, {} as Record<string, number>),
          varianceByMethod: finalReconciliationValues.reduce((acc, item) => {
            acc[item.paymentMethod] = parseFloat(item.actualAmount) - parseFloat(item.expectedAmount)
            return acc
          }, {} as Record<string, number>),
          totalVariance: Math.round(totalVariance * 100) / 100,
        },
      })
    })
  } catch (error) {
    logError('api/pos-opening-entries/[id]/close', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ 
      error: `Failed to close shift: ${message}`,
      code: error instanceof Error && error.message.includes('concurrently') ? 'CONCURRENT_MODIFICATION' : 'UNKNOWN_ERROR'
    }, { status: 500 })
  }
}
