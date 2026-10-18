import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { cancellationReasons } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams, validateBody } from '@/lib/validation'
import { cancellationReasonsListSchema } from '@/lib/validation/schemas/settings'
import { requireQuota } from '@/lib/db/storage-quota'
import { z } from 'zod'

const createCancellationReasonSchema = z.object({
  documentType: z.string().trim().min(1).max(30),
  reason: z.string().trim().min(1).max(500),
})

// GET /api/cancellation-reasons?documentType=work_order
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, cancellationReasonsListSchema)
    if (!parsed.success) return parsed.response
    const { documentType } = parsed.data

    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const reasons = await db
        .select({
          id: cancellationReasons.id,
          reason: cancellationReasons.reason,
          documentType: cancellationReasons.documentType,
          isActive: cancellationReasons.isActive,
          sortOrder: cancellationReasons.sortOrder,
        })
        .from(cancellationReasons)
        .where(
          and(
            eq(cancellationReasons.documentType, documentType),
            eq(cancellationReasons.isActive, true),
          )
        )
        .orderBy(cancellationReasons.sortOrder)

      return NextResponse.json(reasons)
    })
  } catch (error) {
    logError('api/cancellation-reasons', error)
    return NextResponse.json({ error: 'Failed to fetch cancellation reasons' }, { status: 500 })
  }
}

// POST /api/cancellation-reasons
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, createCancellationReasonSchema)
    if (!parsed.success) return parsed.response
    const { documentType, reason } = parsed.data

    const tenantId = session.user.tenantId

    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError

    return await withTenant(tenantId, async (db) => {
      // Get next sort order
      const [{ maxSort }] = await db
        .select({ maxSort: sql<number>`coalesce(max(${cancellationReasons.sortOrder}), -1)` })
        .from(cancellationReasons)
        .where(eq(cancellationReasons.documentType, documentType))

      const [created] = await db.insert(cancellationReasons).values({
        tenantId,
        documentType,
        reason,
        isActive: true,
        sortOrder: (Number(maxSort) || 0) + 1,
      }).returning()

      return NextResponse.json(created, { status: 201 })
    })
  } catch (error) {
    logError('api/cancellation-reasons', error)
    return NextResponse.json({ error: 'Failed to create cancellation reason' }, { status: 500 })
  }
}
