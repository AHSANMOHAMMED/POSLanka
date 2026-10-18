import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

const INACTIVITY_LIMIT_MS = 3 * 60 * 60 * 1000 // 3 hours

/**
 * Validates the current company session against the database.
 * Returns 401 if user/tenant no longer exists, user is inactive,
 * or if the user has been inactive for more than 3 hours.
 */
export async function GET() {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ valid: false }, { status: 401 })
    }

    const tenantId = session.user.tenantId

    // Validate tenant and user
    if (tenantId) {
      const tenant = await db.query.tenants.findFirst({
        where: and(
          eq(tenants.id, tenantId),
          eq(tenants.status, 'active')
        ),
        columns: { id: true },
      })

      if (!tenant) {
        return NextResponse.json(
          { valid: false, reason: 'Business not found or inactive' },
          { status: 401 }
        )
      }

      // Validate user exists and is active, and check inactivity
      const userId = session.user.id
      if (userId) {
        const user = await withTenant(tenantId, async (tdb) => {
          return tdb.query.users.findFirst({
            where: and(
              eq(users.id, userId),
              eq(users.isActive, true)
            ),
            columns: { id: true, lastActiveAt: true },
          })
        })

        if (!user) {
          return NextResponse.json(
            { valid: false, reason: 'Access revoked' },
            { status: 401 }
          )
        }

        // Check if user has been inactive for more than 3 hours
        if (user.lastActiveAt) {
          const elapsed = Date.now() - new Date(user.lastActiveAt).getTime()
          if (elapsed > INACTIVITY_LIMIT_MS) {
            return NextResponse.json(
              { valid: false, reason: 'Session expired due to inactivity' },
              { status: 401 }
            )
          }
        }
      }
    }

    return NextResponse.json({ valid: true })
  } catch (error) {
    logError('api/auth/validate', error)
    return NextResponse.json(
      { valid: false, reason: 'Validation error' },
      { status: 500 }
    )
  }
}
