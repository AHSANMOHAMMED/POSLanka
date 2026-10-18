import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { couponCodes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { validateCouponSchema } from '@/lib/validation/schemas/public'

// Rate limiting for coupon validation
const couponValidateAttempts = new Map<string, { count: number; resetAt: number }>()
const COUPON_VALIDATE_LIMIT = 5 // max attempts
const COUPON_VALIDATE_WINDOW = 60 * 1000 // 1 minute
let couponLastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// POST /api/public/coupons/validate - Validate a coupon code (public, no auth)
export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const now = Date.now()

    // Periodically clean expired entries to prevent memory leaks
    if (now - couponLastCleanup > CLEANUP_INTERVAL) {
      couponLastCleanup = now
      for (const [key, entry] of couponValidateAttempts) {
        if (now > entry.resetAt) couponValidateAttempts.delete(key)
      }
    }

    const attempts = couponValidateAttempts.get(ip)
    if (attempts) {
      if (now < attempts.resetAt) {
        if (attempts.count >= COUPON_VALIDATE_LIMIT) {
          return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
        }
        attempts.count++
      } else {
        couponValidateAttempts.set(ip, { count: 1, resetAt: now + COUPON_VALIDATE_WINDOW })
      }
    } else {
      couponValidateAttempts.set(ip, { count: 1, resetAt: now + COUPON_VALIDATE_WINDOW })
    }

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
