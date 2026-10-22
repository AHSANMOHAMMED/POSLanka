import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { submitLandedCostVoucher, getLandedCostVoucher, LandedCostError } from '@/lib/purchasing/landed-cost'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'

// POST /api/landed-cost-vouchers/[id]/submit — allocate charges, raise item costs, post GL
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }
      await submitLandedCostVoucher(tx, { tenantId: session.user.tenantId, voucherId: p.data.id, userId: session.user.id })
      logAndBroadcast(session.user.tenantId, 'purchase', 'updated', p.data.id, { userId: session.user.id, activityAction: 'submit' })
      return { data: await getLandedCostVoucher(tx, p.data.id) }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    if (err instanceof LandedCostError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    const apiError = stockErrorResponse(err, 'Cannot post landed cost')
    if (apiError) return apiError
    logError('api/landed-cost-vouchers/[id]/submit', err)
    return NextResponse.json({ error: 'Failed to submit landed cost voucher' }, { status: 500 })
  }
}
