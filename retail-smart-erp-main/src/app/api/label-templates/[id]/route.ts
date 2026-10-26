import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { labelTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { updateLabelTemplateSchema } from '@/lib/validation/schemas/label-templates'
import { LABEL_PRESETS } from '@/lib/labels/presets'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    if (!UUID_REGEX.test(id)) {
      const cleanId = id.startsWith('preset-') ? id.replace(/^preset-/, '') : id
      const preset = LABEL_PRESETS.find(p => p.id === cleanId || p.id === id)
      if (preset) {
        return NextResponse.json({
          id,
          name: preset.name,
          description: preset.description,
          widthMm: String(preset.widthMm),
          heightMm: String(preset.heightMm),
          columns: preset.columns ?? (preset.widthMm === 38 && preset.heightMm === 25 ? 2 : 1),
          labelShape: preset.labelShape,
          cornerRadius: preset.cornerRadius ?? null,
          elements: preset.elements,
          isDefault: false,
          isActive: true,
        })
      }
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

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

      // If updating a preset (non-UUID), clone & insert it as a new tenant custom template
      if (!UUID_REGEX.test(id)) {
        if (parsed.data.isDefault) {
          await db.update(labelTemplates)
            .set({ isDefault: false })
            .where(and(
              eq(labelTemplates.tenantId, session.user.tenantId),
              eq(labelTemplates.isDefault, true)
            ))
        }

        const [created] = await db.insert(labelTemplates).values({
          tenantId: session.user.tenantId,
          name: parsed.data.name || 'Custom Label Template',
          description: parsed.data.description || null,
          widthMm: String(parsed.data.widthMm || 50),
          heightMm: String(parsed.data.heightMm || 30),
          columns: parsed.data.columns ?? (Number(parsed.data.widthMm) === 38 && Number(parsed.data.heightMm) === 25 ? 2 : 1),
          labelShape: parsed.data.labelShape || 'rectangle',
          cornerRadius: parsed.data.cornerRadius ?? null,
          elements: (parsed.data.elements || []) as unknown as import('@/lib/labels/types').LabelElement[],
          isDefault: parsed.data.isDefault || false,
          isActive: true,
          createdBy: session.user.id,
        }).returning()

        if (!created) return null
        logAndBroadcast(session.user.tenantId, 'label-template', 'created', created.id, { userId: session.user.id, entityName: created.name })
        return created
      }

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
      if (parsed.data.columns !== undefined) updateData.columns = parsed.data.columns
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

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Built-in presets cannot be deleted' }, { status: 400 })
  }

  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { _response: permError }

      // Vendors never hard-delete: archive + recycle bin (only a super admin restores or purges)
      const binned = await moveToRecycleBin(db, {
        tenantId: session.user.tenantId, entityType: 'label_template', entityId: id,
        userId: session.user.id, userName: session.user.name,
      })

      if (!binned) return null

      logAndBroadcast(session.user.tenantId, 'label-template', 'deleted', id, { userId: session.user.id, entityName: binned.displayName })
      return { success: true, archived: true, recycleBinId: binned.binId }
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
