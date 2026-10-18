import { NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { tenants, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { transferAuthSchema } from '@/lib/validation/schemas/account'

/**
 * POST /api/account-auth/transfer
 * Generates a short-lived transfer token that allows the company login page
 * to create a company session without requiring the user to re-enter credentials.
 */
export async function POST(request: Request) {
  try {
    const session = await accountAuth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, transferAuthSchema)
    if (!parsed.success) return parsed.response
    const { tenantId, tenantSlug } = parsed.data

    const accountId = session.user.accountId || session.user.id

    // Get tenant details (by id or slug)
    // refine() guarantees at least one is set
    const tenant = tenantId
      ? await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
      : await db.query.tenants.findFirst({ where: eq(tenants.slug, tenantSlug!) })

    if (!tenant || tenant.status !== 'active') {
      return NextResponse.json({ error: 'Company not found or inactive' }, { status: 404 })
    }

    // Verify membership
    const membership = await db.query.accountTenants.findFirst({
      where: and(
        eq(accountTenants.accountId, accountId),
        eq(accountTenants.tenantId, tenant.id),
        eq(accountTenants.isActive, true)
      ),
    })

    if (!membership) {
      return NextResponse.json({ error: 'No access to this company' }, { status: 403 })
    }

    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Extract IP and user-agent to embed in transfer token
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Generate short-lived transfer token
    const transferToken = jwt.sign(
      {
        accountId,
        tenantSlug: tenant.slug,
        type: 'company-transfer',
        ip,
        userAgent,
      },
      secret,
      { expiresIn: '30s' }
    )

    return NextResponse.json({
      transferToken,
      slug: tenant.slug,
    })
  } catch (error) {
    logError('api/account-auth/transfer', error)
    return NextResponse.json({ error: 'Failed to generate transfer token' }, { status: 500 })
  }
}
