import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { pendingCompanies, pricingTiers, accounts, tenants } from '@/lib/db/schema'
import { eq, and, sql, gt, count } from 'drizzle-orm'
import { getCountryByCode } from '@/lib/utils/countries'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation/helpers'
import { createPendingCompanySchema, deletePendingCompanySchema } from '@/lib/validation/schemas/account'
import { RESERVED_SLUGS } from '@/lib/utils/reserved-slugs'

const MAX_PENDING_COMPANIES_PER_ACCOUNT = 5

// GET /api/account/pending-companies - List pending companies
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pending = await db
      .select({
        pendingCompany: pendingCompanies,
        tier: pricingTiers,
      })
      .from(pendingCompanies)
      .innerJoin(pricingTiers, eq(pendingCompanies.tierId, pricingTiers.id))
      .where(
        and(
          eq(pendingCompanies.accountId, session.user.accountId),
          // Only show non-expired, non-approved/rejected
          gt(pendingCompanies.expiresAt, new Date()),
          sql`${pendingCompanies.status} NOT IN ('approved', 'rejected', 'expired')`
        )
      )
      .orderBy(pendingCompanies.createdAt)

    return NextResponse.json(
      pending.map((p) => ({
        id: p.pendingCompany.id,
        name: p.pendingCompany.name,
        slug: p.pendingCompany.slug,
        businessType: p.pendingCompany.businessType,
        status: p.pendingCompany.status,
        expiresAt: p.pendingCompany.expiresAt,
        createdAt: p.pendingCompany.createdAt,
        tier: {
          id: p.tier.id,
          name: p.tier.name,
          displayName: p.tier.displayName,
          priceMonthly: Number(p.tier.priceMonthly),
        },
        billingCycle: p.pendingCompany.billingCycle,
      }))
    )
  } catch (error) {
    logError('api/account/pending-companies', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/account/pending-companies - Create pending company (for users with existing companies)
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Super admins cannot create companies
    const adminAccount = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
      columns: { isSuperAdmin: true },
    })
    if (adminAccount?.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Super admins cannot create companies. Use a regular account.' },
        { status: 403 }
      )
    }

    const parsed = await validateBody(request, createPendingCompanySchema)
    if (!parsed.success) return parsed.response
    const { name, slug, businessType, email, phone, address, country, dateFormat, timeFormat, tierId, billingCycle } = parsed.data

    // Validate country
    const countryData = getCountryByCode(country)
    if (!countryData) {
      return NextResponse.json({ error: 'Invalid country selected' }, { status: 400 })
    }

    // Check reserved slugs
    if (RESERVED_SLUGS.has(slug.toLowerCase())) {
      return NextResponse.json({ error: 'This business code is reserved' }, { status: 400 })
    }

    // Limit pending companies per account to prevent abuse
    const [{ pendingCount }] = await db
      .select({ pendingCount: count() })
      .from(pendingCompanies)
      .where(
        and(
          eq(pendingCompanies.accountId, session.user.accountId),
          gt(pendingCompanies.expiresAt, new Date()),
          sql`${pendingCompanies.status} NOT IN ('approved', 'rejected', 'expired')`
        )
      )
    if (pendingCount >= MAX_PENDING_COMPANIES_PER_ACCOUNT) {
      return NextResponse.json(
        { error: `Maximum ${MAX_PENDING_COMPANIES_PER_ACCOUNT} pending companies allowed. Please complete or cancel existing ones first.` },
        { status: 400 }
      )
    }

    // Check if slug is already taken
    const existingTenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
    })
    if (existingTenant) {
      return NextResponse.json({ error: 'Business code is already taken' }, { status: 400 })
    }

    // Check if slug is reserved by a pending company
    const existingPending = await db.query.pendingCompanies.findFirst({
      where: and(
        eq(pendingCompanies.slug, slug),
        gt(pendingCompanies.expiresAt, new Date()),
        sql`${pendingCompanies.status} NOT IN ('approved', 'rejected', 'expired')`
      ),
    })
    if (existingPending) {
      return NextResponse.json({ error: 'Business code is reserved by a pending company' }, { status: 400 })
    }

    // Validate tier exists and is not trial/free
    const tier = await db.query.pricingTiers.findFirst({
      where: and(
        eq(pricingTiers.id, tierId),
        eq(pricingTiers.isActive, true)
      ),
    })
    if (!tier) {
      return NextResponse.json({ error: 'Invalid pricing tier' }, { status: 400 })
    }
    if (tier.name === 'trial' || tier.name === 'free') {
      return NextResponse.json({ error: 'Cannot select trial or free tier for additional companies' }, { status: 400 })
    }

    // Get account for email
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Create pending company with 7-day expiration
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const [pending] = await db.insert(pendingCompanies).values({
      accountId: session.user.accountId,
      name: name.trim(),
      slug: slug.toLowerCase(),
      email: email?.trim() || account.email,
      phone: phone?.trim() || null,
      address: address?.trim() || null,
      businessType,
      country,
      dateFormat,
      timeFormat,
      tierId,
      billingCycle: billingCycle || 'monthly',
      status: 'pending_payment',
      expiresAt,
    }).returning()

    broadcastAccountChange(session.user.accountId!, 'account-site', 'created', pending.id)

    return NextResponse.json({
      id: pending.id,
      name: pending.name,
      slug: pending.slug,
      status: pending.status,
      expiresAt: pending.expiresAt,
    }, { status: 201 })
  } catch (error) {
    logError('api/account/pending-companies', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/account/pending-companies - Cancel a pending company
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, deletePendingCompanySchema)
    if (!parsed.success) return parsed.response
    const { pendingCompanyId } = parsed.data

    // Verify ownership
    const pending = await db.query.pendingCompanies.findFirst({
      where: and(
        eq(pendingCompanies.id, pendingCompanyId),
        eq(pendingCompanies.accountId, session.user.accountId)
      ),
    })

    if (!pending) {
      return NextResponse.json({ error: 'Pending company not found' }, { status: 404 })
    }

    if (pending.status === 'approved') {
      return NextResponse.json({ error: 'Cannot cancel an approved company' }, { status: 400 })
    }

    // Update status to expired (soft delete)
    await db.update(pendingCompanies)
      .set({
        status: 'expired',
        updatedAt: new Date(),
      })
      .where(eq(pendingCompanies.id, pendingCompanyId))

    broadcastAccountChange(session.user.accountId!, 'account-site', 'deleted', pendingCompanyId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/pending-companies', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
