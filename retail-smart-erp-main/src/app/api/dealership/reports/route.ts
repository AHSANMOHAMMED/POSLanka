import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getBranchScope } from '@/lib/auth/branch-access'
import { tenantToday } from '@/lib/accounting/gl'
import { tenantDayRange } from '@/lib/reports/date-range'
import { validateSearchParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import {
  DEALERSHIP_REPORTS, dealerPerformance, documentExpiry, importTaxSummary, vehicleAging, vehicleProfit,
} from '@/lib/dealership/reports'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
const querySchema = z.object({
  report: z.enum(DEALERSHIP_REPORTS),
  fromDate: date.optional(),
  toDate: date.optional(),
  days: z.coerce.number().int().min(0).max(3650).optional(),
})

// GET /api/dealership/reports?report=aging|profit|import-tax|dealers|documents&fromDate&toDate&days
export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError
  const parsed = validateSearchParams(request, querySchema)
  if (!parsed.success) return parsed.response
  const { report, days } = parsed.data
  try {
    const tenantId = session.user.tenantId
    const today = await tenantToday(tenantId)
    const fromDate = parsed.data.fromDate ?? `${today.slice(0, 8)}01`
    const toDate = parsed.data.toDate ?? today
    if (fromDate > toDate) return NextResponse.json({ error: 'The start date is after the end date' }, { status: 400 })
    const range = await tenantDayRange(tenantId, fromDate, toDate)
    return await withTenant(tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const period = { fromDate, toDate, today }
      switch (report) {
        case 'aging': return NextResponse.json({ ...period, ...(await vehicleAging(db, scope, today)) })
        case 'profit': return NextResponse.json({ ...period, ...(await vehicleProfit(db, scope, range.from, range.to)) })
        case 'import-tax': return NextResponse.json({ ...period, ...(await importTaxSummary(db, scope, fromDate, toDate)) })
        case 'dealers': return NextResponse.json({ ...period, ...(await dealerPerformance(db, scope, range.from, range.to)) })
        case 'documents': return NextResponse.json({ ...period, days: days ?? 30, ...(await documentExpiry(db, scope, today, days ?? 30)) })
      }
    })
  } catch (error) {
    logError('api/dealership/reports', error)
    return NextResponse.json({ error: 'Failed to load the report' }, { status: 500 })
  }
}
