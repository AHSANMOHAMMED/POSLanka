import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, pricingTiers, subscriptions, subscriptionStatusEnum, tenants, tenantUsage } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'
import { normalizeBusinessId } from '@/lib/tenant/business-id'

const blank = (v: unknown) => (v === '' || v === 'all' ? undefined : v)

const schema = z.object({
  status: z.preprocess(blank, z.enum(subscriptionStatusEnum.enumValues).optional()),
  tierId: z.preprocess(blank, z.string().uuid().optional()),
  q: z.preprocess(blank, z.string().trim().max(100).optional()),
  /** expiring = trial or period ends within 7 days */
  view: z.preprocess(blank, z.enum(['expiring']).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// GET /api/sys-control/subscriptions — paginated subscriptions with vendor, plan, billing account and storage usage
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const parsed = validateSearchParams(request, schema)
    if (!parsed.success) return parsed.response
    const { status, tierId, q, view, page, pageSize } = parsed.data

    const conds: SQL[] = []
    if (status) conds.push(eq(subscriptions.status, status))
    if (tierId) conds.push(eq(subscriptions.tierId, tierId))
    if (view === 'expiring') {
      conds.push(sql`coalesce(${subscriptions.trialEndsAt}, ${subscriptions.currentPeriodEnd}) between now() and now() + interval '7 days'`)
    }
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`
      const bid = normalizeBusinessId(q)
      conds.push(or(
        ...(bid ? [eq(tenants.businessId, bid)] : []),
        ilike(tenants.name, pattern),
        ilike(tenants.slug, pattern),
        ilike(accounts.email, pattern),
        ilike(accounts.fullName, pattern),
      )!)
    }
    const where = conds.length ? and(...conds) : undefined

    const [rows, [count], statusCounts, tiers] = await Promise.all([
      db.select({
        id: subscriptions.id,
        status: subscriptions.status,
        billingCycle: subscriptions.billingCycle,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        lastPaymentAt: subscriptions.lastPaymentAt,
        subscribedPriceMonthly: subscriptions.subscribedPriceMonthly,
        subscribedPriceYearly: subscriptions.subscribedPriceYearly,
        overrideDatabaseBytes: subscriptions.overrideDatabaseBytes,
        overrideFileStorageBytes: subscriptions.overrideFileStorageBytes,
        tenant: { id: tenants.id, name: tenants.name, slug: tenants.slug, businessId: tenants.businessId, status: tenants.status, lockedReason: tenants.lockedReason },
        tier: {
          id: pricingTiers.id, name: pricingTiers.name, displayName: pricingTiers.displayName,
          priceMonthly: pricingTiers.priceMonthly, priceYearly: pricingTiers.priceYearly,
          maxDatabaseBytes: pricingTiers.maxDatabaseBytes, maxFileStorageBytes: pricingTiers.maxFileStorageBytes,
        },
        billingAccount: { id: accounts.id, email: accounts.email, fullName: accounts.fullName },
        storageBytes: tenantUsage.storageBytes,
        fileStorageBytes: tenantUsage.fileStorageBytes,
      })
        .from(subscriptions)
        .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
        .innerJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
        .innerJoin(accounts, eq(accounts.id, subscriptions.billingAccountId))
        .leftJoin(tenantUsage, eq(tenantUsage.tenantId, subscriptions.tenantId))
        .where(where)
        .orderBy(
          // Soonest to lapse first, then newest
          sql`coalesce(${subscriptions.trialEndsAt}, ${subscriptions.currentPeriodEnd}) asc nulls last`,
          desc(subscriptions.createdAt),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(subscriptions)
        .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
        .innerJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
        .innerJoin(accounts, eq(accounts.id, subscriptions.billingAccountId))
        .where(where),
      db.select({ status: subscriptions.status, count: sql<number>`count(*)::int` }).from(subscriptions).groupBy(subscriptions.status),
      db.select({ id: pricingTiers.id, displayName: pricingTiers.displayName }).from(pricingTiers).orderBy(asc(pricingTiers.sortOrder)),
    ])

    return NextResponse.json({
      subscriptions: rows.map((r) => ({
        ...r,
        usage: { storageBytes: Number(r.storageBytes ?? 0), fileStorageBytes: Number(r.fileStorageBytes ?? 0) },
      })),
      pagination: { page, pageSize, total: count?.total ?? 0 },
      statusCounts: Object.fromEntries(statusCounts.map((c) => [c.status, c.count])),
      tiers,
    })
  } catch (error) {
    logError('api/sys-control/subscriptions', error)
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
  }
}
