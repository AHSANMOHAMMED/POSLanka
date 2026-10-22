import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { rolePermissionOverrides, customRoles, moduleAccess } from '@/lib/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { requirePermission, hasPermission, resolveRoleDefinition, ROLE_PERMISSIONS, OWNER_ONLY_PERMISSIONS, ROLE_HIERARCHY, PERMISSION_MODULES, type Permission } from '@/lib/auth/roles'
import { requireAnyPermission } from '@/lib/purchasing/permissions'
import { checkRoleRank, sanitizeRequestedPermissions, requestedPermissions, escalatedPermissions, escalationResponse } from '@/lib/auth/role-guard'
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

    // Role editors and staff managers (who pick roles for people) may read role definitions
    const permError = requireAnyPermission(session, ['manageRoles', 'manageUsers'])
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const [overrides, roles, modules] = await Promise.all([
        db.select().from(rolePermissionOverrides).where(
          and(isNotNull(rolePermissionOverrides.role))
        ),
        db.select().from(customRoles),
        db.select({ role: moduleAccess.role, moduleKey: moduleAccess.moduleKey, isEnabled: moduleAccess.isEnabled }).from(moduleAccess),
      ])
      // Modules switched off per built-in role (custom roles follow their base role)
      const disabledModules: Record<string, string[]> = {}
      for (const m of modules) {
        if (m.isEnabled || m.role === 'owner') continue
        ;(disabledModules[m.role] ||= []).push(m.moduleKey)
      }

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

      // Effective permissions per built-in role as enforced right now: tenant overrides AND
      // module-access toggles applied (hasPermission), so the editor can show the real outcome.
      const tenantId = session.user.tenantId
      const allPerms = Object.keys(ROLE_PERMISSIONS) as Permission[]
      const effectiveByRole: Record<string, Record<string, boolean>> = {}
      for (const role of Object.keys(ROLE_HIERARCHY)) {
        effectiveByRole[role] = {}
        for (const p of allPerms) effectiveByRole[role][p] = hasPermission(role, p, tenantId)
      }

      return NextResponse.json({
        builtinOverrides,
        customRoles: roles.map(r => ({
          ...r,
          permissions: customRolePerms[r.id] || {},
          effectivePermissions: resolveRoleDefinition(r.baseRole, customRolePerms[r.id] || {}, tenantId),
        })),
        systemDefaults: ROLE_PERMISSIONS,
        effectiveByRole,
        permissionModules: PERMISSION_MODULES,
        disabledModules,
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

    const permError = requirePermission(session, 'manageRoles')
    if (permError) return permError

    const parsed = await validateBody(request, updateRolePermissionsSchema)
    if (!parsed.success) return parsed.response
    const { role, overrides: requested } = parsed.data

    // Owner is immutable; unknown roles refused; non-owners only edit roles below their rank
    const rankError = checkRoleRank(session, role)
    if (rankError) return rankError

    // Validate permission keys
    const allPermissions = Object.keys(ROLE_PERMISSIONS) as Permission[]
    for (const key of Object.keys(requested)) {
      if (!allPermissions.includes(key as Permission)) {
        return NextResponse.json({ error: `Invalid permission: ${key}` }, { status: 400 })
      }
      // Cannot grant owner-only permissions to non-owner roles
      if (requested[key] === true && OWNER_ONLY_PERMISSIONS.includes(key as Permission)) {
        return NextResponse.json({ error: `Permission "${key}" can only be assigned to owners` }, { status: 400 })
      }
    }

    const previousRows = await withTenant(session.user.tenantId, (db) =>
      db.select().from(rolePermissionOverrides).where(
        eq(rolePermissionOverrides.role, role as typeof rolePermissionOverrides.role.enumValues[number]),
      ),
    )
    const previous: Record<string, boolean> = {}
    for (const r of previousRows) previous[r.permissionKey] = r.isGranted
    // Non-owners cannot touch permissions they do not hold (those keep their previous value)
    const systemDefaultsMap = ROLE_PERMISSIONS as Record<string, readonly string[]>
    const previousFull: Record<string, boolean> = {}
    for (const k of Object.keys(ROLE_PERMISSIONS)) previousFull[k] = previous[k] ?? systemDefaultsMap[k].includes(role)
    const overrides = sanitizeRequestedPermissions(session, requested, previousFull)
    const missing = escalatedPermissions(
      session,
      resolveRoleDefinition(role, { ...previous, ...requestedPermissions(requested) }),
      resolveRoleDefinition(role, previous),
    )
    if (missing.length > 0) return escalationResponse(missing)

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
