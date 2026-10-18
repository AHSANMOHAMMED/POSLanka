import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { modifierGroups } from '@/lib/db/schema'
import { eq, and, sql, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { modifierGroupsListSchema, createModifierGroupSchema } from '@/lib/validation/schemas/restaurant'

// GET all modifier groups for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, modifierGroupsListSchema)
    if (!parsed.success) return parsed.response
    const { search, isActive, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (search) {
        conditions.push(ilike(modifierGroups.name, `%${escapeLikePattern(search)}%`))
      }
      if (isActive !== undefined && isActive !== '') {
        conditions.push(eq(modifierGroups.isActive, isActive === 'true'))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(modifierGroups)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get modifier groups with modifier count and item count
      const result = await db.query.modifierGroups.findMany({
        where: whereClause,
        with: {
          modifiers: {
            columns: { id: true },
          },
          itemAssociations: {
            columns: { id: true },
          },
        },
        orderBy: (mg, { asc }) => [asc(mg.sortOrder), asc(mg.name)],
        limit,
        offset,
      })

      // Transform to include counts
      const groupsWithCounts = result.map((group) => ({
        ...group,
        modifierCount: group.modifiers.length,
        itemCount: group.itemAssociations.length,
        modifiers: undefined,
        itemAssociations: undefined,
      }))

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(groupsWithCounts)
      }

      return NextResponse.json({
        data: groupsWithCounts,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/modifier-groups', error)
    return NextResponse.json({ error: 'Failed to fetch modifier groups' }, { status: 500 })
  }
}

// POST create new modifier group
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createModifierGroupSchema)
    if (!parsed.success) return parsed.response
    const { name, description, minSelections, maxSelections, isRequired, sortOrder } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const [newGroup] = await db.insert(modifierGroups).values({
        tenantId: session!.user.tenantId,
        name,
        description: description || null,
        minSelections,
        maxSelections: maxSelections ?? null,
        isRequired,
        isActive: true,
        sortOrder,
      }).returning()

      logAndBroadcast(session!.user.tenantId, 'modifier-group', 'created', newGroup.id)

      return NextResponse.json(newGroup)
    })
  } catch (error) {
    logError('api/modifier-groups', error)
    return NextResponse.json({ error: 'Failed to create modifier group' }, { status: 500 })
  }
}
