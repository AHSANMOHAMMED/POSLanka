import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { rolePermissionOverrides, customRoles } from '@/lib/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { requirePermission, ROLE_PERMISSIONS, OWNER_ONLY_PERMISSIONS, type Permission } from '@/lib/auth/roles'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updateRolePermissionsSchema } from '@/lib/validation/schemas/role-permissions'

// GET /api/role-permissions — List all overrides for the tenant
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTenant')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const [overrides, roles] = await Promise.all([
        db.select().from(rolePermissionOverrides).where(
          and(isNotNull(rolePermissionOverrides.role))
        ),
        db.select().from(customRoles),
      ])

      // Group overrides by role
      const builtinOverrides: Record<string, Record<string, boolean>> = {}
      for (const o of overrides) {
        if (o.role) {
          if (!builtinOverrides[o.role]) builtinOverrides[o.role] = {}
          builtinOverrides[o.role][o.permissionKey] = o.isGranted
        }
      }

      // Get custom role overrides
      const customRoleOverrides = await db.select().from(rolePermissionOverrides).where(
        and(isNotNull(rolePermissionOverrides.customRoleId))
      )

      const customRolePerms: Record<string, Record<string, boolean>> = {}
      for (const o of customRoleOverrides) {
        if (o.customRoleId) {
          if (!customRolePerms[o.customRoleId]) customRolePerms[o.customRoleId] = {}
          customRolePerms[o.customRoleId][o.permissionKey] = o.isGranted
        }
      }

      return NextResponse.json({
        builtinOverrides,
        customRoles: roles.map(r => ({
          ...r,
          permissions: customRolePerms[r.id] || {},
        })),
        systemDefaults: ROLE_PERMISSIONS,
      })
    })
  } catch (error) {
    logError('api/role-permissions', error)
    return NextResponse.json({ error: 'Failed to fetch role permissions' }, { status: 500 })
  }
}

// PUT /api/role-permissions — Bulk upsert overrides for a built-in role
export async function PUT(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTenant')
    if (permError) return permError

    const parsed = await validateBody(request, updateRolePermissionsSchema)
    if (!parsed.success) return parsed.response
    const { role, overrides } = parsed.data

    // Cannot modify owner permissions
    if (role === 'owner') {
      return NextResponse.json({ error: 'Owner permissions cannot be modified' }, { status: 400 })
    }

    // Validate permission keys
    const allPermissions = Object.keys(ROLE_PERMISSIONS) as Permission[]
    for (const key of Object.keys(overrides)) {
      if (!allPermissions.includes(key as Permission)) {
        return NextResponse.json({ error: `Invalid permission: ${key}` }, { status: 400 })
      }
      // Cannot grant owner-only permissions to non-owner roles
      if (overrides[key] === true && OWNER_ONLY_PERMISSIONS.includes(key as Permission)) {
        return NextResponse.json({ error: `Permission "${key}" can only be assigned to owners` }, { status: 400 })
      }
    }

    await withTenant(session.user.tenantId, async (db) => {
      // Delete existing overrides for this role
      await db.delete(rolePermissionOverrides).where(
        and(
          eq(rolePermissionOverrides.role, role as typeof rolePermissionOverrides.role.enumValues[number]),
        )
      )

      // Insert new overrides (only where they differ from system defaults)
      const systemDefaults = ROLE_PERMISSIONS as Record<string, readonly string[]>
      const toInsert: Array<{
        tenantId: string
        role: typeof rolePermissionOverrides.role.enumValues[number]
        permissionKey: string
        isGranted: boolean
        updatedBy: string
      }> = []

      for (const [permKey, granted] of Object.entries(overrides)) {
        const systemDefault = systemDefaults[permKey]?.includes(role) ?? false
        if (granted !== systemDefault) {
          toInsert.push({
            tenantId: session.user.tenantId,
            role: role as typeof rolePermissionOverrides.role.enumValues[number],
            permissionKey: permKey,
            isGranted: granted,
            updatedBy: session.user.id,
          })
        }
      }

      if (toInsert.length > 0) {
        await db.insert(rolePermissionOverrides).values(toInsert)
      }
    })

    invalidatePermissionCache(session.user.tenantId)
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'role-permissions', { userId: session.user.id })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/role-permissions', error)
    return NextResponse.json({ error: 'Failed to update role permissions' }, { status: 500 })
  }
}
