import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { tenants, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST /api/account/companies/[id]/switch - Switch to company
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: tenantId } = paramsParsed.data

    // Verify membership
    const membership = await db.query.accountTenants.findFirst({
      where: and(
        eq(accountTenants.accountId, session.user.accountId),
        eq(accountTenants.tenantId, tenantId),
        eq(accountTenants.isActive, true)
      ),
    })

    if (!membership) {
      return NextResponse.json({ error: 'You do not have access to this company' }, { status: 403 })
    }

    // Get tenant details
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Company is not active' }, { status: 400 })
    }

    // Return tenant info for session update
    return NextResponse.json({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessType: tenant.businessType,
      role: membership.role,
      isOwner: membership.isOwner,
    })
  } catch (error) {
    logError('api/account/companies/[id]/switch', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
