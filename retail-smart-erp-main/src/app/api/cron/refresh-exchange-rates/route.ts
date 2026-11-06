import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/notifications/cron-auth'
import { db } from '@/lib/db'
import { exchangeRateCache } from '@/lib/db/schema'
import { lt } from 'drizzle-orm'
import { fetchExchangeRates } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'

// POST /api/cron/refresh-exchange-rates - Daily exchange rate refresh
export async function POST(request: NextRequest) {
  try {
    const denied = requireCronSecret(request)
    if (denied) return denied

    const now = new Date()

    // Clean up expired entries
    await db.delete(exchangeRateCache).where(lt(exchangeRateCache.expiresAt, now))

    // Fetch fresh rates
    const rates = await fetchExchangeRates()
    if (!rates) {
      return NextResponse.json({ error: 'Failed to fetch rates from all APIs' }, { status: 502 })
    }

    // Store with 24h expiry
    const expiresAt = new Date(now)
    expiresAt.setHours(expiresAt.getHours() + 24)

    await db.insert(exchangeRateCache).values({
      baseCurrency: rates.base,
      rates: rates.rates,
      source: rates.source || 'api',
      fetchedAt: now,
      expiresAt,
    })

    return NextResponse.json({
      success: true,
      source: rates.source,
      currencyCount: Object.keys(rates.rates).length,
      refreshedAt: now.toISOString(),
    })
  } catch (error) {
    logError('api/cron/refresh-exchange-rates', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
