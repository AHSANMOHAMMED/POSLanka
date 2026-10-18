import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { dealers, dealerAllocations } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET dealer balance summary
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageDealers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Get dealer
      const dealer = await db.query.dealers.findFirst({
        where: eq(dealers.id, id),
      })

      if (!dealer) {
        return NextResponse.json({ error: 'Dealer not found' }, { status: 404 })
      }

      // Count active allocations
      const [allocationCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealerAllocations)
        .where(and(
          eq(dealerAllocations.dealerId, id),
          eq(dealerAllocations.status, 'allocated')
        ))

      const currentBalance = parseFloat(dealer.currentBalance || '0')
      const creditLimit = parseFloat(dealer.creditLimit || '0')
      const availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - currentBalance) : 0

      return NextResponse.json({
        currentBalance: currentBalance.toFixed(2),
        creditLimit: creditLimit.toFixed(2),
        availableCredit: availableCredit.toFixed(2),
        totalAllocated: allocationCount.count,
      })
    })
  } catch (error) {
    logError('api/dealers/[id]/balance', error)
    return NextResponse.json({ error: 'Failed to fetch dealer balance' }, { status: 500 })
  }
}
