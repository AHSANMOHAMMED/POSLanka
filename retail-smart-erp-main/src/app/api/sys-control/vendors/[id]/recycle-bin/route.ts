import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { listRecycleBin, RECYCLE_ENTITIES } from '@/lib/recycle-bin'

const querySchema = z.object({
  status: z.enum(['open', 'restored', 'purged', 'all']).default('open'),
  type: z.string().regex(/^[a-z_]{1,50}$/).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/sys-control/vendors/[id]/recycle-bin — what this vendor "deleted": archived master data
 * and snapshots of deleted drafts. Filters: status (open | restored | purged | all), type, q; paged.
 * Viewing needs vendors.impersonate; restore / purge need vendors.manage.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const q = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!q.success) return NextResponse.json({ error: 'Invalid filters' }, { status: 400 })
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, p.data.id), columns: { id: true, name: true, businessId: true, slug: true } })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const result = await listRecycleBin(tenant.id, {
      status: q.data.status, entityType: q.data.type, q: q.data.q, page: q.data.page, pageSize: q.data.pageSize,
    })
    const types = Object.entries(RECYCLE_ENTITIES).map(([type, d]) => ({ type, label: d.label, mode: d.mode }))
    return NextResponse.json({ vendor: tenant, ...result, types })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/recycle-bin GET', error)
    return NextResponse.json({ error: 'Failed to load the recycle bin' }, { status: 500 })
  }
}
