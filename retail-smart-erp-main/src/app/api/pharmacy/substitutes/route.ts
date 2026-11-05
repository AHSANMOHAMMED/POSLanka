import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'
import { findSubstitutes } from '@/lib/pharmacy/substitutes'
import { uuidParam } from '@/lib/pharmacy/route-helpers'

/**
 * GET /api/pharmacy/substitutes?itemId=&warehouseId= — other brands with the same generic name,
 * strength and dosage form, with the stock in that branch and the price (POS "Alternatives").
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const sp = request.nextUrl.searchParams
    const itemId = uuidParam(sp, 'itemId')
    if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
    const warehouseId = uuidParam(sp, 'warehouseId')
    return await withTenant(session.user.tenantId, async (db) => {
      // K4: stock of another branch is not shown to branch-restricted staff
      const scope = await getBranchScope(session, db)
      if (warehouseId && !canAccessBranch(scope, warehouseId)) return branchDeniedResponse(scope, db)
      const wh = warehouseId ?? (scope && scope.length === 1 ? scope[0] : null)
      if (!wh && scope) return NextResponse.json({ error: 'Choose a branch (warehouseId)' }, { status: 400 })
      const result = await findSubstitutes(db, session.user.tenantId, itemId, wh)
      if (!result.item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      return NextResponse.json({ ...result, warehouseId: wh })
    })
  } catch (error) {
    logError('api/pharmacy/substitutes', error)
    return NextResponse.json({ error: 'Failed to load substitutes' }, { status: 500 })
  }
}
