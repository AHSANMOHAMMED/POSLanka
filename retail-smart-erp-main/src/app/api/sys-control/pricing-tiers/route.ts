import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pricingTiers, subscriptions } from '@/lib/db/schema'
import { asc, eq, count, sql } from 'drizzle-orm'
import { adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysCreatePricingTierSchema } from '@/lib/validation/schemas/sys-control'

// GET /api/sys-control/pricing-tiers - List all pricing tiers with subscriber counts
export async function GET() {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tiers = await db.query.pricingTiers.findMany({
      orderBy: [asc(pricingTiers.sortOrder)],
    })

    // Get subscriber counts per tier
    const subscriberCounts = await db
      .select({
        tierId: subscriptions.tierId,
        count: count(),
      })
      .from(subscriptions)
      .where(sql`${subscriptions.status} IN ('active', 'trial', 'locked')`)
      .groupBy(subscriptions.tierId)

    const countMap = new Map(subscriberCounts.map((sc) => [sc.tierId, sc.count]))

    const tiersWithCounts = tiers.map((tier) => ({
      ...tier,
      subscriberCount: countMap.get(tier.id) || 0,
    }))

    return NextResponse.json(tiersWithCounts)
  } catch (error) {
    logError('api/sys-control/pricing-tiers', error)
    return NextResponse.json({ error: 'Failed to fetch pricing tiers' }, { status: 500 })
  }
}

// POST /api/sys-control/pricing-tiers - Create new pricing tier
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/pricing-tiers', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysCreatePricingTierSchema)
    if (!parsed.success) return parsed.response
    const {
      name,
      displayName,
      priceMonthly,
      priceYearly,
      currency,
      maxUsers,
      maxSalesMonthly,
      maxDatabaseBytes,
      maxFileStorageBytes,
      features,
      sortOrder,
    } = parsed.data

    // Check if name already exists
    const existing = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.name, name),
    })
    if (existing) {
      return NextResponse.json({ error: 'A tier with this name already exists' }, { status: 400 })
    }

    const [tier] = await db.insert(pricingTiers)
      .values({
        name,
        displayName,
        priceMonthly: priceMonthly != null ? String(priceMonthly) : null,
        priceYearly: priceYearly != null ? String(priceYearly) : (priceMonthly != null ? String(priceMonthly * 10) : null),
        currency: currency || 'LKR',
        maxUsers: maxUsers || null,
        maxSalesMonthly: maxSalesMonthly || null,
        maxDatabaseBytes: maxDatabaseBytes || null,
        maxFileStorageBytes: maxFileStorageBytes || null,
        features: features || {},
        sortOrder: sortOrder || 0,
        isActive: true,
      })
      .returning()

    await adminAudit.create(session.superAdminId, 'pricing_tier', tier.id, {
      name,
      displayName,
      priceMonthly,
    })

    return NextResponse.json(tier, { status: 201 })
  } catch (error) {
    logError('api/sys-control/pricing-tiers', error)
    return NextResponse.json({ error: 'Failed to create pricing tier' }, { status: 500 })
  }
}
