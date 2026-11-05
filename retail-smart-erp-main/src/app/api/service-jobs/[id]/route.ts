import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, items, sales, serviceJobHistory, serviceJobItems, serviceJobPayments, serviceJobs, tenants, users, warehouses } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { assertBranchAccess, assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateServiceJobSchema } from '@/lib/validation/schemas/service-jobs'
import { roundCurrency } from '@/lib/utils/currency'
import { normalizeImei } from '@/lib/utils/imei'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { hasAnyPermission } from '@/lib/auth/field-access'
import {
  SERVICE_JOB_VIEW, addServiceJobHistory, canSeePasscode, computeServiceJobTotals, computeServiceLines, requireAnyPermission,
  serviceJobErrorResponse, serviceLineRows, storedServiceLines,
} from '@/lib/service-jobs/server'

async function guard() {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permError = requireAnyPermission(session, SERVICE_JOB_VIEW)
  if (permError) return { error: permError }
  const moduleError = requireModule(session, 'selling')
  if (moduleError) return { error: moduleError }
  return { session }
}

// GET /api/service-jobs/[id] — job with lines, advances, history, staff and invoice.
// The device passcode is returned only to staff who repair (manageWorkOrders) or manage sales.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data

    return await withTenant(session.user.tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const creator = alias(users, 'creator')
      const warrantySale = alias(sales, 'warranty_sale')
      const [row] = await db.select({
        job: serviceJobs,
        assignedName: users.fullName,
        createdByName: creator.fullName,
        warehouseName: warehouses.name,
        invoiceNo: sales.invoiceNo,
        saleTotal: sales.total,
        salePaid: sales.paidAmount,
        saleStatus: sales.status,
        warrantyInvoiceNo: warrantySale.invoiceNo,
      })
        .from(serviceJobs)
        .leftJoin(users, eq(users.id, serviceJobs.assignedTo))
        .leftJoin(creator, eq(creator.id, serviceJobs.createdBy))
        .leftJoin(warehouses, eq(warehouses.id, serviceJobs.warehouseId))
        .leftJoin(sales, eq(sales.id, serviceJobs.saleId))
        .leftJoin(warrantySale, eq(warrantySale.id, serviceJobs.warrantySaleId))
        .where(eq(serviceJobs.id, id))
        .limit(1)
      if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

      const lines = await db.select({ line: serviceJobItems, itemName: items.name, itemSku: items.sku, itemUnit: items.unit })
        .from(serviceJobItems)
        .leftJoin(items, eq(items.id, serviceJobItems.itemId))
        .where(eq(serviceJobItems.serviceJobId, id))
        .orderBy(asc(serviceJobItems.sortOrder))

      const payments = await db.select({
        id: serviceJobPayments.id,
        amount: serviceJobPayments.amount,
        paymentMethod: serviceJobPayments.paymentMethod,
        reference: serviceJobPayments.reference,
        receivedByName: users.fullName,
        refundedAt: serviceJobPayments.refundedAt,
        createdAt: serviceJobPayments.createdAt,
      })
        .from(serviceJobPayments)
        .leftJoin(users, eq(users.id, serviceJobPayments.receivedBy))
        .where(eq(serviceJobPayments.serviceJobId, id))
        .orderBy(asc(serviceJobPayments.createdAt))

      const history = await db.select({
        id: serviceJobHistory.id,
        fromStatus: serviceJobHistory.fromStatus,
        toStatus: serviceJobHistory.toStatus,
        note: serviceJobHistory.note,
        changedByName: users.fullName,
        createdAt: serviceJobHistory.createdAt,
      })
        .from(serviceJobHistory)
        .leftJoin(users, eq(users.id, serviceJobHistory.changedBy))
        .where(eq(serviceJobHistory.serviceJobId, id))
        .orderBy(asc(serviceJobHistory.createdAt))

      let customer: { id: string; name: string; phone: string | null; mobilePhone: string | null } | null = null
      if (row.job.customerId) {
        const [c] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, mobilePhone: customers.mobilePhone })
          .from(customers).where(eq(customers.id, row.job.customerId)).limit(1)
        customer = c || null
      }

      // shop header for the job card / receipt
      const [company] = await db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address, email: tenants.email })
        .from(tenants).where(eq(tenants.id, session.user.tenantId)).limit(1)

      const showPasscode = canSeePasscode(session)
      return NextResponse.json({
        ...row.job,
        passcode: showPasscode ? row.job.passcode : null,
        hasPasscode: !!row.job.passcode,
        canSeePasscode: showPasscode,
        assignedName: row.assignedName,
        createdByName: row.createdByName,
        warehouseName: row.warehouseName,
        invoiceNo: row.invoiceNo,
        warrantyInvoiceNo: row.warrantyInvoiceNo,
        sale: row.job.saleId ? { id: row.job.saleId, invoiceNo: row.invoiceNo, total: row.saleTotal, paidAmount: row.salePaid, status: row.saleStatus } : null,
        customer,
        company: company ?? null,
        lines: lines.map((l) => ({ ...l.line, itemName: l.itemName, itemSku: l.itemSku, itemUnit: l.itemUnit })),
        payments,
        history,
      })
    })
  } catch (error) {
    logError('api/service-jobs/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}

// PUT /api/service-jobs/[id] — edit the job (header always replaced; lines when sent)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, updateServiceJobSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied
      if (body.warehouseId) {
        const denied = await assertBranchAccess(session, body.warehouseId, db)
        if (denied) return denied
      }
      if (body.customerId) {
        const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, body.customerId)).limit(1)
        if (!c) return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
      }
      if (body.assignedTo) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.assignedTo)).limit(1)
        if (!u) return NextResponse.json({ error: 'Invalid staff member' }, { status: 400 })
      }
      const computed = body.lines ? await computeServiceLines(db, body.lines) : null
      const passcodeAllowed = canSeePasscode(session)

      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
        if (job.saleId || job.status === 'delivered' || job.status === 'cancelled') {
          return { error: NextResponse.json({ error: `A ${job.status} job cannot be edited` }, { status: 400 }) }
        }
        if (body.expectedUpdatedAt && job.updatedAt && new Date(job.updatedAt).getTime() > new Date(body.expectedUpdatedAt).getTime()) {
          return { error: NextResponse.json({ error: 'This job was changed by someone else. Refresh and try again.', code: 'CONFLICT' }, { status: 409 }) }
        }

        const lines = computed || storedServiceLines(await tx.select().from(serviceJobItems).where(eq(serviceJobItems.serviceJobId, id)))
        const totals = await computeServiceJobTotals(tx, tenantId, lines, body.discountAmount ?? 0)
        const paid = parseFloat(job.paidAmount)
        if (lines.length > 0 && totals.total + 0.005 < paid) {
          return { error: NextResponse.json({ error: `The new total (${totals.total.toFixed(2)}) is less than the advances already received (${paid.toFixed(2)})` }, { status: 400 }) }
        }

        // Estimate changed → it needs the customer's answer again
        const estimate = body.estimateAmount != null ? roundCurrency(body.estimateAmount) : null
        const prevEstimate = job.estimateAmount != null ? parseFloat(job.estimateAmount) : null
        const estimateChanged = estimate !== prevEstimate
        const estimateStatus = !estimate ? 'none' : estimateChanged ? 'pending' : job.estimateStatus

        // Passcode: only staff allowed to see it may change it; left out = kept
        let passcode = job.passcode
        if (passcodeAllowed) {
          if (body.clearPasscode) passcode = null
          else if (body.passcode) passcode = body.passcode
        }

        const now = new Date()
        const [updated] = await tx.update(serviceJobs).set({
          jobType: body.jobType || job.jobType,
          customerId: body.customerId || null,
          customerName: body.customerName,
          customerPhone: body.customerPhone || null,
          title: body.title,
          warehouseId: body.warehouseId || job.warehouseId,
          deviceType: body.deviceType || null,
          brand: body.brand || null,
          model: body.model || null,
          serialNumber: body.serialNumber || null,
          imei: normalizeImei(body.imei).slice(0, 20) || null,
          imei2: normalizeImei(body.imei2).slice(0, 20) || null,
          passcode,
          faultReported: body.faultReported || null,
          accessoriesReceived: body.accessoriesReceived || null,
          conditionChecklist: body.conditionChecklist
            ? body.conditionChecklist.map((c) => ({ label: c.label, ok: c.ok ?? null, note: c.note || null }))
            : job.conditionChecklist,
          conditionNotes: body.conditionNotes || null,
          diagnosis: body.diagnosis || null,
          workDone: body.workDone || null,
          garment: body.garment || null,
          measurements: body.measurements ?? job.measurements,
          fabricSupplied: body.fabricSupplied ?? job.fabricSupplied,
          fittingDate: body.fittingDate || null,
          receivedAt: body.receivedAt ? new Date(body.receivedAt) : job.receivedAt,
          promisedAt: body.promisedAt ? new Date(body.promisedAt) : null,
          isUrgent: !!body.isUrgent,
          assignedTo: body.assignedTo || null,
          estimateAmount: estimate != null ? String(estimate) : null,
          estimateStatus,
          estimateRespondedAt: estimateChanged ? null : job.estimateRespondedAt,
          repairWarrantyDays: body.repairWarrantyDays ?? null,
          notes: body.notes || null,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxAmount: String(totals.taxAmount),
          taxBreakdown: totals.taxBreakdown,
          total: String(totals.total),
          balanceDue: String(roundCurrency(Math.max(0, totals.total - paid))),
          updatedAt: now,
        }).where(eq(serviceJobs.id, id)).returning()

        if (computed) {
          await tx.delete(serviceJobItems).where(eq(serviceJobItems.serviceJobId, id))
          if (computed.length) await tx.insert(serviceJobItems).values(serviceLineRows(tenantId, id, computed))
        }
        if (estimateChanged && estimate) {
          await addServiceJobHistory(tx, { tenantId, serviceJobId: id, note: `Estimate set to ${estimate.toFixed(2)}`, changedBy: userId })
        }
        return { data: updated }
      })
      if ('error' in result) return result.error

      logAndBroadcast(tenantId, 'service-job', 'updated', id, {
        userId,
        entityName: result.data.jobNo,
        description: generateActivityDescription('update', 'service job', result.data.jobNo),
      })
      return NextResponse.json({ ...result.data, passcode: passcodeAllowed ? result.data.passcode : null, hasPasscode: !!result.data.passcode })
    })
  } catch (error) {
    const handled = serviceJobErrorResponse(error)
    if (handled) return handled
    logError('api/service-jobs/[id]', error)
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }
}

// DELETE /api/service-jobs/[id] — only a job with no payment and no invoice (else cancel it); managers
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    if (!hasAnyPermission(session, ['manageSales', 'createSales'])) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied
      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(serviceJobPayments).where(eq(serviceJobPayments.serviceJobId, id))
        if (job.saleId || n > 0) {
          return { error: NextResponse.json({ error: 'This job has payments or an invoice — cancel it instead of deleting' }, { status: 400 }) }
        }
        await tx.delete(serviceJobs).where(eq(serviceJobs.id, id))
        return { data: job }
      })
      if ('error' in result) return result.error
      logAndBroadcast(tenantId, 'service-job', 'deleted', id, {
        userId: session.user.id,
        entityName: result.data.jobNo,
        description: generateActivityDescription('delete', 'service job', result.data.jobNo),
      })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    const handled = serviceJobErrorResponse(error)
    if (handled) return handled
    logError('api/service-jobs/[id]', error)
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 })
  }
}
