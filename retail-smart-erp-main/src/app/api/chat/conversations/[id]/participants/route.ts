import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { staffChatConversations, staffChatParticipants, staffChatMessages } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addParticipantsSchema, removeParticipantSchema } from '@/lib/validation/schemas/chat'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST - Add participants to a group conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = session.user.tenantId

    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const userId = session.user.id

    const parsed = await validateBody(request, addParticipantsSchema)
    if (!parsed.success) return parsed.response
    const { userIds } = parsed.data

    return await withTenant(tenantId, async (db) => {
      // Verify it's a group conversation
      const [conversation] = await db
        .select()
        .from(staffChatConversations)
        .where(eq(staffChatConversations.id, id))

      if (!conversation || conversation.type !== 'group') {
        return NextResponse.json({ error: 'Can only add participants to group conversations' }, { status: 400 })
      }

      // Verify requester is a participant
      const [myParticipation] = await db
        .select()
        .from(staffChatParticipants)
        .where(
          and(
            eq(staffChatParticipants.conversationId, id),
            eq(staffChatParticipants.userId, userId),
            isNull(staffChatParticipants.leftAt)
          )
        )

      if (!myParticipation) {
        return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
      }

      // Add new participants (ignore duplicates via ON CONFLICT)
      for (const newUserId of userIds) {
        // Check if already a participant (possibly left)
        const [existing] = await db
          .select()
          .from(staffChatParticipants)
          .where(
            and(
              eq(staffChatParticipants.conversationId, id),
              eq(staffChatParticipants.userId, newUserId)
            )
          )

        if (existing && !existing.leftAt) {
          continue // Already active
        }

        if (existing && existing.leftAt) {
          // Re-join
          await db.update(staffChatParticipants).set({
            leftAt: null,
            unreadCount: 0,
            joinedAt: new Date(),
          }).where(eq(staffChatParticipants.id, existing.id))
        } else {
          // New participant
          await db.insert(staffChatParticipants).values({
            conversationId: id,
            userId: newUserId,
            tenantId,
          })
        }
      }

      // System message
      const [sysMsg] = await db.insert(staffChatMessages).values({
        conversationId: id,
        tenantId,
        senderId: userId,
        senderName: session.user.name || 'Unknown',
        content: `${session.user.name || 'Someone'} added ${userIds.length} member${userIds.length > 1 ? 's' : ''}`,
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
        type: 'participants-added',
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('Failed to add chat participants:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a participant from group conversation
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

    const parsed = await validateBody(request, removeParticipantSchema)
    if (!parsed.success) return parsed.response
    const { userId: removeUserId } = parsed.data

    return await withTenant(tenantId, async (db) => {
      // Verify it's a group and requester is admin
      const [myParticipation] = await db
        .select()
        .from(staffChatParticipants)
        .where(
          and(
            eq(staffChatParticipants.conversationId, id),
            eq(staffChatParticipants.userId, userId),
            isNull(staffChatParticipants.leftAt)
          )
        )

      if (!myParticipation || myParticipation.role !== 'admin') {
        return NextResponse.json({ error: 'Only group admins can remove participants' }, { status: 403 })
      }

      // Remove participant
      await db.update(staffChatParticipants).set({
        leftAt: new Date(),
      }).where(
        and(
          eq(staffChatParticipants.conversationId, id),
          eq(staffChatParticipants.userId, removeUserId),
          isNull(staffChatParticipants.leftAt)
        )
      )

      // System message
      const [sysMsg] = await db.insert(staffChatMessages).values({
        conversationId: id,
        tenantId,
        senderId: userId,
        senderName: session.user.name || 'Unknown',
        content: `${session.user.name || 'Someone'} removed a member`,
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
        type: 'participant-removed',
        userId: removeUserId,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('Failed to remove chat participant:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
