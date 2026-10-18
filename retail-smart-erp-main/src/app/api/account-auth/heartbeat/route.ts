import { NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { touchSession } from '@/lib/auth/session-manager'

const INACTIVITY_LIMIT_MS = 3 * 60 * 60 * 1000 // 3 hours

/**
 * Account heartbeat endpoint — called periodically by the client when active.
 * Updates lastActiveAt on the account.
 */
export async function POST() {
  try {
    const session = await accountAuth()
    if (!session?.user?.id) {
      return NextResponse.json({ valid: false }, { status: 401 })
    }

    const accountId = session.user.accountId || session.user.id
    const now = new Date()

    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { id: true, lastActiveAt: true },
    })

    if (!account) {
      return NextResponse.json({ valid: false }, { status: 401 })
    }

    // Check inactivity
    if (account.lastActiveAt) {
      const elapsed = now.getTime() - new Date(account.lastActiveAt).getTime()
      if (elapsed > INACTIVITY_LIMIT_MS) {
        return NextResponse.json(
          { valid: false, reason: 'Session expired due to inactivity' },
          { status: 401 }
        )
      }
    }

    // Update lastActiveAt
    await db.update(accounts)
      .set({ lastActiveAt: now })
      .where(eq(accounts.id, accountId))

    // Touch DB session to extend expiry
    if (session.user.sessionToken) {
      touchSession(session.user.sessionToken).catch(() => {})
    }

    return NextResponse.json({ valid: true })
  } catch {
    return NextResponse.json(
      { valid: false, reason: 'Heartbeat error' },
      { status: 500 }
    )
  }
}
