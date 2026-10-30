import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, logAdminAction, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { backupStream } from '@/lib/backup/tenant-backup'
import { fileSlug } from '@/lib/admin/csv'
import { exportTables } from '@/lib/admin/vendor-data'
import { vendorExportZip } from '@/lib/admin/vendor-export'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

/** One export per vendor at a time per instance (an export holds a DB connection while streaming). */
const running = new Set<string>()

/**
 * GET /api/sys-control/vendors/[id]/export?groups=Sales,Items%20%26%20stock
 * Everything of one vendor as a streamed ZIP of CSV files; groups limits it to those sections.
 * The whole of a business leaves the platform here, so owners only (vendors.manage), audited when it starts.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/export-data', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, p.data.id), columns: { id: true, name: true, slug: true, businessId: true } })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const raw = request.nextUrl.searchParams.get('groups')
    const groups = raw ? raw.split(',').map((g) => g.trim()).filter(Boolean) : undefined
    if (groups) {
      const known = new Set(exportTables().map((t) => t.group))
      if (groups.length === 0 || groups.some((g) => !known.has(g))) return NextResponse.json({ error: 'Unknown data section' }, { status: 400 })
    }
    if (running.has(tenant.id)) return NextResponse.json({ error: 'An export of this vendor is already running' }, { status: 409 })

    await logAdminAction({
      accountId: session.superAdminId, action: 'view', resource: 'vendor_data_export', resourceId: tenant.id,
      details: { op: 'data_export', tenantId: tenant.id, groups: groups ?? 'all' },
    })

    running.add(tenant.id)
    const release = () => { running.delete(tenant.id) }
    const gen = vendorExportZip(tenant.id, { vendorName: tenant.name, businessId: formatBusinessId(tenant.businessId), groups })
    const wrapped = (async function* () {
      try {
        yield* gen
      } finally {
        release()
      }
    })()
    const stream = backupStream(wrapped, (err) => {
      release()
      logError('api/sys-control/vendors/[id]/export', err)
    })
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileSlug(tenant.slug)}-data-${stamp}.zip"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/export', error)
    return NextResponse.json({ error: 'Failed to export the vendor’s data' }, { status: 500 })
  }
}
