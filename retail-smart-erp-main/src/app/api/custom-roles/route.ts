import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customRoles, rolePermissionOverrides, users } from '@/lib/db/schema'
import { eq, isNotNull, sql } from 'drizzle-orm'
import { requirePermission, resolveRoleDefinition } from '@/lib/auth/roles'
import { checkRoleRank, sanitizeRequestedPermissions, requestedPermissions, escalatedPermissions, escalationResponse } from '@/lib/auth/role-guard'
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
      const [roles, counts] = await Promise.all([
        db.select().from(customRoles),
        db.select({ customRoleId: users.customRoleId, n: sql<number>`count(*)::int` })
          .from(users)
          .where(isNotNull(users.customRoleId))
          .groupBy(users.customRoleId),
      ])
      const userCount = new Map(counts.map((c) => [c.customRoleId, c.n]))

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
          // What the role actually resolves to (explicit → base-role override → default)
          effectivePermissions: resolveRoleDefinition(r.baseRole, permsByRole[r.id] || {}, session.user.tenantId),
          userCount: userCount.get(r.id) || 0,
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

    const permError = requirePermission(session, 'manageRoles')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createCustomRoleSchema)
    if (!parsed.success) return parsed.response
    const { name, baseRole, description, color, permissions } = parsed.data

    // Cannot base on owner, an unknown role, or (non-owners) a role at/above your own rank
    if (baseRole === 'owner') {
      return NextResponse.json({ error: 'Cannot create custom roles based on owner' }, { status: 400 })
    }
    const rankError = checkRoleRank(session, baseRole)
    if (rankError) return rankError

    // Nobody can create a role carrying permissions they do not hold themselves
    const missing = escalatedPermissions(session, resolveRoleDefinition(baseRole, requestedPermissions(permissions || {}), session.user.tenantId), null)
    if (missing.length > 0) return escalationResponse(missing)
    const explicit = sanitizeRequestedPermissions(session, permissions || {})

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

      // Insert the role's explicit permissions
      const toInsert = Object.entries(explicit).map(([permKey, granted]) => ({
        tenantId: session.user.tenantId,
        customRoleId: role.id,
        permissionKey: permKey,
        isGranted: granted,
        updatedBy: session.user.id,
      }))
      if (toInsert.length > 0) {
        await db.insert(rolePermissionOverrides).values(toInsert)
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
