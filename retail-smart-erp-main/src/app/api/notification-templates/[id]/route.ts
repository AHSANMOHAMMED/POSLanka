import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { notificationTemplates } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { normalizeTriggerEvent } from '@/lib/notifications/types'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateNotificationTemplateSchema } from '@/lib/validation/schemas/settings'
import { moveToRecycleBin } from '@/lib/recycle-bin'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET - Get single notification template
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [template] = await db
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.id, id),
            eq(notificationTemplates.tenantId, session.user.tenantId)
          )
        )

      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      return NextResponse.json(template)
    })
  } catch (error) {
    logError('api/notification-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
}

// PUT - Update notification template
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = await validateBody(request, updateNotificationTemplateSchema)
    if (!parsed.success) return parsed.response
    const {
      name,
      channel,
      triggerEvent,
      isAutoTrigger,
      smsContent,
      emailSubject,
      emailBody,
      isActive,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if template exists
      const [existing] = await db
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.id, id),
            eq(notificationTemplates.tenantId, session.user.tenantId)
          )
        )

      if (!existing) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      // Build update object
      const updateData: Partial<typeof notificationTemplates.$inferInsert> = {
        updatedAt: new Date(),
      }

      if (name !== undefined) updateData.name = name
      if (channel !== undefined) updateData.channel = channel
      if (triggerEvent !== undefined) updateData.triggerEvent = normalizeTriggerEvent(triggerEvent)
      if (isAutoTrigger !== undefined) updateData.isAutoTrigger = isAutoTrigger
      if (smsContent !== undefined) updateData.smsContent = smsContent
      if (emailSubject !== undefined) updateData.emailSubject = emailSubject
      if (emailBody !== undefined) updateData.emailBody = emailBody
      if (isActive !== undefined) updateData.isActive = isActive

      const [template] = await db
        .update(notificationTemplates)
        .set(updateData)
        .where(
          and(
            eq(notificationTemplates.id, id),
            eq(notificationTemplates.tenantId, session.user.tenantId)
          )
        )
        .returning()

      logAndBroadcast(session.user.tenantId, 'notification-template', 'updated', template.id, { userId: session.user.id, entityName: template.name })
      return NextResponse.json(template)
    })
  } catch (error) {
    logError('api/notification-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE - Delete notification template
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if template exists
      const [existing] = await db
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.id, id),
            eq(notificationTemplates.tenantId, session.user.tenantId)
          )
        )

      if (!existing) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      // Vendors never hard-delete: archive + recycle bin (only a super admin can restore or purge)
      const binned = await moveToRecycleBin(db, {
        tenantId: session.user.tenantId, entityType: 'notification_template', entityId: id, userId: session.user.id, userName: session.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      logAndBroadcast(session.user.tenantId, 'notification-template', 'deleted', id, { userId: session.user.id })
      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/notification-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
