import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, users, subscriptions, warehouses, posProfiles } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { normalizeFeatureFlags, type FeatureFlagsMap } from '@/lib/features/flags'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const vendor = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    // Cashier users count
    const [cashierCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.tenantId, vendor.id))

    // Subscription
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, vendor.id),
    })

    // Branches / Warehouses
    const vendorBranches = await db.query.warehouses.findMany({
      where: eq(warehouses.tenantId, vendor.id),
      limit: 10,
    })

    // Counters / POS Profiles
    const vendorCounters = await db.query.posProfiles.findMany({
      where: eq(posProfiles.tenantId, vendor.id),
      limit: 20,
    })

    const settings = (vendor.settings || {}) as Record<string, unknown>
    const flags = normalizeFeatureFlags(settings.featureFlags as Partial<FeatureFlagsMap>)

    return NextResponse.json({
      vendor: {
        ...vendor,
        featureFlags: flags,
        userCount: cashierCount?.count ?? 0,
        subscription: sub || null,
        branches: vendorBranches || [],
        counters: vendorCounters || [],
      },
    })
  } catch (error) {
    logError('api/sys-control/vendors/[id] GET', error)
    return NextResponse.json({ error: 'Failed to fetch vendor' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { status, plan, settings } = body

    const updateData: Record<string, unknown> = {}
    if (status) updateData.status = status
    if (plan) updateData.plan = plan
    if (settings) updateData.settings = settings

    const [updated] = await db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning()

    return NextResponse.json({ success: true, vendor: updated })
  } catch (error) {
    logError('api/sys-control/vendors/[id] PUT', error)
    return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
  }
}
