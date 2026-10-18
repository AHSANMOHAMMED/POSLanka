import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { conversations, messages } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { accountMessageReplySchema, accountMessageActionSchema } from '@/lib/validation/schemas/account'
import { z } from 'zod'

// GET /api/account/messages/[conversationId] - Get conversation messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ conversationId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { conversationId } = paramsParsed.data

    // Verify ownership
    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.accountId, session.user.accountId)
      ),
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Get messages
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))

    // Mark as read by account
    if (conversation.unreadByAccount) {
      await db.update(conversations)
        .set({ unreadByAccount: false })
        .where(eq(conversations.id, conversationId))
    }

    return NextResponse.json({ conversation, messages: msgs })
  } catch (error) {
    logError('api/account/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/account/messages/[conversationId] - Send reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ conversationId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { conversationId } = paramsParsed.data

    const parsed = await validateBody(request, accountMessageReplySchema)
    if (!parsed.success) return parsed.response
    const { content } = parsed.data

    // Verify ownership
    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.accountId, session.user.accountId)
      ),
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (conversation.status === 'closed') {
      return NextResponse.json({ error: 'Conversation is closed' }, { status: 400 })
    }

    const now = new Date()

    const [msg] = await db.insert(messages).values({
      conversationId,
      senderType: 'account',
      senderId: session.user.accountId,
      senderName: session.user.name || 'User',
      content: content.trim(),
    }).returning()

    await db.update(conversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: content.substring(0, 200),
        unreadByAdmin: true,
        unreadByAccount: false,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversationId))

    broadcastAccountChange(session.user.accountId!, 'account-message', 'created', msg.id)

    return NextResponse.json(msg, { status: 201 })
  } catch (error) {
    logError('api/account/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/account/messages/[conversationId] - Close/reopen conversation
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ conversationId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { conversationId } = paramsParsed.data

    const parsed = await validateBody(request, accountMessageActionSchema)
    if (!parsed.success) return parsed.response
    const { action } = parsed.data

    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.accountId, session.user.accountId)
      ),
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const now = new Date()

    if (action === 'close') {
      await db.update(conversations)
        .set({ status: 'closed', closedAt: now, closedBy: 'account', updatedAt: now })
        .where(eq(conversations.id, conversationId))
    } else if (action === 'reopen') {
      await db.update(conversations)
        .set({ status: 'open', closedAt: null, closedBy: null, updatedAt: now })
        .where(eq(conversations.id, conversationId))
    }

    broadcastAccountChange(session.user.accountId!, 'account-message', 'updated', conversationId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
