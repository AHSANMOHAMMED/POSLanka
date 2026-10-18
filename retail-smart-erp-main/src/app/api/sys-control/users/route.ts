import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accounts, accountTenants } from '@/lib/db/schema'
import { eq, desc, ilike, or, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    const whereClause = search
      ? or(
          ilike(accounts.fullName, `%${escapeLikePattern(search)}%`),
          ilike(accounts.email, `%${escapeLikePattern(search)}%`)
        )
      : undefined

    const allAccounts = await db.query.accounts.findMany({
      where: whereClause,
      orderBy: [desc(accounts.createdAt)],
      limit: 100,
    })

    // Get company counts for each account
    const accountsWithCounts = await Promise.all(
      allAccounts.map(async (account) => {
        const companies = await db.select({ count: sql<number>`count(*)` })
          .from(accountTenants)
          .where(eq(accountTenants.accountId, account.id))

        return {
          ...account,
          _count: {
            companies: Number(companies[0]?.count || 0),
          },
        }
      })
    )

    return NextResponse.json(accountsWithCounts)
  } catch (error) {
    logError('api/sys-control/users', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
