import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { modifiers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateModifierSchema } from '@/lib/validation/schemas/restaurant'
import { z } from 'zod'

// PUT update modifier
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; modifierId: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), modifierId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: groupId, modifierId } = paramsParsed.data
    const parsed = await validateBody(request, updateModifierSchema)
    if (!parsed.success) return parsed.response
    const { name, description, price, sku, isDefault, isActive, allergens, calories, sortOrder } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const [updated] = await db.update(modifiers)
        .set({
          name,
          description: description || null,
          price: String(price),
          sku: sku || null,
          isDefault,
          isActive: isActive !== undefined ? isActive : true,
          allergens: allergens || null,
          calories: calories ?? null,
          sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(modifiers.id, modifierId))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Modifier not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'updated', groupId)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/modifier-groups/[id]/modifiers/[modifierId]', error)
    return NextResponse.json({ error: 'Failed to update modifier' }, { status: 500 })
  }
}

// DELETE remove modifier
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; modifierId: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), modifierId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: groupId, modifierId } = paramsParsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const [deleted] = await db.delete(modifiers)
        .where(eq(modifiers.id, modifierId))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Modifier not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'updated', groupId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/modifier-groups/[id]/modifiers/[modifierId]', error)
    return NextResponse.json({ error: 'Failed to delete modifier' }, { status: 500 })
  }
}
