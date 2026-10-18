import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { subscriptions, tenants, pricingTiers, tenantUsage } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSubscriptionSchema } from '@/lib/validation/schemas/account'
import { z } from 'zod'

// NOTE: Tier changes (upgrades/downgrades) must go through the /upgrade endpoint
// which handles proration. This PUT endpoint only handles cancellation toggling.

// GET /api/account/subscriptions/[tenantId] - Get subscription details
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ tenantId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { tenantId } = paramsParsed.data

    // Verify user is the primary owner or billing account
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { id: true, primaryOwnerId: true },
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const isOwner = tenant.primaryOwnerId === session.user.accountId

    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
    })

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    // Only billing account or owner can view subscription
    const isBillingAccount = subscription.billingAccountId === session.user.accountId

    if (!isBillingAccount && !isOwner) {
      return NextResponse.json({ error: 'Not authorized to view subscription' }, { status: 403 })
    }

    // Get tier details
    const tier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, subscription.tierId),
    })

    // Get all available tiers
    const availableTiers = await db.query.pricingTiers.findMany({
      where: eq(pricingTiers.isActive, true),
      orderBy: (t, { asc }) => [asc(t.sortOrder)],
    })

    // Get storage usage
    const usage = await db.query.tenantUsage.findFirst({
      where: eq(tenantUsage.tenantId, tenantId),
    })

    return NextResponse.json({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      currentTier: tier ? {
        id: tier.id,
        name: tier.name,
        displayName: tier.displayName,
        priceMonthly: tier.priceMonthly,
        priceYearly: tier.priceYearly,
        maxUsers: tier.maxUsers,
        maxSalesMonthly: tier.maxSalesMonthly,
        maxDatabaseBytes: tier.maxDatabaseBytes,
        maxFileStorageBytes: tier.maxFileStorageBytes,
        features: tier.features,
      } : null,
      availableTiers: availableTiers.map(t => ({
        id: t.id,
        name: t.name,
        displayName: t.displayName,
        priceMonthly: t.priceMonthly,
        priceYearly: t.priceYearly,
        maxUsers: t.maxUsers,
        maxSalesMonthly: t.maxSalesMonthly,
        maxDatabaseBytes: t.maxDatabaseBytes,
        maxFileStorageBytes: t.maxFileStorageBytes,
        features: t.features,
      })),
      usage: usage ? {
        databaseBytes: usage.storageBytes || 0,
        fileStorageBytes: usage.fileStorageBytes || 0,
      } : null,
      canManage: isBillingAccount,
    })
  } catch (error) {
    logError('api/account/subscriptions/[tenantId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/account/subscriptions/[tenantId] - Update subscription (change tier)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ tenantId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { tenantId } = paramsParsed.data
    const parsed = await validateBody(request, updateSubscriptionSchema)
    if (!parsed.success) return parsed.response
    const { cancelAtPeriodEnd, tierId } = parsed.data

    // Tier changes (tierId) must go through POST /upgrade endpoint for proper proration.
    // This endpoint only handles cancellation toggling.
    if (tierId) {
      return NextResponse.json(
        { error: 'Tier changes must use the /upgrade endpoint for proper proration billing' },
        { status: 400 }
      )
    }

    // Verify user is the billing account
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
    })

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    if (subscription.billingAccountId !== session.user.accountId) {
      return NextResponse.json({ error: 'Not authorized to manage subscription' }, { status: 403 })
    }

    const [updated] = await db.update(subscriptions)
      .set({
        cancelAtPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id))
      .returning()

    broadcastAccountChange(session.user.accountId, 'account-subscription', 'updated', updated.id)

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      tierId: updated.tierId,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
    })
  } catch (error) {
    logError('api/account/subscriptions/[tenantId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
