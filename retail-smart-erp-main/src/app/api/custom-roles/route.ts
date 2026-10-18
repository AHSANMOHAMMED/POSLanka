import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customRoles, rolePermissionOverrides } from '@/lib/db/schema'
import { eq, isNotNull } from 'drizzle-orm'
import { requirePermission, ROLE_PERMISSIONS, OWNER_ONLY_PERMISSIONS, type Permission } from '@/lib/auth/roles'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createCustomRoleSchema } from '@/lib/validation/schemas/role-permissions'

// GET /api/custom-roles — List custom roles for tenant
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const roles = await db.select().from(customRoles)

      // Fetch permissions for each custom role
      const allOverrides = await db.select().from(rolePermissionOverrides).where(
        isNotNull(rolePermissionOverrides.customRoleId)
      )

      const permsByRole: Record<string, Record<string, boolean>> = {}
      for (const o of allOverrides) {
        if (o.customRoleId) {
          if (!permsByRole[o.customRoleId]) permsByRole[o.customRoleId] = {}
          permsByRole[o.customRoleId][o.permissionKey] = o.isGranted
        }
      }

      return NextResponse.json(
        roles.map(r => ({
          ...r,
          permissions: permsByRole[r.id] || {},
        }))
      )
    })
  } catch (error) {
    logError('api/custom-roles', error)
    return NextResponse.json({ error: 'Failed to fetch custom roles' }, { status: 500 })
  }
}

// POST /api/custom-roles — Create a new custom role
export async function POST(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTenant')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createCustomRoleSchema)
    if (!parsed.success) return parsed.response
    const { name, baseRole, description, color, permissions } = parsed.data

    // Cannot base on owner
    if (baseRole === 'owner') {
      return NextResponse.json({ error: 'Cannot create custom roles based on owner' }, { status: 400 })
    }

    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)
    if (!slug) {
      return NextResponse.json({ error: 'Invalid role name' }, { status: 400 })
    }

    const result = await withTenant(session.user.tenantId, async (db) => {
      // Check slug uniqueness (RLS scopes query)
      const existing = await db.query.customRoles.findFirst({
        where: eq(customRoles.slug, slug),
      })
      if (existing) {
        return { error: 'A custom role with this name already exists' }
      }

      // Create the custom role
      const [role] = await db.insert(customRoles).values({
        tenantId: session.user.tenantId,
        name,
        slug,
        baseRole: baseRole as typeof customRoles.baseRole.enumValues[number],
        description: description || null,
        color: color || null,
        createdBy: session.user.id,
      }).returning()

      // Insert permission overrides if provided
      if (permissions && Object.keys(permissions).length > 0) {
        const allPermissions = Object.keys(ROLE_PERMISSIONS) as Permission[]
        const toInsert: Array<{
          tenantId: string
          customRoleId: string
          permissionKey: string
          isGranted: boolean
          updatedBy: string
        }> = []

        for (const [permKey, granted] of Object.entries(permissions)) {
          if (!allPermissions.includes(permKey as Permission)) continue
          // Block owner-only permissions
          if (granted && OWNER_ONLY_PERMISSIONS.includes(permKey as Permission)) continue

          toInsert.push({
            tenantId: session.user.tenantId,
            customRoleId: role.id,
            permissionKey: permKey,
            isGranted: granted,
            updatedBy: session.user.id,
          })
        }

        if (toInsert.length > 0) {
          await db.insert(rolePermissionOverrides).values(toInsert)
        }
      }

      return { role }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    invalidatePermissionCache(session.user.tenantId)
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'role-permissions', { userId: session.user.id, entityName: result.role.name })

    return NextResponse.json(result.role, { status: 201 })
  } catch (error) {
    logError('api/custom-roles', error)
    return NextResponse.json({ error: 'Failed to create custom role' }, { status: 500 })
  }
}
