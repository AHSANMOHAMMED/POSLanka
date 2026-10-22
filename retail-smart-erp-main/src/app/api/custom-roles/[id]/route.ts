import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customRoles, rolePermissionOverrides, users } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { requirePermission, resolveRoleDefinition } from '@/lib/auth/roles'
import { checkRoleRank, isOwnerActor, sanitizeRequestedPermissions, requestedPermissions, escalatedPermissions } from '@/lib/auth/role-guard'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCustomRoleSchema } from '@/lib/validation/schemas/role-permissions'
import { idParamSchema } from '@/lib/validation/schemas/common'

// PUT /api/custom-roles/[id] — Update a custom role
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRoles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCustomRoleSchema)
    if (!parsed.success) return parsed.response
    const { name, baseRole, description, color, isActive, permissions } = parsed.data

    if (baseRole === 'owner') {
      return NextResponse.json({ error: 'Cannot base custom roles on owner' }, { status: 400 })
    }

    if (baseRole !== undefined) {
      const rankError = checkRoleRank(session, baseRole)
      if (rankError) return rankError
    }

    const result = await withTenant(session.user.tenantId, async (db) => {
      // Check role exists (RLS scopes)
      const existing = await db.query.customRoles.findFirst({
        where: eq(customRoles.id, id),
      })
      if (!existing) return { error: 'Custom role not found', status: 404 }

      // Non-owners: only roles ranked below their own, and never the custom role they hold
      // themselves (that would let them reshape their own access).
      const rankError = checkRoleRank(session, existing.baseRole)
      if (rankError) return { error: 'You can only change roles ranked below your own', status: 403 }
      if (!isOwnerActor(session) && session.user.customRoleId === id) {
        return { error: 'You cannot change your own role', status: 403 }
      }

      const previousRows = await db.select().from(rolePermissionOverrides).where(eq(rolePermissionOverrides.customRoleId, id))
      const previous: Record<string, boolean> = {}
      for (const r of previousRows) previous[r.permissionKey] = r.isGranted

      const nextBase = baseRole ?? existing.baseRole
      const nextExplicit = permissions !== undefined ? sanitizeRequestedPermissions(session, permissions, previous) : previous
      // Judge the request as asked: newly granting a permission the actor lacks is refused
      // (keys the actor lacks are otherwise kept as they were — see sanitizeRequestedPermissions)
      const asked = permissions !== undefined ? { ...previous, ...requestedPermissions(permissions) } : previous
      const missing = escalatedPermissions(
        session,
        resolveRoleDefinition(nextBase, asked, session.user.tenantId),
        resolveRoleDefinition(existing.baseRole, previous, session.user.tenantId),
      )
      if (missing.length > 0) {
        return { error: 'You cannot grant permissions you do not have yourself', status: 403, missingPermissions: missing }
      }

      // Build update data
      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (name !== undefined) {
        updateData.name = name
        updateData.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)
      }
      if (baseRole !== undefined) updateData.baseRole = baseRole
      if (description !== undefined) updateData.description = description
      if (color !== undefined) updateData.color = color
      if (isActive !== undefined) updateData.isActive = isActive

      const [updated] = await db.update(customRoles)
        .set(updateData)
        .where(eq(customRoles.id, id))
        .returning()

      // Users on this custom role carry its base role in users.role (rank, module access,
      // fallback permissions) — keep them in step when the base role changes.
      if (baseRole !== undefined && baseRole !== existing.baseRole) {
        await db.update(users)
          .set({ role: baseRole as typeof users.$inferInsert['role'], updatedAt: new Date() })
          .where(and(eq(users.customRoleId, id), ne(users.role, 'owner')))
      }

      // Replace permissions if provided
      if (permissions !== undefined) {
        await db.delete(rolePermissionOverrides).where(eq(rolePermissionOverrides.customRoleId, id))
        const toInsert = Object.entries(nextExplicit).map(([permKey, granted]) => ({
          tenantId: session.user.tenantId,
          customRoleId: id,
          permissionKey: permKey,
          isGranted: granted,
          updatedBy: session.user.id,
        }))
        if (toInsert.length > 0) {
          await db.insert(rolePermissionOverrides).values(toInsert)
        }
      }

      return { role: updated }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) {
      const r = result as { error: string; status?: number; missingPermissions?: string[] }
      return NextResponse.json({ error: r.error, missingPermissions: r.missingPermissions }, { status: r.status || 400 })
    }

    invalidatePermissionCache(session.user.tenantId)
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'role-permissions', { userId: session.user.id })

    return NextResponse.json(result.role)
  } catch (error) {
    logError('api/custom-roles/[id]', error)
    return NextResponse.json({ error: 'Failed to update custom role' }, { status: 500 })
  }
}

// DELETE /api/custom-roles/[id] — Delete a custom role
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRoles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const result = await withTenant(session.user.tenantId, async (db) => {
      // Check role exists
      const existing = await db.query.customRoles.findFirst({
        where: eq(customRoles.id, id),
      })
      if (!existing) return { error: 'Custom role not found', status: 404 }

      // Check no users are assigned to this custom role
      const assignedUser = await db.query.users.findFirst({
        where: eq(users.customRoleId, id),
        columns: { id: true },
      })
      if (assignedUser) {
        return { error: 'Cannot delete a custom role that has users assigned to it. Reassign users first.' }
      }

      // Delete permission overrides (CASCADE should handle this, but be explicit)
      await db.delete(rolePermissionOverrides).where(
        eq(rolePermissionOverrides.customRoleId, id)
      )

      // Delete the custom role
      await db.delete(customRoles).where(eq(customRoles.id, id))

      return { success: true }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: (result as { status?: number }).status || 400 })
    }

    invalidatePermissionCache(session.user.tenantId)
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'role-permissions', { userId: session.user.id })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/custom-roles/[id]', error)
    return NextResponse.json({ error: 'Failed to delete custom role' }, { status: 500 })
  }
}
