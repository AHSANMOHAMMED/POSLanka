import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, validateAdminSession, adminAudit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { businessTypeEnum } from '@/lib/db/schema'
import { changeTenantBusinessType, validateTypeChange } from '@/lib/business-types/change-type'
import { broadcastChange } from '@/lib/websocket/broadcast'

const bodySchema = z.object({
  businessType: z.string().trim().min(1).max(30),
  /** Required (non-empty) for 'mall'; ignored and cleared for every other type */
  businessSegments: z.array(z.string().max(30)).max(20).optional(),
})

/**
 * PUT /api/sys-control/vendors/[id]/business-type — change a vendor's business type (e.g.
 * supermarket → mall with the shop types it runs, retail → electronics, mall → supermarket).
 * Keeps the tenant id, Business ID and all data; turns on switches the new types need (never off),
 * adds missing seed data (categories, accounts, cancellation reasons …). Audited.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession('vendors.manage')
    if (!session) {
      return adminAuthError()
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = await validateBody(request, bodySchema)
    if (!parsed.success) return parsed.response
    const checked = validateTypeChange(parsed.data, businessTypeEnum.enumValues)
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
    }

    const result = await changeTenantBusinessType(id, checked.businessType, checked.businessSegments)
    if (!result) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    await adminAudit.update(session.superAdminId, 'tenant_business_type', id, {
      before: result.before,
      after: { businessType: result.vendor.businessType, businessSegments: result.vendor.businessSegments },
      changes: result.changes,
    })

    // Open web / app sessions refresh the company context (menus, features)
    broadcastChange(id, 'tenant', 'updated', id, { businessType: result.vendor.businessType })

    return NextResponse.json({ ok: true, vendor: result.vendor, changes: result.changes })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/business-type PUT', error)
    return NextResponse.json({ error: 'Failed to change the business type' }, { status: 500 })
  }
}
