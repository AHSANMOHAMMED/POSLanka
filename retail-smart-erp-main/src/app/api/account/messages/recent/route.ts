import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/account/messages/recent - Get 5 most recent conversations
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const recentConversations = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        status: conversations.status,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        unreadByAccount: conversations.unreadByAccount,
      })
      .from(conversations)
      .where(eq(conversations.accountId, session.user.accountId))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(5)

    return NextResponse.json({ conversations: recentConversations })
  } catch (error) {
    logError('api/account/messages/recent', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
