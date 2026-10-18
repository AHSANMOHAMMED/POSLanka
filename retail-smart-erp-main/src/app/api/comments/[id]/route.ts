import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { documentComments } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import type { EntityType } from '@/lib/websocket/events'

// DELETE /api/comments/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const result = await withAuthTenant(async (session, db) => {
      // Only the comment author can delete their own comment
      const [deleted] = await db
        .delete(documentComments)
        .where(
          and(
            eq(documentComments.id, id),
            eq(documentComments.userId, session.user.id)
          )
        )
        .returning()

      if (!deleted) {
        return { error: NextResponse.json({ error: 'Comment not found or you are not the author' }, { status: 404 }) }
      }

      // Broadcast so other users see the comment removed in real-time
      const entityType = deleted.documentType.replace(/_/g, '-') as EntityType
      logAndBroadcast(session.user.tenantId, entityType, 'updated', deleted.documentId, { userId: session.user.id })

      return { data: deleted }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error instanceof NextResponse ? result.error : NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/comments/[id]/DELETE', error)
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
  }
}
