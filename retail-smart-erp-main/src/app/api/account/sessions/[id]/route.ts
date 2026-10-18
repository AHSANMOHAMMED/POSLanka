import { NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { revokeSession } from '@/lib/auth/session-manager'
import { db } from '@/lib/db'
import { accountSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

/**
 * DELETE /api/account/sessions/[id] — Revoke a single session by ID.
 * Validates that the session belongs to the current account.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await accountAuth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Verify the session belongs to this account
    const targetSession = await db.query.accountSessions.findFirst({
      where: and(
        eq(accountSessions.id, id),
        eq(accountSessions.accountId, session.user.accountId),
      ),
      columns: {
        id: true,
        sessionToken: true,
        isRevoked: true,
      },
    })

    if (!targetSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (targetSession.isRevoked) {
      return NextResponse.json({ error: 'Session already revoked' }, { status: 400 })
    }

    // Prevent revoking current session
    if (session.user.sessionToken && targetSession.sessionToken === session.user.sessionToken) {
      return NextResponse.json({ error: 'Cannot revoke your current session' }, { status: 400 })
    }

    await revokeSession(id, 'user_revoked')

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/sessions/[id] DELETE', error)
    return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 })
  }
}
