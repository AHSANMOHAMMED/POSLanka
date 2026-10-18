import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { accountTenants, tenants, subscriptions, pricingTiers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

/**
 * GET /api/my-companies
 *
 * Lightweight endpoint for CompanySwitcher that uses the **company** auth session
 * (not account auth). This works on tenant subdomains where only the company-session
 * cookie exists.
 *
 * Returns minimal data needed for company switching.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const memberships = await db
      .select({
        membership: {
          role: accountTenants.role,
          isOwner: accountTenants.isOwner,
        },
        tenant: {
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          businessType: tenants.businessType,
          status: tenants.status,
        },
        subscription: {
          status: subscriptions.status,
        },
        tier: {
          name: pricingTiers.name,
        },
      })
      .from(accountTenants)
      .innerJoin(tenants, eq(accountTenants.tenantId, tenants.id))
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .leftJoin(pricingTiers, eq(subscriptions.tierId, pricingTiers.id))
      .where(
        and(
          eq(accountTenants.accountId, session.user.accountId),
          eq(accountTenants.isActive, true)
        )
      )

    const companies = memberships.map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      businessType: m.tenant.businessType,
      status: m.tenant.status,
      role: m.membership.role,
      isOwner: m.membership.isOwner,
      subscription: m.subscription
        ? {
            status: m.subscription.status,
            tierName: m.tier?.name || 'Free',
          }
        : null,
    }))

    return NextResponse.json(companies)
  } catch (error) {
    console.error('Error fetching user companies:', error)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}
