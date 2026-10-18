import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { conversations, messages } from '@/lib/db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { createMessageSchema, messagesListSchema } from '@/lib/validation/schemas/auth'

// GET /api/account/messages - List conversations
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, messagesListSchema)
    if (!parsed.success) return parsed.response

    const { page, pageSize, status } = parsed.data

    const conditions = [eq(conversations.accountId, session.user.accountId)]
    if (status && status !== 'all') {
      conditions.push(eq(conversations.status, status))
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(...conditions))

    const total = countResult?.count ?? 0

    const data = await db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    logError('api/account/messages', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/account/messages - Create new conversation
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed2 = await validateBody(request, createMessageSchema)
    if (!parsed2.success) return parsed2.response

    const { subject, category, priority, message: content } = parsed2.data

    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({
        accountId: session.user.accountId!,
        subject: subject.trim(),
        category: category || 'general',
        priority: priority || 'normal',
        lastMessagePreview: content.substring(0, 200),
        unreadByAdmin: true,
        unreadByAccount: false,
      }).returning()

      const [msg] = await tx.insert(messages).values({
        conversationId: conversation.id,
        senderType: 'account',
        senderId: session.user.accountId!,
        senderName: session.user.name || 'User',
        content: content.trim(),
      }).returning()

      return { conversation, message: msg }
    })

    broadcastAccountChange(session.user.accountId!, 'account-message', 'created', result.conversation.id)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/account/messages', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
