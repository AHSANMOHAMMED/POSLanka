import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateAdminSession, getAdminFromSession, adminAudit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const { id } = await params
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
      columns: { id: true, slug: true, name: true, status: true },
    })
    if (!tenant || tenant.status !== 'active') {
      return NextResponse.json({ error: 'Vendor not found or inactive' }, { status: 404 })
    }

    const admin = await getAdminFromSession()
    const impersonateToken = jwt.sign(
      {
        type: 'vendor-impersonate',
        tenantId: tenant.id,
        adminId: session.superAdminId,
        adminEmail: admin?.email || undefined,
      },
      secret,
      { expiresIn: '5m' }
    )

    await adminAudit.update(session.superAdminId, 'impersonate', tenant.id, {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    })

    return NextResponse.json({
      impersonateToken,
      tenantSlug: tenant.slug,
      redirectUrl: `/api/auth/impersonate?token=${encodeURIComponent(impersonateToken)}&slug=${encodeURIComponent(tenant.slug)}`,
    })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/impersonate', error)
    return NextResponse.json({ error: 'Failed to start impersonation' }, { status: 500 })
  }
}
