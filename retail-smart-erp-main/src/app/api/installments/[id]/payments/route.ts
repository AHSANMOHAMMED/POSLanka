import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { installmentPlans } from '@/lib/db/schema'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { installmentPaymentSchema } from '@/lib/validation/schemas/installments'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { tenantToday } from '@/lib/accounting/gl'
import { recordInstallmentPayment } from '@/lib/installments/service'
import { installmentErrorResponse } from '@/lib/installments/errors'
import { INSTALLMENT_TAKE, requireAny } from '@/lib/installments/access'

/**
 * POST /api/installments/[id]/payments — take an installment payment (partial payments allowed;
 * oldest installment first, late fees first unless waived) or the early settlement (settle: true,
 * amount = the settlement quote). Cheque payments need `cheque` details and are registered in
 * the cheques register. Posts the receipt to the ledger in the same transaction (./posting).
 * Returns the receipt (HPR-…).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, INSTALLMENT_TAKE)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const parsed = await validateBody(request, installmentPaymentSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)
    const today = await tenantToday(tenantId)
    // a back-dated receipt is allowed (posting a collector's book), a future one is not
    const paymentDate = body.paymentDate && body.paymentDate <= today ? body.paymentDate : today

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const branchDenied = await assertRecordBranch(session, tx, installmentPlans, id)
      if (branchDenied) return { response: branchDenied }
      return recordInstallmentPayment(tx, tenantId, id, {
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        reference: body.reference,
        paymentDate,
        notes: body.notes,
        waiveLateFees: body.waiveLateFees,
        settle: body.settle,
        rebatePercent: body.rebatePercent,
        cheque: body.paymentMethod === 'cheque' ? body.cheque : null,
      }, userId, today)
    })
    if ('response' in result) return result.response
    logAndBroadcast(tenantId, 'installment-plan', 'updated', id, {
      userId: session.user.id,
      entityName: result.plan.planNo,
      description: `${body.settle ? 'Settlement' : 'Installment payment'} ${result.receipt.receiptNo} of ${Number(result.receipt.amount).toFixed(2)} on ${result.plan.planNo}`,
    })
    if (result.plan.saleId) logAndBroadcast(tenantId, 'sale', 'updated', result.plan.saleId)
    if (result.cheque) logAndBroadcast(tenantId, 'cheque', 'created', result.cheque.id)
    return NextResponse.json({ receipt: result.receipt, cheque: result.cheque, planStatus: result.plan.status, balance: result.plan.balance }, { status: 201 })
  } catch (error) {
    const known = installmentErrorResponse(error)
    if (known) return known
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/installments/[id]/payments POST', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
