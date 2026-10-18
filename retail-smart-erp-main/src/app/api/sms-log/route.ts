import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/roles'
import { withAuthTenant } from '@/lib/db'
import { eq, desc, and, sql, ilike, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { notificationLogs, users } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { smsLogListSchema } from '@/lib/validation/schemas/settings'

// GET - Get SMS logs with pagination
export async function GET(request: Request) {
  try {
    const parsed = validateSearchParams(request, smsLogListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status } = parsed.data

    const offset = (page - 1) * pageSize

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'viewActivityLogs')
      if (permError) return { error: permError }

      // Build where conditions - RLS handles tenant filtering
      const conditions: ReturnType<typeof eq>[] = [
        eq(notificationLogs.channel, 'sms'),
      ]

      if (status) {
        conditions.push(eq(notificationLogs.status, status))
      }

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(notificationLogs.recipientContact, `%${escaped}%`),
            ilike(notificationLogs.recipientName, `%${escaped}%`),
            ilike(notificationLogs.content, `%${escaped}%`)
          )!
        )
      }

      const whereClause = and(...conditions)

      // Get total count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationLogs)
        .where(whereClause)

      const total = Number(countResult.count)

      // Get logs with sender info
      const logs = await db
        .select({
          id: notificationLogs.id,
          status: notificationLogs.status,
          recipientContact: notificationLogs.recipientContact,
          recipientName: notificationLogs.recipientName,
          content: notificationLogs.content,
          segments: notificationLogs.segments,
          providerMessageId: notificationLogs.providerMessageId,
          errorMessage: notificationLogs.errorMessage,
          sentAt: notificationLogs.sentAt,
          createdAt: notificationLogs.createdAt,
          sentBy: notificationLogs.sentBy,
          senderName: users.fullName,
        })
        .from(notificationLogs)
        .leftJoin(users, eq(notificationLogs.sentBy, users.id))
        .where(whereClause)
        .orderBy(desc(notificationLogs.createdAt))
        .limit(pageSize)
        .offset(offset)

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
    logError('api/sms-log', error)
    return NextResponse.json({ error: 'Failed to fetch SMS logs' }, { status: 500 })
  }
}
