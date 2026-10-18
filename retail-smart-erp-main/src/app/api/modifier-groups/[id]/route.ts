import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { modifierGroups, modifiers } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateModifierGroupSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single modifier group with modifiers and item count
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const group = await db.query.modifierGroups.findFirst({
        where: eq(modifierGroups.id, id),
        with: {
          modifiers: {
            orderBy: (m, { asc }) => [asc(m.sortOrder), asc(m.name)],
          },
          itemAssociations: {
            columns: { id: true },
          },
        },
      })

      if (!group) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      return NextResponse.json({
        ...group,
        itemCount: group.itemAssociations.length,
        itemAssociations: undefined,
      })
    })
  } catch (error) {
    logError('api/modifier-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch modifier group' }, { status: 500 })
  }
}

// PUT update modifier group
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateModifierGroupSchema)
    if (!parsed.success) return parsed.response
    const { name, description, minSelections, maxSelections, isRequired, isActive, sortOrder } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const [updated] = await db.update(modifierGroups)
        .set({
          name,
          description: description || null,
          minSelections,
          maxSelections: maxSelections ?? null,
          isRequired,
          isActive: isActive !== undefined ? isActive : true,
          sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(modifierGroups.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/modifier-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to update modifier group' }, { status: 500 })
  }
}

// DELETE modifier group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for associated modifiers
      const [modifierCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(modifiers)
        .where(eq(modifiers.groupId, id))

      if (modifierCount?.count > 0) {
        return NextResponse.json({
          error: `Cannot delete modifier group. It has ${modifierCount.count} modifier(s). Remove them first or deactivate the group instead.`,
          suggestion: 'deactivate',
        }, { status: 400 })
      }

      const [deleted] = await db.delete(modifierGroups)
        .where(eq(modifierGroups.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/modifier-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to delete modifier group' }, { status: 500 })
  }
}
