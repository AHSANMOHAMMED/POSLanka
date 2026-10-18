import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, users, subscriptions } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import {
  DEFAULT_VENDOR_FEATURE_FLAGS,
  normalizeFeatureFlags,
  type FeatureFlagsMap,
} from '@/lib/features/flags'
import { setTenantFeatureFlags } from '@/lib/features/check'

export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase()

    const allTenants = await db.query.tenants.findMany({
      orderBy: [desc(tenants.createdAt)],
      columns: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        businessType: true,
        country: true,
        currency: true,
        status: true,
        plan: true,
        settings: true,
        createdAt: true,
        setupCompletedAt: true,
      },
    })

    const filtered = search
      ? allTenants.filter(
          (t) =>
            t.name.toLowerCase().includes(search) ||
            t.slug.toLowerCase().includes(search) ||
            t.email.toLowerCase().includes(search)
        )
      : allTenants

    const withMeta = await Promise.all(
      filtered.slice(0, 200).map(async (t) => {
        const [cashierCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.tenantId, t.id))

        const sub = await db.query.subscriptions.findFirst({
          where: eq(subscriptions.tenantId, t.id),
          columns: { status: true, currentPeriodEnd: true },
        })

        const settings = (t.settings || {}) as { featureFlags?: Partial<FeatureFlagsMap> }
        return {
          ...t,
          featureFlags: normalizeFeatureFlags(settings.featureFlags),
          userCount: cashierCount?.count ?? 0,
          subscriptionStatus: sub?.status ?? null,
        }
      })
    )

    return NextResponse.json({
      vendors: withMeta,
      defaults: DEFAULT_VENDOR_FEATURE_FLAGS,
    })
  } catch (error) {
    logError('api/sys-control/vendors', error)
    return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { tenantIds, featureFlags, applyDefaults } = body as {
      tenantIds?: string[]
      featureFlags?: Partial<FeatureFlagsMap>
      applyDefaults?: boolean
    }

    if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
      return NextResponse.json({ error: 'tenantIds required' }, { status: 400 })
    }

    const flags = applyDefaults
      ? DEFAULT_VENDOR_FEATURE_FLAGS
      : normalizeFeatureFlags(featureFlags)

    const results = []
    for (const tenantId of tenantIds.slice(0, 100)) {
      const next = await setTenantFeatureFlags(tenantId, flags)
      results.push({ tenantId, featureFlags: next })
    }

    return NextResponse.json({ updated: results.length, results })
  } catch (error) {
    logError('api/sys-control/vendors PATCH', error)
    return NextResponse.json({ error: 'Failed to update vendors' }, { status: 500 })
  }
}
