import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getItemProfitability } from '@/lib/reports/inventory'

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

  const categoryId = searchParams.get('categoryId') || undefined

  // Validate UUID format for optional ID params
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (categoryId && !UUID_RE.test(categoryId)) {
    return NextResponse.json({ error: 'Invalid categoryId format' }, { status: 400 })
  }

  const result = await withTenant(tenantId, async (db) => {
    return getItemProfitability(db, tenantId, { fromDate, toDate, categoryId })
  })

  return NextResponse.json(result)
}
