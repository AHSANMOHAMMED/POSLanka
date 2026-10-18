import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getPurchaseSummary } from '@/lib/reports/inventory'

export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError

  const tenantId = session.user.tenantId
  const searchParams = request.nextUrl.searchParams

  const fromDate = searchParams.get('fromDate')
  const toDate = searchParams.get('toDate')

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: 'fromDate and toDate are required' },
      { status: 400 }
    )
  }

  const groupBy = searchParams.get('groupBy') as 'supplier' | 'month' | undefined

  const result = await withTenant(tenantId, async (db) => {
    return getPurchaseSummary(db, tenantId, { fromDate, toDate, groupBy })
  })

  return NextResponse.json(result)
}
