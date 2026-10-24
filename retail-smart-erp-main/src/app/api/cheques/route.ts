import { NextRequest, NextResponse } from 'next/server'
import { and, desc, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { cheques, customers, purchases, sales, suppliers, users, warehouses } from '@/lib/db/schema'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { chequeListSchema, createChequeSchema, chequeStatusValues } from '@/lib/validation/schemas/cheques'
import { tenantToday } from '@/lib/accounting/gl'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import { allowedChequeActions, ChequeError, insertCheque, type ChequeDirection } from '@/lib/cheques/cheques'
import type { ChequeStatus } from '@/lib/db/schema'
import { canViewAllCheques } from '@/lib/cheques/access'
import { getBranchScope, canAccessBranch, branchDeniedResponse, branchDeniedMessage } from '@/lib/auth/branch-access'

// GET /api/cheques — register with filters (status, direction, due within N days, branch)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const viewAll = canViewAllCheques(session)
    if (!viewAll) {
      const permError = requirePermission(session, 'createSales')
      if (permError) return permError
    }
    const parsed = validateSearchParams(request, chequeListSchema)
    if (!parsed.success) return parsed.response
    const q = parsed.data
    const tenantId = session.user.tenantId
    const today = await tenantToday(tenantId)

    return await withTenant(tenantId, async (db) => {
      const conds: SQL[] = []
      if (!viewAll) conds.push(eq(cheques.createdBy, session.user.id))
      if (q.direction) conds.push(eq(cheques.direction, q.direction))
      if (q.status) {
        const wanted = q.status.split(',').flatMap((s) => (s === 'open' ? ['pending', 'deposited'] : [s]))
          .filter((s): s is ChequeStatus => (chequeStatusValues as readonly string[]).includes(s))
        if (wanted.length) conds.push(inArray(cheques.status, wanted))
      }
      if (q.dueWithinDays !== undefined) {
        conds.push(inArray(cheques.status, ['pending', 'deposited']))
        conds.push(sql`${cheques.chequeDate} <= ${today}::date + ${q.dueWithinDays}::int`)
      }
      if (q.warehouseId) conds.push(eq(cheques.warehouseId, q.warehouseId))
      // K4: branch-restricted users see their own branches' cheques (and the ones they recorded)
      const scope = await getBranchScope(session, db)
      if (q.warehouseId && !canAccessBranch(scope, q.warehouseId)) return branchDeniedResponse(scope, db)
      if (scope) conds.push(or(inArray(cheques.warehouseId, scope), eq(cheques.createdBy, session.user.id))!)
      if (q.customerId) conds.push(eq(cheques.customerId, q.customerId))
      if (q.supplierId) conds.push(eq(cheques.supplierId, q.supplierId))
      if (q.fromDate) conds.push(sql`${cheques.chequeDate} >= ${q.fromDate}::date`)
      if (q.toDate) conds.push(sql`${cheques.chequeDate} <= ${q.toDate}::date`)
      if (q.search) {
        const p = `%${escapeLikePattern(q.search)}%`
        conds.push(or(
          ilike(cheques.chequeNo, p), ilike(cheques.bankName, p), ilike(cheques.partyName, p),
          ilike(customers.name, p), ilike(suppliers.name, p),
        )!)
      }
      const where = conds.length ? and(...conds) : undefined

      const [agg] = await db.select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`COALESCE(SUM(${cheques.amount}), 0)`,
        receivedOpen: sql<string>`COALESCE(SUM(CASE WHEN ${cheques.direction} = 'received' AND ${cheques.status} IN ('pending','deposited') THEN ${cheques.amount} ELSE 0 END), 0)`,
        issuedOpen: sql<string>`COALESCE(SUM(CASE WHEN ${cheques.direction} = 'issued' AND ${cheques.status} = 'pending' THEN ${cheques.amount} ELSE 0 END), 0)`,
        overdue: sql<number>`count(*) FILTER (WHERE ${cheques.status} IN ('pending','deposited') AND ${cheques.chequeDate} < ${today}::date)::int`,
        bounced: sql<number>`count(*) FILTER (WHERE ${cheques.status} = 'bounced')::int`,
      })
        .from(cheques)
        .leftJoin(customers, eq(customers.id, cheques.customerId))
        .leftJoin(suppliers, eq(suppliers.id, cheques.supplierId))
        .where(where)

      const offset = (q.page - 1) * q.pageSize
      const rows = await db.select({
        cheque: cheques,
        customerName: customers.name,
        supplierName: suppliers.name,
        invoiceNo: sales.invoiceNo,
        purchaseNo: purchases.purchaseNo,
        warehouseName: warehouses.name,
        createdByName: users.fullName,
      })
        .from(cheques)
        .leftJoin(customers, eq(customers.id, cheques.customerId))
        .leftJoin(suppliers, eq(suppliers.id, cheques.supplierId))
        .leftJoin(sales, eq(sales.id, cheques.saleId))
        .leftJoin(purchases, eq(purchases.id, cheques.purchaseId))
        .leftJoin(warehouses, eq(warehouses.id, cheques.warehouseId))
        .leftJoin(users, eq(users.id, cheques.createdBy))
        .where(where)
        // open cheques by due date first, then the rest newest first
        .orderBy(
          sql`CASE WHEN ${cheques.status} IN ('pending','deposited') THEN 0 ELSE 1 END`,
          sql`CASE WHEN ${cheques.status} IN ('pending','deposited') THEN ${cheques.chequeDate} END ASC`,
          desc(cheques.chequeDate),
          asc(cheques.chequeNo),
        )
        .limit(q.all ? 1000 : q.pageSize)
        .offset(q.all ? 0 : offset)

      const dayMs = 86400000
      const data = rows.map((r) => {
        const c = r.cheque
        const open = c.status === 'pending' || c.status === 'deposited'
        const daysToDue = Math.round((Date.parse(`${c.chequeDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs)
        return {
          ...c,
          partyDisplay: r.customerName || r.supplierName || c.partyName || null,
          customerName: r.customerName,
          supplierName: r.supplierName,
          invoiceNo: r.invoiceNo,
          purchaseNo: r.purchaseNo,
          warehouseName: r.warehouseName,
          createdByName: r.createdByName,
          daysToDue: open ? daysToDue : null,
          overdue: open && daysToDue < 0,
          actions: allowedChequeActions(c.direction as ChequeDirection, c.status as ChequeStatus),
        }
      })
      const total = agg?.count || 0
      return NextResponse.json({
        data,
        today,
        totals: {
          count: total,
          amount: roundCurrency(parseCurrency(agg?.amount)),
          receivedOpen: roundCurrency(parseCurrency(agg?.receivedOpen)),
          issuedOpen: roundCurrency(parseCurrency(agg?.issuedOpen)),
          overdue: agg?.overdue || 0,
          bounced: agg?.bounced || 0,
        },
        pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      })
    })
  } catch (error) {
    logError('api/cheques', error)
    return NextResponse.json({ error: 'Failed to fetch cheques' }, { status: 500 })
  }
}

// POST /api/cheques — record a cheque on its own (register entry; settles no invoice).
// Received: anyone at the till (createSales); issued: purchasing / accounts.
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await validateBody(request, createChequeSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const { role, tenantId, customRoleId } = session.user
    if (body.direction === 'received') {
      const permError = requirePermission(session, 'createSales')
      if (permError) return permError
    } else if (!hasPermission(role, 'managePurchases', tenantId, customRoleId) && !hasPermission(role, 'manageAccounting', tenantId, customRoleId)) {
      return NextResponse.json({ error: 'You do not have permission to record issued cheques' }, { status: 403 })
    }
    const quotaError = await requireQuota(tenantId, 'essential')
    if (quotaError) return quotaError

    const cheque = await withTenantTransaction(tenantId, async (tx) => {
      // K4: a branch-restricted user records cheques for their own branches (default: their first)
      const scope = await getBranchScope(session, tx)
      if (body.warehouseId && !canAccessBranch(scope, body.warehouseId)) throw new ChequeError('BRANCH_ACCESS_DENIED', await branchDeniedMessage(scope, tx), 403)
      if (body.customerId) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, body.customerId))
        if (!c) throw new ChequeError('NOT_FOUND', 'Customer not found', 404)
      }
      if (body.supplierId) {
        const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, body.supplierId))
        if (!s) throw new ChequeError('NOT_FOUND', 'Supplier not found', 404)
      }
      return insertCheque(tx, {
        tenantId, direction: body.direction, details: body, amount: body.amount, userId: session.user.id,
        customerId: body.customerId || null, supplierId: body.supplierId || null, warehouseId: body.warehouseId || scope?.[0] || null,
      })
    })
    logAndBroadcast(tenantId, 'cheque', 'created', cheque.id, { userId: session.user.id, entityName: cheque.chequeNo })
    return NextResponse.json(cheque, { status: 201 })
  } catch (error) {
    if (error instanceof ChequeError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    logError('api/cheques', error)
    return NextResponse.json({ error: 'Failed to record cheque' }, { status: 500 })
  }
}
