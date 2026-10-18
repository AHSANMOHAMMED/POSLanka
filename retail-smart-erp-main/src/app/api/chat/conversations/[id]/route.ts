import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { staffChatConversations, staffChatParticipants, staffChatMessages, users } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateConversationSchema } from '@/lib/validation/schemas/chat'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - Get conversation details + participants
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

      // Get conversation
      const [conversation] = await db
        .select()
        .from(staffChatConversations)
        .where(eq(staffChatConversations.id, id))

      if (!conversation) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      // Get participants with user info
      const participants = await db
        .select({
          userId: staffChatParticipants.userId,
          role: staffChatParticipants.role,
          joinedAt: staffChatParticipants.joinedAt,
          leftAt: staffChatParticipants.leftAt,
          userName: users.fullName,
          userEmail: users.email,
          userRole: users.role,
        })
        .from(staffChatParticipants)
        .innerJoin(users, eq(staffChatParticipants.userId, users.id))
        .where(eq(staffChatParticipants.conversationId, id))

      return NextResponse.json({
        conversation: {
          ...conversation,
          myRole: participation.role,
          isMuted: participation.isMuted,
          unreadCount: participation.unreadCount,
        },
        participants: participants.map(p => ({
          userId: p.userId,
          name: p.userName,
          email: p.userEmail,
          role: p.userRole,
          chatRole: p.role,
          joinedAt: p.joinedAt,
          isActive: !p.leftAt,
        })),
      })
    })
  } catch (error) {
    console.error('Failed to get chat conversation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Update conversation (name, description, mute)
export async function PUT(
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

    const parsed = await validateBody(request, updateConversationSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

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

      // Handle mute toggle (any participant)
      if (body.isMuted !== undefined) {
        await db.update(staffChatParticipants).set({
          isMuted: body.isMuted,
        }).where(eq(staffChatParticipants.id, participation.id))
      }

      // Handle name/description update (group only, admin only)
      if (body.name !== undefined || body.description !== undefined) {
        const [conversation] = await db
          .select()
          .from(staffChatConversations)
          .where(eq(staffChatConversations.id, id))

        if (conversation?.type !== 'group') {
          return NextResponse.json({ error: 'Cannot rename a direct message' }, { status: 400 })
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() }
        if (body.name !== undefined) updateData.name = body.name.trim()
        if (body.description !== undefined) updateData.description = body.description?.trim() || null

        await db.update(staffChatConversations).set(updateData).where(eq(staffChatConversations.id, id))

        logAndBroadcast(session.user.tenantId, 'staff-chat', 'updated', id, undefined, {
          conversationId: id,
          type: 'conversation-updated',
        })
      }

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('Failed to update chat conversation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Leave the conversation (group only)
export async function DELETE(
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
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const [conversation] = await db
        .select()
        .from(staffChatConversations)
        .where(eq(staffChatConversations.id, id))

      if (!conversation || conversation.type !== 'group') {
        return NextResponse.json({ error: 'Can only leave group conversations' }, { status: 400 })
      }

      // Mark participant as left
      await db.update(staffChatParticipants).set({
        leftAt: new Date(),
      }).where(
        and(
          eq(staffChatParticipants.conversationId, id),
          eq(staffChatParticipants.userId, userId),
          isNull(staffChatParticipants.leftAt)
        )
      )

      // Add system message
      const [sysMsg] = await db.insert(staffChatMessages).values({
        conversationId: id,
        tenantId,
        senderId: userId,
        senderName: session.user.name || 'Unknown',
        content: `${session.user.name || 'Someone'} left the group`,
        messageType: 'system',
      }).returning()

      await db.update(staffChatConversations).set({
        lastMessagePreview: sysMsg.content,
        lastMessageSenderName: sysMsg.senderName,
        lastMessageAt: sysMsg.createdAt,
        updatedAt: new Date(),
      }).where(eq(staffChatConversations.id, id))

      logAndBroadcast(tenantId, 'staff-chat', 'updated', id, undefined, {
        conversationId: id,
        type: 'participant-left',
        userId,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('Failed to leave chat conversation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
