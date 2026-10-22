import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession, getAdminFromSession, adminAudit, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { issueImpersonationToken } from '@/lib/auth/impersonation-token'

const bodySchema = z.object({ reason: z.string().trim().max(500).optional() }).catch({})

/**
 * POST /api/sys-control/vendors/[id]/impersonate — signs a 2-minute, single-use token that opens the
 * vendor app as its owner (consumed by /api/auth/impersonate). Rate limited and audited
 * with the admin, reason and IP; only active vendors with an active owner can be opened.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/impersonate', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession('vendors.impersonate')
    if (!session) {
      return adminAuthError()
    }

    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    // Body is optional (older clients POST nothing), so it is parsed leniently rather than via validateBody
    // eslint-disable-next-line custom-rules/no-direct-request-json
    const { reason } = bodySchema.parse(await request.json().catch(() => ({})))

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, p.data.id),
      columns: { id: true, slug: true, name: true, status: true, businessId: true },
    })
    if (!tenant || tenant.status !== 'active') {
      return NextResponse.json({ error: 'Vendor not found or not active' }, { status: 404 })
    }
    const owner = await db.query.users.findFirst({
      where: and(eq(users.tenantId, tenant.id), eq(users.role, 'owner'), eq(users.isActive, true)),
      columns: { id: true, email: true },
    })
    if (!owner) {
      return NextResponse.json({ error: 'This vendor has no active owner to sign in as' }, { status: 409 })
    }

    const admin = await getAdminFromSession()
    // Single-use: the jti is recorded here and burned by the vendor sign-in (src/lib/auth/impersonation-token.ts)
    const impersonateToken = await issueImpersonationToken({
      tenantId: tenant.id,
      adminId: session.superAdminId,
      adminEmail: admin?.email || undefined,
    })

    await adminAudit.update(session.superAdminId, 'impersonate', tenant.id, {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessId: tenant.businessId,
      ownerUserId: owner.id,
      reason: reason || null,
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
