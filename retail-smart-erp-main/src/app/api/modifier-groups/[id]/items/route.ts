import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { modifierGroupItems, modifierGroups } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateModifierGroupItemsSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET list associated menu items for a modifier group
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

      const associations = await db.query.modifierGroupItems.findMany({
        where: eq(modifierGroupItems.modifierGroupId, id),
        with: {
          item: {
            columns: {
              id: true,
              name: true,
              sku: true,
              sellingPrice: true,
              isActive: true,
              imageUrl: true,
            },
          },
        },
      })

      // Return the items with association info
      const result = associations.map((assoc) => ({
        associationId: assoc.id,
        itemId: assoc.item.id,
        name: assoc.item.name,
        sku: assoc.item.sku,
        sellingPrice: assoc.item.sellingPrice,
        isActive: assoc.item.isActive,
        imageUrl: assoc.item.imageUrl,
        createdAt: assoc.createdAt,
      }))

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/modifier-groups/[id]/items', error)
    return NextResponse.json({ error: 'Failed to fetch associated items' }, { status: 500 })
  }
}

// POST/PUT update item associations (replace all associations)
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
    const parsed = await validateBody(request, updateModifierGroupItemsSchema)
    if (!parsed.success) return parsed.response
    const { itemIds } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify group exists
      const group = await db.query.modifierGroups.findFirst({
        where: eq(modifierGroups.id, id),
        columns: { id: true },
      })

      if (!group) {
        return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
      }

      // Use transaction to replace all associations
      await db.transaction(async (tx) => {
        // Remove existing associations
        await tx.delete(modifierGroupItems)
          .where(eq(modifierGroupItems.modifierGroupId, id))

        // Add new associations
        if (itemIds.length > 0) {
          const values = itemIds.map((itemId: string) => ({
            tenantId: session!.user.tenantId,
            modifierGroupId: id,
            itemId,
          }))

          await tx.insert(modifierGroupItems).values(values)
        }
      })

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'updated', id)

      return NextResponse.json({ success: true, count: itemIds.length })
    })
  } catch (error) {
    logError('api/modifier-groups/[id]/items', error)
    return NextResponse.json({ error: 'Failed to update item associations' }, { status: 500 })
  }
}

// PUT is an alias for POST (both replace associations)
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return POST(request, context)
}
