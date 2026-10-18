import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getBalanceSheet } from '@/lib/accounting/reports'
import { accountingSettings, fiscalYears } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { balanceSheetQuerySchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, balanceSheetQuerySchema)
    if (!parsed.success) return parsed.response
    const asOfDate = parsed.data.asOfDate || new Date().toISOString().split('T')[0]
    const costCenterId = parsed.data.costCenterId || undefined
    const compareAsOfDate = parsed.data.compareAsOfDate || null

    return await withTenant(session.user.tenantId, async (db) => {
      // Try to get fiscal year start date from settings
      let fiscalYearStartDate: string | undefined
      const [settings] = await db.select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, session.user.tenantId))
        .limit(1)

      if (settings?.currentFiscalYearId) {
        const [fy] = await db.select()
          .from(fiscalYears)
          .where(eq(fiscalYears.id, settings.currentFiscalYearId))
          .limit(1)

        if (fy) {
          fiscalYearStartDate = fy.startDate
        }
      }

      const result = await getBalanceSheet(db, session.user.tenantId, asOfDate, fiscalYearStartDate, costCenterId)

      const response: Record<string, unknown> = {
        ...result,
        filters: { asOfDate },
      }

      // Run comparison if requested
      if (compareAsOfDate) {
        const compResult = await getBalanceSheet(db, session.user.tenantId, compareAsOfDate, fiscalYearStartDate, costCenterId)
        response.comparison = {
          assets: compResult.assets,
          liabilities: compResult.liabilities,
          equity: compResult.equity,
          totalAssets: compResult.totalAssets,
          totalLiabilities: compResult.totalLiabilities,
          totalEquity: compResult.totalEquity,
          netProfit: compResult.netProfit,
        }
      }

      return NextResponse.json(response)
    })
  } catch (error) {
    logError('api/accounting/reports/balance-sheet', error)
    return NextResponse.json({ error: 'Failed to generate balance sheet' }, { status: 500 })
  }
}
