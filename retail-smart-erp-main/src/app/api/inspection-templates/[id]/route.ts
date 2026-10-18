import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { inspectionTemplates } from '@/lib/db/schema'
import { eq, and, or, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateInspectionTemplateSchema } from '@/lib/validation/schemas/service-types'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single inspection template
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
      const template = await db.query.inspectionTemplates.findFirst({
        where: and(
          eq(inspectionTemplates.id, id),
          or(
            isNull(inspectionTemplates.tenantId),
            eq(inspectionTemplates.tenantId, session.user.tenantId)
          )
        ),
        with: {
          vehicleType: true,
          categories: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            orderBy: (cats: any, { asc }: any) => [asc(cats.sortOrder)],
            with: {
              items: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderBy: (items: any, { asc }: any) => [asc(items.sortOrder)],
              },
            },
          },
        },
      })

      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      return NextResponse.json(template)
    })
  } catch (error) {
    logError('api/inspection-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch inspection template' }, { status: 500 })
  }
}

// PUT update inspection template
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInspectionTemplates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateInspectionTemplateSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check if template exists
      const existingTemplate = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, id),
      })

      if (!existingTemplate) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      // System defaults (tenantId is null) can only be deactivated
      if (!existingTemplate.tenantId) {
        if (body.isActive !== undefined && Object.keys(body).length === 1) {
          const [updated] = await db
            .update(inspectionTemplates)
            .set({ isActive: body.isActive, updatedAt: new Date() })
            .where(eq(inspectionTemplates.id, id))
            .returning()

          return NextResponse.json(updated)
        }
        return NextResponse.json({ error: 'Cannot modify system default templates' }, { status: 403 })
      }

      // Verify ownership
      if (existingTemplate.tenantId !== session!.user.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      const { name, description, vehicleTypeId, inspectionType, isDefault, isActive } = body

      const [updated] = await db
        .update(inspectionTemplates)
        .set({
          name: name ?? existingTemplate.name,
          description: description !== undefined ? description : existingTemplate.description,
          vehicleTypeId: vehicleTypeId !== undefined ? vehicleTypeId : existingTemplate.vehicleTypeId,
          inspectionType: inspectionType ?? existingTemplate.inspectionType,
          isDefault: isDefault ?? existingTemplate.isDefault,
          isActive: isActive ?? existingTemplate.isActive,
          updatedAt: new Date(),
        })
        .where(eq(inspectionTemplates.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'inspection-template', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/inspection-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to update inspection template' }, { status: 500 })
  }
}

// DELETE inspection template (only tenant's own)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInspectionTemplates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const existingTemplate = await db.query.inspectionTemplates.findFirst({
        where: eq(inspectionTemplates.id, id),
      })

      if (!existingTemplate) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      if (!existingTemplate.tenantId) {
        return NextResponse.json({ error: 'Cannot delete system default templates' }, { status: 403 })
      }

      if (existingTemplate.tenantId !== session!.user.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      // Soft delete by deactivating
      const [updated] = await db
        .update(inspectionTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(inspectionTemplates.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'inspection-template', 'deleted', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/inspection-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete inspection template' }, { status: 500 })
  }
}
