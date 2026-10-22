import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getAdjustmentsByReason } from '@/lib/reports/inventory'

// GET /api/reports/adjustments-by-reason?startDate&endDate&warehouseId — H3
export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate') || undefined
  const endDate = searchParams.get('endDate') || undefined
  const warehouseId = searchParams.get('warehouseId') || undefined
  const isDate = (d?: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (!isDate(startDate) || !isDate(endDate)) return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 })
  if (warehouseId && !/^[0-9a-f-]{36}$/i.test(warehouseId)) return NextResponse.json({ error: 'Invalid warehouseId' }, { status: 400 })

  const result = await withTenant(session.user.tenantId, (db) =>
    getAdjustmentsByReason(db, session.user.tenantId, { startDate, endDate, warehouseId }))
  return NextResponse.json(result)
}
