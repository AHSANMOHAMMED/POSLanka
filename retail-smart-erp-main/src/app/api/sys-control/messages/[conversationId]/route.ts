import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversations, messages, accounts } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysReplyMessageSchema, sysUpdateConversationSchema } from '@/lib/validation/schemas/sys-control'
import { z } from 'zod'

// GET /api/sys-control/messages/[conversationId] - Get conversation with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ conversationId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { conversationId } = paramsParsed.data

    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Get account info
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, conversation.accountId),
    })

    // Get messages
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))

    // Mark as read by admin
    if (conversation.unreadByAdmin) {
      await db.update(conversations)
        .set({ unreadByAdmin: false })
        .where(eq(conversations.id, conversationId))
    }

    return NextResponse.json({
      conversation,
      account: account ? { id: account.id, email: account.email, fullName: account.fullName } : null,
      messages: msgs,
    })
  } catch (error) {
    logError('api/sys-control/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/sys-control/messages/[conversationId] - Admin reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ conversationId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { conversationId } = paramsParsed.data
    const parsed = await validateBody(request, sysReplyMessageSchema)
    if (!parsed.success) return parsed.response
    const { content } = parsed.data

    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const now = new Date()

    const [msg] = await db.insert(messages).values({
      conversationId,
      senderType: 'admin',
      senderId: null,
      senderName: 'Support Team',
      content: content.trim(),
    }).returning()

    await db.update(conversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: content.substring(0, 200),
        unreadByAccount: true,
        unreadByAdmin: false,
        updatedAt: now,
        // Reopen if closed
        ...(conversation.status === 'closed' ? { status: 'open', closedAt: null, closedBy: null } : {}),
      })
      .where(eq(conversations.id, conversationId))

    return NextResponse.json(msg, { status: 201 })
  } catch (error) {
    logError('api/sys-control/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/sys-control/messages/[conversationId] - Update status/priority
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ conversationId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { conversationId } = paramsParsed.data
    const parsed = await validateBody(request, sysUpdateConversationSchema)
    if (!parsed.success) return parsed.response
    const { status, priority, action } = parsed.data

    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const now = new Date()
    const updateData: Record<string, unknown> = { updatedAt: now }

    if (action === 'close') {
      updateData.status = 'closed'
      updateData.closedAt = now
      updateData.closedBy = 'admin'
    } else if (action === 'reopen') {
      updateData.status = 'open'
      updateData.closedAt = null
      updateData.closedBy = null
    } else if (action === 'archive') {
      updateData.status = 'archived'
    }

    if (status) {
      updateData.status = status
    }
    if (priority) {
      updateData.priority = priority
    }

    await db.update(conversations)
      .set(updateData)
      .where(eq(conversations.id, conversationId))

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
