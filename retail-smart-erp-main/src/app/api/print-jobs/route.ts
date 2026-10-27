import { NextRequest, NextResponse } from 'next/server'
import { and, desc, asc, eq, ilike, inArray, isNotNull, lt, gte, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, printJobItems, printJobPayments, printJobs, users, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { getBranchScope, branchFilter, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createPrintJobSchema, printJobsListSchema } from '@/lib/validation/schemas/print-jobs'
import { escapeLikePattern } from '@/lib/utils/sql'
import { nextDocNo } from '@/lib/documents/numbering'
import { roundCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import {
  OPEN_PRINT_JOB_STATUSES, colomboDayBounds, computePrintJobTotals, computePrintLines, lineRows, postPrintJobAdvanceToGL,
} from '@/lib/print-jobs/server'
import { printJobErrorResponse } from '@/lib/print-jobs/errors'
import { findOrCreateWalkInCustomer } from '@/lib/customers/walk-in'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'

// GET /api/print-jobs — list with status / due filters, search by job no., phone, name, title
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, printJobsListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, due, customerId, warehouseId, assignedTo, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      // K4: branch-restricted staff see their own branches' jobs (and ones without a branch)
      const scope = await getBranchScope(session, db)
      const branchCond = branchFilter(scope, printJobs.warehouseId, { includeUnassigned: true })
      if (branchCond) conditions.push(branchCond)
      if (warehouseId) conditions.push(eq(printJobs.warehouseId, warehouseId))
      if (customerId) conditions.push(eq(printJobs.customerId, customerId))
      if (assignedTo) conditions.push(eq(printJobs.assignedTo, assignedTo))
      if (status === 'open' || (!status && due)) {
        conditions.push(inArray(printJobs.status, [...OPEN_PRINT_JOB_STATUSES]))
      } else if (status && status !== 'all') {
        conditions.push(eq(printJobs.status, status))
      }
      if (due) {
        const { start, end } = colomboDayBounds()
        if (due === 'today') conditions.push(and(isNotNull(printJobs.dueAt), gte(printJobs.dueAt, start), lt(printJobs.dueAt, end))!)
        if (due === 'overdue') conditions.push(and(isNotNull(printJobs.dueAt), lt(printJobs.dueAt, new Date()))!)
        if (due === 'urgent') conditions.push(eq(printJobs.isUrgent, true))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        const digits = search.replace(/\D/g, '')
        const ors = [
          ilike(printJobs.jobNo, `%${escaped}%`),
          ilike(printJobs.customerName, `%${escaped}%`),
          ilike(printJobs.title, `%${escaped}%`),
          ilike(printJobs.customerPhone, `%${escaped}%`),
        ]
        // 077 123 4567 / 0771234567 / 94771234567: match on the last 9 digits
        if (digits.length >= 6) ors.push(sql`regexp_replace(coalesce(${printJobs.customerPhone}, ''), '\\D', '', 'g') LIKE ${'%' + digits.slice(-9) + '%'}`)
        conditions.push(or(...ors)!)
      }
      const whereClause = conditions.length ? and(...conditions) : undefined

      // Status counts for the chips (same filters except status / due)
      const chipConds: SQL[] = []
      if (branchCond) chipConds.push(branchCond)
      if (warehouseId) chipConds.push(eq(printJobs.warehouseId, warehouseId))
      const countRows = await db.select({ status: printJobs.status, count: sql<number>`count(*)::int` })
        .from(printJobs).where(chipConds.length ? and(...chipConds) : undefined).groupBy(printJobs.status)
      const { start, end } = colomboDayBounds()
      const [dueCounts] = await db.select({
        // timestamps are stored as UTC wall time (drizzle writes toISOString())
        today: sql<number>`count(*) FILTER (WHERE ${printJobs.dueAt} >= ${start.toISOString()}::timestamp AND ${printJobs.dueAt} < ${end.toISOString()}::timestamp)::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${printJobs.dueAt} < ${new Date().toISOString()}::timestamp)::int`,
        urgent: sql<number>`count(*) FILTER (WHERE ${printJobs.isUrgent})::int`,
      }).from(printJobs).where(and(inArray(printJobs.status, [...OPEN_PRINT_JOB_STATUSES]), ...chipConds))

      const [{ count: total }] = await db.select({ count: sql<number>`count(*)::int` }).from(printJobs).where(whereClause)
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? 0 : (page - 1) * pageSize

      // Open jobs: most urgent first (urgent, then due soonest); otherwise newest first
      const openView = status === 'open' || !!due
      const rows = await db.select({
        id: printJobs.id, jobNo: printJobs.jobNo, title: printJobs.title, status: printJobs.status,
        proofStatus: printJobs.proofStatus, customerId: printJobs.customerId, customerName: printJobs.customerName,
        customerPhone: printJobs.customerPhone, receivedAt: printJobs.receivedAt, dueAt: printJobs.dueAt,
        isUrgent: printJobs.isUrgent, total: printJobs.total, paidAmount: printJobs.paidAmount,
        balanceDue: printJobs.balanceDue, saleId: printJobs.saleId, warehouseId: printJobs.warehouseId,
        warehouseName: warehouses.name, assignedTo: printJobs.assignedTo, assignedName: users.fullName,
        createdAt: printJobs.createdAt,
      })
        .from(printJobs)
        .leftJoin(users, eq(users.id, printJobs.assignedTo))
        .leftJoin(warehouses, eq(warehouses.id, printJobs.warehouseId))
        .where(whereClause)
        .orderBy(...(openView
          ? [desc(printJobs.isUrgent), sql`${printJobs.dueAt} ASC NULLS LAST`, asc(printJobs.createdAt)]
          : [desc(printJobs.createdAt)]))
        .limit(limit)
        .offset(offset)

      const counts: Record<string, number> = {}
      for (const r of countRows) counts[r.status] = r.count
      const summary = { counts, dueToday: dueCounts?.today || 0, overdue: dueCounts?.overdue || 0, urgent: dueCounts?.urgent || 0 }

      if (all) return NextResponse.json(rows)
      return NextResponse.json({
        data: rows,
        summary,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      })
    })
  } catch (error) {
    logError('api/print-jobs', error)
    return NextResponse.json({ error: 'Failed to fetch print jobs' }, { status: 500 })
  }
}

// POST /api/print-jobs — book a job (optionally with an advance)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createPrintJobSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Branch of the job: requested (must be allowed) → open shift → own / default branch
      const branch = await resolveRecordBranch(session, db, body.warehouseId || null)
      if (branch.error) return branch.error

      let customerName = body.customerName
      let customerPhone = body.customerPhone || null
      if (body.customerId) {
        const [c] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, mobilePhone: customers.mobilePhone })
          .from(customers).where(eq(customers.id, body.customerId)).limit(1)
        if (!c) return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
        customerName = body.customerName || c.name
        customerPhone = customerPhone || c.mobilePhone || c.phone || null
      }
      if (body.assignedTo) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.assignedTo)).limit(1)
        if (!u) return NextResponse.json({ error: 'Invalid staff member' }, { status: 400 })
      }

      const lines = await computePrintLines(db, body.lines)
      const totals = await computePrintJobTotals(db, tenantId, lines, body.discountAmount || 0)
      const advance = body.advance ? roundCurrency(body.advance.amount) : 0
      if (advance > totals.total + 0.005) {
        return NextResponse.json({ error: `The advance cannot be more than the job total (${totals.total.toFixed(2)})` }, { status: 400 })
      }

      let createdCustomerId: string | null = null
      const result = await db.transaction(async (tx) => {
        // Walk-in with a phone: find the customer by phone (SL local form) or create one
        let customerId = body.customerId || null
        if (!customerId && body.saveCustomer && customerPhone) {
          const walkIn = await findOrCreateWalkInCustomer(tx, tenantId, { name: customerName, phone: customerPhone })
          customerId = walkIn.customerId
          if (walkIn.outcome === 'created') createdCustomerId = walkIn.customerId
        }
        const jobNo = await nextDocNo(tx, tenantId, 'print_job')
        const [job] = await tx.insert(printJobs).values({
          tenantId,
          jobNo,
          warehouseId: branch.warehouseId,
          customerId,
          customerName,
          customerPhone,
          title: body.title,
          receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          isUrgent: !!body.isUrgent,
          assignedTo: body.assignedTo || null,
          status: 'received',
          proofStatus: body.proofStatus || 'not_needed',
          proofFiles: body.proofFiles || [],
          proofNote: body.proofNote || null,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxAmount: String(totals.taxAmount),
          taxBreakdown: totals.taxBreakdown,
          total: String(totals.total),
          paidAmount: String(advance),
          balanceDue: String(roundCurrency(Math.max(0, totals.total - advance))),
          notes: body.notes || null,
          createdBy: userId,
        }).returning()

        await tx.insert(printJobItems).values(lineRows(tenantId, job.id, lines))

        if (advance > 0 && body.advance) {
          const [payment] = await tx.insert(printJobPayments).values({
            tenantId,
            printJobId: job.id,
            amount: String(advance),
            paymentMethod: body.advance.paymentMethod,
            reference: body.advance.reference || null,
            receivedBy: userId,
            // 0187: the advance goes into this user's drawer / open shift (none → no shift)
            posOpeningEntryId: await currentOpenShiftId(tx, userId),
          }).returning({ id: printJobPayments.id })
          await postPrintJobAdvanceToGL(tx, tenantId, {
            paymentId: payment.id, jobNo, amount: advance, paymentMethod: body.advance.paymentMethod, customerId: job.customerId,
          })
        }
        return job
      })

      if (createdCustomerId) logAndBroadcast(tenantId, 'customer', 'created', createdCustomerId)
      logAndBroadcast(tenantId, 'print-job', 'created', result.id, {
        userId,
        entityName: result.jobNo,
        description: generateActivityDescription('create', 'print job', result.jobNo),
      })
      return NextResponse.json(result)
    })
  } catch (error) {
    const handled = printJobErrorResponse(error)
    if (handled) return handled
    logError('api/print-jobs', error)
    return NextResponse.json({ error: 'Failed to create print job' }, { status: 500 })
  }
}
