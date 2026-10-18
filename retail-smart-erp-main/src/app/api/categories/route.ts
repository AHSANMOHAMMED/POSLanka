import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { categories } from '@/lib/db/schema'
import { and, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation'
import { categoriesListSchema, createCategorySchema } from '@/lib/validation/schemas/items'

// GET all categories for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, categoriesListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []
      if (search) {
        conditions.push(ilike(categories.name, `%${escapeLikePattern(search)}%`))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all categories (for dropdowns)
      if (all) {
        const result = await db.query.categories.findMany({
          where: whereClause,
          orderBy: (categories, { asc }) => [asc(categories.name)],
          limit: 1000,
        })
        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(categories)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results
      const result = await db.query.categories.findMany({
        where: whereClause,
        orderBy: (categories, { asc }) => [asc(categories.name)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/categories', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

// POST create new category
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCategories')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createCategorySchema)
    if (!parsed.success) return parsed.response
    const { name } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate category name within tenant (RLS scopes the query)
      const existingCategory = await db.query.categories.findFirst({
        where: ilike(categories.name, name.trim()),
      })
      if (existingCategory) {
        return NextResponse.json({ error: 'A category with this name already exists' }, { status: 400 })
      }

      const [newCategory] = await db.insert(categories).values({
        tenantId: session!.user.tenantId,
        name,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'category', 'created', newCategory.id)

      return NextResponse.json(newCategory)
    })
  } catch (error) {
    logError('api/categories', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}
