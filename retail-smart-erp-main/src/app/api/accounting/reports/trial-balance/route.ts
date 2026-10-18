import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getTrialBalance } from '@/lib/accounting/reports'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { trialBalanceQuerySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, trialBalanceQuerySchema)
    if (!parsed.success) return parsed.response
    const { fromDate, toDate } = parsed.data
    const costCenterId = parsed.data.costCenterId || undefined

    return await withTenant(session.user.tenantId, async (db) => {
      const rows = await getTrialBalance(db, session.user.tenantId, fromDate, toDate, costCenterId)

      // Calculate totals for all columns
      let totalOpeningDebit = 0
      let totalOpeningCredit = 0
      let totalPeriodDebit = 0
      let totalPeriodCredit = 0
      let totalClosingDebit = 0
      let totalClosingCredit = 0
      for (const row of rows) {
        totalOpeningDebit += row.openingDebit
        totalOpeningCredit += row.openingCredit
        totalPeriodDebit += row.periodDebit
        totalPeriodCredit += row.periodCredit
        totalClosingDebit += row.closingDebit
        totalClosingCredit += row.closingCredit
      }

      return NextResponse.json({
        rows,
        totals: {
          openingDebit: Math.round(totalOpeningDebit * 100) / 100,
          openingCredit: Math.round(totalOpeningCredit * 100) / 100,
          periodDebit: Math.round(totalPeriodDebit * 100) / 100,
          periodCredit: Math.round(totalPeriodCredit * 100) / 100,
          closingDebit: Math.round(totalClosingDebit * 100) / 100,
          closingCredit: Math.round(totalClosingCredit * 100) / 100,
        },
        filters: { fromDate, toDate },
      })
    })
  } catch (error) {
    logError('api/accounting/reports/trial-balance', error)
    return NextResponse.json({ error: 'Failed to generate trial balance' }, { status: 500 })
  }
}
