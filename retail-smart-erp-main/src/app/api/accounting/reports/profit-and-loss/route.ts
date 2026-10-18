import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getProfitAndLoss } from '@/lib/accounting/reports'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { profitAndLossQuerySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, profitAndLossQuerySchema)
    if (!parsed.success) return parsed.response
    const { fromDate, toDate, compareFromDate, compareToDate } = parsed.data
    const costCenterId = parsed.data.costCenterId || undefined

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await getProfitAndLoss(db, session.user.tenantId, fromDate, toDate, costCenterId)

      const response: Record<string, unknown> = {
        income: result.income,
        expenses: result.expenses,
        totalIncome: result.totalIncome,
        totalExpenses: result.totalExpenses,
        netProfitLoss: result.netProfit,
        filters: { fromDate, toDate },
      }

      // Run comparison period if requested
      if (compareFromDate && compareToDate) {
        const compResult = await getProfitAndLoss(db, session.user.tenantId, compareFromDate, compareToDate, costCenterId)
        response.comparison = {
          income: compResult.income,
          expenses: compResult.expenses,
          totalIncome: compResult.totalIncome,
          totalExpenses: compResult.totalExpenses,
          netProfitLoss: compResult.netProfit,
        }
      }

      return NextResponse.json(response)
    })
  } catch (error) {
    logError('api/accounting/reports/profit-and-loss', error)
    return NextResponse.json({ error: 'Failed to generate profit and loss report' }, { status: 500 })
  }
}
