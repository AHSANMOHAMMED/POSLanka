import { NextRequest, NextResponse } from 'next/server'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { binErrorResponse, entryParamsSchema, vendorExists } from '@/lib/admin/recycle-bin-http'
import { restoreFromRecycleBin } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string; entryId: string }> }

/**
 * POST — restore (undo the vendor's delete): archived records are re-activated, deleted drafts are
 * re-inserted with their child rows. vendors.manage, audited.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/recycle-bin', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const p = entryParamsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const entry = await restoreFromRecycleBin(p.data.id, p.data.entryId, session.superAdminId)
    if (entry.entity_type === 'user' || entry.entity_type === 'custom_role') invalidatePermissionCache(p.data.id)
    await adminAudit.update(session.superAdminId, 'vendor_recycle_bin', p.data.entryId, {
      op: 'recycle_restore', tenantId: p.data.id, entityType: entry.entity_type, table: entry.entity_table,
      entityId: entry.entity_id, name: entry.display_name, mode: entry.mode,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const r = binErrorResponse(error, 'restore')
    if (r) return r
    logError('api/sys-control/vendors/[id]/recycle-bin/[entryId]/restore POST', error)
    return NextResponse.json({ error: 'Failed to restore the entry' }, { status: 500 })
  }
}
