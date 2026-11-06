import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, logAdminAction, validateAdminSession } from '@/lib/admin'
import { validateBody } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { applyBusinessTypeFeatures, isBusinessType, resetTypePreset } from '@/lib/admin/business-type-features'
import { FEATURE_FLAGS } from '@/lib/features/flags'

const flagKey = z.enum(FEATURE_FLAGS)

const applySchema = z.object({
  /** { loyalty: false, gift_cards: true } */
  changes: z.partialRecord(flagKey, z.boolean()).refine((c) => Object.keys(c).length > 0, 'Choose at least one switch'),
  /** Change the vendors of this type now (default true) */
  applyToExisting: z.boolean().optional(),
  /** Change what new vendors of this type start with (default true) */
  applyToNew: z.boolean().optional(),
  /** Only these vendors (must be of this type); omitted = all of them */
  tenantIds: z.array(z.string().uuid()).max(2000).optional(),
})

/**
 * PUT /api/sys-control/business-types/[type]/features — turn switches on / off for every vendor of
 * the business type and/or for new vendors of that type. Audited.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const { type } = await params
    if (!isBusinessType(type)) return NextResponse.json({ error: 'Unknown business type' }, { status: 404 })
    const parsed = await validateBody(request, applySchema)
    if (!parsed.success) return parsed.response
    const applyToExisting = parsed.data.applyToExisting ?? true
    const applyToNew = parsed.data.applyToNew ?? true
    if (!applyToExisting && !applyToNew) {
      return NextResponse.json({ error: 'Choose existing vendors, new vendors, or both' }, { status: 400 })
    }
    const result = await applyBusinessTypeFeatures(type, {
      changes: parsed.data.changes,
      applyToExisting,
      applyToNew,
      tenantIds: parsed.data.tenantIds,
    })
    // resource_id is a uuid column: the business type goes in the details
    await logAdminAction({ accountId: session.superAdminId, action: 'update', resource: 'business_type_features', details: {
      businessType: type,
      changes: result.changes,
      applyToExisting,
      applyToNew,
      updatedTenants: result.updatedTenants,
      tenantIds: parsed.data.tenantIds?.length ? result.updatedTenantIds : undefined,
    } })
    return NextResponse.json(result)
  } catch (error) {
    logError('api/sys-control/business-types/[type]/features PUT', error)
    return NextResponse.json({ error: 'Failed to update features' }, { status: 500 })
  }
}

/** DELETE — put the "new vendors start with" preset of this type back to the built-in default. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const { type } = await params
    if (!isBusinessType(type)) return NextResponse.json({ error: 'Unknown business type' }, { status: 404 })
    const result = await resetTypePreset(type)
    await logAdminAction({ accountId: session.superAdminId, action: 'update', resource: 'business_type_preset', details: { businessType: type, reset: true } })
    return NextResponse.json(result)
  } catch (error) {
    logError('api/sys-control/business-types/[type]/features DELETE', error)
    return NextResponse.json({ error: 'Failed to reset preset' }, { status: 500 })
  }
}
