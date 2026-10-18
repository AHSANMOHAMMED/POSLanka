import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { pendingCompanies, pricingTiers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET /api/account/pending-companies/[id] - Get single pending company
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const pending = await db
      .select({
        pendingCompany: pendingCompanies,
        tier: pricingTiers,
      })
      .from(pendingCompanies)
      .innerJoin(pricingTiers, eq(pendingCompanies.tierId, pricingTiers.id))
      .where(
        and(
          eq(pendingCompanies.id, id),
          eq(pendingCompanies.accountId, session.user.accountId)
        )
      )
      .limit(1)

    if (pending.length === 0) {
      return NextResponse.json({ error: 'Pending company not found' }, { status: 404 })
    }

    const p = pending[0]

    return NextResponse.json({
      id: p.pendingCompany.id,
      name: p.pendingCompany.name,
      slug: p.pendingCompany.slug,
      email: p.pendingCompany.email,
      phone: p.pendingCompany.phone,
      address: p.pendingCompany.address,
      businessType: p.pendingCompany.businessType,
      country: p.pendingCompany.country,
      dateFormat: p.pendingCompany.dateFormat,
      timeFormat: p.pendingCompany.timeFormat,
      status: p.pendingCompany.status,
      expiresAt: p.pendingCompany.expiresAt,
      rejectionReason: p.pendingCompany.rejectionReason,
      createdAt: p.pendingCompany.createdAt,
      tier: {
        id: p.tier.id,
        name: p.tier.name,
        displayName: p.tier.displayName,
        priceMonthly: Number(p.tier.priceMonthly),
        priceYearly: Number(p.tier.priceYearly),
        currency: p.tier.currency || 'LKR',
      },
      billingCycle: p.pendingCompany.billingCycle,
    })
  } catch (error) {
    logError('api/account/pending-companies/[id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
