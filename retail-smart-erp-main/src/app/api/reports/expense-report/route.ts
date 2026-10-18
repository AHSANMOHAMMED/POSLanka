import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { glEntries, chartOfAccounts } from '@/lib/db/schema'
import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Query GL entries where the account rootType is 'expense', grouped by account
      const data = await db.select({
        accountId: chartOfAccounts.id,
        accountName: chartOfAccounts.name,
        accountNumber: chartOfAccounts.accountNumber,
        totalAmount: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric) - CAST(${glEntries.credit} AS numeric)), 0)`,
        entryCount: sql<number>`COUNT(*)::int`,
      })
        .from(glEntries)
        .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
        .where(and(
          eq(glEntries.tenantId, session.user.tenantId),
          eq(chartOfAccounts.rootType, 'expense'),
          gte(glEntries.postingDate, fromDate),
          lte(glEntries.postingDate, toDate),
        ))
        .groupBy(chartOfAccounts.id, chartOfAccounts.name, chartOfAccounts.accountNumber)
        .orderBy(sql`SUM(CAST(${glEntries.debit} AS numeric) - CAST(${glEntries.credit} AS numeric)) DESC`)

      let totalExpenses = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expenses = data.map((row: any) => {
        const amount = Math.round(Number(row.totalAmount) * 100) / 100
        totalExpenses += amount
        return {
          accountId: row.accountId,
          accountName: row.accountName,
          accountNumber: row.accountNumber,
          totalAmount: amount,
          entryCount: row.entryCount,
        }
      })

      // Determine top expense category
      const topExpense = expenses.length > 0 ? expenses[0].accountName : 'N/A'

      return NextResponse.json({
        summary: {
          totalExpenses: Math.round(totalExpenses * 100) / 100,
          topExpenseCategory: topExpense,
          accountCount: expenses.length,
        },
        data: expenses,
      })
    })
  } catch (error) {
    logError('api/reports/expense-report', error)
    return NextResponse.json({ error: 'Failed to generate expense report' }, { status: 500 })
  }
}
