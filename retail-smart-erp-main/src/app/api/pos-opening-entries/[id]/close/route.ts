import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db as rawDb, withTenantTransaction } from '@/lib/db'
import { requireQuota } from '@/lib/db/storage-quota'
import {
  posOpeningEntries,
  posClosingEntries,
  posClosingReconciliation,
} from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { notify } from '@/lib/notifications/notify'
import { getAlertSettings } from '@/lib/notifications/alert-settings'
import { logError } from '@/lib/ai/error-logger'
import { postPosShiftVarianceToGL } from '@/lib/accounting/auto-post'
import { tenantToday } from '@/lib/accounting/gl'
import { buildShiftReport, shiftCashMovementTotals, SHIFT_VARIANCE_REASON_LABELS } from '@/lib/pos/shift-report'
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
import { SAFE_USER } from '@/lib/db/safe-columns'
import { nextDocNo } from '@/lib/documents/numbering'
import { assertBranchAccess } from '@/lib/auth/branch-access'
import { shiftOutsideCollections } from '@/lib/pos/shift-collections'

/** Payment methods that never sit in the cash drawer / card terminal batch */
const NON_DRAWER_METHODS = new Set<string>(['credit', 'gift_card'])

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
    const { actualAmounts, notes, varianceReason, varianceNote, version: _version } = parsed.data

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

      // K4: a branch-restricted user closes shifts of their own branches only
      const branchDenied = await assertBranchAccess(session, openingEntry.warehouseId, db)
      if (branchDenied) return branchDenied

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

      // Process sales — each sale is counted exactly once:
      // payment rows are authoritative (they carry split tenders, credit used and
      // the real cash received); sale.paymentMethod/total is only a fallback for
      // legacy rows that have no payment records.
      const ensureMethod = (method: PaymentMethod) => {
        if (method && !salesByPaymentMethod[method]) {
          salesByPaymentMethod[method] = { totalSales: 0, totalReturns: 0, netSales: 0, transactionCount: 0 }
        }
      }

      for (const sale of openingEntry.sales) {
        if (sale.status === 'void') continue
        const saleAmount = parseFloat(sale.total)
        const salePaymentMethod = sale.paymentMethod as PaymentMethod
        // Methods used in sales but not declared at opening (e.g. card) still count toward the shift
        ensureMethod(salePaymentMethod)
        for (const payment of sale.payments || []) ensureMethod(payment.method as PaymentMethod)
        if (salePaymentMethod && salesByPaymentMethod[salePaymentMethod]) {
          salesByPaymentMethod[salePaymentMethod].transactionCount++
        }

        if (!sale.payments || sale.payments.length === 0) {
          if (salePaymentMethod && salesByPaymentMethod[salePaymentMethod]) {
            if (sale.isReturn) {
              salesByPaymentMethod[salePaymentMethod].totalReturns += Math.abs(saleAmount)
              salesByPaymentMethod[salePaymentMethod].netSales -= Math.abs(saleAmount)
            } else {
              // Only what was actually received: an unpaid (on-account / pending) sale put
              // nothing in the drawer
              const received = Math.max(0, parseFloat(sale.paidAmount || '0') || 0)
              salesByPaymentMethod[salePaymentMethod].totalSales += received
              salesByPaymentMethod[salePaymentMethod].netSales += received
            }
          }
          continue
        }

        for (const payment of sale.payments) {
          const paymentMethod = payment.method as PaymentMethod
          // Return payment rows are stored negative (money out); normalise and apply sign by isReturn
          const paymentAmount = Math.abs(parseFloat(payment.amount))
          
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

      // Voided sales are reported on the Z report but are not transactions of the drawer
      const liveSaleCount = openingEntry.sales.filter(sale => sale.status !== 'void').length

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
          totalTransactions: liveSaleCount,
        }
      )

      if (!validation.isValid) {
        return NextResponse.json({
          error: 'Payment breakdown validation failed',
          discrepancies: validation.discrepancies,
        }, { status: 400 })
      }

      // H1: cash paid into / out of the drawer during the shift (posted movements only)
      const movementTotals = await shiftCashMovementTotals(db, id)
      // 0187: money this shift took outside the POS sale screen (print-job advances / refunds,
      // print-job and work-order invoice payments, layaway payments), per tender
      const outsideCollections = await shiftOutsideCollections(db, id)

      // Calculate expected amounts and variances for every method that was opened OR used in a sale
      // (cash too when the drawer had paid-ins / paid-outs)
      const reconciliationMethods = Array.from(new Set<PaymentMethod>([
        ...openingPaymentMethods,
        ...(Object.keys(salesByPaymentMethod) as PaymentMethod[]),
        ...(movementTotals.count > 0 ? ['cash' as PaymentMethod] : []),
        ...(Object.keys(outsideCollections.byMethod) as PaymentMethod[]),
      ]))
      const reconciliationValues = reconciliationMethods.map(method => {
        const openingAmount = openingBalanceMap[method] || 0
        const expectedAmount = calculateExpectedAmount(openingAmount, salesByPaymentMethod[method]?.totalSales || 0, salesByPaymentMethod[method]?.totalReturns || 0)
          + (method === 'cash' ? movementTotals.net : 0)
          + (outsideCollections.byMethod[method] || 0)
        // Store credit and gift cards are not tenders in the drawer: nothing to count, so they
        // reconcile at the expected amount instead of posting a fake cash shortage.
        const actualAmount = NON_DRAWER_METHODS.has(method) ? expectedAmount : (actualAmountsMap[method] || 0)

        return {
          tenantId: session.user.tenantId,
          closingEntryId: '', // Will be set after closing entry is created
          paymentMethod: method,
          openingAmount: String(Math.round(openingAmount * 100) / 100),
          expectedAmount: String(Math.round(expectedAmount * 100) / 100),
          actualAmount: String(Math.round(actualAmount * 100) / 100),
        }
      })

      // Variance per counted tender and in total
      const varianceByMethodList = reconciliationValues.map(item => ({
        method: item.paymentMethod,
        variance: Math.round((parseFloat(item.actualAmount) - parseFloat(item.expectedAmount)) * 100) / 100,
      }))
      const totalVariance = reconciliationValues.reduce((sum, item) => {
        return sum + (parseFloat(item.actualAmount) - parseFloat(item.expectedAmount))
      }, 0)

      // H1: a drawer that does not balance needs a structured reason (and a note for "other")
      const hasVariance = varianceByMethodList.some(v => Math.abs(v.variance) >= 0.01)
      if (hasVariance && !varianceReason) {
        return NextResponse.json({
          error: 'The counted amounts differ from the expected amounts. Select a variance reason to close the shift.',
          code: 'VARIANCE_REASON_REQUIRED',
          varianceByMethod: Object.fromEntries(varianceByMethodList.map(v => [v.method, v.variance])),
          totalVariance: Math.round(totalVariance * 100) / 100,
        }, { status: 400 })
      }

      // H1: Z-report details (tax, discounts, voids, returns, cash movements, ledger tie-out)
      const cashRec = reconciliationValues.find(r => r.paymentMethod === 'cash')
      const reportData = await buildShiftReport(db, session.user.tenantId, {
        openingEntryId: id,
        sales: openingEntry.sales,
        openingCash: cashRec ? parseFloat(cashRec.openingAmount) : 0,
        expectedCash: cashRec ? parseFloat(cashRec.expectedAmount) : 0,
        outsideCollections,
      })

      // Closing entry number CLOSE-YYYYMMDD-### from the per-tenant daily sequence
      const entryNumber = await nextDocNo(db, session.user.tenantId, 'pos_closing')

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
        totalTransactions: liveSaleCount,
        status: 'submitted', // Use submitted instead of draft for completed closures
        submittedAt: new Date(),
        submittedBy: session.user.id,
        notes: notes || null,
        varianceReason: hasVariance ? varianceReason || null : null,
        varianceNote: hasVariance ? varianceNote || null : null,
        reportData: reportData as unknown as Record<string, unknown>,
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

      // Post over/short to GL per tender: each method's difference against its own account
      if (hasVariance) {
        await postPosShiftVarianceToGL(db, session.user.tenantId, {
          closingEntryId: closingEntry.id,
          postingDate: await tenantToday(session.user.tenantId),
          totalVariance: Math.round(totalVariance * 100) / 100,
          byMethod: varianceByMethodList,
          costCenterId: openingEntry.posProfile?.costCenterId || null,
          notes: `POS shift ${entryNumber}: ${SHIFT_VARIANCE_REASON_LABELS[varianceReason || 'other'] || varianceReason}`,
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
          user: SAFE_USER,
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
      logAndBroadcast(session.user.tenantId, 'pos-closing', 'created', closingEntry.id, {
        userId: session.user.id,
        activityAction: 'submit',
        entityName: closingEntry.entryNumber,
        description: `Closed shift ${openingEntry.entryNumber}${hasVariance ? ` with variance ${Math.round(totalVariance * 100) / 100} (${varianceReason})` : ''}`,
        metadata: {
          posOpeningEntryId: id,
          posProfileId: openingEntry.posProfileId,
          varianceByMethod: Object.fromEntries(varianceByMethodList.map(v => [v.method, v.variance])),
          varianceReason: hasVariance ? varianceReason : null,
          varianceNote: hasVariance ? varianceNote || null : null,
          cashMovements: movementTotals,
          outsideCollections: { total: outsideCollections.total, bySource: outsideCollections.bySource },
          ledgerTiesOut: reportData.ledger.tiesOut,
        },
      })
      const varianceThreshold = Math.max((await getAlertSettings(session.user.tenantId)).varianceThreshold, 0.01)
      if (Math.abs(totalVariance) >= varianceThreshold) {
        void notify(session.user.tenantId, 'shift_variance', {
          title: `Shift closed with ${totalVariance > 0 ? 'excess' : 'shortage'} ${Math.abs(totalVariance).toFixed(2)}`,
          body: `${session.user.name || 'Cashier'} closed ${openingEntry.posProfile?.name || 'counter'} (${closingEntry.entryNumber})`,
          data: { screen: 'shifts', id: closingEntry.id },
          permission: 'manageSales',
          excludeUserId: session.user.id,
        })
      }

      return NextResponse.json({
        success: true,
        closingEntry: completeClosing,
        reconciliation: reconciliationWithVariance,
        summary: {
          totalSales,
          totalReturns,
          netSales,
          totalTransactions: liveSaleCount,
          totalVariance: Math.round(totalVariance * 100) / 100,
          cashPaidIn: movementTotals.paidIn,
          cashPaidOut: movementTotals.paidOut,
          outsideCollections: outsideCollections.total,
        },
        varianceReason: hasVariance ? varianceReason : null,
        varianceNote: hasVariance ? varianceNote || null : null,
        zReport: reportData,
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
