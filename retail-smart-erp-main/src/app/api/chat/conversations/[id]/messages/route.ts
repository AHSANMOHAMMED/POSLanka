import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { staffChatConversations, staffChatParticipants, staffChatMessages } from '@/lib/db/schema'
import { eq, and, isNull, desc, lt, sql, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sendMessageSchema } from '@/lib/validation/schemas/chat'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - Get messages for a conversation (cursor-based pagination)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const before = searchParams.get('before') // message ID for cursor
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify user is a participant
      const [participation] = await db
        .select()
        .from(staffChatParticipants)
        .where(
          and(
            eq(staffChatParticipants.conversationId, id),
            eq(staffChatParticipants.userId, userId),
            isNull(staffChatParticipants.leftAt)
          )
        )

      if (!participation) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      // Build query conditions
      const conditions = [eq(staffChatMessages.conversationId, id)]

      if (before) {
        // Get the createdAt of the cursor message
        const [cursorMsg] = await db
          .select({ createdAt: staffChatMessages.createdAt })
          .from(staffChatMessages)
          .where(eq(staffChatMessages.id, before))

        if (cursorMsg) {
          conditions.push(lt(staffChatMessages.createdAt, cursorMsg.createdAt))
        }
      }

      const msgs = await db
        .select()
        .from(staffChatMessages)
        .where(and(...conditions))
        .orderBy(desc(staffChatMessages.createdAt))
        .limit(limit + 1) // +1 to check if there are more

      const hasMore = msgs.length > limit
      const messages = msgs.slice(0, limit).reverse() // Reverse to chronological order

      return NextResponse.json({
        messages: messages.map(m => ({
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.deletedAt ? null : m.content,
          messageType: m.messageType,
          metadata: m.metadata,
          isDeleted: !!m.deletedAt,
          isEdited: !!m.editedAt,
          createdAt: m.createdAt,
        })),
        hasMore,
        nextCursor: hasMore ? messages[0]?.id : null,
      })
    })
  } catch (error) {
    console.error('Failed to fetch chat messages:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const userId = session.user.id
    const tenantId = session.user.tenantId

    const parsed = await validateBody(request, sendMessageSchema)
    if (!parsed.success) return parsed.response
    const { content } = parsed.data

    return await withTenant(tenantId, async (db) => {
      // Verify user is a participant
      const [participation] = await db
        .select()
        .from(staffChatParticipants)
        .where(
          and(
            eq(staffChatParticipants.conversationId, id),
            eq(staffChatParticipants.userId, userId),
            isNull(staffChatParticipants.leftAt)
          )
        )

      if (!participation) {
        return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
      }

      const senderName = session.user.name || 'Unknown'
      const preview = content.trim().slice(0, 100)

      // Create message
      const [message] = await db.insert(staffChatMessages).values({
        conversationId: id,
        tenantId,
        senderId: userId,
        senderName,
        content: content.trim(),
      }).returning()

      // Update conversation cache
      await db.update(staffChatConversations).set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview,
        lastMessageSenderName: senderName,
        updatedAt: new Date(),
      }).where(eq(staffChatConversations.id, id))

      // Increment unread count for all other active participants
      await db.update(staffChatParticipants).set({
        unreadCount: sql`${staffChatParticipants.unreadCount} + 1`,
      }).where(
        and(
          eq(staffChatParticipants.conversationId, id),
          isNull(staffChatParticipants.leftAt),
          ne(staffChatParticipants.userId, userId)
        )
      )

      // Broadcast to tenant
      logAndBroadcast(tenantId, 'staff-chat', 'created', message.id, undefined, {
        conversationId: id,
        senderId: userId,
        senderName,
        preview,
      })

      return NextResponse.json({
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: message.senderName,
        content: message.content,
        messageType: message.messageType,
        isDeleted: false,
        isEdited: false,
        createdAt: message.createdAt,
      })
    })
  } catch (error) {
    console.error('Failed to send chat message:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
