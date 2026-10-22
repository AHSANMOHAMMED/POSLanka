import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { users } from '@/lib/db/schema'
import {
  requirePermission,
  getEffectivePermissions,
  isPermissionModuleDisabled,
  ROLE_PERMISSIONS,
  type Permission,
} from '@/lib/auth/roles'
import { getCustomRoleName } from '@/lib/auth/permission-cache'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'

// GET /api/users/[id]/permissions — what this staff member can actually do right now:
// their role / custom role, tenant overrides and module-access toggles applied — exactly what
// requirePermission enforces. `blockedByModule` lists permissions the role would have but the
// owner switched the module off for it.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const self = (await params).id === session.user.id
    if (!self) {
      const permError = requirePermission(session, 'manageUsers')
      if (permError) return permError
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session.user.tenantId

    const user = await withTenant(tenantId, (db) =>
      db.query.users.findFirst({
        where: eq(users.id, id),
        columns: { id: true, fullName: true, role: true, customRoleId: true, isActive: true },
      }),
    )
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const permissions = getEffectivePermissions(user.role, tenantId, user.customRoleId)
    const blockedByModule = (Object.keys(ROLE_PERMISSIONS) as Permission[])
      .filter((p) => isPermissionModuleDisabled(user.role, p, tenantId))

    return NextResponse.json({
      userId: user.id,
      fullName: user.fullName,
      role: user.role,
      customRoleId: user.customRoleId,
      customRoleName: user.customRoleId ? getCustomRoleName(tenantId, user.customRoleId) ?? null : null,
      isActive: user.isActive,
      permissions,
      blockedByModule,
    })
  } catch (error) {
    logError('api/users/[id]/permissions', error)
    return NextResponse.json({ error: 'Failed to load permissions' }, { status: 500 })
  }
}
