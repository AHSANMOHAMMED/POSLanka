import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { cheques, expenseCategories, expenses } from '@/lib/db/schema'
import { hasPermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateExpenseSchema } from '@/lib/validation/schemas/expenses'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { ApprovalError } from '@/lib/auth/approval-token'
import { ChequeError } from '@/lib/cheques/cheques'
import { ExpenseError, payExpense, reverseExpensePayment } from '@/lib/expenses/expenses'
import { canManageExpenses, expenseErrorResponse } from '@/lib/expenses/route-helpers'
import { notify } from '@/lib/notifications/notify'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import { getBranchScope, canAccessBranch, branchDeniedMessage } from '@/lib/auth/branch-access'

// GET /api/expenses/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const viewAll = canManageExpenses(session) || hasPermission(session.user.role, 'viewAccounting', session.user.tenantId, session.user.customRoleId)
    return await withTenant(session.user.tenantId, async (db) => {
      const [r] = await db.select({ expense: expenses, categoryName: expenseCategories.name })
        .from(expenses).leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(eq(expenses.id, p.data.id))
      if (!r || (!viewAll && r.expense.createdBy !== session.user.id && r.expense.claimantId !== session.user.id)) {
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
      }
      // K4: another branch's expense is not shown to branch-restricted staff (their own claims are)
      if (r.expense.createdBy !== session.user.id && r.expense.claimantId !== session.user.id
        && !canAccessBranch(await getBranchScope(session, db), r.expense.warehouseId)) {
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
      }
      const [cheque] = await db.select().from(cheques).where(eq(cheques.expenseId, r.expense.id))
      return NextResponse.json({ ...r.expense, categoryName: r.categoryName, cheque: cheque || null })
    })
  } catch (error) {
    logError('api/expenses/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch expense' }, { status: 500 })
  }
}

/**
 * PATCH /api/expenses/[id] { action: approve | reject | pay | void }
 *  approve / reject a claim — accounts (not their own claim, unless owner)
 *  pay an approved claim     — accounts from office cash / bank / cheque; a cashier from their drawer
 *  void                      — accounts; a paid expense's posting is reversed
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, updateExpenseSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const { role, tenantId, customRoleId } = session.user
    const userId = session.user.id
    const accounts = canManageExpenses(session)
    const isSupervisor = hasPermission(role, 'manageSales', tenantId, customRoleId)

    const forbidden = (msg: string) => new ExpenseError('FORBIDDEN', msg, 403)
    const result = await withTenantTransaction(tenantId, async (tx) => {
      const [e] = await tx.select().from(expenses).where(eq(expenses.id, p.data.id)).for('update')
      if (!e) throw new ExpenseError('NOT_FOUND', 'Expense not found', 404)
      // K4: only expenses of the user's own branches (or their own claims)
      if (e.createdBy !== userId && e.claimantId !== userId) {
        const scope = await getBranchScope(session, tx)
        if (!canAccessBranch(scope, e.warehouseId)) throw new ExpenseError('BRANCH_ACCESS_DENIED', await branchDeniedMessage(scope, tx), 403)
      }
      const now = new Date()

      if (body.action === 'approve' || body.action === 'reject') {
        if (!accounts) throw forbidden('Only accounts can approve or reject claims')
        if (e.kind !== 'reimbursement') throw new ExpenseError('NOT_A_CLAIM', 'Only reimbursement claims are approved')
        if (e.claimantId === userId && role !== 'owner') throw forbidden('You cannot approve your own claim')
        const from = body.action === 'approve' ? ['pending'] : ['pending', 'approved']
        if (!from.includes(e.status)) throw new ExpenseError('INVALID_STATUS', `A ${e.status} claim cannot be ${body.action === 'approve' ? 'approved' : 'rejected'}`)
        const [u] = await tx.update(expenses).set(body.action === 'approve'
          ? { status: 'approved', approvedBy: userId, approvedAt: now, accountId: body.accountId || e.accountId, updatedAt: now }
          : { status: 'rejected', approvedBy: userId, approvedAt: now, rejectedReason: body.reason || null, updatedAt: now },
        ).where(eq(expenses.id, e.id)).returning()
        return u
      }

      if (body.action === 'pay') {
        if (e.kind !== 'reimbursement' || e.status !== 'approved') {
          throw new ExpenseError('INVALID_STATUS', e.kind === 'reimbursement' ? `A ${e.status} claim cannot be paid` : 'This expense is already recorded as paid')
        }
        const canPay = accounts || (body.paidFrom === 'drawer' && hasPermission(role, 'createSales', tenantId, customRoleId))
        if (!canPay) throw forbidden('You do not have permission to pay this claim')
        if (body.accountId && accounts) {
          await tx.update(expenses).set({ accountId: body.accountId }).where(eq(expenses.id, e.id))
          e.accountId = body.accountId
        }
        const paid = await payExpense(tx, e, {
          tenantId, userId, isSupervisor: isSupervisor || accounts,
          paidFrom: body.paidFrom!, paymentMethod: body.paymentMethod, openingEntryId: body.openingEntryId || null,
          cheque: body.cheque, applyCounterLimit: false,
        })
        const [u] = await tx.update(expenses).set({
          status: 'paid', paidFrom: paid.paidFrom, paymentMethod: paid.paymentMethod, posOpeningEntryId: paid.posOpeningEntryId,
          cashMovementId: paid.cashMovementId, warehouseId: paid.warehouseId, paidBy: userId, paidAt: now, updatedAt: now,
        }).where(eq(expenses.id, e.id)).returning()
        return u
      }

      // void
      if (!accounts) throw forbidden('Only accounts can void expenses')
      if (e.status === 'void' || e.status === 'rejected') throw new ExpenseError('INVALID_STATUS', `A ${e.status} entry cannot be voided`)
      if (e.status === 'paid') await reverseExpensePayment(tx, e, { tenantId, userId, reason: body.reason! })
      const [u] = await tx.update(expenses).set({ status: 'void', voidedBy: userId, voidedAt: now, voidReason: body.reason || null, updatedAt: now })
        .where(eq(expenses.id, e.id)).returning()
      return u
    })

    logAndBroadcast(tenantId, 'expense', 'updated', result.id, {
      userId,
      entityName: result.expenseNo,
      activityAction: body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : body.action === 'void' ? 'cancel' : 'status_change',
      description: `${result.expenseNo} ${body.action}${body.reason ? `: ${body.reason}` : ''}`,
    })
    if (result.posOpeningEntryId) logAndBroadcast(tenantId, 'pos-shift', 'updated', result.posOpeningEntryId)
    if (result.claimantId && result.claimantId !== userId && (body.action === 'approve' || body.action === 'reject' || body.action === 'pay')) {
      void notify(tenantId, 'expense_claim', {
        title: `Your claim ${result.expenseNo} was ${body.action === 'pay' ? 'paid' : body.action === 'approve' ? 'approved' : 'rejected'}`,
        body: `${roundCurrency(parseCurrency(result.amount)).toFixed(2)}${body.reason ? ` — ${body.reason}` : ''}`,
        data: { screen: 'expenses', id: result.id },
        userIds: [result.claimantId],
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApprovalError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    if (error instanceof ChequeError || error instanceof ExpenseError) return expenseErrorResponse(error)
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('GL_ACCOUNTS_MISSING:') || (error instanceof Error && error.name === 'GLValidationError')) {
      return NextResponse.json({ error: message.replace('GL_ACCOUNTS_MISSING: ', ''), code: 'GL_POSTING_FAILED' }, { status: 400 })
    }
    logError('api/expenses/[id]', error)
    return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 })
  }
}
