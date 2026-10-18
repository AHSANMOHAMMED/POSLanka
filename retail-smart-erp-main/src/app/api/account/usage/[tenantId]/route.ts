import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { tenantUsage, subscriptions, pricingTiers, tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

// GET /api/account/usage/[tenantId] - Get storage usage for a tenant
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

    // Get tenant info and verify ownership
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    if (tenant.primaryOwnerId !== session.user.accountId) {
      return NextResponse.json({ error: 'Not authorized to view this company' }, { status: 403 })
    }

    // Get usage data
    const usage = await db.query.tenantUsage.findFirst({
      where: eq(tenantUsage.tenantId, tenantId),
    })

    // Get subscription and tier for limits
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
    })

    let tier = null
    if (subscription?.tierId) {
      tier = await db.query.pricingTiers.findFirst({
        where: eq(pricingTiers.id, subscription.tierId),
      })
    }

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        businessType: tenant.businessType,
      },
      usage: usage ? {
        databaseBytes: usage.storageBytes || 0,
        fileStorageBytes: usage.fileStorageBytes || 0,
        updatedAt: usage.updatedAt,
      } : null,
      totals: {
        storageBytes: usage?.storageBytes || 0,
        fileStorageBytes: usage?.fileStorageBytes || 0,
      },
      subscription: subscription ? {
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
      } : null,
      tier: tier ? {
        id: tier.id,
        name: tier.name,
        displayName: tier.displayName,
      } : null,
      limits: {
        maxStorageBytes: tier?.maxDatabaseBytes || null,
        maxFileStorageBytes: tier?.maxFileStorageBytes || null,
      },
      canManage: tenant.primaryOwnerId === session.user.accountId || subscription?.billingAccountId === session.user.accountId,
    })
  } catch (error) {
    logError('api/account/usage/[tenantId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
