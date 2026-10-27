import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, items, printJobItems, printJobPayments, printJobs, sales, users, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertBranchAccess, assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updatePrintJobSchema } from '@/lib/validation/schemas/print-jobs'
import { roundCurrency } from '@/lib/utils/currency'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { computePrintJobTotals, computePrintLines, lineRows, storedLinesToComputed } from '@/lib/print-jobs/server'
import { printJobErrorResponse } from '@/lib/print-jobs/errors'

async function guard() {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permError = requirePermission(session, 'createSales')
  if (permError) return { error: permError }
  const moduleError = requireModule(session, 'selling')
  if (moduleError) return { error: moduleError }
  return { session }
}

// GET /api/print-jobs/[id] — job with lines, advances, staff and invoice
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data

    return await withTenant(session.user.tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const creator = alias(users, 'creator')
      const [job] = await db.select({
        job: printJobs,
        assignedName: users.fullName,
        createdByName: creator.fullName,
        warehouseName: warehouses.name,
        invoiceNo: sales.invoiceNo,
        saleTotal: sales.total,
        salePaid: sales.paidAmount,
        saleStatus: sales.status,
      })
        .from(printJobs)
        .leftJoin(users, eq(users.id, printJobs.assignedTo))
        .leftJoin(creator, eq(creator.id, printJobs.createdBy))
        .leftJoin(warehouses, eq(warehouses.id, printJobs.warehouseId))
        .leftJoin(sales, eq(sales.id, printJobs.saleId))
        .where(eq(printJobs.id, id))
        .limit(1)
      if (!job) return NextResponse.json({ error: 'Print job not found' }, { status: 404 })

      const lines = await db.select({
        line: printJobItems,
        itemName: items.name,
        itemSku: items.sku,
        itemUnit: items.unit,
      })
        .from(printJobItems)
        .leftJoin(items, eq(items.id, printJobItems.itemId))
        .where(eq(printJobItems.printJobId, id))
        .orderBy(asc(printJobItems.sortOrder))

      const payments = await db.select({
        id: printJobPayments.id,
        amount: printJobPayments.amount,
        paymentMethod: printJobPayments.paymentMethod,
        reference: printJobPayments.reference,
        receivedByName: users.fullName,
        refundedAt: printJobPayments.refundedAt,
        createdAt: printJobPayments.createdAt,
      })
        .from(printJobPayments)
        .leftJoin(users, eq(users.id, printJobPayments.receivedBy))
        .where(eq(printJobPayments.printJobId, id))
        .orderBy(asc(printJobPayments.createdAt))

      let customer: { id: string; name: string; phone: string | null; mobilePhone: string | null } | null = null
      if (job.job.customerId) {
        const [c] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, mobilePhone: customers.mobilePhone })
          .from(customers).where(eq(customers.id, job.job.customerId)).limit(1)
        customer = c || null
      }

      return NextResponse.json({
        ...job.job,
        assignedName: job.assignedName,
        createdByName: job.createdByName,
        warehouseName: job.warehouseName,
        invoiceNo: job.invoiceNo,
        sale: job.job.saleId ? { id: job.job.saleId, invoiceNo: job.invoiceNo, total: job.saleTotal, paidAmount: job.salePaid, status: job.saleStatus } : null,
        customer,
        lines: lines.map((l) => ({ ...l.line, itemName: l.itemName, itemSku: l.itemSku, itemUnit: l.itemUnit })),
        payments,
      })
    })
  } catch (error) {
    logError('api/print-jobs/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch print job' }, { status: 500 })
  }
}

// PUT /api/print-jobs/[id] — edit the job (header always replaced; lines when sent)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, updatePrintJobSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
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
      const computed = body.lines ? await computePrintLines(db, body.lines) : null

      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Print job not found' }, { status: 404 }) }
        if (job.saleId || job.status === 'delivered' || job.status === 'cancelled') {
          return { error: NextResponse.json({ error: `A ${job.status} job cannot be edited` }, { status: 400 }) }
        }
        if (body.expectedUpdatedAt && job.updatedAt && new Date(job.updatedAt).getTime() > new Date(body.expectedUpdatedAt).getTime()) {
          return { error: NextResponse.json({ error: 'This job was changed by someone else. Refresh and try again.', code: 'CONFLICT' }, { status: 409 }) }
        }

        let lines = computed
        if (!lines) {
          const stored = await tx.select().from(printJobItems).where(eq(printJobItems.printJobId, id))
          lines = storedLinesToComputed(stored)
        }
        const totals = await computePrintJobTotals(tx, tenantId, lines, body.discountAmount ?? 0)
        const paid = parseFloat(job.paidAmount)
        if (totals.total + 0.005 < paid) {
          return { error: NextResponse.json({ error: `The new total (${totals.total.toFixed(2)}) is less than the advances already received (${paid.toFixed(2)})` }, { status: 400 }) }
        }

        const proofStatus = body.proofStatus || job.proofStatus
        const now = new Date()
        const [updated] = await tx.update(printJobs).set({
          customerId: body.customerId || null,
          customerName: body.customerName,
          customerPhone: body.customerPhone || null,
          title: body.title,
          warehouseId: body.warehouseId || job.warehouseId,
          receivedAt: body.receivedAt ? new Date(body.receivedAt) : job.receivedAt,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          isUrgent: !!body.isUrgent,
          assignedTo: body.assignedTo || null,
          notes: body.notes || null,
          proofStatus,
          proofFiles: body.proofFiles ?? job.proofFiles,
          proofNote: body.proofNote || null,
          proofSentAt: proofStatus === 'sent' && job.proofStatus !== 'sent' ? now : job.proofSentAt,
          proofRespondedAt: (proofStatus === 'approved' || proofStatus === 'changes_requested') && proofStatus !== job.proofStatus ? now : job.proofRespondedAt,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxAmount: String(totals.taxAmount),
          taxBreakdown: totals.taxBreakdown,
          total: String(totals.total),
          balanceDue: String(roundCurrency(Math.max(0, totals.total - paid))),
          updatedAt: now,
        }).where(eq(printJobs.id, id)).returning()

        if (computed) {
          await tx.delete(printJobItems).where(eq(printJobItems.printJobId, id))
          await tx.insert(printJobItems).values(lineRows(tenantId, id, computed))
        }
        return { data: updated }
      })
      if ('error' in result) return result.error

      logAndBroadcast(tenantId, 'print-job', 'updated', id, {
        userId,
        entityName: result.data.jobNo,
        description: generateActivityDescription('update', 'print job', result.data.jobNo),
      })
      return NextResponse.json(result.data)
    })
  } catch (error) {
    const handled = printJobErrorResponse(error)
    if (handled) return handled
    logError('api/print-jobs/[id]', error)
    return NextResponse.json({ error: 'Failed to update print job' }, { status: 500 })
  }
}

// DELETE /api/print-jobs/[id] — only a job without any payment and not invoiced (else cancel it)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied
      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Print job not found' }, { status: 404 }) }
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(printJobPayments).where(eq(printJobPayments.printJobId, id))
        if (job.saleId || n > 0) {
          return { error: NextResponse.json({ error: 'This job has payments or an invoice — cancel it instead of deleting' }, { status: 400 }) }
        }
        await tx.delete(printJobs).where(eq(printJobs.id, id))
        return { data: job }
      })
      if ('error' in result) return result.error
      logAndBroadcast(tenantId, 'print-job', 'deleted', id, {
        userId: session.user.id,
        entityName: result.data.jobNo,
        description: generateActivityDescription('delete', 'print job', result.data.jobNo),
      })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    const handled = printJobErrorResponse(error)
    if (handled) return handled
    logError('api/print-jobs/[id]', error)
    return NextResponse.json({ error: 'Failed to delete print job' }, { status: 500 })
  }
}
