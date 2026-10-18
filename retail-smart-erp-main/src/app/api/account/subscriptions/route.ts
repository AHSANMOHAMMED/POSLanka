import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { subscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/account/subscriptions - List all subscriptions for current user
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all subscriptions where user is the billing account
    const userSubscriptions = await db.query.subscriptions.findMany({
      where: eq(subscriptions.billingAccountId, session.user.accountId),
      with: {
        tenant: true,
        tier: true,
      },
    })

    return NextResponse.json(userSubscriptions)
  } catch (error) {
    logError('api/account/subscriptions', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
