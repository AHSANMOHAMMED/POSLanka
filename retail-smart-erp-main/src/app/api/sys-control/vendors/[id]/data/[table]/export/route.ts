import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, logAdminAction, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { backupStream } from '@/lib/backup/tenant-backup'
import { fileSlug } from '@/lib/admin/csv'
import { exportTables } from '@/lib/admin/vendor-data'
import { vendorTableCsv } from '@/lib/admin/vendor-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

const paramsSchema = z.object({ id: z.string().uuid(), table: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/) })

/** GET /api/sys-control/vendors/[id]/data/[table]/export — every row of one table as CSV. vendors.impersonate, audited. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/data/export', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = paramsSchema.safeParse(await params)
    if (!p.success || !exportTables().some((t) => t.name === p.data.table)) return NextResponse.json({ error: 'Unknown table' }, { status: 404 })
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, p.data.id), columns: { id: true, slug: true } })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    await logAdminAction({
      accountId: session.superAdminId, action: 'view', resource: 'vendor_data_export', resourceId: tenant.id,
      details: { op: 'table_export', tenantId: tenant.id, table: p.data.table },
    })
    const stream = backupStream(vendorTableCsv(tenant.id, p.data.table), (err) => logError('api/sys-control/vendors/[id]/data/[table]/export', err))
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileSlug(tenant.slug)}-${p.data.table}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/data/[table]/export', error)
    return NextResponse.json({ error: 'Failed to export the table' }, { status: 500 })
  }
}
