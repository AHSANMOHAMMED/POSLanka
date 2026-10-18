import { NextResponse } from 'next/server'
import {
  getContactInfo,
  getVolumeDiscountTiers,
  getSeasonalOffer,
} from '@/lib/billing/settings'

// GET /api/public/settings - Unauthenticated public settings
export async function GET() {
  try {
    const [contactInfo, volumeDiscounts, seasonalOffer] = await Promise.all([
      getContactInfo(),
      getVolumeDiscountTiers(),
      getSeasonalOffer(),
    ])

    return NextResponse.json(
      {
        contactInfo,
        volumeDiscounts,
        seasonalOffer: seasonalOffer.enabled ? seasonalOffer : null,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    )
  } catch {
    return NextResponse.json(
      { contactInfo: null, volumeDiscounts: null, seasonalOffer: null },
      { status: 500 }
    )
  }
}
