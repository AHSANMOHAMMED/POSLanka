import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { tenantUsage, accountTenants, subscriptions, pricingTiers, tenants } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/account/usage - Get usage summary for all user's companies
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all tenant memberships for this account
    const memberships = await db.query.accountTenants.findMany({
      where: and(
        eq(accountTenants.accountId, session.user.accountId),
        eq(accountTenants.isActive, true)
      ),
    })

    if (memberships.length === 0) {
      return NextResponse.json({
        companies: [],
        totals: {
          companies: 0,
          records: 0,
          storageBytes: 0,
          fileStorageBytes: 0,
        },
      })
    }

    const tenantIds = memberships.map(m => m.tenantId)

    // Get all tenants
    const tenantList = await db.query.tenants.findMany({
      where: inArray(tenants.id, tenantIds),
    })

    // Get all usage data
    const usageList = await db.query.tenantUsage.findMany({
      where: inArray(tenantUsage.tenantId, tenantIds),
    })

    // Get all subscriptions with tiers
    const subscriptionList = await db
      .select({
        subscription: subscriptions,
        tier: pricingTiers,
      })
      .from(subscriptions)
      .leftJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
      .where(inArray(subscriptions.tenantId, tenantIds))

    // Build lookup maps
    const usageMap = new Map(usageList.map(u => [u.tenantId, u]))
    const subscriptionMap = new Map(subscriptionList.map(s => [s.subscription.tenantId, s]))
    const membershipMap = new Map(memberships.map(m => [m.tenantId, m]))

    // Calculate per-company usage
    const companies = tenantList.map(tenant => {
      const usage = usageMap.get(tenant.id)
      const sub = subscriptionMap.get(tenant.id)
      const membership = membershipMap.get(tenant.id)

      const totalRecords = usage ? (
        usage.usersCount +
        usage.customersCount +
        usage.vehiclesCount +
        usage.itemsCount +
        usage.categoriesCount +
        usage.serviceTypesCount +
        usage.suppliersCount +
        usage.salesCount +
        usage.saleItemsCount +
        usage.workOrdersCount +
        usage.workOrderServicesCount +
        usage.workOrderPartsCount +
        usage.appointmentsCount +
        usage.insuranceEstimatesCount +
        usage.purchasesCount +
        usage.purchaseOrdersCount +
        usage.stockTransfersCount
      ) : 0

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        businessType: tenant.businessType,
        status: tenant.status,
        role: membership?.role,
        isOwner: membership?.isOwner,
        subscription: sub ? {
          status: sub.subscription.status,
          tierName: sub.tier?.displayName || sub.tier?.name,
          trialEndsAt: sub.subscription.trialEndsAt,
          currentPeriodEnd: sub.subscription.currentPeriodEnd,
        } : null,
        usage: usage ? {
          users: usage.usersCount,
          customers: usage.customersCount,
          items: usage.itemsCount,
          sales: usage.salesCount,
          workOrders: usage.workOrdersCount,
          totalRecords,
          storageBytes: usage.storageBytes,
          fileStorageBytes: usage.fileStorageBytes,
          updatedAt: usage.updatedAt,
        } : null,
        limits: sub?.tier ? {
          maxUsers: sub.tier.maxUsers,
          maxSalesMonthly: sub.tier.maxSalesMonthly,
        } : null,
      }
    })

    // Calculate overall totals
    const totals = {
      companies: companies.length,
      records: companies.reduce((sum, c) => sum + (c.usage?.totalRecords || 0), 0),
      storageBytes: companies.reduce((sum, c) => sum + (c.usage?.storageBytes || 0), 0),
      fileStorageBytes: companies.reduce((sum, c) => sum + (c.usage?.fileStorageBytes || 0), 0),
    }

    return NextResponse.json({
      companies,
      totals,
    })
  } catch (error) {
    logError('api/account/usage', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
