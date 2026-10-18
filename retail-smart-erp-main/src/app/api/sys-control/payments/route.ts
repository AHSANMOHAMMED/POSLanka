import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { paymentDeposits } from '@/lib/db/schema'
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
    const status = searchParams.get('status') || 'pending'

    const whereClause = status !== 'all'
      ? eq(paymentDeposits.status, status as 'pending' | 'approved' | 'rejected')
      : undefined

    const payments = await db.query.paymentDeposits.findMany({
      where: whereClause,
      with: {
        account: true,
        subscription: {
          with: {
            tenant: true,
          },
        },
      },
      orderBy: [desc(paymentDeposits.createdAt)],
    })

    return NextResponse.json(payments)
  } catch (error) {
    logError('api/sys-control/payments', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}
