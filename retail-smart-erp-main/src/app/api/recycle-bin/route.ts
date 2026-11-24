import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { hasPermission } from '@/lib/auth/roles'
import { isFeatureEnabled } from '@/lib/features/flags'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { listRecycleBin, RECYCLE_ENTITIES } from '@/lib/recycle-bin'
import { logError } from '@/lib/ai/error-logger'

const querySchema = z.object({
  status: z.enum(['open', 'restored', 'all']).default('open'),
  type: z.string().regex(/^[a-z_]{1,50}$/).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/recycle-bin — Vendor owner/manager view of deleted items & records.
 * Permanent purge is restricted to platform Super Admin so vendor data is never lost.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!hasPermission(session.user.role, 'manageSettings')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const flags = await getTenantFeatureFlags(session.user.tenantId)
    if (!isFeatureEnabled(flags, 'owner_recycle_bin')) {
      return NextResponse.json(
        { error: 'Recycle bin access is disabled for this business by the platform administrator.' },
        { status: 403 }
      )
    }

    const q = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!q.success) {
      return NextResponse.json({ error: 'Invalid filters' }, { status: 400 })
    }

    const result = await listRecycleBin(session.user.tenantId, {
      status: q.data.status,
      entityType: q.data.type,
      q: q.data.q,
      page: q.data.page,
      pageSize: q.data.pageSize,
    })

    const types = Object.entries(RECYCLE_ENTITIES).map(([type, d]) => ({
      type,
      label: d.label,
      mode: d.mode,
    }))

    return NextResponse.json({ ...result, types })
  } catch (error) {
    logError('api/recycle-bin GET', error)
    return NextResponse.json({ error: 'Failed to load recycle bin' }, { status: 500 })
  }
}
