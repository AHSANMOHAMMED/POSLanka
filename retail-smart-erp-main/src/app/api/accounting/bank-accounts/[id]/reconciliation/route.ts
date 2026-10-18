import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, bankTransactions } from '@/lib/db/schema'
import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { reconcileBankAccountSchema } from '@/lib/validation/schemas/accounting'
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
      // Verify bank account exists
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      // Get counts by status
      const statusCounts = await db
        .select({
          status: bankTransactions.status,
          count: sql<number>`count(*)::int`,
          totalDebit: sql<string>`coalesce(sum(${bankTransactions.debit}), 0)`,
          totalCredit: sql<string>`coalesce(sum(${bankTransactions.credit}), 0)`,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.bankAccountId, id))
        .groupBy(bankTransactions.status)

      let unmatchedCount = 0
      let matchedCount = 0
      let reconciledCount = 0
      let totalStatementDebit = 0
      let totalStatementCredit = 0
      let unmatchedDebitTotal = 0
      let unmatchedCreditTotal = 0

      for (const row of statusCounts) {
        const debit = Number(row.totalDebit)
        const credit = Number(row.totalCredit)

        if (row.status === 'unmatched') {
          unmatchedCount = row.count
          unmatchedDebitTotal = debit
          unmatchedCreditTotal = credit
        } else if (row.status === 'matched') {
          matchedCount = row.count
        } else if (row.status === 'reconciled') {
          reconciledCount = row.count
        }

        totalStatementDebit += debit
        totalStatementCredit += credit
      }

      const statementBalance = String(totalStatementCredit - totalStatementDebit)

      return NextResponse.json({
        bankAccountId: id,
        bookBalance: account.currentBalance,
        statementBalance,
        unmatchedCount,
        matchedCount,
        reconciledCount,
        totalTransactions: unmatchedCount + matchedCount + reconciledCount,
        unmatchedDebitTotal: String(unmatchedDebitTotal),
        unmatchedCreditTotal: String(unmatchedCreditTotal),
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]/reconciliation', error)
    return NextResponse.json({ error: 'Failed to fetch reconciliation summary' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, reconcileBankAccountSchema)
    if (!parsed.success) return parsed.response
    const { fromDate, toDate } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Verify bank account exists
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      // Reconcile matched transactions within the date range
      const result = await db
        .update(bankTransactions)
        .set({ status: 'reconciled' })
        .where(
          and(
            eq(bankTransactions.bankAccountId, id),
            eq(bankTransactions.status, 'matched'),
            gte(bankTransactions.transactionDate, fromDate),
            lte(bankTransactions.transactionDate, toDate)
          )
        )
        .returning()

      logAndBroadcast(tenantId, 'bank-transaction', 'updated', id)
      return NextResponse.json({
        success: true,
        reconciledCount: result.length,
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]/reconciliation', error)
    return NextResponse.json({ error: 'Failed to reconcile transactions' }, { status: 500 })
  }
}
