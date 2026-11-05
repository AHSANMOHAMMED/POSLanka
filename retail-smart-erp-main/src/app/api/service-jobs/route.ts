import { NextRequest, NextResponse } from 'next/server'
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, serviceJobItems, serviceJobPayments, serviceJobs, users, warehouses } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { getBranchScope, branchFilter, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createServiceJobSchema, serviceJobsListSchema } from '@/lib/validation/schemas/service-jobs'
import { escapeLikePattern } from '@/lib/utils/sql'
import { nextDocNo } from '@/lib/documents/numbering'
import { roundCurrency } from '@/lib/utils/currency'
import { normalizeImei } from '@/lib/utils/imei'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { OPEN_SERVICE_JOB_STATUSES, jobKindForBusinessType } from '@/lib/service-jobs/constants'
import {
  SERVICE_JOB_MONEY, SERVICE_JOB_VIEW, addServiceJobHistory, checkServiceWarranty, colomboDayBounds, computeServiceJobTotals,
  computeServiceLines, postServiceJobAdvanceToGL, requireAnyPermission, serviceJobErrorResponse, serviceLineRows,
} from '@/lib/service-jobs/server'
import { hasAnyPermission } from '@/lib/auth/field-access'
import { findOrCreateWalkInCustomer } from '@/lib/customers/walk-in'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'

// GET /api/service-jobs — list with status / due filters; search by job no., phone, name,
// title, serial / IMEI, brand / model
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, SERVICE_JOB_VIEW)
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, serviceJobsListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, due, customerId, warehouseId, assignedTo, mine, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions: SQL[] = []
      // K4: branch-restricted staff see their own branches' jobs (and ones without a branch)
      const scope = await getBranchScope(session, db)
      const branchCond = branchFilter(scope, serviceJobs.warehouseId, { includeUnassigned: true })
      if (branchCond) conditions.push(branchCond)
      if (warehouseId) conditions.push(eq(serviceJobs.warehouseId, warehouseId))
      if (customerId) conditions.push(eq(serviceJobs.customerId, customerId))
      if (assignedTo) conditions.push(eq(serviceJobs.assignedTo, assignedTo))
      if (mine) conditions.push(eq(serviceJobs.assignedTo, session.user.id))
      if (status === 'open' || (!status && due)) {
        conditions.push(inArray(serviceJobs.status, [...OPEN_SERVICE_JOB_STATUSES]))
      } else if (status && status !== 'all') {
        conditions.push(eq(serviceJobs.status, status))
      }
      if (due) {
        const { start, end } = colomboDayBounds()
        if (due === 'today') conditions.push(and(isNotNull(serviceJobs.promisedAt), gte(serviceJobs.promisedAt, start), lt(serviceJobs.promisedAt, end))!)
        if (due === 'overdue') conditions.push(and(isNotNull(serviceJobs.promisedAt), lt(serviceJobs.promisedAt, new Date()))!)
        if (due === 'urgent') conditions.push(eq(serviceJobs.isUrgent, true))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        const digits = search.replace(/\D/g, '')
        const ors: SQL[] = [
          ilike(serviceJobs.jobNo, `%${escaped}%`),
          ilike(serviceJobs.customerName, `%${escaped}%`),
          ilike(serviceJobs.title, `%${escaped}%`),
          ilike(serviceJobs.customerPhone, `%${escaped}%`),
          ilike(serviceJobs.serialNumber, `%${escaped}%`),
          ilike(serviceJobs.brand, `%${escaped}%`),
          ilike(serviceJobs.model, `%${escaped}%`),
          ilike(serviceJobs.garment, `%${escaped}%`),
        ]
        if (digits.length >= 6) {
          // 077 123 4567 / 0771234567 / 94771234567: match on the last 9 digits
          ors.push(sql`regexp_replace(coalesce(${serviceJobs.customerPhone}, ''), '\\D', '', 'g') LIKE ${'%' + digits.slice(-9) + '%'}`)
          ors.push(sql`(${serviceJobs.imei} LIKE ${'%' + digits + '%'} OR ${serviceJobs.imei2} LIKE ${'%' + digits + '%'})`)
        }
        conditions.push(or(...ors)!)
      }
      const whereClause = conditions.length ? and(...conditions) : undefined

      // Status counts for the tabs (same branch filters, not status / due)
      const chipConds: SQL[] = []
      if (branchCond) chipConds.push(branchCond)
      if (warehouseId) chipConds.push(eq(serviceJobs.warehouseId, warehouseId))
      if (mine) chipConds.push(eq(serviceJobs.assignedTo, session.user.id))
      const countRows = await db.select({ status: serviceJobs.status, count: sql<number>`count(*)::int` })
        .from(serviceJobs).where(chipConds.length ? and(...chipConds) : undefined).groupBy(serviceJobs.status)
      const { start, end } = colomboDayBounds()
      const [dueCounts] = await db.select({
        // timestamps are stored as UTC wall time (drizzle writes toISOString())
        today: sql<number>`count(*) FILTER (WHERE ${serviceJobs.promisedAt} >= ${start.toISOString()}::timestamp AND ${serviceJobs.promisedAt} < ${end.toISOString()}::timestamp)::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${serviceJobs.promisedAt} < ${new Date().toISOString()}::timestamp)::int`,
        urgent: sql<number>`count(*) FILTER (WHERE ${serviceJobs.isUrgent})::int`,
      }).from(serviceJobs).where(and(inArray(serviceJobs.status, [...OPEN_SERVICE_JOB_STATUSES]), ...chipConds))

      const [{ count: total }] = await db.select({ count: sql<number>`count(*)::int` }).from(serviceJobs).where(whereClause)
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? 0 : (page - 1) * pageSize
      const openView = status === 'open' || !!due

      const rows = await db.select({
        id: serviceJobs.id, jobNo: serviceJobs.jobNo, jobType: serviceJobs.jobType, title: serviceJobs.title, status: serviceJobs.status,
        estimateStatus: serviceJobs.estimateStatus, customerId: serviceJobs.customerId, customerName: serviceJobs.customerName,
        customerPhone: serviceJobs.customerPhone, deviceType: serviceJobs.deviceType, brand: serviceJobs.brand, model: serviceJobs.model,
        serialNumber: serviceJobs.serialNumber, imei: serviceJobs.imei, garment: serviceJobs.garment, underWarranty: serviceJobs.underWarranty,
        receivedAt: serviceJobs.receivedAt, promisedAt: serviceJobs.promisedAt, isUrgent: serviceJobs.isUrgent,
        total: serviceJobs.total, paidAmount: serviceJobs.paidAmount, balanceDue: serviceJobs.balanceDue, saleId: serviceJobs.saleId,
        warehouseId: serviceJobs.warehouseId, warehouseName: warehouses.name, assignedTo: serviceJobs.assignedTo, assignedName: users.fullName,
        createdAt: serviceJobs.createdAt,
      })
        .from(serviceJobs)
        .leftJoin(users, eq(users.id, serviceJobs.assignedTo))
        .leftJoin(warehouses, eq(warehouses.id, serviceJobs.warehouseId))
        .where(whereClause)
        .orderBy(...(openView
          ? [desc(serviceJobs.isUrgent), sql`${serviceJobs.promisedAt} ASC NULLS LAST`, asc(serviceJobs.createdAt)]
          : [desc(serviceJobs.createdAt)]))
        .limit(limit)
        .offset(offset)

      const counts: Record<string, number> = {}
      for (const r of countRows) counts[r.status] = r.count
      const summary = { counts, dueToday: dueCounts?.today || 0, overdue: dueCounts?.overdue || 0, urgent: dueCounts?.urgent || 0 }
      if (all) return NextResponse.json(rows)
      return NextResponse.json({ data: rows, summary, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
    })
  } catch (error) {
    logError('api/service-jobs', error)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}

// POST /api/service-jobs — book a job in (optionally with an advance)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, SERVICE_JOB_VIEW)
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createServiceJobSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    if (body.advance && !hasAnyPermission(session, SERVICE_JOB_MONEY)) {
      return NextResponse.json({ error: 'Only counter staff or managers can take an advance' }, { status: 403 })
    }

    return await withTenant(tenantId, async (db) => {
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

      const lines = await computeServiceLines(db, body.lines)
      const totals = await computeServiceJobTotals(db, tenantId, lines, body.discountAmount || 0)
      const advance = body.advance ? roundCurrency(body.advance.amount) : 0
      // Before any lines are priced the advance is held against the estimate
      const ceiling = Math.max(totals.total, body.estimateAmount || 0)
      if (advance > ceiling + 0.005) {
        return NextResponse.json({ error: `The advance cannot be more than the job total / estimate (${ceiling.toFixed(2)})` }, { status: 400 })
      }

      // Repairs: was the unit sold here and is it still under the shop's warranty?
      const imei = normalizeImei(body.imei).slice(0, 20) || null
      const imei2 = normalizeImei(body.imei2).slice(0, 20) || null
      const jobType = body.jobType || jobKindForBusinessType(session.user)
      const lookupTerm = imei || body.serialNumber || imei2
      const warranty = jobType === 'repair' && lookupTerm ? await checkServiceWarranty(db, tenantId, lookupTerm, await getBranchScope(session, db)) : null

      let createdCustomerId: string | null = null
      const result = await db.transaction(async (tx) => {
        let customerId = body.customerId || null
        if (!customerId && body.saveCustomer && customerPhone) {
          const walkIn = await findOrCreateWalkInCustomer(tx, tenantId, { name: customerName, phone: customerPhone })
          customerId = walkIn.customerId
          if (walkIn.outcome === 'created') createdCustomerId = walkIn.customerId
        }
        const jobNo = await nextDocNo(tx, tenantId, 'service_job')
        const balance = roundCurrency(Math.max(0, totals.total - advance))
        const [job] = await tx.insert(serviceJobs).values({
          tenantId,
          jobNo,
          jobType,
          warehouseId: branch.warehouseId,
          customerId,
          customerName,
          customerPhone,
          title: body.title,
          deviceType: body.deviceType || null,
          brand: body.brand || null,
          model: body.model || null,
          serialNumber: body.serialNumber || warranty?.serialNumber || null,
          imei,
          imei2,
          serialNumberId: warranty?.serialNumberId || null,
          itemId: warranty?.itemId || null,
          passcode: body.passcode || null,
          faultReported: body.faultReported || null,
          accessoriesReceived: body.accessoriesReceived || null,
          conditionChecklist: (body.conditionChecklist || []).map((c) => ({ label: c.label, ok: c.ok ?? null, note: c.note || null })),
          conditionNotes: body.conditionNotes || null,
          diagnosis: body.diagnosis || null,
          workDone: body.workDone || null,
          underWarranty: !!warranty?.inWarranty,
          warrantySaleId: warranty?.saleId || null,
          warrantyUntil: warranty?.warrantyUntil || null,
          garment: body.garment || null,
          measurements: body.measurements || {},
          fabricSupplied: !!body.fabricSupplied,
          fittingDate: body.fittingDate || null,
          receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
          promisedAt: body.promisedAt ? new Date(body.promisedAt) : null,
          isUrgent: !!body.isUrgent,
          assignedTo: body.assignedTo || null,
          status: 'received',
          estimateAmount: body.estimateAmount != null ? String(roundCurrency(body.estimateAmount)) : null,
          estimateStatus: body.estimateAmount != null && body.estimateAmount > 0 ? 'pending' : 'none',
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxAmount: String(totals.taxAmount),
          taxBreakdown: totals.taxBreakdown,
          total: String(totals.total),
          paidAmount: String(advance),
          balanceDue: String(balance),
          repairWarrantyDays: body.repairWarrantyDays ?? null,
          notes: body.notes || null,
          createdBy: userId,
        }).returning()

        if (lines.length) await tx.insert(serviceJobItems).values(serviceLineRows(tenantId, job.id, lines))
        await addServiceJobHistory(tx, {
          tenantId, serviceJobId: job.id, fromStatus: null, toStatus: 'received', changedBy: userId,
          note: warranty?.found ? (warranty.inWarranty ? `Under warranty until ${warranty.warrantyUntil} (invoice ${warranty.invoiceNo || '—'})` : `Sold here (invoice ${warranty.invoiceNo || '—'}), warranty ended ${warranty.warrantyUntil || '—'}`) : null,
        })

        if (advance > 0 && body.advance) {
          const [payment] = await tx.insert(serviceJobPayments).values({
            tenantId,
            serviceJobId: job.id,
            amount: String(advance),
            paymentMethod: body.advance.paymentMethod,
            reference: body.advance.reference || null,
            receivedBy: userId,
            // the advance goes into this user's drawer / open shift (none → no shift)
            posOpeningEntryId: await currentOpenShiftId(tx, userId),
          }).returning({ id: serviceJobPayments.id })
          await postServiceJobAdvanceToGL(tx, tenantId, {
            paymentId: payment.id, jobNo, amount: advance, paymentMethod: body.advance.paymentMethod, customerId: job.customerId,
          })
        }
        return job
      })

      if (createdCustomerId) logAndBroadcast(tenantId, 'customer', 'created', createdCustomerId)
      logAndBroadcast(tenantId, 'service-job', 'created', result.id, {
        userId,
        entityName: result.jobNo,
        description: generateActivityDescription('create', 'service job', result.jobNo),
      })
      return NextResponse.json({ ...result, passcode: undefined, hasPasscode: !!result.passcode, warranty })
    })
  } catch (error) {
    const handled = serviceJobErrorResponse(error)
    if (handled) return handled
    logError('api/service-jobs', error)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}
