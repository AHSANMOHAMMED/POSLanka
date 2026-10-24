import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posClosingEntries, posOpeningEntries } from '@/lib/db/schema'
import { and, gte, lte, ne, inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { posDailySummarySchema } from '@/lib/validation/schemas/pos'
import { SAFE_USER } from '@/lib/db/safe-columns'
import type { ShiftReportData } from '@/lib/pos/shift-report'
import { getBranchScope } from '@/lib/auth/branch-access'

// GET daily summary - aggregate all shifts for a given date
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePOS')
    if (permError) return permError

    const parsed = validateSearchParams(request, posDailySummarySchema)
    if (!parsed.success) return parsed.response
    const dateStr = parsed.data.date

    // Parse date range for the given day
    const dayStart = new Date(dateStr + 'T00:00:00')
    const dayEnd = new Date(dateStr + 'T23:59:59.999')

    return await withTenant(session.user.tenantId, async (db) => {
      // K4: branch-restricted users get the summary of their own branches' shifts
      const scope = await getBranchScope(session, db)
      const branchCond = scope
        ? inArray(posClosingEntries.openingEntryId, db.select({ id: posOpeningEntries.id }).from(posOpeningEntries).where(inArray(posOpeningEntries.warehouseId, scope)))
        : undefined

      // Get all closing entries for the date
      const closingEntries = await db.query.posClosingEntries.findMany({
        where: and(
          branchCond,
          gte(posClosingEntries.closingTime, dayStart),
          lte(posClosingEntries.closingTime, dayEnd),
          // a cancelled closing was re-done (the shift reopened and closed again): count it once
          ne(posClosingEntries.status, 'cancelled'),
        ),
        with: {
          openingEntry: {
            with: {
              balances: true,
            },
          },
          posProfile: true,
          user: SAFE_USER,
          reconciliation: true,
        },
        orderBy: posClosingEntries.openingTime,
      })

      // Aggregate totals across all shifts
      let totalSales = 0
      let totalReturns = 0
      let netSales = 0
      let totalTransactions = 0

      // H1: Z-report totals across the day's shifts (closings before H1 carry no report data)
      const day = {
        tax: 0, discounts: 0, voidsCount: 0, voidsTotal: 0, returnsCount: 0, returnsTotal: 0,
        cashPaidIn: 0, cashPaidOut: 0, approvals: 0, ledgerTiesOut: true, shiftsWithReport: 0,
      }
      const r2 = (n: number) => Math.round(n * 100) / 100

      // Payment method breakdown
      const paymentMethodTotals: Record<string, {
        openingAmount: number
        expectedAmount: number
        actualAmount: number
        variance: number
      }> = {}

      const shifts = closingEntries.map(entry => {
        const shiftSales = parseFloat(entry.totalSales)
        const shiftReturns = parseFloat(entry.totalReturns)
        const shiftNet = parseFloat(entry.netSales)

        totalSales += shiftSales
        totalReturns += shiftReturns
        netSales += shiftNet
        totalTransactions += entry.totalTransactions

        // Aggregate reconciliation per payment method
        const shiftReconciliation = entry.reconciliation.map(rec => {
          const opening = parseFloat(rec.openingAmount)
          const expected = parseFloat(rec.expectedAmount)
          const actual = parseFloat(rec.actualAmount)
          // Fix #12: Round variance to avoid floating-point drift
          const variance = Math.round((actual - expected) * 100) / 100

          if (!paymentMethodTotals[rec.paymentMethod]) {
            paymentMethodTotals[rec.paymentMethod] = {
              openingAmount: 0,
              expectedAmount: 0,
              actualAmount: 0,
              variance: 0,
            }
          }
          paymentMethodTotals[rec.paymentMethod].openingAmount += opening
          paymentMethodTotals[rec.paymentMethod].expectedAmount += expected
          paymentMethodTotals[rec.paymentMethod].actualAmount += actual
          paymentMethodTotals[rec.paymentMethod].variance += variance

          return {
            paymentMethod: rec.paymentMethod,
            openingAmount: opening,
            expectedAmount: expected,
            actualAmount: actual,
            variance,
          }
        })

        const report = (entry.reportData || null) as ShiftReportData | null
        if (report) {
          day.shiftsWithReport++
          day.tax += report.tax?.total || 0
          day.discounts += report.discounts?.total || 0
          day.voidsCount += report.voids?.count || 0
          day.voidsTotal += report.voids?.total || 0
          day.returnsCount += report.returns?.count || 0
          day.returnsTotal += report.returns?.total || 0
          day.cashPaidIn += report.cashMovements?.paidIn || 0
          day.cashPaidOut += report.cashMovements?.paidOut || 0
          day.approvals += report.approvals?.count || 0
          if (report.ledger && !report.ledger.tiesOut) day.ledgerTiesOut = false
        }

        return {
          id: entry.id,
          entryNumber: entry.entryNumber,
          varianceReason: entry.varianceReason,
          varianceNote: entry.varianceNote,
          report,
          posProfile: entry.posProfile ? { id: entry.posProfile.id, name: entry.posProfile.name } : null,
          user: entry.user ? { id: entry.user.id, name: entry.user.fullName } : null,
          openingTime: entry.openingTime,
          closingTime: entry.closingTime,
          totalSales: shiftSales,
          totalReturns: shiftReturns,
          netSales: shiftNet,
          totalTransactions: entry.totalTransactions,
          status: entry.status,
          reconciliation: shiftReconciliation,
        }
      })

      // Calculate total variance
      const totalVariance = Object.values(paymentMethodTotals).reduce(
        (sum, pm) => sum + pm.variance, 0
      )

      return NextResponse.json({
        date: dateStr,
        totalShifts: closingEntries.length,
        summary: {
          totalSales,
          totalReturns,
          netSales,
          totalTransactions,
          totalVariance,
          taxTotal: r2(day.tax),
          discountTotal: r2(day.discounts),
          voidsCount: day.voidsCount,
          voidsTotal: r2(day.voidsTotal),
          returnsCount: day.returnsCount,
          returnsTotal: r2(day.returnsTotal),
          cashPaidIn: r2(day.cashPaidIn),
          cashPaidOut: r2(day.cashPaidOut),
          approvals: day.approvals,
          ledgerTiesOut: day.ledgerTiesOut,
          shiftsWithReport: day.shiftsWithReport,
        },
        paymentMethodBreakdown: Object.entries(paymentMethodTotals).map(([method, totals]) => ({
          paymentMethod: method,
          ...totals,
        })),
        shifts,
      })
    })
  } catch (error) {
    logError('api/pos-daily-summary', error)
    return NextResponse.json({ error: 'Failed to fetch daily summary' }, { status: 500 })
  }
}
