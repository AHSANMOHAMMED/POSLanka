import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, withTenant } from '@/lib/db'
import { tenants, users, setupProgress } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { setupStepSchema } from '@/lib/validation/schemas/settings'
import { requireQuota } from '@/lib/db/storage-quota'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; stepIndex: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug, stepIndex } = await params
    const stepIndexNum = parseInt(stepIndex, 10)

    if (isNaN(stepIndexNum) || stepIndexNum < 0 || stepIndexNum > 7) {
      return NextResponse.json({ error: 'Invalid step index' }, { status: 400 })
    }

    const parsed = await validateBody(request, setupStepSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Find tenant (tenants table has no RLS)
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Verify user has access to this tenant
    const userRecord = await withTenant(tenant.id, async (tdb) => {
      return tdb.query.users.findFirst({
        where: and(
          eq(users.id, session.user.id),
          eq(users.isActive, true)
        ),
      })
    })

    if (!userRecord) {
      return NextResponse.json({ error: 'No access to this company' }, { status: 403 })
    }

    // Only allow owners to save setup progress
    if (userRecord.role !== 'owner') {
      return NextResponse.json({ error: 'Only the business owner can save setup progress' }, { status: 403 })
    }

    // Check if setup is already completed
    if (tenant.setupCompletedAt) {
      return NextResponse.json({ error: 'Setup already completed' }, { status: 400 })
    }

    // Check storage quota
    const quotaError = await requireQuota(tenant.id, 'standard')
    if (quotaError) return quotaError

    const data = body.data && typeof body.data === 'object' ? body.data : {}
    const markAsCompleted = body.completed

    // Upsert the setup progress entry (uses withTenant for RLS context)
    const progress = await withTenant(tenant.id, async (tdb) => {
      const [row] = await tdb
        .insert(setupProgress)
        .values({
          tenantId: tenant.id,
          stepIndex: stepIndexNum,
          data: data,
          completedAt: markAsCompleted ? new Date() : null,
          createdAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [setupProgress.tenantId, setupProgress.stepIndex],
          set: {
            data: data,
            completedAt: markAsCompleted ? new Date() : sql`${setupProgress.completedAt}`,
            updatedAt: sql`now()`,
          },
        })
        .returning()
      return row
    })

    return NextResponse.json({
      success: true,
      stepIndex: progress.stepIndex,
      completedAt: progress.completedAt,
    })
  } catch (error) {
    console.error('Failed to save setup step:', error)
    return NextResponse.json(
      { error: 'Failed to save setup step' },
      { status: 500 }
    )
  }
}
