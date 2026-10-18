import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { inspectionTemplates, inspectionCategories, inspectionChecklistItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createInspectionCategorySchema, updateInspectionCategoriesOrderSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET categories for a template
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
      const categories = await db.query.inspectionCategories.findMany({
        where: eq(inspectionCategories.templateId, id),
        with: {
          items: {
            orderBy: (items, { asc }) => [asc(items.sortOrder)],
          },
        },
        orderBy: (cats, { asc }) => [asc(cats.sortOrder)],
      })

      return NextResponse.json(categories)
    })
  } catch (error) {
    logError('api/inspection-templates/[id]/categories', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

// POST add category to template
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInspectionTemplates')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = await validateBody(request, createInspectionCategorySchema)
    if (!parsed.success) return parsed.response
    const { name, sortOrder, items } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify template ownership
      const template = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, id),
      })

      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      if (!template.tenantId) {
        return NextResponse.json({ error: 'Cannot modify system default templates' }, { status: 403 })
      }

      if (template.tenantId !== session.user.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      // Get current max sortOrder
      const existingCategories = await db.query.inspectionCategories.findMany({
        where: eq(inspectionCategories.templateId, id),
      })
      const maxSortOrder = Math.max(...existingCategories.map(c => c.sortOrder), -1)

      const [newCategory] = await db.insert(inspectionCategories).values({
        tenantId: session.user.tenantId,
        templateId: id,
        name,
        sortOrder: sortOrder ?? maxSortOrder + 1,
      }).returning()

      // Add items if provided
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          await db.insert(inspectionChecklistItems).values({
            tenantId: session.user.tenantId,
            categoryId: newCategory.id,
            itemName: item.itemName,
            itemType: item.itemType,
            options: item.options ? JSON.stringify(item.options) : '[]',
            isRequired: item.isRequired,
            sortOrder: item.sortOrder ?? i,
          })
        }
      }

      // Fetch the created category with items
      const createdCategory = await db.query.inspectionCategories.findFirst({
        where: eq(inspectionCategories.id, newCategory.id),
        with: {
          items: {
            orderBy: (items, { asc }) => [asc(items.sortOrder)],
          },
        },
      })

      // Broadcast inspection template update
      logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', id)

      return NextResponse.json(createdCategory)
    })
  } catch (error) {
    logError('api/inspection-templates/[id]/categories', error)
    return NextResponse.json({ error: 'Failed to add category' }, { status: 500 })
  }
}

// PUT update category order (bulk update)
export async function PUT(
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

    const parsed = await validateBody(request, updateInspectionCategoriesOrderSchema)
    if (!parsed.success) return parsed.response
    const { categories: categoryUpdates } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify template ownership
      const template = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, id),
      })

      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      if (!template.tenantId) {
        return NextResponse.json({ error: 'Cannot modify system default templates' }, { status: 403 })
      }

      if (template.tenantId !== session.user.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      // Update each category's sortOrder
      for (const update of categoryUpdates) {
        await db
          .update(inspectionCategories)
          .set({ sortOrder: update.sortOrder })
          .where(eq(inspectionCategories.id, update.id))
      }

      // Broadcast inspection template update
      logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/inspection-templates/[id]/categories', error)
    return NextResponse.json({ error: 'Failed to update categories' }, { status: 500 })
  }
}
