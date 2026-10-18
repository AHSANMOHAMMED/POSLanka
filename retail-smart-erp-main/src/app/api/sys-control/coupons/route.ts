import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { couponCodes } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysCreateCouponSchema } from '@/lib/validation/schemas/sys-control'

// GET /api/sys-control/coupons - List all coupon codes
export async function GET() {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const coupons = await db.query.couponCodes.findMany({
      orderBy: [desc(couponCodes.createdAt)],
    })

    return NextResponse.json(coupons)
  } catch (error) {
    logError('api/sys-control/coupons', error)
    return NextResponse.json({ error: 'Failed to fetch coupons' }, { status: 500 })
  }
}

// POST /api/sys-control/coupons - Create a new coupon code
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/coupons', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysCreateCouponSchema)
    if (!parsed.success) return parsed.response
    const {
      code,
      description,
      discountType,
      discountValue,
      applicableTiers,
      minBillingCycle,
      maxUses,
      maxUsesPerAccount,
      validFrom,
      validUntil,
      isActive,
    } = parsed.data

    // Check if code already exists
    const existing = await db.query.couponCodes.findFirst({
      where: eq(couponCodes.code, code.trim().toUpperCase()),
    })
    if (existing) {
      return NextResponse.json({ error: 'A coupon with this code already exists' }, { status: 400 })
    }

    const [coupon] = await db.insert(couponCodes)
      .values({
        code: code.trim().toUpperCase(),
        description: description || null,
        discountType: discountType || 'percentage',
        discountValue: String(discountValue || '0'),
        applicableTiers: applicableTiers || null,
        minBillingCycle: minBillingCycle || null,
        maxUses: maxUses || null,
        maxUsesPerAccount: maxUsesPerAccount ?? 1,
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        isActive: isActive ?? true,
      })
      .returning()

    await adminAudit.create(session.superAdminId, 'coupon', coupon.id, {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    })

    return NextResponse.json(coupon, { status: 201 })
  } catch (error) {
    logError('api/sys-control/coupons', error)
    return NextResponse.json({ error: 'Failed to create coupon' }, { status: 500 })
  }
}
