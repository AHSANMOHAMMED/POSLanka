import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, withTenant } from '@/lib/db'
import { tenants, users, setupProgress } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function DELETE(
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

    // Verify user has access to this tenant and is owner
    const userRecord = await withTenant(tenant.id, async (tdb) => {
      return tdb.query.users.findFirst({
        where: and(
          eq(users.id, session.user.id),
          eq(users.isActive, true),
          eq(users.role, 'owner')
        ),
      })
    })

    if (!userRecord) {
      return NextResponse.json({ error: 'Only the business owner can reset setup' }, { status: 403 })
    }

    // Check if setup is already completed
    if (tenant.setupCompletedAt) {
      return NextResponse.json({ error: 'Cannot reset setup after it has been completed' }, { status: 400 })
    }

    // Delete all setup progress entries for this tenant (uses withTenant for RLS)
    const result = await withTenant(tenant.id, async (tdb) => {
      return tdb.delete(setupProgress)
        .where(eq(setupProgress.tenantId, tenant.id))
        .returning()
    })

    return NextResponse.json({
      success: true,
      deletedCount: result.length,
    })
  } catch (error) {
    console.error('Failed to reset setup progress:', error)
    return NextResponse.json(
      { error: 'Failed to reset setup progress' },
      { status: 500 }
    )
  }
}