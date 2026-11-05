import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'
import { buildControlledRegister, controlledRegisterCsv } from '@/lib/pharmacy/controlled-register'
import { dateRange, requireAnyPermission, uuidParam } from '@/lib/pharmacy/route-helpers'

/**
 * GET /api/pharmacy/controlled-register?from=&to=&itemId=&warehouseId=&format=csv — the controlled
 * drug register: per controlled medicine the opening balance, every receipt / dispensing (with the
 * prescription) / return / adjustment and the closing balance. Branch-restricted staff get their
 * own branches. Managers (viewReports) and stock keepers (manageInventory).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['viewReports', 'manageInventory'])
    if (permError) return permError
    const sp = request.nextUrl.searchParams
    const { from, to } = dateRange(sp)
    const itemId = uuidParam(sp, 'itemId')
    const warehouseId = uuidParam(sp, 'warehouseId')

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      if (warehouseId && !canAccessBranch(scope, warehouseId)) return branchDeniedResponse(scope, db)
      const drugs = await buildControlledRegister(db, { tenantId: session.user.tenantId, from, to, itemId, warehouseId, scope })
      if (sp.get('format') === 'csv') {
        return new NextResponse(controlledRegisterCsv(drugs, from, to), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="controlled-drug-register-${from}-to-${to}.csv"`,
          },
        })
      }
      return NextResponse.json({ from, to, data: drugs })
    })
  } catch (error) {
    logError('api/pharmacy/controlled-register', error)
    return NextResponse.json({ error: 'Failed to load the controlled drug register' }, { status: 500 })
  }
}
