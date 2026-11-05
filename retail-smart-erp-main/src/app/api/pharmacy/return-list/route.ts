import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'
import { returnToSupplierList } from '@/lib/pharmacy/reports'
import { loadPharmacySettings } from '@/lib/pharmacy/settings'
import { uuidParam } from '@/lib/pharmacy/route-helpers'

/**
 * GET /api/pharmacy/return-list?days=&warehouseId= — expired and short-dated batches grouped by the
 * supplier, with the purchase invoice each batch came from (the purchase return is made from that
 * purchase). days defaults to the pharmacy's expiry alert window.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError
    const sp = request.nextUrl.searchParams
    const warehouseId = uuidParam(sp, 'warehouseId')
    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      if (warehouseId && !canAccessBranch(scope, warehouseId)) return branchDeniedResponse(scope, db)
      const raw = sp.get('days')
      const days = raw !== null && raw !== '' && Number.isFinite(Number(raw))
        ? Math.min(730, Math.max(0, Math.round(Number(raw))))
        : (await loadPharmacySettings(db, session.user.tenantId)).expiryAlertDays
      const suppliers = await returnToSupplierList(db, { tenantId: session.user.tenantId, days, scope, warehouseId })
      return NextResponse.json({ days, suppliers, totalValue: Math.round(suppliers.reduce((s, g) => s + g.value, 0) * 100) / 100 })
    })
  } catch (error) {
    logError('api/pharmacy/return-list', error)
    return NextResponse.json({ error: 'Failed to load the return list' }, { status: 500 })
  }
}
