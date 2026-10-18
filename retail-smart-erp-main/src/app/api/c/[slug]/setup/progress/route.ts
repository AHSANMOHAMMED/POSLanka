import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, withTenant } from '@/lib/db'
import { tenants, users, setupProgress } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await params

    // Find tenant
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

    // Get all setup progress entries for this tenant (uses withTenant for RLS)
    const progressEntries = await withTenant(tenant.id, async (tdb) => {
      return tdb.query.setupProgress.findMany({
        where: eq(setupProgress.tenantId, tenant.id),
        orderBy: [desc(setupProgress.stepIndex)],
      })
    })

    // Find the latest completed step, or fall back to highest saved step
    const latestCompletedStep = progressEntries
      .filter(entry => entry.completedAt !== null)
      .sort((a, b) => b.stepIndex - a.stepIndex)[0]

    // Find the most recent saved data (highest step index, regardless of completion)
    const latestSavedData = progressEntries[0]

    // Use completed step if available, otherwise use highest saved step index
    const currentStep = latestCompletedStep?.stepIndex
      ?? (latestSavedData ? latestSavedData.stepIndex : -1)

    return NextResponse.json({
      currentStep,
      data: latestSavedData?.data ?? {},
      completedAt: tenant.setupCompletedAt,
    })
  } catch (error) {
    console.error('Failed to load setup progress:', error)
    return NextResponse.json(
      { error: 'Failed to load setup progress' },
      { status: 500 }
    )
  }
}
