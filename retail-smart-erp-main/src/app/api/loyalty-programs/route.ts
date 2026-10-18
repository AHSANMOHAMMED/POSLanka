import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { loyaltyPrograms, loyaltyTiers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { upsertLoyaltyProgramSchema } from '@/lib/validation/schemas/loyalty'

// GET - fetch active loyalty program with tiers
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const program = await db.query.loyaltyPrograms.findFirst({
        where: eq(loyaltyPrograms.status, 'active'),
      })

      if (!program) {
        return NextResponse.json(null)
      }

      const tiers = await db.query.loyaltyTiers.findMany({
        where: eq(loyaltyTiers.tenantId, session.user.tenantId),
      })

      return NextResponse.json({ ...program, tiers })
    })
  } catch (error) {
    logError('api/loyalty-programs', error)
    return NextResponse.json({ error: 'Failed to fetch loyalty program' }, { status: 500 })
  }
}

// POST - create or update loyalty program with tiers
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, upsertLoyaltyProgramSchema)
    if (!parsed.success) return parsed.response
    const { name, collectionFactor, conversionFactor, minRedemptionPoints, pointsExpire, expiryDays, tiers: tierData } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if a program already exists
      const existing = await db.query.loyaltyPrograms.findFirst()

      let program
      if (existing) {
        // Update existing
        const [updated] = await db.update(loyaltyPrograms)
          .set({
            name,
            collectionFactor: String(collectionFactor || 1),
            conversionFactor: String(conversionFactor || 0.01),
            minRedemptionPoints: minRedemptionPoints || 100,
            pointsExpire: pointsExpire || false,
            expiryDays: expiryDays || 365,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(loyaltyPrograms.id, existing.id))
          .returning()
        program = updated
      } else {
        // Create new
        const [created] = await db.insert(loyaltyPrograms).values({
          tenantId: session.user.tenantId,
          name,
          collectionFactor: String(collectionFactor || 1),
          conversionFactor: String(conversionFactor || 0.01),
          minRedemptionPoints: minRedemptionPoints || 100,
          pointsExpire: pointsExpire || false,
          expiryDays: expiryDays || 365,
          status: 'active',
        }).returning()
        program = created
      }

      // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.
      // Upsert tiers (delete+insert using the withTenant db directly)
      if (tierData && Array.isArray(tierData)) {
        // Delete existing tiers
        await db.delete(loyaltyTiers)
          .where(eq(loyaltyTiers.tenantId, session.user.tenantId))

        // Insert new tiers
        for (const tier of tierData) {
          await db.insert(loyaltyTiers).values({
            tenantId: session.user.tenantId,
            name: tier.name,
            tier: tier.tier,
            minPoints: tier.minPoints || 0,
            earnRate: String(tier.earnRate || 1),
            redeemRate: String(tier.redeemRate || 1),
            isActive: tier.isActive !== false,
          })
        }
      }

      // Fetch updated tiers
      const tiers = await db.query.loyaltyTiers.findMany({
        where: eq(loyaltyTiers.tenantId, session.user.tenantId),
      })

      logAndBroadcast(session.user.tenantId, 'loyalty-program', 'updated', program.id)

      return NextResponse.json({ ...program, tiers })
    })
  } catch (error) {
    logError('api/loyalty-programs', error)
    return NextResponse.json({ error: 'Failed to save loyalty program' }, { status: 500 })
  }
}
