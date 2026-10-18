import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { modifierGroupItems, modifierGroups, modifiers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET /api/items/[id]/modifier-groups
// Returns modifier groups linked to this item, with their modifiers
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
    const { id: itemId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Find all modifier groups linked to this item
      const links = await db
        .select({ modifierGroupId: modifierGroupItems.modifierGroupId })
        .from(modifierGroupItems)
        .where(
          and(
            eq(modifierGroupItems.itemId, itemId),
          )
        )

      if (links.length === 0) {
        return NextResponse.json([])
      }

      const groupIds = links.map(l => l.modifierGroupId)

      // Fetch groups with their modifiers
      const groups = await db.query.modifierGroups.findMany({
        where: and(
          eq(modifierGroups.isActive, true),
        ),
        with: {
          modifiers: {
            where: eq(modifiers.isActive, true),
            orderBy: (modifiers, { asc }) => [asc(modifiers.sortOrder)],
          },
        },
        orderBy: (modifierGroups, { asc }) => [asc(modifierGroups.sortOrder)],
      })

      // Filter to only linked groups
      const linkedGroups = groups
        .filter(g => groupIds.includes(g.id))
        .map(g => ({
          id: g.id,
          name: g.name,
          minSelections: g.minSelections || 0,
          maxSelections: g.maxSelections,
          isRequired: g.isRequired,
          modifiers: g.modifiers.map(m => ({
            id: m.id,
            name: m.name,
            price: m.price,
            isDefault: m.isDefault || false,
          })),
        }))

      return NextResponse.json(linkedGroups)
    })
  } catch (error) {
    console.error('Error fetching item modifier groups:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
