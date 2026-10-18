import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversations, messages, accounts } from '@/lib/db/schema'
import { eq, desc, and, sql, ilike, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysCreateConversationSchema } from '@/lib/validation/schemas/sys-control'

// GET /api/sys-control/messages - List all conversations
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20'), 100)
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const search = searchParams.get('search')

    const conditions = []
    if (status && status !== 'all') {
      conditions.push(eq(conversations.status, status))
    }
    if (priority && priority !== 'all') {
      conditions.push(eq(conversations.priority, priority))
    }
    if (search) {
      const escaped = escapeLikePattern(search)
      conditions.push(or(
        ilike(conversations.subject, `%${escaped}%`),
        ilike(conversations.lastMessagePreview, `%${escaped}%`)
      ))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(whereClause)

    const total = countResult?.count ?? 0

    const data = await db
      .select({
        conversation: conversations,
        account: {
          id: accounts.id,
          email: accounts.email,
          fullName: accounts.fullName,
        },
      })
      .from(conversations)
      .innerJoin(accounts, eq(conversations.accountId, accounts.id))
      .where(whereClause)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({
      data: data.map(d => ({ ...d.conversation, account: d.account })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    logError('api/sys-control/messages', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/sys-control/messages - Admin initiates conversation
export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysCreateConversationSchema)
    if (!parsed.success) return parsed.response
    const { accountId, subject, category, priority, message: content } = parsed.data

    // Verify account exists
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({
        accountId,
        subject: subject.trim(),
        category: category || 'general',
        priority: priority || 'normal',
        lastMessagePreview: content.substring(0, 200),
        unreadByAdmin: false,
        unreadByAccount: true,
      }).returning()

      const [msg] = await tx.insert(messages).values({
        conversationId: conversation.id,
        senderType: 'admin',
        senderId: null,
        senderName: 'Support Team',
        content: content.trim(),
      }).returning()

      return { conversation, message: msg }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/sys-control/messages', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
