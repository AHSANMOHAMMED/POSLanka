import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { categories, items } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCategorySchema } from '@/lib/validation/schemas/items'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single category
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const category = await db.query.categories.findFirst({
        where: eq(categories.id, id),
      })

      if (!category) {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }

      return NextResponse.json(category)
    })
  } catch (error) {
    logError('api/categories/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch category' }, { status: 500 })
  }
}

// PUT update category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCategories')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCategorySchema)
    if (!parsed.success) return parsed.response
    const { name } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate category name (excluding current category) - RLS scopes
      const existingCategory = await db.query.categories.findFirst({
        where: and(
          eq(categories.name, name.trim()),
          ne(categories.id, id)
        ),
      })
      if (existingCategory) {
        return NextResponse.json({ error: 'A category with this name already exists' }, { status: 400 })
      }

      const [updated] = await db.update(categories)
        .set({ name })
        .where(eq(categories.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'category', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/categories/[id]', error)
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

// DELETE category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCategories')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check if category has items (RLS scopes the query)
      const itemsInCategory = await db.query.items.findFirst({
        where: eq(items.categoryId, id),
      })

      if (itemsInCategory) {
        return NextResponse.json(
          { error: 'Cannot delete category that contains items. Please move or delete the items first.' },
          { status: 400 }
        )
      }

      const [deleted] = await db.delete(categories)
        .where(eq(categories.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'category', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/categories/[id]', error)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
