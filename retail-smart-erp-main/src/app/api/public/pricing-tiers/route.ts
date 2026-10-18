import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pricingTiers } from '@/lib/db/schema'
import { asc, eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/public/pricing-tiers - Public endpoint, no auth required
// Returns active pricing tiers for display on landing page
export async function GET() {
  try {
    const tiers = await db.query.pricingTiers.findMany({
      where: eq(pricingTiers.isActive, true),
      orderBy: [asc(pricingTiers.sortOrder)],
    })

    const publicTiers = tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      displayName: tier.displayName,
      priceMonthly: tier.priceMonthly,
      priceYearly: tier.priceYearly,
      currency: tier.currency,
      maxDatabaseBytes: tier.maxDatabaseBytes,
      maxFileStorageBytes: tier.maxFileStorageBytes,
      features: tier.features,
      sortOrder: tier.sortOrder,
    }))

    return NextResponse.json(publicTiers, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    logError('api/public/pricing-tiers', error)
    return NextResponse.json({ error: 'Failed to fetch pricing tiers' }, { status: 500 })
  }
}
