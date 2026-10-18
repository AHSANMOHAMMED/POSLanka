import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { staffChatParticipants } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST - Mark conversation as read
export async function POST(
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
      await db.update(staffChatParticipants).set({
        unreadCount: 0,
        lastReadAt: new Date(),
      }).where(
        and(
          eq(staffChatParticipants.conversationId, id),
          eq(staffChatParticipants.userId, userId),
          isNull(staffChatParticipants.leftAt)
        )
      )

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('Failed to mark chat as read:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
