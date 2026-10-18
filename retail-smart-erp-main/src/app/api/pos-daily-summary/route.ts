import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posClosingEntries } from '@/lib/db/schema'
import { and, gte, lte } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { posDailySummarySchema } from '@/lib/validation/schemas/pos'

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
      // Get all closing entries for the date
      const closingEntries = await db.query.posClosingEntries.findMany({
        where: and(
          gte(posClosingEntries.closingTime, dayStart),
          lte(posClosingEntries.closingTime, dayEnd),
        ),
        with: {
          openingEntry: {
            with: {
              balances: true,
            },
          },
          posProfile: true,
          user: true,
          reconciliation: true,
        },
        orderBy: posClosingEntries.openingTime,
      })

      // Aggregate totals across all shifts
      let totalSales = 0
      let totalReturns = 0
      let netSales = 0
      let totalTransactions = 0

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

        return {
          id: entry.id,
          entryNumber: entry.entryNumber,
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
