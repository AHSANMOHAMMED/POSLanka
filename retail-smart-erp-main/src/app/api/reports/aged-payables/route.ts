import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getAgedPayables } from '@/lib/reports/inventory'

export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError

  const { searchParams } = new URL(request.url)
  const asOfDate = searchParams.get('asOfDate') || undefined

  const result = await withTenant(session.user.tenantId, async (db) => {
    return getAgedPayables(db, session.user.tenantId, { asOfDate })
  })

  return NextResponse.json(result)
}
