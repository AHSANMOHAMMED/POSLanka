import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { rolePermissionOverrides } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
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

    const permError = requirePermission(session, 'manageTenant')
    if (permError) return permError

    const parsed = await validateBody(request, resetRolePermissionsSchema)
    if (!parsed.success) return parsed.response
    const { role } = parsed.data

    if (role === 'owner') {
      return NextResponse.json({ error: 'Owner permissions cannot be modified' }, { status: 400 })
    }

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
