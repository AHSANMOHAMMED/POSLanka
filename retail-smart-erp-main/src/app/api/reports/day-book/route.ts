import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { glEntries, chartOfAccounts } from '@/lib/db/schema'
import { eq, and, gte, lte } from 'drizzle-orm'
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
      // Fetch all GL entries within the date range with account info
      const entries = await db.select({
        id: glEntries.id,
        postingDate: glEntries.postingDate,
        voucherType: glEntries.voucherType,
        voucherNumber: glEntries.voucherNumber,
        accountName: chartOfAccounts.name,
        accountNumber: chartOfAccounts.accountNumber,
        debit: glEntries.debit,
        credit: glEntries.credit,
        remarks: glEntries.remarks,
      })
        .from(glEntries)
        .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
        .where(and(
          eq(glEntries.tenantId, session.user.tenantId),
          gte(glEntries.postingDate, fromDate),
          lte(glEntries.postingDate, toDate),
        ))
        .orderBy(glEntries.postingDate, glEntries.voucherType, glEntries.createdAt)

      // Calculate totals
      let totalDebits = 0
      let totalCredits = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = entries.map((entry: any) => {
        const debit = Number(entry.debit)
        const credit = Number(entry.credit)
        totalDebits += debit
        totalCredits += credit

        return {
          id: entry.id,
          postingDate: entry.postingDate,
          voucherType: entry.voucherType,
          voucherNumber: entry.voucherNumber || '-',
          accountName: entry.accountName,
          accountNumber: entry.accountNumber,
          debit: Math.round(debit * 100) / 100,
          credit: Math.round(credit * 100) / 100,
          remarks: entry.remarks || '',
        }
      })

      // Group by voucher type for summary
      const voucherTypeCounts = new Map<string, { count: number; debit: number; credit: number }>()
      for (const entry of data) {
        const existing = voucherTypeCounts.get(entry.voucherType)
        if (existing) {
          existing.count++
          existing.debit += entry.debit
          existing.credit += entry.credit
        } else {
          voucherTypeCounts.set(entry.voucherType, { count: 1, debit: entry.debit, credit: entry.credit })
        }
      }

      const voucherSummary = Array.from(voucherTypeCounts.entries()).map(([type, info]) => ({
        voucherType: type,
        count: info.count,
        totalDebit: Math.round(info.debit * 100) / 100,
        totalCredit: Math.round(info.credit * 100) / 100,
      }))

      return NextResponse.json({
        summary: {
          totalDebits: Math.round(totalDebits * 100) / 100,
          totalCredits: Math.round(totalCredits * 100) / 100,
          transactionCount: data.length,
        },
        voucherSummary,
        data,
      })
    })
  } catch (error) {
    logError('api/reports/day-book', error)
    return NextResponse.json({ error: 'Failed to generate day book report' }, { status: 500 })
  }
}
