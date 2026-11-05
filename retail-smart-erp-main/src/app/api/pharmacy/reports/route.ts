import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'
import { expiryLoss, prescriptionSummary, salesByGeneric } from '@/lib/pharmacy/reports'
import { dateRange, uuidParam } from '@/lib/pharmacy/route-helpers'

/**
 * GET /api/pharmacy/reports?from=&to=&warehouseId= — sales by generic name, prescription-only and
 * controlled sales, and expiry loss for the period. Branch-restricted managers get their branches.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError
    const sp = request.nextUrl.searchParams
    const { from, to } = dateRange(sp)
    const warehouseId = uuidParam(sp, 'warehouseId')
    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      if (warehouseId && !canAccessBranch(scope, warehouseId)) return branchDeniedResponse(scope, db)
      const q = { tenantId: session.user.tenantId, from, to, scope, warehouseId }
      const [byGeneric, prescriptions, expiry] = await Promise.all([salesByGeneric(db, q), prescriptionSummary(db, q), expiryLoss(db, q)])
      return NextResponse.json({ from, to, byGeneric, prescriptions, expiry })
    })
  } catch (error) {
    logError('api/pharmacy/reports', error)
    return NextResponse.json({ error: 'Failed to load the pharmacy reports' }, { status: 500 })
  }
}
