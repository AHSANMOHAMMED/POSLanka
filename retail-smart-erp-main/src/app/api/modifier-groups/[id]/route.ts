import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { modifierGroups } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { notInRecycleBin } from '@/lib/recycle-bin'
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
            where: (m) => notInRecycleBin('modifier', m.id),
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
      // Vendors never hard-delete: archive + recycle bin (only a super admin restores or purges)
      const binned = await moveToRecycleBin(db, {
        tenantId: session!.user.tenantId, entityType: 'modifier_group', entityId: id,
        userId: session!.user.id, userName: session!.user.name,
      })

      if (!binned) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'deleted', id)

      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/modifier-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to delete modifier group' }, { status: 500 })
  }
}
