import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getSalesSummary } from '@/lib/reports/sales'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')
    const groupBy = searchParams.get('groupBy') as 'day' | 'week' | 'month' | 'customer' | 'salesperson' | 'payment_method' | undefined

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await getSalesSummary(db, session.user.tenantId, {
        fromDate,
        toDate,
        groupBy: groupBy || undefined,
      })
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reports/sales-summary', error)
    return NextResponse.json({ error: 'Failed to fetch sales summary' }, { status: 500 })
  }
}
