import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { periodClosingVouchers, fiscalYears, chartOfAccounts } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { getProfitAndLoss } from '@/lib/accounting/reports'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createPeriodClosingSchema } from '@/lib/validation/schemas/accounting'

export async function GET(_request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db
        .select({
          id: periodClosingVouchers.id,
          tenantId: periodClosingVouchers.tenantId,
          fiscalYearId: periodClosingVouchers.fiscalYearId,
          closingDate: periodClosingVouchers.closingDate,
          closingAccountId: periodClosingVouchers.closingAccountId,
          netProfitLoss: periodClosingVouchers.netProfitLoss,
          status: periodClosingVouchers.status,
          submittedAt: periodClosingVouchers.submittedAt,
          submittedBy: periodClosingVouchers.submittedBy,
          createdAt: periodClosingVouchers.createdAt,
          fiscalYearName: fiscalYears.name,
          closingAccountName: chartOfAccounts.name,
        })
        .from(periodClosingVouchers)
        .leftJoin(fiscalYears, eq(periodClosingVouchers.fiscalYearId, fiscalYears.id))
        .leftJoin(chartOfAccounts, eq(periodClosingVouchers.closingAccountId, chartOfAccounts.id))
        .orderBy(desc(periodClosingVouchers.createdAt))

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/accounting/period-closing', error)
    return NextResponse.json({ error: 'Failed to fetch period closing vouchers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createPeriodClosingSchema)
    if (!parsed.success) return parsed.response
    const { fiscalYearId, closingDate, closingAccountId } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Get the fiscal year to determine date range
      const [fiscalYear] = await db
        .select()
        .from(fiscalYears)
        .where(eq(fiscalYears.id, fiscalYearId))
        .limit(1)

      if (!fiscalYear) {
        return NextResponse.json({ error: 'Fiscal year not found' }, { status: 404 })
      }

      if (fiscalYear.isClosed) {
        return NextResponse.json({ error: 'Fiscal year is already closed' }, { status: 400 })
      }

      // Verify closing account exists
      const [closingAccount] = await db
        .select()
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.id, closingAccountId))
        .limit(1)

      if (!closingAccount) {
        return NextResponse.json({ error: 'Closing account not found' }, { status: 404 })
      }

      // Fix #2: Validate closing account is an equity account (e.g., Retained Earnings)
      if (closingAccount.rootType !== 'equity') {
        return NextResponse.json({
          error: 'Closing account must be an equity account (e.g., Retained Earnings)',
        }, { status: 400 })
      }

      // Calculate net profit/loss for the fiscal year period using P&L report
      const plReport = await getProfitAndLoss(
        db,
        tenantId,
        fiscalYear.startDate,
        fiscalYear.endDate
      )

      const netProfitLoss = plReport.netProfit

      // Create the period closing voucher in draft status
      const [newVoucher] = await db.insert(periodClosingVouchers).values({
        tenantId,
        fiscalYearId,
        closingDate,
        closingAccountId,
        netProfitLoss: String(netProfitLoss),
        status: 'draft',
      }).returning()

      logAndBroadcast(tenantId, 'period-closing', 'created', newVoucher.id)
      return NextResponse.json(newVoucher)
    })
  } catch (error) {
    logError('api/accounting/period-closing', error)
    return NextResponse.json({ error: 'Failed to create period closing voucher' }, { status: 500 })
  }
}
