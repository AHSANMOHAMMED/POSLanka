import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { periodClosingVouchers, fiscalYears, chartOfAccounts, glEntries } from '@/lib/db/schema'
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { getProfitAndLoss } from '@/lib/accounting/reports'
import { createGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(
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

    const quotaError = await requireQuota(tenantId, 'essential')
    if (quotaError) return quotaError

    const result = await withTenantTransaction(tenantId, async (db) => {
      // 1. Get the period closing voucher with FOR UPDATE lock
      const [voucher] = await db
        .select()
        .from(periodClosingVouchers)
        .where(eq(periodClosingVouchers.id, id))
        .for('update')

      if (!voucher) throw new Error('NOT_FOUND')
      if (voucher.status !== 'draft') throw new Error('INVALID_STATUS')

      // 2. Get the fiscal year to find date range
      const [fiscalYear] = await db
        .select()
        .from(fiscalYears)
        .where(eq(fiscalYears.id, voucher.fiscalYearId))
        .limit(1)

      if (!fiscalYear) throw new Error('FISCAL_YEAR_NOT_FOUND')
      if (fiscalYear.isClosed) throw new Error('FISCAL_YEAR_ALREADY_CLOSED')

      // 3. Get all active non-group income and expense accounts
      const incomeExpenseAccounts = await db
        .select({
          id: chartOfAccounts.id,
          rootType: chartOfAccounts.rootType,
        })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.isGroup, false),
          eq(chartOfAccounts.isActive, true),
          sql`${chartOfAccounts.rootType} IN ('income', 'expense')`,
        ))

      if (incomeExpenseAccounts.length === 0) {
        throw new Error('NO_ACCOUNTS')
      }

      const accountIds = incomeExpenseAccounts.map(a => a.id)

      // 4. Get balances for all income/expense accounts within the fiscal year period
      const balances = await db
        .select({
          accountId: glEntries.accountId,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
        })
        .from(glEntries)
        .where(and(
          gte(glEntries.postingDate, fiscalYear.startDate),
          lte(glEntries.postingDate, fiscalYear.endDate),
          inArray(glEntries.accountId, accountIds),
        ))
        .groupBy(glEntries.accountId)

      const balanceMap = new Map(balances.map(b => [b.accountId, b]))
      const accountRootTypeMap = new Map(incomeExpenseAccounts.map(a => [a.id, a.rootType]))

      // 5. Build closing GL entries
      // For each income account: Dr account for its credit balance (to zero it out)
      // For each expense account: Cr account for its debit balance (to zero it out)
      // The difference (net profit/loss) goes to the closing account
      const closingEntries: GLEntryInput[] = []
      let totalClosingDebit = 0
      let totalClosingCredit = 0

      for (const [accountId, balance] of balanceMap) {
        const debit = Number(balance.totalDebit)
        const credit = Number(balance.totalCredit)
        const rootType = accountRootTypeMap.get(accountId)

        if (rootType === 'income') {
          // Income accounts have natural credit balance (credit > debit)
          // To close: Dr income account for its net credit balance
          const netCredit = Math.round((credit - debit) * 100) / 100
          if (netCredit !== 0) {
            if (netCredit > 0) {
              closingEntries.push({
                accountId,
                debit: netCredit,
                credit: 0,
                remarks: 'Period closing - close income account',
              })
              totalClosingDebit += netCredit
            } else {
              // Unusual case: income account has debit balance
              closingEntries.push({
                accountId,
                debit: 0,
                credit: Math.abs(netCredit),
                remarks: 'Period closing - close income account',
              })
              totalClosingCredit += Math.abs(netCredit)
            }
          }
        } else if (rootType === 'expense') {
          // Expense accounts have natural debit balance (debit > credit)
          // To close: Cr expense account for its net debit balance
          const netDebit = Math.round((debit - credit) * 100) / 100
          if (netDebit !== 0) {
            if (netDebit > 0) {
              closingEntries.push({
                accountId,
                debit: 0,
                credit: netDebit,
                remarks: 'Period closing - close expense account',
              })
              totalClosingCredit += netDebit
            } else {
              // Unusual case: expense account has credit balance
              closingEntries.push({
                accountId,
                debit: Math.abs(netDebit),
                credit: 0,
                remarks: 'Period closing - close expense account',
              })
              totalClosingDebit += Math.abs(netDebit)
            }
          }
        }
      }

      // 6. Calculate the net difference for the closing account (Retained Earnings)
      // totalClosingDebit = sum of income closings (debiting income accounts)
      // totalClosingCredit = sum of expense closings (crediting expense accounts)
      // If totalClosingDebit > totalClosingCredit => net profit => Cr closing account
      // If totalClosingCredit > totalClosingDebit => net loss => Dr closing account
      const netDifference = Math.round((totalClosingDebit - totalClosingCredit) * 100) / 100

      if (netDifference > 0) {
        // Net profit: Credit the closing account (Retained Earnings)
        closingEntries.push({
          accountId: voucher.closingAccountId,
          debit: 0,
          credit: netDifference,
          remarks: 'Period closing - net profit to retained earnings',
        })
      } else if (netDifference < 0) {
        // Net loss: Debit the closing account (Retained Earnings)
        closingEntries.push({
          accountId: voucher.closingAccountId,
          debit: Math.abs(netDifference),
          credit: 0,
          remarks: 'Period closing - net loss to retained earnings',
        })
      }

      // Only post if there are entries to post
      if (closingEntries.length > 0) {
        // 7. Post GL entries via createGLEntries
        await createGLEntries(db, {
          tenantId,
          postingDate: voucher.closingDate,
          voucherType: 'period_closing',
          voucherId: voucher.id,
          voucherNumber: `PC-${fiscalYear.name}`,
          fiscalYearId: fiscalYear.id,
          skipFiscalYearValidation: true, // Period closing posts to the fiscal year being closed
          entries: closingEntries,
        })
      }

      // 8. Recalculate net P&L for storage on the voucher
      const plReport = await getProfitAndLoss(
        db,
        tenantId,
        fiscalYear.startDate,
        fiscalYear.endDate
      )

      // 9. Mark the fiscal year as closed
      await db.update(fiscalYears)
        .set({
          isClosed: true,
          closedAt: new Date(),
          closedBy: session!.user.id,
        })
        .where(eq(fiscalYears.id, fiscalYear.id))

      // 10. Update the period closing voucher status to submitted
      const [updated] = await db.update(periodClosingVouchers)
        .set({
          status: 'submitted',
          netProfitLoss: String(plReport.netProfit),
          submittedAt: new Date(),
          submittedBy: session!.user.id,
        })
        .where(eq(periodClosingVouchers.id, id))
        .returning()

      return updated
    })

    logAndBroadcast(tenantId, 'period-closing', 'updated', id)
    logAndBroadcast(tenantId, 'fiscal-year', 'updated', result.fiscalYearId)

    return NextResponse.json(result)
  } catch (error) {
    const err = error as Error
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Period closing voucher not found' }, { status: 404 })
    }
    if (err.message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Only draft vouchers can be submitted' }, { status: 400 })
    }
    if (err.message === 'FISCAL_YEAR_NOT_FOUND') {
      return NextResponse.json({ error: 'Fiscal year not found' }, { status: 404 })
    }
    if (err.message === 'FISCAL_YEAR_ALREADY_CLOSED') {
      return NextResponse.json({ error: 'Fiscal year is already closed' }, { status: 400 })
    }
    if (err.message === 'NO_ACCOUNTS') {
      return NextResponse.json({ error: 'No income or expense accounts found to close' }, { status: 400 })
    }
    logError('api/accounting/period-closing/[id]/submit', error)
    return NextResponse.json({ error: 'Failed to submit period closing voucher' }, { status: 500 })
  }
}
