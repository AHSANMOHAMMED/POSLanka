import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireRole } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logActivity } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'

// DELETE /api/settings/api-keys/[id] — revoke a key (kept for the audit trail, stops working at once)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const roleError = requireRole(session, ['owner', 'manager'])
    if (roleError) return roleError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)

    const revoked = await withTenant(tenantId, async (db) => {
      const [row] = await db.update(apiKeys)
        .set({ revokedAt: new Date(), revokedBy: userId })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix })
      return row
    })
    if (!revoked) return NextResponse.json({ error: 'API key not found or already revoked' }, { status: 404 })

    await logActivity({
      tenantId,
      userId,
      action: 'delete',
      entityType: 'api_key',
      entityId: revoked.id,
      entityName: revoked.name,
      description: `Revoked API key "${revoked.name}" (${revoked.keyPrefix})`,
    })
    return NextResponse.json({ revoked: true })
  } catch (error) {
    logError('api/settings/api-keys/[id]', error)
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 })
  }
}
