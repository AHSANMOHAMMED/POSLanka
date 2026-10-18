import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { labelTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { updateLabelTemplateSchema } from '@/lib/validation/schemas/label-templates'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const result = await withAuthTenant(async (session, db) => {
      const [template] = await db.select().from(labelTemplates)
        .where(and(
          eq(labelTemplates.id, id),
          eq(labelTemplates.tenantId, session.user.tenantId)
        ))
      return template || { _notFound: true }
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('_notFound' in result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/label-templates/[id] GET', error)
    return NextResponse.json({ error: 'Failed to fetch label template' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const parsed = await validateBody(request, updateLabelTemplateSchema)
    if (!parsed.success) return parsed.response

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { _response: permError }

      // If setting as default, clear existing default
      if (parsed.data.isDefault) {
        await db.update(labelTemplates)
          .set({ isDefault: false })
          .where(and(
            eq(labelTemplates.tenantId, session.user.tenantId),
            eq(labelTemplates.isDefault, true)
          ))
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description || null
      if (parsed.data.widthMm !== undefined) updateData.widthMm = String(parsed.data.widthMm)
      if (parsed.data.heightMm !== undefined) updateData.heightMm = String(parsed.data.heightMm)
      if (parsed.data.labelShape !== undefined) updateData.labelShape = parsed.data.labelShape
      if (parsed.data.cornerRadius !== undefined) updateData.cornerRadius = parsed.data.cornerRadius
      if (parsed.data.elements !== undefined) updateData.elements = parsed.data.elements
      if (parsed.data.isDefault !== undefined) updateData.isDefault = parsed.data.isDefault
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive

      const [updated] = await db.update(labelTemplates)
        .set(updateData)
        .where(and(
          eq(labelTemplates.id, id),
          eq(labelTemplates.tenantId, session.user.tenantId)
        ))
        .returning()

      if (!updated) return null

      logAndBroadcast(session.user.tenantId, 'label-template', 'updated', updated.id, { userId: session.user.id, entityName: updated.name })
      return updated
    })

    if (result === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (result && '_response' in result) {
      return (result as { _response: NextResponse })._response
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/label-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to update label template' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { _response: permError }

      const [deleted] = await db.delete(labelTemplates)
        .where(and(
          eq(labelTemplates.id, id),
          eq(labelTemplates.tenantId, session.user.tenantId)
        ))
        .returning()

      if (!deleted) return null

      logAndBroadcast(session.user.tenantId, 'label-template', 'deleted', deleted.id, { userId: session.user.id, entityName: deleted.name })
      return { success: true }
    })

    if (result === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (result && '_response' in result) {
      return (result as { _response: NextResponse })._response
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/label-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete label template' }, { status: 500 })
  }
}
