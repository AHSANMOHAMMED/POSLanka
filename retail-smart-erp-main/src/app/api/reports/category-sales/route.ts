import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getCategorySales } from '@/lib/reports/business-specific'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    if (session.user.businessType !== 'supermarket') {
      return NextResponse.json({ error: 'This report is only available for supermarket businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await getCategorySales(db, session.user.tenantId, { fromDate, toDate })
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reports/category-sales', error)
    return NextResponse.json({ error: 'Failed to fetch category sales report' }, { status: 500 })
  }
}
