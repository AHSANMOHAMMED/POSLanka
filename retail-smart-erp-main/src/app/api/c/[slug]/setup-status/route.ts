import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await params
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
      columns: {
        id: true,
        name: true,
        setupCompletedAt: true,
      },
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Verify the user has access to this tenant
    const userRecord = await withTenant(tenant.id, async (tdb) => {
      return tdb.query.users.findFirst({
        where: and(
          eq(users.id, session.user.id),
          eq(users.isActive, true)
        ),
      })
    })

    if (!userRecord) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json({
      ...tenant,
      setupCompleted: !!tenant.setupCompletedAt,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch setup status' }, { status: 500 })
  }
}
