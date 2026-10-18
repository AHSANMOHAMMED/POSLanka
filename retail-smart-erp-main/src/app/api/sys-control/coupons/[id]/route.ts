import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { couponCodes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysUpdateCouponSchema } from '@/lib/validation/schemas/sys-control'
import { idParamSchema } from '@/lib/validation/schemas/common'

// PUT /api/sys-control/coupons/[id] - Update coupon
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/coupons', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, sysUpdateCouponSchema)
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

    const existing = await db.query.couponCodes.findFirst({
      where: eq(couponCodes.id, id),
    })

    if (!existing) {
      return NextResponse.json({ error: 'Coupon not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}

    if (code !== undefined) updateData.code = code.trim().toUpperCase()
    if (description !== undefined) updateData.description = description
    if (discountType !== undefined) updateData.discountType = discountType
    if (discountValue !== undefined) updateData.discountValue = String(discountValue)
    if (applicableTiers !== undefined) updateData.applicableTiers = applicableTiers
    if (minBillingCycle !== undefined) updateData.minBillingCycle = minBillingCycle
    if (maxUses !== undefined) updateData.maxUses = maxUses
    if (maxUsesPerAccount !== undefined) updateData.maxUsesPerAccount = maxUsesPerAccount
    if (validFrom !== undefined) updateData.validFrom = validFrom ? new Date(validFrom) : null
    if (validUntil !== undefined) updateData.validUntil = validUntil ? new Date(validUntil) : null
    if (isActive !== undefined) updateData.isActive = isActive

    updateData.updatedAt = new Date()

    const [coupon] = await db.update(couponCodes)
      .set(updateData)
      .where(eq(couponCodes.id, id))
      .returning()

    await adminAudit.update(session.superAdminId, 'coupon', id, {
      code: existing.code,
      changes: Object.keys(updateData).filter(k => k !== 'updatedAt'),
    })

    return NextResponse.json(coupon)
  } catch (error) {
    logError('api/sys-control/coupons/[id]', error)
    return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 })
  }
}

// DELETE /api/sys-control/coupons/[id] - Delete coupon
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/coupons', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const existing = await db.query.couponCodes.findFirst({
      where: eq(couponCodes.id, id),
    })

    if (!existing) {
      return NextResponse.json({ error: 'Coupon not found' }, { status: 404 })
    }

    await db.delete(couponCodes)
      .where(eq(couponCodes.id, id))

    await adminAudit.delete(session.superAdminId, 'coupon', id, {
      code: existing.code,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/coupons/[id]', error)
    return NextResponse.json({ error: 'Failed to delete coupon' }, { status: 500 })
  }
}
