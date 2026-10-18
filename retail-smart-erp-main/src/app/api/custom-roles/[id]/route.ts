import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customRoles, rolePermissionOverrides, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePermission, ROLE_PERMISSIONS, OWNER_ONLY_PERMISSIONS, type Permission } from '@/lib/auth/roles'
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

    const permError = requirePermission(session, 'manageTenant')
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

    const result = await withTenant(session.user.tenantId, async (db) => {
      // Check role exists (RLS scopes)
      const existing = await db.query.customRoles.findFirst({
        where: eq(customRoles.id, id),
      })
      if (!existing) return { error: 'Custom role not found', status: 404 }

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

      // Update permissions if provided
      if (permissions !== undefined) {
        // Delete existing custom role permissions
        await db.delete(rolePermissionOverrides).where(
          and(eq(rolePermissionOverrides.customRoleId, id))
        )

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
          if (granted && OWNER_ONLY_PERMISSIONS.includes(permKey as Permission)) continue

          toInsert.push({
            tenantId: session.user.tenantId,
            customRoleId: id,
            permissionKey: permKey,
            isGranted: granted,
            updatedBy: session.user.id,
          })
        }

        if (toInsert.length > 0) {
          await db.insert(rolePermissionOverrides).values(toInsert)
        }
      }

      return { role: updated }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: (result as { status?: number }).status || 400 })
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

    const permError = requirePermission(session, 'manageTenant')
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
