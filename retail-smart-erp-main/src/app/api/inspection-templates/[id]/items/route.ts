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
import { createChecklistItemSchema, updateChecklistItemSchema, updateChecklistItemsOrderSchema } from '@/lib/validation/schemas/work-orders'
import { z } from 'zod'
import { idParamSchema } from '@/lib/validation/schemas/common'

const updateChecklistItemUnionSchema = z.union([updateChecklistItemSchema, updateChecklistItemsOrderSchema])

// POST add item to a category
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
    const { id: templateId } = paramsParsed.data

    const parsed = await validateBody(request, createChecklistItemSchema)
    if (!parsed.success) return parsed.response
    const { categoryId, itemName, itemType, options, isRequired, sortOrder } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify template ownership
      const template = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, templateId),
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

      // Verify category belongs to this template
      const category = await db.query.inspectionCategories.findFirst({
        where: eq(inspectionCategories.id, categoryId),
      })

      if (!category || category.templateId !== templateId) {
        return NextResponse.json({ error: 'Category not found in this template' }, { status: 400 })
      }

      // Get current max sortOrder in this category
      const existingItems = await db.query.inspectionChecklistItems.findMany({
        where: eq(inspectionChecklistItems.categoryId, categoryId),
      })
      const maxSortOrder = Math.max(...existingItems.map(i => i.sortOrder), -1)

      const [newItem] = await db.insert(inspectionChecklistItems).values({
        tenantId: session.user.tenantId,
        categoryId,
        itemName,
        itemType,
        options: options ? JSON.stringify(options) : '[]',
        isRequired,
        sortOrder: sortOrder ?? maxSortOrder + 1,
      }).returning()

      // Broadcast inspection template update
      logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', templateId)

      return NextResponse.json(newItem)
    })
  } catch (error) {
    logError('api/inspection-templates/[id]/items', error)
    return NextResponse.json({ error: 'Failed to add item' }, { status: 500 })
  }
}

// PUT update item or item order (bulk update)
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
    const { id: templateId } = paramsParsed.data

    // Validate body against union of single-item and bulk-order schemas
    const parsed = await validateBody(request, updateChecklistItemUnionSchema)
    if (!parsed.success) return parsed.response
    const rawBody = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify template ownership
      const template = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, templateId),
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

      // Single item update
      const singleResult = updateChecklistItemSchema.safeParse(rawBody)
      if (singleResult.success) {
        const { itemId, itemName, itemType, options, isRequired, sortOrder, categoryId } = singleResult.data

        const updateData: Record<string, unknown> = {}
        if (itemName !== undefined) updateData.itemName = itemName
        if (itemType !== undefined) updateData.itemType = itemType
        if (options !== undefined) updateData.options = JSON.stringify(options)
        if (isRequired !== undefined) updateData.isRequired = isRequired
        if (sortOrder !== undefined) updateData.sortOrder = sortOrder
        if (categoryId !== undefined) updateData.categoryId = categoryId

        const [updated] = await db
          .update(inspectionChecklistItems)
          .set(updateData)
          .where(eq(inspectionChecklistItems.id, itemId))
          .returning()

        // Broadcast inspection template update
        logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', templateId)

        return NextResponse.json(updated)
      }

      // Bulk update items order
      const bulkResult = updateChecklistItemsOrderSchema.safeParse(rawBody)
      if (bulkResult.success) {
        for (const update of bulkResult.data.items) {
          const updateData: Record<string, unknown> = { sortOrder: update.sortOrder }
          if (update.categoryId !== undefined) {
            updateData.categoryId = update.categoryId
          }
          await db
            .update(inspectionChecklistItems)
            .set(updateData)
            .where(eq(inspectionChecklistItems.id, update.id))
        }

        // Broadcast inspection template update
        logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', templateId)

        return NextResponse.json({ success: true })
      }

      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    })
  } catch (error) {
    logError('api/inspection-templates/[id]/items', error)
    return NextResponse.json({ error: 'Failed to update items' }, { status: 500 })
  }
}

// DELETE remove item
export async function DELETE(
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
    const { id: templateId } = paramsParsed.data
    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')
    const categoryId = searchParams.get('categoryId')

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify template ownership
      const template = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, templateId),
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

      // Delete specific item
      if (itemId) {
        await db.delete(inspectionChecklistItems).where(eq(inspectionChecklistItems.id, itemId))
        // Broadcast inspection template update
        logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', templateId)
        return NextResponse.json({ success: true })
      }

      // Delete entire category (and its items via cascade)
      if (categoryId) {
        await db.delete(inspectionCategories).where(eq(inspectionCategories.id, categoryId))
        // Broadcast inspection template update
        logAndBroadcast(session.user.tenantId, 'inspection-template', 'updated', templateId)
        return NextResponse.json({ success: true })
      }

      return NextResponse.json({ error: 'itemId or categoryId is required' }, { status: 400 })
    })
  } catch (error) {
    logError('api/inspection-templates/[id]/items', error)
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
