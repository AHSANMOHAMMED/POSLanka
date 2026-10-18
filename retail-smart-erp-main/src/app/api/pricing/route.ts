import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pricingTiers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { convertCurrencyAmount } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'

// GET /api/pricing?currency=USD - Get pricing tiers with optional currency conversion
export async function GET(request: NextRequest) {
  try {
    const targetCurrency = request.nextUrl.searchParams.get('currency') || 'LKR'

    const tiers = await db.query.pricingTiers.findMany({
      where: eq(pricingTiers.isActive, true),
      orderBy: (t, { asc }) => [asc(t.sortOrder)],
    })

    const tiersWithConversion = await Promise.all(
      tiers.map(async (tier) => {
        const priceMonthly = Number(tier.priceMonthly)
        const priceYearly = Number(tier.priceYearly)

        let convertedMonthly = priceMonthly
        let convertedYearly = priceYearly

        if (targetCurrency !== 'LKR' && priceMonthly > 0) {
          const cm = await convertCurrencyAmount(priceMonthly, 'LKR', targetCurrency)
          if (cm !== null) convertedMonthly = cm

          const cy = await convertCurrencyAmount(priceYearly, 'LKR', targetCurrency)
          if (cy !== null) convertedYearly = cy
        }

        return {
          id: tier.id,
          name: tier.name,
          displayName: tier.displayName,
          priceLKR: {
            monthly: priceMonthly,
            yearly: priceYearly,
          },
          priceConverted: {
            monthly: convertedMonthly,
            yearly: convertedYearly,
            currency: targetCurrency,
          },
          maxDatabaseBytes: tier.maxDatabaseBytes,
          maxFileStorageBytes: tier.maxFileStorageBytes,
          features: tier.features,
        }
      })
    )

    return NextResponse.json({
      tiers: tiersWithConversion,
      baseCurrency: 'LKR',
      displayCurrency: targetCurrency,
    })
  } catch (error) {
    logError('api/pricing', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
