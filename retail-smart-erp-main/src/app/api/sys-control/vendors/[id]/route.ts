import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  tenants,
  users,
  subscriptions,
  warehouses,
  posProfiles,
  tenantStatusEnum,
  planEnum,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { validateAdminSession, adminAudit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
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

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const vendor = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const [[cashierCount], sub, vendorBranches, vendorCounters] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.tenantId, vendor.id)),
      db.query.subscriptions.findFirst({
        where: eq(subscriptions.tenantId, vendor.id),
        with: { tier: { columns: { id: true, name: true, priceMonthly: true, priceYearly: true } } },
      }),
      db.query.warehouses.findMany({
        where: eq(warehouses.tenantId, vendor.id),
        limit: 50,
      }),
      db.query.posProfiles.findMany({
        where: eq(posProfiles.tenantId, vendor.id),
        limit: 50,
      }),
    ])

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

const limitValueSchema = z.union([z.number(), z.string().max(100), z.boolean()])

const updateVendorSchema = z
  .object({
    status: z.enum(tenantStatusEnum.enumValues).optional(),
    plan: z.enum(planEnum.enumValues).optional(),
    settings: z
      .object({
        featureFlags: z.record(z.string(), z.boolean()).optional(),
        limits: z.record(z.string().max(50), limitValueSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (d) => d.status !== undefined || d.plan !== undefined || d.settings !== undefined,
    { message: 'Nothing to update' }
  )

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = await validateBody(request, updateVendorSchema)
    if (!parsed.success) return parsed.response
    const { status, plan, settings } = parsed.data

    const current = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
      columns: { id: true, status: true, plan: true, settings: true, lockedAt: true, lockedReason: true },
    })
    if (!current) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const currentSettings = (current.settings || {}) as Record<string, unknown>
    const currentFlags = (currentSettings.featureFlags || {}) as Partial<FeatureFlagsMap>
    const currentLimits = (currentSettings.limits || {}) as Record<string, unknown>

    const updateData: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}

    if (status !== undefined && status !== current.status) {
      updateData.status = status
      before.status = current.status
      after.status = status
      if (status === 'locked') {
        updateData.lockedAt = new Date()
        updateData.lockedReason = 'admin_locked'
      } else if (current.status === 'locked') {
        updateData.lockedAt = null
        updateData.lockedReason = null
      }
    }

    if (plan !== undefined && plan !== current.plan) {
      updateData.plan = plan
      before.plan = current.plan
      after.plan = plan
    }

    if (settings) {
      // Only featureFlags and limits may be merged; the rest of settings is preserved as-is.
      const nextSettings: Record<string, unknown> = { ...currentSettings }
      if (settings.featureFlags) {
        const mergedFlags = normalizeFeatureFlags({ ...currentFlags, ...settings.featureFlags } as Partial<FeatureFlagsMap>)
        nextSettings.featureFlags = mergedFlags
        before.featureFlags = normalizeFeatureFlags(currentFlags)
        after.featureFlags = mergedFlags
      }
      if (settings.limits) {
        const mergedLimits = { ...currentLimits, ...settings.limits }
        nextSettings.limits = mergedLimits
        before.limits = currentLimits
        after.limits = mergedLimits
      }
      updateData.settings = nextSettings
    }

    const [updated] = await db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning()

    await adminAudit.update(session.superAdminId, 'tenant', id, { before, after })

    return NextResponse.json({ success: true, vendor: updated })
  } catch (error) {
    logError('api/sys-control/vendors/[id] PUT', error)
    return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
  }
}
