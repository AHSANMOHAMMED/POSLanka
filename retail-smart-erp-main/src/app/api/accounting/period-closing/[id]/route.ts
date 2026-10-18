import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { periodClosingVouchers, fiscalYears, chartOfAccounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

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
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [voucher] = await db
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
          fiscalYearStartDate: fiscalYears.startDate,
          fiscalYearEndDate: fiscalYears.endDate,
          fiscalYearIsClosed: fiscalYears.isClosed,
          closingAccountName: chartOfAccounts.name,
          closingAccountNumber: chartOfAccounts.accountNumber,
          closingAccountRootType: chartOfAccounts.rootType,
        })
        .from(periodClosingVouchers)
        .leftJoin(fiscalYears, eq(periodClosingVouchers.fiscalYearId, fiscalYears.id))
        .leftJoin(chartOfAccounts, eq(periodClosingVouchers.closingAccountId, chartOfAccounts.id))
        .where(eq(periodClosingVouchers.id, id))
        .limit(1)

      if (!voucher) {
        return NextResponse.json({ error: 'Period closing voucher not found' }, { status: 404 })
      }

      return NextResponse.json(voucher)
    })
  } catch (error) {
    logError('api/accounting/period-closing/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch period closing voucher' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const [existing] = await db
        .select()
        .from(periodClosingVouchers)
        .where(eq(periodClosingVouchers.id, id))
        .limit(1)

      if (!existing) {
        return NextResponse.json({ error: 'Period closing voucher not found' }, { status: 404 })
      }

      if (existing.status !== 'draft') {
        return NextResponse.json(
          { error: 'Only draft period closing vouchers can be deleted' },
          { status: 400 }
        )
      }

      await db.delete(periodClosingVouchers).where(eq(periodClosingVouchers.id, id))

      logAndBroadcast(tenantId, 'period-closing', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/period-closing/[id]', error)
    return NextResponse.json({ error: 'Failed to delete period closing voucher' }, { status: 500 })
  }
}
