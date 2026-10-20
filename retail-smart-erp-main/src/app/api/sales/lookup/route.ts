import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { salesLookupSchema } from '@/lib/validation/schemas/sales'
import { lookupSaleByCode } from '@/lib/sales/returns'

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

    const parsed = validateSearchParams(request, salesLookupSchema)
    if (!parsed.success) return parsed.response

    const found = await withTenant(session.user.tenantId, (db) => lookupSaleByCode(db, parsed.data.code))
    if (!found) return NextResponse.json({ error: `No sale found for "${parsed.data.code}"` }, { status: 404 })
    return NextResponse.json(found)
  } catch (error) {
    logError('api/sales/lookup', error)
    return NextResponse.json({ error: 'Failed to look up sale' }, { status: 500 })
  }
}
