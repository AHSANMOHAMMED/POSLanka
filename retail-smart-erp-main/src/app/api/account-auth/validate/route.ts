import { NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSession } from '@/lib/auth/session-manager'

const INACTIVITY_LIMIT_MS = 3 * 60 * 60 * 1000 // 3 hours

/**
 * Validates the current account session against the database.
 * Returns 401 if account no longer exists or user has been inactive for 3+ hours.
 */
export async function GET() {
  try {
    const session = await accountAuth()

    if (!session?.user) {
      return NextResponse.json({ valid: false }, { status: 401 })
    }

    // Check DB session validity (revocation check)
    if (session.user.sessionToken) {
      const dbSession = await validateSession(session.user.sessionToken)
      if (!dbSession) {
        return NextResponse.json(
          { valid: false, reason: 'Session revoked' },
          { status: 401 }
        )
      }
    }

    const accountId = session.user.accountId || session.user.id

    if (accountId) {
      const account = await db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: { id: true, lastActiveAt: true },
      })

      if (!account) {
        return NextResponse.json(
          { valid: false, reason: 'Account not found' },
          { status: 401 }
        )
      }

      // Check inactivity
      if (account.lastActiveAt) {
        const elapsed = Date.now() - new Date(account.lastActiveAt).getTime()
        if (elapsed > INACTIVITY_LIMIT_MS) {
          return NextResponse.json(
            { valid: false, reason: 'Session expired due to inactivity' },
            { status: 401 }
          )
        }
      }
    }

    return NextResponse.json({ valid: true })
  } catch (error) {
    logError('api/account-auth/validate', error)
    return NextResponse.json(
      { valid: false, reason: 'Validation error' },
      { status: 500 }
    )
  }
}
