import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getStockBalance } from '@/lib/reports/inventory'

export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError

  const tenantId = session.user.tenantId
  const searchParams = request.nextUrl.searchParams

  const categoryId = searchParams.get('categoryId') || undefined
  const belowReorderParam = searchParams.get('belowReorder')
  const belowReorder = belowReorderParam === 'true' ? true : undefined

  const result = await withTenant(tenantId, async (db) => {
    return getStockBalance(db, tenantId, { categoryId, belowReorder })
  })

  return NextResponse.json(result)
}
