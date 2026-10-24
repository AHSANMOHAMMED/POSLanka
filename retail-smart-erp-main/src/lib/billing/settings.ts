import { db } from '@/lib/db'
import { systemSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { invalidate, registerCache } from '@/lib/cache/invalidation'

// In-memory cache with 5-minute TTL (dropped on every instance when a setting changes)
const cache = new Map<string, { value: unknown; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
registerCache('billing-settings', (key) => { if (key) cache.delete(key); else cache.clear() })

async function getCachedSetting<T>(key: string, fallback: T): Promise<T> {
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T
  }

  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, key),
    })

    const value = (setting?.value as T) ?? fallback
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL })
    return value
  } catch {
    return fallback
  }
}

export function invalidateSettingsCache(key?: string) {
  invalidate('billing-settings', key ?? null)
}

// --- Volume Discount Tiers ---

export interface VolumeTier {
  min: number
  max: number | null
  percent: number
}

const DEFAULT_VOLUME_TIERS: VolumeTier[] = [
  { min: 2, max: 5, percent: 15 },
  { min: 6, max: 10, percent: 25 },
  { min: 11, max: null, percent: 30 },
]

export async function getVolumeDiscountTiers(): Promise<VolumeTier[]> {
  const config = await getCachedSetting<{ tiers?: VolumeTier[] }>('volume_discounts', {})
  return config.tiers ?? DEFAULT_VOLUME_TIERS
}

export async function getVolumeDiscountPercentAsync(companyCount: number): Promise<number> {
  const tiers = await getVolumeDiscountTiers()
  // Sort descending by min so we match the highest applicable tier
  const sorted = [...tiers].sort((a, b) => b.min - a.min)
  for (const tier of sorted) {
    if (companyCount >= tier.min) {
      if (tier.max === null || companyCount <= tier.max) {
        return tier.percent
      }
      // If companyCount exceeds max, it may still match a higher tier
      if (tier.max !== null && companyCount > tier.max) {
        continue
      }
    }
  }
  return 0
}

// --- Contact Info ---

export interface ContactInfo {
  email: string
  phone: string
  whatsapp: string
  address: string
  companyName: string
  businessHours: string
}

const DEFAULT_CONTACT_INFO: ContactInfo = {
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@poslanka.lk',
  phone: '+94 11 234 5678',
  whatsapp: '+94 77 123 4567',
  address: 'Colombo, Sri Lanka',
  companyName: process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS',
  businessHours: 'Mon-Fri 9:00 AM - 6:00 PM (Asia/Colombo)',
}

export async function getContactInfo(): Promise<ContactInfo> {
  return getCachedSetting<ContactInfo>('contact_info', DEFAULT_CONTACT_INFO)
}

// --- Seasonal Offer ---

export interface SeasonalOffer {
  enabled: boolean
  title: string
  description: string
  discountPercent: number
  validUntil: string
  badgeText: string
  applicableTiers: string[]
  showOnLanding: boolean
  showOnPricing: boolean
}

const DEFAULT_SEASONAL_OFFER: SeasonalOffer = {
  enabled: false,
  title: '',
  description: '',
  discountPercent: 0,
  validUntil: '',
  badgeText: '',
  applicableTiers: [],
  showOnLanding: false,
  showOnPricing: false,
}

export async function getSeasonalOffer(): Promise<SeasonalOffer> {
  return getCachedSetting<SeasonalOffer>('seasonal_offer', DEFAULT_SEASONAL_OFFER)
}
