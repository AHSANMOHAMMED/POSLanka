import { NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { listActiveSessions, revokeAllSessions } from '@/lib/auth/session-manager'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { deleteSessionsSchema } from '@/lib/validation/schemas/account'

/**
 * GET /api/account/sessions — List all active sessions for the current account.
 * Returns sessions with an `isCurrent` flag for the caller's session.
 */
export async function GET() {
  try {
    const session = await accountAuth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = session.user.accountId
    const currentToken = session.user.sessionToken

    const sessions = await listActiveSessions(accountId, currentToken || undefined)

    return NextResponse.json({ sessions })
  } catch (error) {
    logError('api/account/sessions GET', error)
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 })
  }
}

/**
 * DELETE /api/account/sessions — Revoke all sessions.
 * Body: { exceptCurrent?: boolean }
 * If exceptCurrent is true, keeps the caller's session alive.
 */
export async function DELETE(request: Request) {
  try {
    const session = await accountAuth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, deleteSessionsSchema)
    if (!parsed.success) return parsed.response
    const exceptCurrent = parsed.data.exceptCurrent === true
    const currentToken = session.user.sessionToken

    await revokeAllSessions(
      session.user.accountId,
      exceptCurrent && currentToken ? currentToken : undefined,
      'user_revoked_all'
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/sessions DELETE', error)
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 })
  }
}
