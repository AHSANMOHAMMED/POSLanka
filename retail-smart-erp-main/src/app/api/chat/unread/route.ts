import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { staffChatParticipants } from '@/lib/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'

// GET - Get total unread count across all conversations
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const [result] = await db
        .select({
          totalUnread: sql<number>`COALESCE(SUM(${staffChatParticipants.unreadCount}), 0)::int`,
        })
        .from(staffChatParticipants)
        .where(
          and(
            eq(staffChatParticipants.userId, session.user.id),
            isNull(staffChatParticipants.leftAt)
          )
        )

      return NextResponse.json({ unreadCount: result?.totalUnread || 0 })
    })
  } catch (error) {
    console.error('Failed to get chat unread count:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
