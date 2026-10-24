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
import { otherFieldsSet, setDefaultHidden } from '@/lib/defaults/hidden-defaults'
import { moveToRecycleBin } from '@/lib/recycle-bin'

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

      // System defaults (tenantId is null) are shared by every company and read-only for tenants (RLS).
      // {isActive} alone hides / re-shows the template for THIS company only (tenant_hidden_defaults).
      if (!existingTemplate.tenantId) {
        if (typeof body.isActive === 'boolean' && otherFieldsSet(body).length === 0) {
          const hidden = !body.isActive
          await setDefaultHidden(db, session!.user.tenantId, 'inspection_template', id, hidden, session!.user.id)
          logAndBroadcast(session!.user.tenantId, 'inspection-template', 'updated', id, {
            userId: session!.user.id,
            entityName: existingTemplate.name,
            description: hidden ? 'Hid system inspection template for this company' : 'Restored system inspection template for this company',
          })
          return NextResponse.json({ ...existingTemplate, hidden })
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

// PATCH — same as PUT; on a system default only {isActive} is accepted (per-company hide/show)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(request, context)
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

      // Vendors never hard-delete: archive + recycle bin (only a super admin can restore or purge)
      const binned = await moveToRecycleBin(db, {
        tenantId: session!.user.tenantId, entityType: 'inspection_template', entityId: id, userId: session!.user.id, userName: session!.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'inspection-template', 'deleted', id)

      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/inspection-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete inspection template' }, { status: 500 })
  }
}
