import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { db as rawDb, withTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { removeSaleLinesSchema } from '@/lib/validation/schemas/sales'
import { createReturnInTx } from '@/lib/sales/returns'
import { notifyReturnAlerts } from '@/lib/notifications/sales-alerts'
import { saleFlowErrorResponse } from '@/lib/sales/route-helpers'

/**
 * POST /api/sales/[id]/remove-lines — "edit a completed bill / remove an item".
 * Implemented as a guided partial return so the history is preserved (the original invoice is
 * never rewritten). Body: { lines:[{saleItemId, quantity, serialNumberIds?}], reason,
 * refundMethod ('cash'|'card'|'credit'), refundAmount?, notes?, posOpeningEntryId? }.
 * 200 { returnSale, refundAmount, refundTotal, returnStatus, lines }. Requires processReturns.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'processReturns')
    if (perm) return perm
    const userId = await resolveUserIdRequired(session)

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, removeSaleLinesSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    const acctError = await requireAccountingConfig(rawDb, tenantId, 'sale')
    if (acctError) return acctError

    return await withTenant(tenantId, async (db) => {
      const result = await db.transaction((tx) => createReturnInTx(tx, { tenantId, userId }, {
        originalSaleId: p.data.id,
        lines: body.lines.map((l) => ({ originalSaleItemId: l.saleItemId, quantity: l.quantity, serialNumberIds: l.serialNumberIds })),
        refundMethod: body.refundMethod,
        clientRefundAmount: body.refundAmount ?? null,
        posOpeningEntryId: body.posOpeningEntryId || null,
        reason: body.reason,
        notes: body.notes || 'Line removed from completed bill',
      }))
      const rtn = result.returnSale
      logAndBroadcast(tenantId, 'sale', 'created', rtn.id, {
        userId, entityName: rtn.invoiceNo,
        description: `Removed ${result.lines.length} line(s) from ${result.originalSale?.invoiceNo} via return ${rtn.invoiceNo}: ${body.reason}`,
      })
      logAndBroadcast(tenantId, 'sale', 'updated', p.data.id, { userId })
      for (const itemId of result.affectedItemIds) logAndBroadcast(tenantId, 'item', 'updated', itemId)
      logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.warehouseId)
      notifyReturnAlerts(tenantId, {
        returnId: rtn.id, returnNo: rtn.invoiceNo, originalInvoiceNo: result.originalSale?.invoiceNo,
        manual: false, refundTotal: result.refundTotal, actorUserId: userId, actorName: session.user.name,
      })

      return NextResponse.json({
        returnSale: rtn,
        refundAmount: result.refundPaidOut,
        refundTotal: result.refundTotal,
        returnStatus: result.returnStatus,
        lines: result.lines,
      })
    })
  } catch (error) {
    const mapped = saleFlowErrorResponse(error)
    if (mapped) return mapped
    logError('api/sales/[id]/remove-lines', error)
    return NextResponse.json({ error: 'Failed to remove lines' }, { status: 500 })
  }
}
