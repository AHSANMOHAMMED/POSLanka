import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { couponCodes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { validateCouponSchema } from '@/lib/validation/schemas/public'
import { consumeRateLimit, clientIp, rateLimitedResponse } from '@/lib/auth/rate-limit'

// Rate limiting for coupon validation: 5 per minute per IP (database-backed, shared by all instances)
const COUPON_VALIDATE_RATE_LIMIT = { maxAttempts: 5, windowMs: 60 * 1000, category: 'coupon_validate' }

// POST /api/public/coupons/validate - Validate a coupon code (public, no auth)
export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const limit = await consumeRateLimit(clientIp(request), COUPON_VALIDATE_RATE_LIMIT)
    if (limit.limited) return rateLimitedResponse(limit)

    const parsed = await validateBody(request, validateCouponSchema)
    if (!parsed.success) return parsed.response
    const { code, tierId, billingCycle } = parsed.data

    // Lookup coupon by code (case-insensitive)
    const coupon = await db.query.couponCodes.findFirst({
      where: eq(couponCodes.code, code.trim().toUpperCase()),
    })

    if (!coupon) {
      return NextResponse.json({ valid: false, message: 'Invalid coupon code' })
    }

    // Check if active
    if (!coupon.isActive) {
      return NextResponse.json({ valid: false, message: 'This coupon is no longer active' })
    }

    // Check date validity
    const currentDate = new Date()
    if (coupon.validFrom && currentDate < new Date(coupon.validFrom)) {
      return NextResponse.json({ valid: false, message: 'This coupon is not yet valid' })
    }
    if (coupon.validUntil && currentDate > new Date(coupon.validUntil)) {
      return NextResponse.json({ valid: false, message: 'This coupon has expired' })
    }

    // Check max uses
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return NextResponse.json({ valid: false, message: 'This coupon has reached its usage limit' })
    }

    // Check applicable tiers
    if (tierId && coupon.applicableTiers) {
      const tiers = coupon.applicableTiers as string[]
      if (Array.isArray(tiers) && tiers.length > 0 && !tiers.includes(tierId)) {
        return NextResponse.json({ valid: false, message: 'This coupon is not applicable to the selected plan' })
      }
    }

    // Check minimum billing cycle
    if (coupon.minBillingCycle && billingCycle) {
      const cycleOrder: Record<string, number> = { monthly: 1, annual: 2 }
      const requiredOrder = cycleOrder[coupon.minBillingCycle] || 0
      const providedOrder = cycleOrder[billingCycle] || 0
      if (providedOrder < requiredOrder) {
        return NextResponse.json({
          valid: false,
          message: `This coupon requires a minimum billing cycle of ${coupon.minBillingCycle}`,
        })
      }
    }

    return NextResponse.json({
      valid: true,
      discount: {
        type: coupon.discountType,
        value: coupon.discountValue,
      },
    })
  } catch (error) {
    logError('api/public/coupons/validate', error)
    return NextResponse.json({ error: 'Failed to validate coupon' }, { status: 500 })
  }
}
