import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { staffChatConversations, staffChatParticipants, staffChatMessages, users } from '@/lib/db/schema'
import { eq, and, desc, isNull, sql, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createConversationSchema } from '@/lib/validation/schemas/chat'

// GET - List conversations for current user
export async function GET(_request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    return await withTenant(session.user.tenantId, async (db) => {
      // Get conversation IDs where user is an active participant
      const myParticipations = await db
        .select({
          conversationId: staffChatParticipants.conversationId,
          unreadCount: staffChatParticipants.unreadCount,
          isMuted: staffChatParticipants.isMuted,
        })
        .from(staffChatParticipants)
        .where(
          and(
            eq(staffChatParticipants.userId, userId),
            isNull(staffChatParticipants.leftAt)
          )
        )

      if (myParticipations.length === 0) {
        return NextResponse.json({ data: [] })
      }

      const conversationIds = myParticipations.map(p => p.conversationId)
      const unreadMap = new Map(myParticipations.map(p => [p.conversationId, p.unreadCount]))
      const mutedMap = new Map(myParticipations.map(p => [p.conversationId, p.isMuted]))

      // Get conversations
      const convos = await db
        .select()
        .from(staffChatConversations)
        .where(inArray(staffChatConversations.id, conversationIds))
        .orderBy(desc(staffChatConversations.lastMessageAt))

      // Get all participants for these conversations (for DM names and group members)
      const allParticipants = await db
        .select({
          conversationId: staffChatParticipants.conversationId,
          userId: staffChatParticipants.userId,
          role: staffChatParticipants.role,
          leftAt: staffChatParticipants.leftAt,
          userName: users.fullName,
          userEmail: users.email,
          userRole: users.role,
        })
        .from(staffChatParticipants)
        .innerJoin(users, eq(staffChatParticipants.userId, users.id))
        .where(
          and(
            inArray(staffChatParticipants.conversationId, conversationIds),
            isNull(staffChatParticipants.leftAt)
          )
        )

      // Group participants by conversation
      const participantsByConvo = new Map<string, typeof allParticipants>()
      for (const p of allParticipants) {
        const list = participantsByConvo.get(p.conversationId) || []
        list.push(p)
        participantsByConvo.set(p.conversationId, list)
      }

      const data = convos.map(c => {
        const participants = participantsByConvo.get(c.id) || []
        const otherParticipants = participants.filter(p => p.userId !== userId)

        return {
          id: c.id,
          type: c.type,
          name: c.type === 'group' ? c.name : (otherParticipants[0]?.userName || 'Unknown'),
          description: c.description,
          avatarColor: c.avatarColor,
          lastMessageAt: c.lastMessageAt,
          lastMessagePreview: c.lastMessagePreview,
          lastMessageSenderName: c.lastMessageSenderName,
          unreadCount: unreadMap.get(c.id) || 0,
          isMuted: mutedMap.get(c.id) || false,
          participants: participants.map(p => ({
            userId: p.userId,
            name: p.userName,
            email: p.userEmail,
            role: p.userRole,
            chatRole: p.role,
          })),
          createdAt: c.createdAt,
        }
      })

      return NextResponse.json({ data })
    })
  } catch (error) {
    console.error('Failed to fetch chat conversations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new conversation (DM or group)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createConversationSchema)
    if (!parsed.success) return parsed.response
    const { type, participantIds, name, description, avatarColor } = parsed.data
    const userId = session.user.id
    const tenantId = session.user.tenantId

    if (type === 'group' && !name?.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 })
    }

    return await withTenant(tenantId, async (db) => {
      // For DM: check if conversation already exists between these two users
      if (type === 'direct') {
        if (participantIds.length !== 1) {
          return NextResponse.json({ error: 'Direct message requires exactly one other participant' }, { status: 400 })
        }

        const otherUserId = participantIds[0]
        if (otherUserId === userId) {
          return NextResponse.json({ error: 'Cannot create DM with yourself' }, { status: 400 })
        }

        // Find existing DM between these two users
        const existingDM = await db.execute(sql`
          SELECT c.id FROM staff_chat_conversations c
          WHERE c.type = 'direct'
            AND EXISTS (
              SELECT 1 FROM staff_chat_participants p1
              WHERE p1.conversation_id = c.id AND p1.user_id = ${userId} AND p1.left_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM staff_chat_participants p2
              WHERE p2.conversation_id = c.id AND p2.user_id = ${otherUserId} AND p2.left_at IS NULL
            )
          LIMIT 1
        `)

        if (existingDM.rows.length > 0) {
          return NextResponse.json({ conversationId: (existingDM.rows[0] as { id: string }).id, existing: true })
        }
      }

      // Create conversation
      const [conversation] = await db
        .insert(staffChatConversations)
        .values({
          tenantId,
          type,
          name: type === 'group' ? name!.trim() : null,
          description: type === 'group' ? description?.trim() || null : null,
          avatarColor: type === 'group' ? avatarColor || null : null,
          createdBy: userId,
        })
        .returning()

      // Add all participants (including current user)
      const allParticipantIds = [userId, ...participantIds.filter((id: string) => id !== userId)]
      await db.insert(staffChatParticipants).values(
        allParticipantIds.map((pId: string) => ({
          conversationId: conversation.id,
          userId: pId,
          tenantId,
          role: pId === userId ? 'admin' : 'member',
        }))
      )

      // For groups, add a system message
      if (type === 'group') {
        const [sysMsg] = await db.insert(staffChatMessages).values({
          conversationId: conversation.id,
          tenantId,
          senderId: userId,
          senderName: session.user.name || 'Unknown',
          content: `${session.user.name || 'Someone'} created this group`,
          messageType: 'system',
        }).returning()

        await db.update(staffChatConversations).set({
          lastMessagePreview: sysMsg.content,
          lastMessageSenderName: sysMsg.senderName,
          lastMessageAt: sysMsg.createdAt,
        }).where(eq(staffChatConversations.id, conversation.id))
      }

      logAndBroadcast(tenantId, 'staff-chat', 'created', conversation.id, undefined, {
        conversationId: conversation.id,
        type: 'new-conversation',
      })

      return NextResponse.json({ conversationId: conversation.id, existing: false })
    })
  } catch (error) {
    console.error('Failed to create chat conversation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
