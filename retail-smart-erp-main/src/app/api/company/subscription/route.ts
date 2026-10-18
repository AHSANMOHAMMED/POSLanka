import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant, db } from '@/lib/db'
import { pricingTiers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/company/subscription - Get current company's subscription status
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (tenantDb) => {
      // Get subscription (RLS scopes to tenant)
      const subscription = await tenantDb.query.subscriptions.findFirst()

      if (!subscription) {
        return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
      }

      // Get tier name - pricingTiers is a global table without RLS
      let tierName = 'Free'
      if (subscription.tierId) {
        const tier = await db.query.pricingTiers.findFirst({
          where: eq(pricingTiers.id, subscription.tierId),
        })
        if (tier) {
          tierName = tier.displayName
        }
      }

      return NextResponse.json({
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        tierName,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      })
    })
  } catch (error) {
    logError('api/company/subscription', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
