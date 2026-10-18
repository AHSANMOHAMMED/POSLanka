import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pricingTiers, subscriptions } from '@/lib/db/schema'
import { eq, and, ne, sql } from 'drizzle-orm'
import { adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysUpdatePricingTierSchema } from '@/lib/validation/schemas/sys-control'
import { idParamSchema } from '@/lib/validation/schemas/common'

// PUT /api/sys-control/pricing-tiers/[id] - Update pricing tier
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/pricing-tiers', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, sysUpdatePricingTierSchema)
    if (!parsed.success) return parsed.response
    const {
      displayName,
      priceMonthly,
      priceYearly,
      currency,
      maxUsers,
      maxSalesMonthly,
      maxDatabaseBytes,
      maxFileStorageBytes,
      features,
      sortOrder,
      isActive,
    } = parsed.data

    const existing = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, id),
    })

    if (!existing) {
      return NextResponse.json({ error: 'Pricing tier not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}

    if (displayName !== undefined) updateData.displayName = displayName
    if (priceMonthly !== undefined) updateData.priceMonthly = priceMonthly != null ? String(priceMonthly) : null
    if (priceYearly !== undefined) updateData.priceYearly = priceYearly != null ? String(priceYearly) : null
    if (currency !== undefined) updateData.currency = currency
    if (maxUsers !== undefined) updateData.maxUsers = maxUsers
    if (maxSalesMonthly !== undefined) updateData.maxSalesMonthly = maxSalesMonthly
    if (maxDatabaseBytes !== undefined) updateData.maxDatabaseBytes = maxDatabaseBytes
    if (maxFileStorageBytes !== undefined) updateData.maxFileStorageBytes = maxFileStorageBytes
    if (features !== undefined) updateData.features = features
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder
    if (isActive !== undefined) updateData.isActive = isActive

    const [tier] = await db.update(pricingTiers)
      .set(updateData)
      .where(eq(pricingTiers.id, id))
      .returning()

    await adminAudit.update(session.superAdminId, 'pricing_tier', id, {
      name: existing.name,
      changes: Object.keys(updateData),
    })

    // If price changed, count how many active subscribers will be grandfathered
    let grandfatheredCount = 0
    if (priceMonthly !== undefined && String(priceMonthly) !== existing.priceMonthly) {
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tierId, id),
            ne(subscriptions.status, 'cancelled')
          )
        )
      grandfatheredCount = result[0]?.count || 0
    }

    return NextResponse.json({ ...tier, grandfatheredCount })
  } catch (error) {
    logError('api/sys-control/pricing-tiers/[id]', error)
    return NextResponse.json({ error: 'Failed to update pricing tier' }, { status: 500 })
  }
}

// DELETE /api/sys-control/pricing-tiers/[id] - Delete pricing tier (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/pricing-tiers', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const existing = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, id),
    })

    if (!existing) {
      return NextResponse.json({ error: 'Pricing tier not found' }, { status: 404 })
    }

    // Soft delete - just deactivate
    await db.update(pricingTiers)
      .set({ isActive: false })
      .where(eq(pricingTiers.id, id))

    await adminAudit.delete(session.superAdminId, 'pricing_tier', id, {
      name: existing.name,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/pricing-tiers/[id]', error)
    return NextResponse.json({ error: 'Failed to delete pricing tier' }, { status: 500 })
  }
}
