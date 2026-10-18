import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { modifiers, modifierGroups } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createModifierSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET all modifiers in a group
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
      // Verify group exists
      const group = await db.query.modifierGroups.findFirst({
        where: eq(modifierGroups.id, id),
        columns: { id: true },
      })

      if (!group) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      const result = await db.query.modifiers.findMany({
        where: eq(modifiers.groupId, id),
        orderBy: (m, { asc }) => [asc(m.sortOrder), asc(m.name)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/modifier-groups/[id]/modifiers', error)
    return NextResponse.json({ error: 'Failed to fetch modifiers' }, { status: 500 })
  }
}

// POST add modifier to group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, createModifierSchema)
    if (!parsed.success) return parsed.response
    const { name, description, price, sku, isDefault, allergens, calories, sortOrder } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify group exists
      const group = await db.query.modifierGroups.findFirst({
        where: eq(modifierGroups.id, id),
        columns: { id: true },
      })

      if (!group) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      // Get the next sort order if not provided
      let finalSortOrder = sortOrder
      if (finalSortOrder === undefined || finalSortOrder === null) {
        const [maxSort] = await db
          .select({ maxSort: sql<number>`COALESCE(MAX(${modifiers.sortOrder}), -1) + 1` })
          .from(modifiers)
          .where(eq(modifiers.groupId, id))
        finalSortOrder = maxSort?.maxSort ?? 0
      }

      const [newModifier] = await db.insert(modifiers).values({
        tenantId: session!.user.tenantId,
        groupId: id,
        name,
        description: description || null,
        price: String(price),
        sku: sku || null,
        isDefault,
        isActive: true,
        allergens: allergens || null,
        calories: calories ?? null,
        sortOrder: finalSortOrder,
      }).returning()

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'updated', id)

      return NextResponse.json(newModifier)
    })
  } catch (error) {
    logError('api/modifier-groups/[id]/modifiers', error)
    return NextResponse.json({ error: 'Failed to create modifier' }, { status: 500 })
  }
}
