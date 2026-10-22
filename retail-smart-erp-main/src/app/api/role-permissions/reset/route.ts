import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { rolePermissionOverrides } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePermission, resolveRoleDefinition } from '@/lib/auth/roles'
import { checkRoleRank, escalatedPermissions, escalationResponse } from '@/lib/auth/role-guard'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { resetRolePermissionsSchema } from '@/lib/validation/schemas/role-permissions'

// POST /api/role-permissions/reset — Reset a role's permissions to system defaults
export async function POST(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRoles')
    if (permError) return permError

    const parsed = await validateBody(request, resetRolePermissionsSchema)
    if (!parsed.success) return parsed.response
    const { role } = parsed.data

    const rankError = checkRoleRank(session, role)
    if (rankError) return rankError

    // A reset must not hand the role a default permission the (non-owner) actor lacks
    const previousRows = await withTenant(session.user.tenantId, (db) =>
      db.select().from(rolePermissionOverrides).where(
        eq(rolePermissionOverrides.role, role as typeof rolePermissionOverrides.role.enumValues[number]),
      ),
    )
    const previous: Record<string, boolean> = {}
    for (const r of previousRows) previous[r.permissionKey] = r.isGranted
    const missing = escalatedPermissions(session, resolveRoleDefinition(role), resolveRoleDefinition(role, previous))
    if (missing.length > 0) return escalationResponse(missing)

    await withTenant(session.user.tenantId, async (db) => {
      await db.delete(rolePermissionOverrides).where(
        and(
          eq(rolePermissionOverrides.role, role as typeof rolePermissionOverrides.role.enumValues[number]),
        )
      )
    })

    invalidatePermissionCache(session.user.tenantId)
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'role-permissions', { userId: session.user.id })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/role-permissions/reset', error)
    return NextResponse.json({ error: 'Failed to reset role permissions' }, { status: 500 })
  }
}
