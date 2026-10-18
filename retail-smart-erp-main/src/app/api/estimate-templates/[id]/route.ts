import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { estimateTemplates } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateEstimateTemplateSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// E25: GET single template
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
      const template = await db.query.estimateTemplates.findFirst({
        where: eq(estimateTemplates.id, id),
        with: {
          createdByUser: {
            columns: { fullName: true }
          }
        },
      })

      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      return NextResponse.json(template)
    })
  } catch (error) {
    logError('api/estimate-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
}

// E25: PUT update template
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateEstimateTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, description, itemsTemplate, isActive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify ownership (RLS scopes the query)
      const existing = await db.query.estimateTemplates.findFirst({
        where: eq(estimateTemplates.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      const [updated] = await db.update(estimateTemplates)
        .set({
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(itemsTemplate !== undefined && { itemsTemplate }),
          ...(isActive !== undefined && { isActive }),
          updatedAt: new Date(),
        })
        .where(eq(estimateTemplates.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'estimate-template', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/estimate-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// E25: DELETE template (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify ownership (RLS scopes the query)
      const existing = await db.query.estimateTemplates.findFirst({
        where: eq(estimateTemplates.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      // Soft delete
      await db.update(estimateTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(estimateTemplates.id, id))

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'estimate-template', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/estimate-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
