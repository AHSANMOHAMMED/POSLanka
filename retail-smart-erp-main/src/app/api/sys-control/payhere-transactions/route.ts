import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { payhereTransactions } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'all'

    const whereClause = status !== 'all'
      ? eq(payhereTransactions.status, status as 'pending' | 'success' | 'failed' | 'cancelled' | 'refunded' | 'charged_back')
      : undefined

    const transactions = await db.query.payhereTransactions.findMany({
      where: whereClause,
      with: {
        account: true,
        subscription: {
          with: {
            tenant: true,
            tier: true,
          },
        },
      },
      orderBy: [desc(payhereTransactions.createdAt)],
      limit: 200,
    })

    return NextResponse.json(transactions)
  } catch (error) {
    logError('api/sys-control/payhere-transactions', error)
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  }
}
