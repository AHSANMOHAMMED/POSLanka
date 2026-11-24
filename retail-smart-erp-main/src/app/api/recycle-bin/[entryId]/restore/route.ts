import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { hasPermission } from '@/lib/auth/roles'
import { isFeatureEnabled } from '@/lib/features/flags'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { restoreFromRecycleBin, RecycleBinError } from '@/lib/recycle-bin'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { uuidSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'

/**
 * POST /api/recycle-bin/[entryId]/restore — Restore a deleted item or record for the current company.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
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

    const { entryId } = await params
    const parsedId = uuidSchema.safeParse(entryId)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid entry ID' }, { status: 400 })
    }

    const entry = await restoreFromRecycleBin(
      session.user.tenantId,
      parsedId.data,
      session.user.id
    )

    if (entry.entity_type === 'user' || entry.entity_type === 'custom_role') {
      invalidatePermissionCache(session.user.tenantId)
    }

    return NextResponse.json({
      success: true,
      restoredName: entry.display_name,
      entityType: entry.entity_type,
    })
  } catch (error) {
    if (error instanceof RecycleBinError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logError('api/recycle-bin/[entryId]/restore POST', error)
    return NextResponse.json({ error: 'Failed to restore item' }, { status: 500 })
  }
}
