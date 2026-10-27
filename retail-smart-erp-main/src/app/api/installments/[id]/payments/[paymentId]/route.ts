import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { installmentPayments, installmentPlans } from '@/lib/db/schema'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { uuidSchema } from '@/lib/validation/schemas/common'
import { installmentReceiptActionSchema } from '@/lib/validation/schemas/installments'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { tenantToday } from '@/lib/accounting/gl'
import { InstallmentError, bounceReceiptCheque, reverseInstallmentPayment } from '@/lib/installments/service'
import { installmentErrorResponse } from '@/lib/installments/errors'
import { INSTALLMENT_REVERSE, requireAny } from '@/lib/installments/access'

const paramsSchema = z.object({ id: uuidSchema, paymentId: uuidSchema })

/**
 * POST /api/installments/[id]/payments/[paymentId] { action: void | bounce, reason, date? }
 *  - void: the receipt was taken by mistake — schedule, plan, sale payment and journal entry are
 *    reversed; a cheque still in hand is cancelled in the cheques register.
 *  - bounce: the receipt's cheque was returned unpaid — the cheque is marked bounced in the
 *    register and the receipt reversed (the installments are unpaid again).
 * Sales managers / accounts; branch of the plan.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, INSTALLMENT_REVERSE)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, paramsSchema)
    if (!p.success) return p.response
    const { id, paymentId } = p.data
    const parsed = await validateBody(request, installmentReceiptActionSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)
    const today = await tenantToday(tenantId)
    if (body.date && body.date > today) throw new InstallmentError('The date cannot be in the future')
    const date = body.date || today

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const branchDenied = await assertRecordBranch(session, tx, installmentPlans, id)
      if (branchDenied) return { response: branchDenied }
      const [r] = await tx.select({ id: installmentPayments.id }).from(installmentPayments)
        .where(and(eq(installmentPayments.id, paymentId), eq(installmentPayments.planId, id)))
      if (!r) throw new InstallmentError('Receipt not found', 404)
      if (body.action === 'bounce') return bounceReceiptCheque(tx, tenantId, paymentId, { userId, reason: body.reason, date })
      const out = await reverseInstallmentPayment(tx, tenantId, paymentId, { userId, reason: body.reason, date, cause: 'void' })
      if (out.already) throw new InstallmentError('This receipt is already voided', 409, 'ALREADY_VOIDED')
      return out
    })
    if ('response' in result) return result.response
    logAndBroadcast(tenantId, 'installment-plan', 'updated', id, {
      userId: session.user.id,
      entityName: result.plan.planNo,
      activityAction: 'cancel',
      description: `${body.action === 'bounce' ? 'Cheque bounced on' : 'Voided'} receipt ${result.receipt.receiptNo} of ${Number(result.receipt.amount).toFixed(2)} on ${result.plan.planNo}: ${body.reason}`,
    })
    if (result.plan.saleId) logAndBroadcast(tenantId, 'sale', 'updated', result.plan.saleId)
    if (result.receipt.chequeId) logAndBroadcast(tenantId, 'cheque', 'updated', result.receipt.chequeId)
    return NextResponse.json({ receipt: result.receipt, planStatus: result.plan.status, balance: result.plan.balance })
  } catch (error) {
    const known = installmentErrorResponse(error)
    if (known) return known
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/installments/[id]/payments/[paymentId] POST', error)
    return NextResponse.json({ error: 'Failed to update the receipt' }, { status: 500 })
  }
}
