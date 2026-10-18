import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const INACTIVITY_LIMIT_MS = 3 * 60 * 60 * 1000 // 3 hours

/**
 * Heartbeat endpoint — called periodically by the client when the user is active.
 * Updates `lastActiveAt` on the user record so the server knows the user is still
 * interacting. Also returns whether the session is still valid (not expired due to
 * inactivity).
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ valid: false }, { status: 401 })
    }

    const now = new Date()
    const tenantId = session.user.tenantId

    if (tenantId) {
      const user = await withTenant(tenantId, async (tdb) => {
        return tdb.query.users.findFirst({
          where: eq(users.id, session.user.id),
          columns: { id: true, lastActiveAt: true },
        })
      })

      if (!user) {
        return NextResponse.json({ valid: false }, { status: 401 })
      }

      // If lastActiveAt is older than 3 hours, session has expired
      if (user.lastActiveAt) {
        const elapsed = now.getTime() - new Date(user.lastActiveAt).getTime()
        if (elapsed > INACTIVITY_LIMIT_MS) {
          return NextResponse.json(
            { valid: false, reason: 'Session expired due to inactivity' },
            { status: 401 }
          )
        }
      }

      // Update users.lastActiveAt
      await withTenant(tenantId, async (tdb) => {
        return tdb.update(users)
          .set({ lastActiveAt: now })
          .where(eq(users.id, session.user.id))
      })
    }

    return NextResponse.json({ valid: true })
  } catch {
    return NextResponse.json(
      { valid: false, reason: 'Heartbeat error' },
      { status: 500 }
    )
  }
}
