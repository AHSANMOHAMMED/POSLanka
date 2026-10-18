import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/roles'
import { withAuthTenant } from '@/lib/db'
import { eq, desc, and, gte, sql, ilike, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { notificationLogs, notificationTemplates, users } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { notificationLogsListSchema } from '@/lib/validation/schemas/settings'

// GET - List notification logs with pagination
export async function GET(request: Request) {
  try {
    const parsed = validateSearchParams(request, notificationLogsListSchema)
    if (!parsed.success) return parsed.response
    const { search, channel, status, startDate, page, pageSize } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'viewActivityLogs')
      if (permError) return { error: permError }

      // Build where conditions - RLS handles tenant filtering
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(notificationLogs.recipientName, `%${escaped}%`),
            ilike(notificationLogs.recipientContact, `%${escaped}%`),
            ilike(notificationLogs.content, `%${escaped}%`),
            ilike(notificationLogs.subject, `%${escaped}%`)
          )!
        )
      }

      if (channel && channel !== 'all') {
        conditions.push(eq(notificationLogs.channel, channel))
      }

      if (status && status !== 'all') {
        conditions.push(eq(notificationLogs.status, status))
      }

      if (startDate) {
        conditions.push(gte(notificationLogs.createdAt, new Date(startDate)))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get logs with pagination
      const logs = await db
        .select({
          id: notificationLogs.id,
          channel: notificationLogs.channel,
          status: notificationLogs.status,
          recipientType: notificationLogs.recipientType,
          recipientName: notificationLogs.recipientName,
          recipientContact: notificationLogs.recipientContact,
          subject: notificationLogs.subject,
          content: notificationLogs.content,
          entityType: notificationLogs.entityType,
          entityReference: notificationLogs.entityReference,
          provider: notificationLogs.provider,
          providerMessageId: notificationLogs.providerMessageId,
          errorMessage: notificationLogs.errorMessage,
          cost: notificationLogs.cost,
          segments: notificationLogs.segments,
          sentAt: notificationLogs.sentAt,
          createdAt: notificationLogs.createdAt,
          templateName: notificationTemplates.name,
          sentByName: users.fullName,
        })
        .from(notificationLogs)
        .leftJoin(notificationTemplates, eq(notificationLogs.templateId, notificationTemplates.id))
        .leftJoin(users, eq(notificationLogs.sentBy, users.id))
        .where(whereClause)
        .orderBy(desc(notificationLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      // Get total count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationLogs)
        .where(whereClause)

      const total = Number(countResult?.count) || 0

      return {
        data: logs,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if ('error' in result && result.error instanceof Response) {
      return result.error
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/notification-logs', error)
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
  }
}
