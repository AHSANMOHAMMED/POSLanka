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
    const accountId = searchParams.get('accountId')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    // Validate UUID format
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(accountId)) {
      return NextResponse.json({ error: 'Invalid accountId format' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Get account info
      const [account] = await db.select({
        id: chartOfAccounts.id,
        name: chartOfAccounts.name,
        accountNumber: chartOfAccounts.accountNumber,
        rootType: chartOfAccounts.rootType,
      })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.id, accountId),
          eq(chartOfAccounts.tenantId, session.user.tenantId),
        ))

      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      // Opening balance: sum of all GL entries before fromDate
      const [opening] = await db.select({
        totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
      })
        .from(glEntries)
        .where(and(
          eq(glEntries.tenantId, session.user.tenantId),
          eq(glEntries.accountId, accountId),
          sql`${glEntries.postingDate} < ${fromDate}`,
        ))

      const openingDebit = Number(opening.totalDebit)
      const openingCredit = Number(opening.totalCredit)
      const openingBalance = openingDebit - openingCredit

      // GL entries within the date range
      const entries = await db.select({
        id: glEntries.id,
        postingDate: glEntries.postingDate,
        voucherType: glEntries.voucherType,
        voucherNumber: glEntries.voucherNumber,
        debit: glEntries.debit,
        credit: glEntries.credit,
        remarks: glEntries.remarks,
        partyType: glEntries.partyType,
      })
        .from(glEntries)
        .where(and(
          eq(glEntries.tenantId, session.user.tenantId),
          eq(glEntries.accountId, accountId),
          gte(glEntries.postingDate, fromDate),
          lte(glEntries.postingDate, toDate),
        ))
        .orderBy(glEntries.postingDate, glEntries.createdAt)

      // Build entries with running balance
      let runningBalance = openingBalance
      let totalDebit = 0
      let totalCredit = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = entries.map((entry: any) => {
        const debit = Number(entry.debit)
        const credit = Number(entry.credit)
        runningBalance += debit - credit
        totalDebit += debit
        totalCredit += credit

        return {
          id: entry.id,
          postingDate: entry.postingDate,
          voucherType: entry.voucherType,
          voucherNumber: entry.voucherNumber || '-',
          debit: Math.round(debit * 100) / 100,
          credit: Math.round(credit * 100) / 100,
          balance: Math.round(runningBalance * 100) / 100,
          remarks: entry.remarks || '',
          partyType: entry.partyType || '',
        }
      })

      const closingBalance = openingBalance + totalDebit - totalCredit

      return NextResponse.json({
        account: {
          id: account.id,
          name: account.name,
          accountNumber: account.accountNumber,
          rootType: account.rootType,
        },
        summary: {
          openingBalance: Math.round(openingBalance * 100) / 100,
          totalDebit: Math.round(totalDebit * 100) / 100,
          totalCredit: Math.round(totalCredit * 100) / 100,
          closingBalance: Math.round(closingBalance * 100) / 100,
        },
        data,
      })
    })
  } catch (error) {
    logError('api/reports/general-ledger', error)
    return NextResponse.json({ error: 'Failed to generate general ledger report' }, { status: 500 })
  }
}
