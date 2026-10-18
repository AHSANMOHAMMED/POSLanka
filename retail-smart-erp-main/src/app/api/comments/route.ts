import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { documentComments, users } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { z } from 'zod'

const getCommentsSchema = z.object({
  documentType: z.string().min(1).max(50),
  documentId: z.string().uuid(),
})

const createCommentSchema = z.object({
  documentType: z.string().min(1).max(50),
  documentId: z.string().uuid(),
  content: z.string().min(1).max(5000),
})

// GET /api/comments?documentType=purchase_order&documentId=xxx
export async function GET(request: NextRequest) {
  try {
    const paramsParsed = validateSearchParams(request, getCommentsSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { documentType, documentId } = paramsParsed.data

    const result = await withAuthTenant(async (session, db) => {
      const comments = await db
        .select({
          id: documentComments.id,
          content: documentComments.content,
          createdAt: documentComments.createdAt,
          userId: documentComments.userId,
          user: {
            fullName: users.fullName,
          },
        })
        .from(documentComments)
        .leftJoin(users, eq(documentComments.userId, users.id))
        .where(
          and(
            eq(documentComments.documentType, documentType),
            eq(documentComments.documentId, documentId)
          )
        )
        .orderBy(desc(documentComments.createdAt))
        .limit(100)

      return { data: comments }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    logError('api/comments/GET', error)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }
}

// POST /api/comments
export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, createCommentSchema)
    if (!parsed.success) return parsed.response
    const { documentType, documentId, content } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      const [comment] = await db
        .insert(documentComments)
        .values({
          tenantId: session.user.tenantId,
          documentType,
          documentId,
          userId: session.user.id,
          content,
        })
        .returning()

      // Broadcast so other users see the comment in real-time
      const entityType = documentType.replace(/_/g, '-') as Parameters<typeof logAndBroadcast>[1]
      logAndBroadcast(session.user.tenantId, entityType, 'updated', documentId, {
        userId: session.user.id,
        description: `Added comment on ${documentType} ${documentId}`,
        activityAction: 'update',
      })

      return { data: comment }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error instanceof NextResponse ? result.error : NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logError('api/comments/POST', error)
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 })
  }
}
