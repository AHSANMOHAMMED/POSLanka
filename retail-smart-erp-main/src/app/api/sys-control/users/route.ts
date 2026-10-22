import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, accountTenants } from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils/sql'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'

const blank = (v: unknown) => (v === '' || v === 'all' ? undefined : v)

const listSchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(100).optional()),
  status: z.preprocess(blank, z.enum(['active', 'inactive']).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/sys-control/users — customer accounts (people who sign in to the account portal /
 * own vendors), paginated, with the number of businesses each one belongs to (one GROUP BY).
 * Platform admins are listed by /api/sys-control/users/admins.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }
    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { q, status, page, pageSize } = parsed.data

    const conds: SQL[] = [eq(accounts.isSuperAdmin, false)]
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`
      conds.push(or(ilike(accounts.fullName, pattern), ilike(accounts.email, pattern), ilike(accounts.phone, pattern))!)
    }
    if (status) conds.push(eq(accounts.isActive, status === 'active'))
    const where = and(...conds)

    const companyCounts = db
      .select({ accountId: accountTenants.accountId, companies: sql<number>`count(*)::int`.as('companies') })
      .from(accountTenants)
      .where(eq(accountTenants.isActive, true))
      .groupBy(accountTenants.accountId)
      .as('company_counts')

    const [rows, [count]] = await Promise.all([
      db.select({
        id: accounts.id,
        email: accounts.email,
        fullName: accounts.fullName,
        phone: accounts.phone,
        emailVerified: accounts.emailVerified,
        isActive: accounts.isActive,
        deactivatedAt: accounts.deactivatedAt,
        deactivationReason: accounts.deactivationReason,
        lastLoginAt: accounts.lastLoginAt,
        createdAt: accounts.createdAt,
        companies: sql<number>`coalesce(${companyCounts.companies}, 0)::int`,
      })
        .from(accounts)
        .leftJoin(companyCounts, eq(companyCounts.accountId, accounts.id))
        .where(where)
        .orderBy(desc(accounts.createdAt), accounts.id)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(accounts).where(where),
    ])

    return NextResponse.json({ accounts: rows, pagination: { page, pageSize, total: count?.total ?? 0 } })
  } catch (error) {
    logError('api/sys-control/users', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
