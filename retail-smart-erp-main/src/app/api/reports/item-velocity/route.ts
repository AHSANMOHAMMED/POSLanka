import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getItemVelocity } from '@/lib/reports/business-specific'
import { logError } from '@/lib/ai/error-logger'
import { requireAllBranches } from '@/lib/auth/branch-access'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError
    // K4: a company-wide report, not split by branch: refused for branch-restricted users
    const branchError = await requireAllBranches(session)
    if (branchError) return branchError

    if (!['retail', 'supermarket', 'pharmacy', 'electronics', 'hardware', 'print_studio'].includes(session.user.businessType)) {
      return NextResponse.json({ error: 'This report is for shops (retail, supermarket, pharmacy)' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await getItemVelocity(db, session.user.tenantId, { fromDate, toDate })
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reports/item-velocity', error)
    return NextResponse.json({ error: 'Failed to fetch item velocity report' }, { status: 500 })
  }
}
