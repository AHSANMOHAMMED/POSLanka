import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertBranchAccess, getBranchScope } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { paymentsReceivedListSchema, recordPaymentSchema } from '@/lib/validation/schemas/payments-received'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { escapeLikePattern } from '@/lib/utils/sql'
import { recordCustomerPayment, scopeSql } from '@/lib/payments-received/server'

function rows<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]
}

// Local (Asia/Colombo) date of a timestamp column stored as UTC wall time
const localDate = (col: string) => sql.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Colombo')::date`)

// GET /api/payments-received — money received from customers: payments on invoices (payments
// table; voided ones and refunds on returns excluded) and customer credit deposits (advances),
// with the receipt they were recorded on. Store credit applied to an invoice (method 'credit') is
// listed too but not counted in the money total (that money was received as the deposit). Filters: date range, method, customer, branch, search.
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, paymentsReceivedListSchema)
    if (!parsed.success) return parsed.response
    const { search, fromDate, toDate, method, customerId, warehouseId, kind, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      if (warehouseId) {
        const denied = await assertBranchAccess(session, warehouseId, db, { scope })
        if (denied) return denied
      }
      const pFilters = [sql`p.voided_at IS NULL`, sql`s.is_return = false`]
      const cFilters = [sql`c.type = 'add'`]
      if (fromDate) { pFilters.push(sql`${localDate('p.created_at')} >= ${fromDate}::date`); cFilters.push(sql`${localDate('c.created_at')} >= ${fromDate}::date`) }
      if (toDate) { pFilters.push(sql`${localDate('p.created_at')} <= ${toDate}::date`); cFilters.push(sql`${localDate('c.created_at')} <= ${toDate}::date`) }
      if (method) { pFilters.push(sql`p.method = ${method}`); cFilters.push(sql`COALESCE(r.method, 'cash') = ${method}`) }
      if (customerId) { pFilters.push(sql`s.customer_id = ${customerId}::uuid`); cFilters.push(sql`c.customer_id = ${customerId}::uuid`) }
      if (warehouseId) { pFilters.push(sql`s.warehouse_id = ${warehouseId}::uuid`); cFilters.push(sql`r.warehouse_id = ${warehouseId}::uuid`) }
      if (search) {
        const q = `%${escapeLikePattern(search)}%`
        pFilters.push(sql`(s.invoice_no ILIKE ${q} OR COALESCE(cu.name, s.customer_name, '') ILIKE ${q} OR COALESCE(p.reference, '') ILIKE ${q} OR COALESCE(r.receipt_no, '') ILIKE ${q})`)
        cFilters.push(sql`(cu.name ILIKE ${q} OR COALESCE(r.receipt_no, '') ILIKE ${q} OR COALESCE(c.notes, '') ILIKE ${q})`)
      }
      const pWhere = sql.join(pFilters, sql` AND `)
      const cWhere = sql.join(cFilters, sql` AND `)
      const parts = []
      if (kind !== 'credit_deposit') {
        parts.push(sql`
          SELECT p.id, 'invoice_payment' AS kind, p.created_at AS "createdAt", ${localDate('p.created_at')}::text AS date,
                 s.customer_id AS "customerId", COALESCE(cu.name, s.customer_name) AS "customerName",
                 s.id AS "saleId", s.invoice_no AS "invoiceNo", p.method::text AS method, p.reference, p.amount::float AS amount,
                 u.full_name AS "receivedBy", r.id AS "receiptId", r.receipt_no AS "receiptNo",
                 s.warehouse_id AS "warehouseId", w.name AS "warehouseName"
          FROM payments p
          JOIN sales s ON s.id = p.sale_id
          LEFT JOIN customers cu ON cu.id = s.customer_id
          LEFT JOIN users u ON u.id = p.received_by
          LEFT JOIN warehouses w ON w.id = s.warehouse_id
          LEFT JOIN payment_receipt_allocations a ON a.payment_id = p.id OR a.credit_payment_id = p.id
          LEFT JOIN payment_receipts r ON r.id = a.receipt_id
          WHERE ${pWhere}${scopeSql(scope, 's.warehouse_id')}`)
      }
      if (kind !== 'invoice_payment') {
        parts.push(sql`
          SELECT c.id, 'credit_deposit' AS kind, c.created_at AS "createdAt", ${localDate('c.created_at')}::text AS date,
                 c.customer_id AS "customerId", cu.name AS "customerName",
                 NULL::uuid AS "saleId", NULL::varchar AS "invoiceNo", COALESCE(r.method, 'cash') AS method, r.reference, c.amount::float AS amount,
                 u.full_name AS "receivedBy", r.id AS "receiptId", r.receipt_no AS "receiptNo",
                 r.warehouse_id AS "warehouseId", w.name AS "warehouseName"
          FROM customer_credit_transactions c
          JOIN customers cu ON cu.id = c.customer_id
          LEFT JOIN users u ON u.id = c.created_by
          LEFT JOIN payment_receipts r ON c.reference_type = 'payment_receipt' AND r.id = c.reference_id
          LEFT JOIN warehouses w ON w.id = r.warehouse_id
          WHERE ${cWhere}${scopeSql(scope, 'r.warehouse_id')}`)
      }
      const union = sql.join(parts, sql` UNION ALL `)
      const [totals] = rows<{ count: number; total: number; creditApplied: number }>(await db.execute(sql`
        SELECT count(*)::int AS count, COALESCE(sum(amount) FILTER (WHERE method <> 'credit'), 0)::float AS total,
               COALESCE(sum(amount) FILTER (WHERE method = 'credit'), 0)::float AS "creditApplied" FROM (${union}) x`))
      const byMethod = rows<{ method: string; total: number; count: number }>(await db.execute(sql`
        SELECT method, COALESCE(sum(amount), 0)::float AS total, count(*)::int AS count FROM (${union}) x GROUP BY method ORDER BY 2 DESC`))
      const limit = all ? 1000 : Math.min(pageSize, 200)
      const offset = all ? 0 : (page - 1) * pageSize
      const data = rows(await db.execute(sql`SELECT * FROM (${union}) x ORDER BY "createdAt" DESC, id LIMIT ${limit} OFFSET ${offset}`))
      const [{ anyEver }] = rows<{ anyEver: boolean }>(await db.execute(sql`
        SELECT (EXISTS (SELECT 1 FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.voided_at IS NULL AND s.is_return = false)
             OR EXISTS (SELECT 1 FROM customer_credit_transactions WHERE type = 'add')) AS "anyEver"`))
      return NextResponse.json({
        data, totals: { count: totals?.count || 0, amount: totals?.total || 0, creditApplied: totals?.creditApplied || 0, byMethod }, anyEver,
        pagination: { page, pageSize, total: totals?.count || 0, totalPages: Math.ceil((totals?.count || 0) / pageSize) },
      })
    })
  } catch (error) {
    logError('api/payments-received', error)
    return NextResponse.json({ error: 'Failed to fetch payments received' }, { status: 500 })
  }
}

// POST /api/payments-received — "Record payment": one customer, one amount received, allocated
// over that customer's unpaid invoices (src/lib/payments-received/server.ts)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const parsed = await validateBody(request, recordPaymentSchema)
    if (!parsed.success) return parsed.response
    const userId = await resolveUserIdRequired(session)
    const result = await recordCustomerPayment(session, userId, parsed.data)
    if (result.body.id) {
      logAndBroadcast(session.user.tenantId, 'payment-receipt', 'created', String(result.body.id), {
        userId, entityName: String(result.body.receiptNo || ''), description: `Recorded payment ${result.body.receiptNo}`,
      })
    }
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    logError('api/payments-received POST', error)
    return NextResponse.json({ error: 'Failed to record the payment' }, { status: 500 })
  }
}
