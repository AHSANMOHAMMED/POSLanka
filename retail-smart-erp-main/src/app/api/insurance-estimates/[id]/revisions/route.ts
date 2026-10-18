import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateRevisions } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// E24: Get all revisions with full snapshots for comparison
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify estimate exists (RLS scopes to tenant)
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, id),
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      // Fetch all revisions with full data
      const revisions = await db.query.insuranceEstimateRevisions.findMany({
        where: eq(insuranceEstimateRevisions.estimateId, id),
        with: {
          changedByUser: {
            columns: { fullName: true }
          }
        },
        orderBy: [desc(insuranceEstimateRevisions.revisionNumber)],
      })

      return NextResponse.json(revisions)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/revisions', error)
    return NextResponse.json({ error: 'Failed to fetch revisions' }, { status: 500 })
  }
}
