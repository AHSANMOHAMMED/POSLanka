import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceAssessors, insuranceCompanies } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { insuranceAssessorsListSchema, createInsuranceAssessorSchema } from '@/lib/validation/schemas/insurance'

// GET all insurance assessors for the tenant
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, insuranceAssessorsListSchema)
    if (!parsed.success) return parsed.response
    const { insuranceCompanyId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.query.insuranceAssessors.findMany({
        with: {
          insuranceCompany: true,
        },
        orderBy: (assessors, { asc }) => [asc(assessors.name)],
      })

      // Filter by insurance company if provided
      const filteredResult = insuranceCompanyId
        ? result.filter(a => a.insuranceCompanyId === insuranceCompanyId)
        : result

      return NextResponse.json(filteredResult)
    })
  } catch (error) {
    logError('api/insurance-assessors', error)
    return NextResponse.json({ error: 'Failed to fetch insurance assessors' }, { status: 500 })
  }
}

// POST create new insurance assessor
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

    const parsed = await validateBody(request, createInsuranceAssessorSchema)
    if (!parsed.success) return parsed.response
    const { insuranceCompanyId, name, phone, email } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Validate insuranceCompanyId belongs to tenant (RLS scopes the query)
      if (insuranceCompanyId) {
        const company = await db.query.insuranceCompanies.findFirst({
          where: eq(insuranceCompanies.id, insuranceCompanyId),
        })
        if (!company) {
          return NextResponse.json({ error: 'Invalid insurance company' }, { status: 400 })
        }
      }

      const [newAssessor] = await db.insert(insuranceAssessors).values({
        tenantId: session.user.tenantId,
        insuranceCompanyId: insuranceCompanyId || null,
        name,
        phone: phone || null,
        email: email || null,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'insurance-assessor', 'created', newAssessor.id)

      return NextResponse.json(newAssessor)
    })
  } catch (error) {
    logError('api/insurance-assessors', error)
    return NextResponse.json({ error: 'Failed to create insurance assessor' }, { status: 500 })
  }
}
