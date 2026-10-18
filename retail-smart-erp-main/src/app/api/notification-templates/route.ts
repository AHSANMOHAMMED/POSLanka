import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { eq, desc, and, ilike, or, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { notificationTemplates } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { notificationTemplatesListSchema, createNotificationTemplateSchema } from '@/lib/validation/schemas/settings'

// GET - List notification templates
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, notificationTemplatesListSchema)
    if (!parsed.success) return parsed.response
    const { search, channel, all, page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions
      const conditions = [eq(notificationTemplates.tenantId, session.user.tenantId)]

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(notificationTemplates.name, `%${escaped}%`),
            ilike(notificationTemplates.smsContent, `%${escaped}%`),
            ilike(notificationTemplates.emailSubject, `%${escaped}%`)
          )!
        )
      }

      if (channel && channel !== 'all') {
        conditions.push(eq(notificationTemplates.channel, channel))
      }

      if (all) {
        // Return all templates (for dropdowns)
        const templates = await db
          .select({
            id: notificationTemplates.id,
            name: notificationTemplates.name,
            channel: notificationTemplates.channel,
            isActive: notificationTemplates.isActive,
          })
          .from(notificationTemplates)
          .where(and(...conditions))
          .orderBy(notificationTemplates.name)
          .limit(1000)

        return NextResponse.json(templates)
      }

      // Paginated query
      const templates = await db
        .select({
          id: notificationTemplates.id,
          name: notificationTemplates.name,
          channel: notificationTemplates.channel,
          triggerEvent: notificationTemplates.triggerEvent,
          isAutoTrigger: notificationTemplates.isAutoTrigger,
          smsContent: notificationTemplates.smsContent,
          emailSubject: notificationTemplates.emailSubject,
          isActive: notificationTemplates.isActive,
          createdBy: notificationTemplates.createdBy,
          createdAt: notificationTemplates.createdAt,
          updatedAt: notificationTemplates.updatedAt,
        })
        .from(notificationTemplates)
        .where(and(...conditions))
        .orderBy(desc(notificationTemplates.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      // Get total count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationTemplates)
        .where(and(...conditions))

      const total = Number(countResult?.count) || 0

      return NextResponse.json({
        data: templates,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/notification-templates', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

// POST - Create notification template
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createNotificationTemplateSchema)
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
      const [template] = await db
        .insert(notificationTemplates)
        .values({
          tenantId: session.user.tenantId,
          name,
          channel,
          triggerEvent: triggerEvent || null,
          isAutoTrigger: isAutoTrigger || false,
          smsContent: smsContent || null,
          emailSubject: emailSubject || null,
          emailBody: emailBody || null,
          isActive,
          createdBy: session.user.id,
        })
        .returning()

      logAndBroadcast(session.user.tenantId, 'notification-template', 'created', template.id, { userId: session.user.id, entityName: template.name })
      return NextResponse.json(template, { status: 201 })
    })
  } catch (error) {
    logError('api/notification-templates', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
