import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { exchangeRateCache } from '@/lib/db/schema'
import { gt } from 'drizzle-orm'
import { fetchExchangeRates } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'

// GET /api/exchange-rates - Get current exchange rates (cached)
export async function GET() {
  try {
    const now = new Date()

    // Check database cache first
    const cached = await db.query.exchangeRateCache.findFirst({
      where: gt(exchangeRateCache.expiresAt, now),
      orderBy: (cache, { desc }) => [desc(cache.fetchedAt)],
    })

    if (cached) {
      return NextResponse.json({
        base: cached.baseCurrency,
        rates: cached.rates,
        source: cached.source,
        fetchedAt: cached.fetchedAt,
        cached: true,
      })
    }

    // Fetch fresh rates
    const rates = await fetchExchangeRates()
    if (!rates) {
      return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 502 })
    }

    // Store in cache (expires in 24 hours)
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
      base: rates.base,
      rates: rates.rates,
      source: rates.source,
      fetchedAt: now,
      cached: false,
    })
  } catch (error) {
    logError('api/exchange-rates', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
