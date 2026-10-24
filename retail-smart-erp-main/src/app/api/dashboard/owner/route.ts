import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { warehouses } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams } from '@/lib/validation'
import { ownerDashboardSchema } from '@/lib/validation/schemas/expenses'
import { tenantToday } from '@/lib/accounting/gl'
import { tenantDayRange } from '@/lib/reports/date-range'
import { ownerDashboard } from '@/lib/dashboard/owner'
import { logError } from '@/lib/ai/error-logger'

/**
 * GET /api/dashboard/owner?warehouseId=&fromDate=&toDate=&topItems=
 * Owner / manager figures (viewReports): stock value at cost and selling price, gross profit and
 * profit per item for the period (default: this month to today), cheques due in 7 days / overdue /
 * bounced, batches expiring in 30 days, low stock. See src/lib/dashboard/owner.ts for the maths.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError
    const parsed = validateSearchParams(request, ownerDashboardSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session.user.tenantId
    const today = await tenantToday(tenantId)
    const fromDate = parsed.data.fromDate || `${today.slice(0, 8)}01`
    const toDate = parsed.data.toDate || today
    if (fromDate > toDate) return NextResponse.json({ error: 'The start date is after the end date' }, { status: 400 })
    const range = await tenantDayRange(tenantId, fromDate, toDate)

    return await withTenant(tenantId, async (db) => {
      const branches = await db.select({ id: warehouses.id, name: warehouses.name })
        .from(warehouses).where(eq(warehouses.isActive, true)).orderBy(asc(warehouses.name))
      const figures = await ownerDashboard(db, {
        tenantId, warehouseId: parsed.data.warehouseId || null, from: range.from, to: range.to, today, topItems: parsed.data.topItems,
      })
      return NextResponse.json({
        period: { fromDate, toDate, timezone: range.tz },
        today,
        warehouseId: parsed.data.warehouseId || null,
        branches,
        ...figures,
      })
    })
  } catch (error) {
    logError('api/dashboard/owner', error)
    return NextResponse.json({ error: 'Failed to load the dashboard' }, { status: 500 })
  }
}
