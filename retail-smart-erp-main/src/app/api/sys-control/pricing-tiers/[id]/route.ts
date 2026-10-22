import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pricingTiers, subscriptions } from '@/lib/db/schema'
import { eq, and, ne, sql } from 'drizzle-orm'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
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

    const session = await validateAdminSession('billing')
    if (!session) {
      return adminAuthError()
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

    const priceChanged =
      (priceMonthly !== undefined && Number(priceMonthly) !== Number(existing.priceMonthly)) ||
      (priceYearly !== undefined && Number(priceYearly) !== Number(existing.priceYearly))

    const { tier, grandfatheredCount } = await db.transaction(async (tx) => {
      let grandfathered = 0
      if (priceChanged) {
        // Existing subscribers keep what they signed up for: anyone without a locked-in price
        // is pinned to the tier's current price before it changes. Their period is untouched;
        // the new price applies to new sign-ups and plan changes only.
        const pinned = await tx.update(subscriptions)
          .set({
            subscribedPriceMonthly: sql`coalesce(${subscriptions.subscribedPriceMonthly}, ${existing.priceMonthly})`,
            subscribedPriceYearly: sql`coalesce(${subscriptions.subscribedPriceYearly}, ${existing.priceYearly})`,
            priceLockedAt: sql`coalesce(${subscriptions.priceLockedAt}, now())`,
          })
          .where(and(eq(subscriptions.tierId, id), ne(subscriptions.status, 'cancelled')))
          .returning({ id: subscriptions.id })
        grandfathered = pinned.length
      }
      const [updated] = await tx.update(pricingTiers)
        .set(updateData)
        .where(eq(pricingTiers.id, id))
        .returning()
      return { tier: updated, grandfatheredCount: grandfathered }
    })

    await adminAudit.update(session.superAdminId, 'pricing_tier', id, {
      name: existing.name,
      changes: Object.keys(updateData),
      before: { priceMonthly: existing.priceMonthly, priceYearly: existing.priceYearly },
      after: { priceMonthly: tier.priceMonthly, priceYearly: tier.priceYearly },
      grandfatheredSubscribers: grandfatheredCount,
    })

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

    const session = await validateAdminSession('billing')
    if (!session) {
      return adminAuthError()
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
