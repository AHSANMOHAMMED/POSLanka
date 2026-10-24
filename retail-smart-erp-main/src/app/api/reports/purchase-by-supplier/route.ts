import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getPurchaseBySupplier } from '@/lib/reports/inventory'
import { requireAllBranches } from '@/lib/auth/branch-access'

export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError
  // K4: a company-wide report, not split by branch: refused for branch-restricted users
  const branchError = await requireAllBranches(session)
  if (branchError) return branchError

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

  const result = await withTenant(tenantId, async (db) => {
    return getPurchaseBySupplier(db, tenantId, { fromDate, toDate })
  })

  return NextResponse.json(result)
}
