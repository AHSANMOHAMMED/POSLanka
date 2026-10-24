import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { cheques, customers, purchases, sales, suppliers, warehouses } from '@/lib/db/schema'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation'
import { updateChequeStatusSchema, chequeIdParamSchema } from '@/lib/validation/schemas/cheques'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { allowedChequeActions, ChequeError, transitionCheque, CHEQUE_STATUS_LABELS, type ChequeDirection } from '@/lib/cheques/cheques'
import type { ChequeStatus } from '@/lib/db/schema'
import { canViewAllCheques } from '@/lib/cheques/access'
import { getBranchScope, canAccessBranch, branchDeniedMessage } from '@/lib/auth/branch-access'

// GET /api/cheques/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const viewAll = canViewAllCheques(session)
    if (!viewAll) {
      const permError = requirePermission(session, 'createSales')
      if (permError) return permError
    }
    const p = validateParams(await params, chequeIdParamSchema)
    if (!p.success) return p.response
    return await withTenant(session.user.tenantId, async (db) => {
      const [r] = await db.select({
        cheque: cheques, customerName: customers.name, supplierName: suppliers.name,
        invoiceNo: sales.invoiceNo, purchaseNo: purchases.purchaseNo, warehouseName: warehouses.name,
      })
        .from(cheques)
        .leftJoin(customers, eq(customers.id, cheques.customerId))
        .leftJoin(suppliers, eq(suppliers.id, cheques.supplierId))
        .leftJoin(sales, eq(sales.id, cheques.saleId))
        .leftJoin(purchases, eq(purchases.id, cheques.purchaseId))
        .leftJoin(warehouses, eq(warehouses.id, cheques.warehouseId))
        .where(eq(cheques.id, p.data.id))
      if (!r || (!viewAll && r.cheque.createdBy !== session.user.id)) {
        return NextResponse.json({ error: 'Cheque not found' }, { status: 404 })
      }
      // K4: another branch's cheque is not shown to branch-restricted staff
      if (r.cheque.createdBy !== session.user.id && !canAccessBranch(await getBranchScope(session, db), r.cheque.warehouseId)) {
        return NextResponse.json({ error: 'Cheque not found' }, { status: 404 })
      }
      return NextResponse.json({
        ...r.cheque,
        customerName: r.customerName, supplierName: r.supplierName, invoiceNo: r.invoiceNo,
        purchaseNo: r.purchaseNo, warehouseName: r.warehouseName,
        actions: allowedChequeActions(r.cheque.direction as ChequeDirection, r.cheque.status as ChequeStatus),
      })
    })
  } catch (error) {
    logError('api/cheques/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch cheque' }, { status: 500 })
  }
}

/**
 * PATCH /api/cheques/[id] { action: deposit | clear | bounce | cancel | return, depositAccountId?, reason?, date? }
 * Accounts (manageAccounting) for any cheque; sales managers for received, purchasing for issued.
 * A bounce / cancel of a cheque that paid an invoice re-opens the invoice (see src/lib/cheques).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const p = validateParams(await params, chequeIdParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, updateChequeStatusSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const { role, tenantId, customRoleId } = session.user
    const accounts = hasPermission(role, 'manageAccounting', tenantId, customRoleId)

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const [c] = await tx.select({ direction: cheques.direction, warehouseId: cheques.warehouseId, createdBy: cheques.createdBy }).from(cheques).where(eq(cheques.id, p.data.id))
      if (!c) throw new ChequeError('NOT_FOUND', 'Cheque not found', 404)
      // K4: only cheques of the user's own branches (or ones they recorded)
      if (c.createdBy !== session.user.id) {
        const scope = await getBranchScope(session, tx)
        if (!canAccessBranch(scope, c.warehouseId)) throw new ChequeError('BRANCH_ACCESS_DENIED', await branchDeniedMessage(scope, tx), 403)
      }
      const allowed = accounts
        || (c.direction === 'received' && hasPermission(role, 'manageSales', tenantId, customRoleId))
        || (c.direction === 'issued' && hasPermission(role, 'managePurchases', tenantId, customRoleId))
      if (!allowed) throw new ChequeError('FORBIDDEN', 'You do not have permission to update this cheque', 403)
      return transitionCheque(tx, {
        tenantId, chequeId: p.data.id, action: body.action, userId: session.user.id,
        depositAccountId: body.depositAccountId || null, reason: body.reason || null, date: body.date,
      })
    })

    const { cheque, before, reopened } = result
    logAndBroadcast(tenantId, 'cheque', 'updated', cheque.id, {
      userId: session.user.id,
      entityName: cheque.chequeNo,
      activityAction: body.action === 'cancel' ? 'cancel' : 'status_change',
      description: `Cheque ${cheque.chequeNo} (${cheque.bankName}) ${CHEQUE_STATUS_LABELS[before.status as ChequeStatus]} → ${CHEQUE_STATUS_LABELS[cheque.status as ChequeStatus]}${body.reason ? `: ${body.reason}` : ''}`,
      metadata: { before: { status: before.status }, after: { status: cheque.status }, reopened },
    })
    if (reopened?.saleId) logAndBroadcast(tenantId, 'sale', 'updated', reopened.saleId)
    if (reopened?.purchaseId) logAndBroadcast(tenantId, 'purchase', 'updated', reopened.purchaseId)
    if (reopened?.expenseId) logAndBroadcast(tenantId, 'expense', 'updated', reopened.expenseId)
    if (cheque.customerId) logAndBroadcast(tenantId, 'customer', 'updated', cheque.customerId)
    if (cheque.supplierId) logAndBroadcast(tenantId, 'supplier', 'updated', cheque.supplierId)

    return NextResponse.json({
      ...cheque,
      reopened,
      actions: allowedChequeActions(cheque.direction as ChequeDirection, cheque.status as ChequeStatus),
    })
  } catch (error) {
    if (error instanceof ChequeError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('GL_ACCOUNTS_MISSING:') || (error instanceof Error && error.name === 'GLValidationError')) {
      return NextResponse.json({ error: message.replace('GL_ACCOUNTS_MISSING: ', ''), code: 'GL_POSTING_FAILED' }, { status: 400 })
    }
    logError('api/cheques/[id]', error)
    return NextResponse.json({ error: 'Failed to update cheque' }, { status: 500 })
  }
}
