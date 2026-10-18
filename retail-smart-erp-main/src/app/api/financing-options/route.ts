import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { financingOptions } from '@/lib/db/schema'
import { eq, and, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { financingOptionsListSchema, createFinancingOptionSchema } from '@/lib/validation/schemas/dealership'

// GET all financing options for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, financingOptionsListSchema)
    if (!parsed.success) return parsed.response
    const { search, isActive, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (search) {
        conditions.push(
          ilike(financingOptions.lenderName, `%${escapeLikePattern(search)}%`)
        )
      }
      if (isActive !== undefined && isActive !== '') {
        conditions.push(eq(financingOptions.isActive, isActive === 'true'))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(financingOptions)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.financingOptions.findMany({
        where: whereClause,
        orderBy: (financingOptions, { asc }) => [asc(financingOptions.lenderName)],
        limit,
        offset,
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/financing-options', error)
    return NextResponse.json({ error: 'Failed to fetch financing options' }, { status: 500 })
  }
}

// POST create new financing option
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError
    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createFinancingOptionSchema)
    if (!parsed.success) return parsed.response
    const {
      lenderName, contactInfo, loanType,
      minAmount, maxAmount, minTermMonths, maxTermMonths,
      interestRateMin, interestRateMax,
      notes, isActive,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [newOption] = await db.insert(financingOptions).values({
        tenantId: session!.user.tenantId,
        lenderName,
        contactInfo: contactInfo || null,
        loanType: loanType || null,
        minAmount: minAmount != null ? String(minAmount) : null,
        maxAmount: maxAmount != null ? String(maxAmount) : null,
        minTermMonths: minTermMonths ?? null,
        maxTermMonths: maxTermMonths ?? null,
        interestRateMin: interestRateMin != null ? String(interestRateMin) : null,
        interestRateMax: interestRateMax != null ? String(interestRateMax) : null,
        notes: notes || null,
        isActive,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'financing-option', 'created', newOption.id)

      return NextResponse.json(newOption)
    })
  } catch (error) {
    logError('api/financing-options', error)
    return NextResponse.json({ error: 'Failed to create financing option' }, { status: 500 })
  }
}
