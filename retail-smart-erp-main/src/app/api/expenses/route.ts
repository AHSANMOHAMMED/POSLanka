import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { authWithCompany } from '@/lib/auth'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { expenseCategories, expenses, users, warehouses } from '@/lib/db/schema'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { createExpenseSchema, expenseListSchema } from '@/lib/validation/schemas/expenses'
import { tenantToday } from '@/lib/accounting/gl'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import { ApprovalError } from '@/lib/auth/approval-token'
import { ChequeError } from '@/lib/cheques/cheques'
import { ExpenseError, nextExpenseNo, payExpense } from '@/lib/expenses/expenses'
import { expenseErrorResponse, canManageExpenses } from '@/lib/expenses/route-helpers'
import { notify } from '@/lib/notifications/notify'

const STATUSES = ['pending', 'approved', 'rejected', 'paid', 'void'] as const

// GET /api/expenses — expenses and claims with filters and totals.
// Accounts see everything; other staff see what they recorded or claimed.
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const viewAll = canManageExpenses(session) || hasPermission(session.user.role, 'viewAccounting', session.user.tenantId, session.user.customRoleId)
    const parsed = validateSearchParams(request, expenseListSchema)
    if (!parsed.success) return parsed.response
    const q = parsed.data
    const me = session.user.id

    return await withTenant(session.user.tenantId, async (db) => {
      const claimant = alias(users, 'claimant')
      const conds: SQL[] = []
      // Cashiers may list the approved claims they can pay out of their drawer
      const payableClaims = q.kind === 'reimbursement' && q.status === 'approved'
        && hasPermission(session.user.role, 'createSales', session.user.tenantId, session.user.customRoleId)
      if ((!viewAll && !payableClaims) || q.mine) conds.push(or(eq(expenses.createdBy, me), eq(expenses.claimantId, me))!)
      if (q.kind) conds.push(eq(expenses.kind, q.kind))
      if (q.status) {
        const wanted = q.status.split(',').filter((s): s is typeof STATUSES[number] => (STATUSES as readonly string[]).includes(s))
        if (wanted.length) conds.push(inArray(expenses.status, wanted))
      }
      if (q.categoryId) conds.push(eq(expenses.categoryId, q.categoryId))
      if (q.warehouseId) conds.push(eq(expenses.warehouseId, q.warehouseId))
      if (q.paidFrom) conds.push(eq(expenses.paidFrom, q.paidFrom))
      if (q.openingEntryId) conds.push(eq(expenses.posOpeningEntryId, q.openingEntryId))
      if (q.fromDate) conds.push(sql`${expenses.expenseDate} >= ${q.fromDate}::date`)
      if (q.toDate) conds.push(sql`${expenses.expenseDate} <= ${q.toDate}::date`)
      if (q.search) {
        const p = `%${escapeLikePattern(q.search)}%`
        conds.push(or(ilike(expenses.expenseNo, p), ilike(expenses.payee, p), ilike(expenses.description, p), ilike(expenses.receiptNo, p))!)
      }
      const where = conds.length ? and(...conds) : undefined

      const [agg] = await db.select({
        count: sql<number>`count(*)::int`,
        paid: sql<string>`COALESCE(SUM(CASE WHEN ${expenses.status} = 'paid' THEN ${expenses.amount} ELSE 0 END), 0)`,
        pending: sql<string>`COALESCE(SUM(CASE WHEN ${expenses.status} = 'pending' THEN ${expenses.amount} ELSE 0 END), 0)`,
        approved: sql<string>`COALESCE(SUM(CASE WHEN ${expenses.status} = 'approved' THEN ${expenses.amount} ELSE 0 END), 0)`,
        drawer: sql<string>`COALESCE(SUM(CASE WHEN ${expenses.status} = 'paid' AND ${expenses.paidFrom} = 'drawer' THEN ${expenses.amount} ELSE 0 END), 0)`,
      }).from(expenses).where(where)

      const byCategory = await db.select({
        categoryId: expenses.categoryId,
        name: expenseCategories.name,
        amount: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
      })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(and(...(where ? [where] : []), eq(expenses.status, 'paid')))
        .groupBy(expenses.categoryId, expenseCategories.name)
        .orderBy(sql`3 DESC`)

      const rows = await db.select({
        expense: expenses,
        categoryName: expenseCategories.name,
        warehouseName: warehouses.name,
        createdByName: users.fullName,
        claimantName: claimant.fullName,
      })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .leftJoin(warehouses, eq(warehouses.id, expenses.warehouseId))
        .leftJoin(users, eq(users.id, expenses.createdBy))
        .leftJoin(claimant, eq(claimant.id, expenses.claimantId))
        .where(where)
        .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
        .limit(q.all ? 1000 : q.pageSize)
        .offset(q.all ? 0 : (q.page - 1) * q.pageSize)

      const total = agg?.count || 0
      return NextResponse.json({
        data: rows.map((r) => ({ ...r.expense, categoryName: r.categoryName, warehouseName: r.warehouseName, createdByName: r.createdByName, claimantName: r.claimantName })),
        totals: {
          count: total,
          paid: roundCurrency(parseCurrency(agg?.paid)),
          pending: roundCurrency(parseCurrency(agg?.pending)),
          approved: roundCurrency(parseCurrency(agg?.approved)),
          fromDrawer: roundCurrency(parseCurrency(agg?.drawer)),
          byCategory: byCategory.map((c) => ({ categoryId: c.categoryId, name: c.name || 'Uncategorised', amount: roundCurrency(parseCurrency(c.amount)) })),
        },
        pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      })
    })
  } catch (error) {
    logError('api/expenses', error)
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
  }
}

/**
 * POST /api/expenses
 *  expense from the drawer — cashier (createSales) on their open shift, up to the counter limit
 *  expense from office cash / bank — accounts (manageAccounting)
 *  reimbursement claim — any staff member for themselves; accounts may enter one for someone else
 */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await validateBody(request, createExpenseSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const { role, tenantId, customRoleId } = session.user
    const userId = session.user.id
    const accounts = canManageExpenses(session)

    if (body.kind === 'expense') {
      const permError = body.paidFrom === 'drawer' ? requirePermission(session, 'createSales') : requirePermission(session, 'manageAccounting')
      if (permError) return permError
    } else {
      const permError = requirePermission(session, 'requestAdvance')
      if (permError) return permError
    }
    if (body.claimantId && body.claimantId !== userId && !accounts) {
      return NextResponse.json({ error: 'You can only claim your own expenses' }, { status: 403 })
    }
    const quotaError = await requireQuota(tenantId, 'essential')
    if (quotaError) return quotaError
    const isSupervisor = hasPermission(role, 'manageSales', tenantId, customRoleId)
    const today = await tenantToday(tenantId)

    const expense = await withTenantTransaction(tenantId, async (tx) => {
      if (body.categoryId) {
        const [cat] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, body.categoryId))
        if (!cat) throw new ExpenseError('NOT_FOUND', 'Expense category not found', 404)
      }
      const expenseNo = await nextExpenseNo(tx, tenantId, body.kind)
      const [row] = await tx.insert(expenses).values({
        tenantId,
        expenseNo,
        kind: body.kind,
        status: body.kind === 'reimbursement' ? 'pending' : 'paid',
        expenseDate: body.expenseDate || today,
        categoryId: body.categoryId || null,
        accountId: accounts ? body.accountId || null : null,
        amount: String(roundCurrency(body.amount)),
        payee: body.payee || null,
        receiptNo: body.receiptNo || null,
        description: body.description || null,
        notes: body.notes || null,
        attachmentUrl: body.attachmentUrl || null,
        warehouseId: body.warehouseId || null,
        claimantId: body.kind === 'reimbursement' ? (body.claimantId || userId) : null,
        createdBy: userId,
      }).returning()
      if (body.kind === 'reimbursement') return row

      const paid = await payExpense(tx, row, {
        tenantId, userId, isSupervisor,
        paidFrom: body.paidFrom!, paymentMethod: body.paymentMethod, openingEntryId: body.openingEntryId || null,
        cheque: body.cheque, applyCounterLimit: true, approvalToken: body.approvalToken,
      })
      const [updated] = await tx.update(expenses).set({
        paidFrom: paid.paidFrom, paymentMethod: paid.paymentMethod, posOpeningEntryId: paid.posOpeningEntryId,
        cashMovementId: paid.cashMovementId, warehouseId: paid.warehouseId, paidBy: userId, paidAt: new Date(), updatedAt: new Date(),
      }).where(eq(expenses.id, row.id)).returning()
      return updated
    })

    logAndBroadcast(tenantId, 'expense', 'created', expense.id, {
      userId, entityName: expense.expenseNo,
      description: `${expense.kind === 'reimbursement' ? 'Reimbursement claim' : 'Expense'} ${expense.expenseNo} ${roundCurrency(parseCurrency(expense.amount)).toFixed(2)}${expense.paidFrom ? ` (${expense.paidFrom})` : ''}`,
    })
    if (expense.posOpeningEntryId) logAndBroadcast(tenantId, 'pos-shift', 'updated', expense.posOpeningEntryId)
    if (expense.kind === 'reimbursement') {
      void notify(tenantId, 'expense_claim', {
        title: `Expense claim ${expense.expenseNo}: ${roundCurrency(parseCurrency(expense.amount)).toFixed(2)}`,
        body: `${session.user.name || 'A staff member'} — ${expense.description || expense.payee || 'reimbursement'}`,
        data: { screen: 'expenses', id: expense.id },
        permission: 'manageAccounting',
        excludeUserId: userId,
      })
    }
    return NextResponse.json(expense, { status: 201 })
  } catch (error) {
    if (error instanceof ApprovalError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    if (error instanceof ChequeError || error instanceof ExpenseError) return expenseErrorResponse(error)
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('GL_ACCOUNTS_MISSING:') || (error instanceof Error && error.name === 'GLValidationError')) {
      return NextResponse.json({ error: message.replace('GL_ACCOUNTS_MISSING: ', ''), code: 'GL_POSTING_FAILED' }, { status: 400 })
    }
    logError('api/expenses', error)
    return NextResponse.json({ error: 'Failed to record expense' }, { status: 500 })
  }
}
