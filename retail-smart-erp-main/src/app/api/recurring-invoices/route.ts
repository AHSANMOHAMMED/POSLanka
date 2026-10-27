import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, recurringInvoiceItems, recurringInvoices, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { branchFilter, getBranchScope, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createRecurringInvoiceSchema, recurringInvoicesListSchema } from '@/lib/validation/schemas/recurring-invoices'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { nextRunDate } from '@/lib/recurring-invoices/schedule'
import { lineRows, profileAmountSql } from '@/lib/recurring-invoices/server'

// GET /api/recurring-invoices — profiles with customer, branch, schedule, next run and amount
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, recurringInvoicesListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, customerId, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const conds = [eq(recurringInvoices.isActive, true)]
      const branchCond = branchFilter(scope, recurringInvoices.warehouseId, { includeUnassigned: true })
      if (branchCond) conds.push(branchCond)
      if (customerId) conds.push(eq(recurringInvoices.customerId, customerId))
      if (search) {
        const q = `%${escapeLikePattern(search)}%`
        conds.push(or(ilike(recurringInvoices.profileName, q), ilike(customers.name, q))!)
      }
      const chipWhere = and(...conds)
      if (status && status !== 'all') conds.push(eq(recurringInvoices.status, status))
      const where = and(...conds)

      const countRows = await db.select({ status: recurringInvoices.status, count: sql<number>`count(*)::int` })
        .from(recurringInvoices).leftJoin(customers, eq(customers.id, recurringInvoices.customerId))
        .where(chipWhere).groupBy(recurringInvoices.status)
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
        .from(recurringInvoices).leftJoin(customers, eq(customers.id, recurringInvoices.customerId)).where(where)
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const rows = await db.select({
        id: recurringInvoices.id, profileName: recurringInvoices.profileName, customerId: recurringInvoices.customerId,
        customerName: customers.name, warehouseId: recurringInvoices.warehouseId, warehouseName: warehouses.name,
        frequency: recurringInvoices.frequency, intervalCount: recurringInvoices.intervalCount, startDate: recurringInvoices.startDate,
        endType: recurringInvoices.endType, endAfterCount: recurringInvoices.endAfterCount, endDate: recurringInvoices.endDate,
        nextRunDate: recurringInvoices.nextRunDate, occurrencesGenerated: recurringInvoices.occurrencesGenerated,
        invoiceAction: recurringInvoices.invoiceAction, status: recurringInvoices.status, lastRunAt: recurringInvoices.lastRunAt,
        lastError: recurringInvoices.lastError, amount: profileAmountSql(), createdAt: recurringInvoices.createdAt,
      })
        .from(recurringInvoices)
        .leftJoin(customers, eq(customers.id, recurringInvoices.customerId))
        .leftJoin(warehouses, eq(warehouses.id, recurringInvoices.warehouseId))
        .where(where)
        .orderBy(sql`CASE ${recurringInvoices.status} WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END`,
          sql`${recurringInvoices.nextRunDate} ASC NULLS LAST`, desc(recurringInvoices.createdAt))
        .limit(limit)
        .offset(all ? 0 : (page - 1) * pageSize)

      const counts: Record<string, number> = {}
      for (const r of countRows) counts[r.status] = r.count
      if (all) return NextResponse.json(rows)
      return NextResponse.json({ data: rows, counts, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
    })
  } catch (error) {
    logError('api/recurring-invoices', error)
    return NextResponse.json({ error: 'Failed to fetch recurring invoices' }, { status: 500 })
  }
}

// POST /api/recurring-invoices — create a profile
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createRecurringInvoiceSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    const result = await withTenant(tenantId, async (db) => {
      const [customer] = await db.select({ id: customers.id, isActive: customers.isActive }).from(customers).where(eq(customers.id, body.customerId))
      if (!customer || customer.isActive === false) return { error: NextResponse.json({ error: 'Customer not found' }, { status: 400 }) }
      const branch = await resolveRecordBranch(session, db, body.warehouseId)
      if (branch.error) return { error: branch.error }

      const schedule = { ...body, endAfterCount: body.endAfterCount ?? null, endDate: body.endDate ?? null }
      const next = nextRunDate(schedule, 0)
      const [row] = await db.insert(recurringInvoices).values({
        tenantId, profileName: body.profileName, customerId: body.customerId, warehouseId: branch.warehouseId,
        frequency: body.frequency, intervalCount: body.intervalCount, startDate: body.startDate,
        endType: body.endType, endAfterCount: body.endType === 'after' ? body.endAfterCount ?? null : null,
        endDate: body.endType === 'on_date' ? body.endDate ?? null : null,
        nextRunDate: next, occurrencesGenerated: 0, invoiceAction: body.invoiceAction,
        paymentTermsDays: body.paymentTermsDays, notes: body.notes || null, terms: body.terms || null,
        notifyChannel: body.notifyChannel, status: next ? 'active' : 'completed', createdBy: userId,
      }).returning({ id: recurringInvoices.id, profileName: recurringInvoices.profileName })
      await db.insert(recurringInvoiceItems).values(lineRows(tenantId, row.id, body.lines))
      return { row }
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'recurring-invoice', 'created', result.row.id, {
      userId, entityName: result.row.profileName, description: `Created recurring invoice profile ${result.row.profileName}`,
    })
    return NextResponse.json({ id: result.row.id }, { status: 201 })
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/recurring-invoices', error)
    return NextResponse.json({ error: 'Failed to create the recurring invoice' }, { status: 500 })
  }
}
