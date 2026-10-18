import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceCompanies } from '@/lib/db/schema'
import { or, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { insuranceCompaniesListSchema, createInsuranceCompanySchema } from '@/lib/validation/schemas/insurance'

// GET all insurance companies for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, insuranceCompaniesListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      let whereClause = undefined
      if (search) {
        const escaped = escapeLikePattern(search)
        whereClause = or(
          ilike(insuranceCompanies.name, `%${escaped}%`),
          ilike(insuranceCompanies.shortName, `%${escaped}%`)
        )
      }

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(insuranceCompanies)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.insuranceCompanies.findMany({
        where: whereClause,
        orderBy: (insuranceCompanies, { asc }) => [asc(insuranceCompanies.name)],
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
    logError('api/insurance-companies', error)
    return NextResponse.json({ error: 'Failed to fetch insurance companies' }, { status: 500 })
  }
}

// POST create new insurance company
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageInsuranceCompanies')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createInsuranceCompanySchema)
    if (!parsed.success) return parsed.response
    const { name, shortName, phone, email, claimHotline, isPartnerGarage, estimateThreshold } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [newCompany] = await db.insert(insuranceCompanies).values({
        tenantId: session.user.tenantId,
        name,
        shortName: shortName || null,
        phone: phone || null,
        email: email || null,
        claimHotline: claimHotline || null,
        isPartnerGarage: isPartnerGarage || false,
        estimateThreshold: estimateThreshold || null,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'insurance-company', 'created', newCompany.id)

      return NextResponse.json(newCompany)
    })
  } catch (error) {
    logError('api/insurance-companies', error)
    return NextResponse.json({ error: 'Failed to create insurance company' }, { status: 500 })
  }
}
