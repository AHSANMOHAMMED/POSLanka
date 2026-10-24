import { NextRequest, NextResponse } from 'next/server'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { auditCopy } from '@/lib/admin/vendor-data'
import { binErrorResponse, entryParamsSchema, vendorExists } from '@/lib/admin/recycle-bin-http'
import { getRecycleBinEntry, purgeFromRecycleBin } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string; entryId: string }> }

/** GET — one recycle-bin entry with its saved copy (and child rows for deleted drafts). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = entryParamsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    return NextResponse.json({ entry: await getRecycleBinEntry(p.data.id, p.data.entryId) })
  } catch (error) {
    const r = binErrorResponse(error, 'view')
    if (r) return r
    logError('api/sys-control/vendors/[id]/recycle-bin/[entryId] GET', error)
    return NextResponse.json({ error: 'Failed to load the entry' }, { status: 500 })
  }
}

/**
 * DELETE — purge: permanently delete the archived record (refused while other records reference
 * it), or drop the saved copy of a deleted draft. vendors.manage, audited with the snapshot.
 */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/recycle-bin', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const p = entryParamsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const entry = await purgeFromRecycleBin(p.data.id, p.data.entryId, session.superAdminId)
    await adminAudit.delete(session.superAdminId, 'vendor_recycle_bin', p.data.entryId, {
      op: 'recycle_purge', tenantId: p.data.id, entityType: entry.entity_type, table: entry.entity_table,
      entityId: entry.entity_id, name: entry.display_name, mode: entry.mode, before: auditCopy(entry.snapshot ?? {}),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const r = binErrorResponse(error, 'purge')
    if (r) return r
    logError('api/sys-control/vendors/[id]/recycle-bin/[entryId] DELETE', error)
    return NextResponse.json({ error: 'Failed to purge the entry' }, { status: 500 })
  }
}
