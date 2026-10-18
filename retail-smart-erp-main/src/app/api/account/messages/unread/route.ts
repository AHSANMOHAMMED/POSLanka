import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

// GET /api/account/messages/unread - Get unread conversation count
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(
        eq(conversations.accountId, session.user.accountId),
        eq(conversations.unreadByAccount, true),
        eq(conversations.status, 'open')
      ))

    return NextResponse.json({ unreadCount: result?.count ?? 0 })
  } catch {
    return NextResponse.json({ unreadCount: 0 })
  }
}
