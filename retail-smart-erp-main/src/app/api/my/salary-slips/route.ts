import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { salarySlips } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams } from '@/lib/validation/helpers'
import { mySalarySlipsListSchema } from '@/lib/validation/schemas/hr'

// GET current user's salary slips
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewOwnPaySlips')
    if (permError) return permError

    const parsed = validateSearchParams(request, mySalarySlipsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, year } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = [eq(salarySlips.userId, session.user.id)]
      // Only show submitted slips to employees
      conditions.push(eq(salarySlips.status, 'submitted'))
      if (year) conditions.push(eq(salarySlips.payrollYear, year))
      const whereClause = and(...conditions)

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(salarySlips)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.salarySlips.findMany({
        where: whereClause,
        orderBy: (s, { desc }) => [desc(s.payrollYear), desc(s.payrollMonth)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/my/salary-slips', error)
    return NextResponse.json({ error: 'Failed to fetch salary slips' }, { status: 500 })
  }
}
