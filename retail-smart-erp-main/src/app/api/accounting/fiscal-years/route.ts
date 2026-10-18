import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { fiscalYears } from '@/lib/db/schema'
import { and, sql, desc, lte, gte, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { fiscalYearsListSchema, createFiscalYearSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, fiscalYearsListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) {
        conditions.push(ilike(fiscalYears.name, `%${escapeLikePattern(search)}%`))
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined

      // Return all for dropdown usage (e.g., settings page)
      if (all) {
        const years = await db.select().from(fiscalYears).where(where).orderBy(desc(fiscalYears.startDate)).limit(1000)
        return NextResponse.json(years)
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fiscalYears)
        .where(where)

      const years = await db
        .select()
        .from(fiscalYears)
        .where(where)
        .orderBy(desc(fiscalYears.startDate))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      return NextResponse.json({
        data: years,
        pagination: {
          page,
          pageSize,
          total: Number(count),
          totalPages: Math.ceil(Number(count) / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/accounting/fiscal-years', error)
    return NextResponse.json({ error: 'Failed to fetch fiscal years' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createFiscalYearSchema)
    if (!parsed.success) return parsed.response
    const { name, startDate, endDate } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Check for overlapping fiscal years
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fiscalYears)
        .where(
          and(
            lte(fiscalYears.startDate, endDate),
            gte(fiscalYears.endDate, startDate)
          )
        )

      if (Number(count) > 0) {
        return NextResponse.json(
          { error: 'Fiscal year dates overlap with an existing fiscal year' },
          { status: 409 }
        )
      }

      const [newFiscalYear] = await db.insert(fiscalYears).values({
        tenantId,
        name,
        startDate,
        endDate,
      }).returning()

      logAndBroadcast(tenantId, 'fiscal-year', 'created', newFiscalYear.id)
      return NextResponse.json(newFiscalYear)
    })
  } catch (error) {
    logError('api/accounting/fiscal-years', error)
    return NextResponse.json({ error: 'Failed to create fiscal year' }, { status: 500 })
  }
}
