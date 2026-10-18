import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, bankTransactions } from '@/lib/db/schema'
import { eq, and, sql, desc, gte, lte } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { bankTransactionsListSchema } from '@/lib/validation/schemas/accounting'
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

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = validateSearchParams(request, bankTransactionsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, status, fromDate, toDate } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify bank account exists
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      // Build conditions
      const conditions: ReturnType<typeof eq>[] = [
        eq(bankTransactions.bankAccountId, id),
      ]

      if (status) {
        conditions.push(sql`${bankTransactions.status} = ${status}`)
      }

      if (fromDate) {
        conditions.push(gte(bankTransactions.transactionDate, fromDate))
      }

      if (toDate) {
        conditions.push(lte(bankTransactions.transactionDate, toDate))
      }

      const whereClause = and(...conditions)

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bankTransactions)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const transactions = await db
        .select()
        .from(bankTransactions)
        .where(whereClause)
        .orderBy(desc(bankTransactions.transactionDate))
        .limit(Math.min(pageSize, 100))
        .offset(offset)

      return NextResponse.json({
        data: transactions,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]/transactions', error)
    return NextResponse.json({ error: 'Failed to fetch bank transactions' }, { status: 500 })
  }
}
