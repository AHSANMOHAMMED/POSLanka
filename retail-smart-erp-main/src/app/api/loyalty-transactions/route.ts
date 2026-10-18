import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { loyaltyTransactions } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { loyaltyTransactionsListSchema } from '@/lib/validation/schemas/loyalty'

// GET - list loyalty transactions for a customer
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError

    const parsed = validateSearchParams(request, loyaltyTransactionsListSchema)
    if (!parsed.success) return parsed.response
    const { customerId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const transactions = await db.query.loyaltyTransactions.findMany({
        where: eq(loyaltyTransactions.customerId, customerId),
        orderBy: [desc(loyaltyTransactions.createdAt)],
        limit: 100,
      })

      return NextResponse.json(transactions)
    })
  } catch (error) {
    logError('api/loyalty-transactions', error)
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  }
}
