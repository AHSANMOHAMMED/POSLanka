import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { salesLookupSchema } from '@/lib/validation/schemas/sales'
import { lookupSaleByCode } from '@/lib/sales/returns'
import { requireModule } from '@/lib/auth/roles'
import { getBranchScope, canAccessBranch } from '@/lib/auth/branch-access'

/**
 * GET /api/sales/lookup?code=<INV-…|RTN-…|OFF-…>
 * Exact match on invoice number, offline receipt reference, or a return number (resolved to
 * the original sale). Used by POS receipt scanning to open a return / exchange.
 * 200 { sale: { …sale, items:[…line, returnedQuantity, remainingQuantity, refundUnitAmount],
 *               returnStatus, linkedReturns, paidByMethod, refundedByMethod, refundableTotal },
 *       matchedBy: 'invoice'|'offline_ref'|'return', matchedReturn }
 * 404 when nothing matches.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, salesLookupSchema)
    if (!parsed.success) return parsed.response

    const found = await withTenant(session.user.tenantId, async (db) => {
      const hit = await lookupSaleByCode(db, parsed.data.code)
      // K4: a sale of another branch is "not found" for branch-restricted staff
      if (hit && hit.sale.warehouseId && !canAccessBranch(await getBranchScope(session, db), hit.sale.warehouseId)) return null
      return hit
    })
    if (!found) return NextResponse.json({ error: `No sale found for "${parsed.data.code}"` }, { status: 404 })
    return NextResponse.json(found)
  } catch (error) {
    logError('api/sales/lookup', error)
    return NextResponse.json({ error: 'Failed to look up sale' }, { status: 500 })
  }
}
