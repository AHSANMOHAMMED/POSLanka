import { NextRequest, NextResponse } from 'next/server'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, recurringInvoiceItems, recurringInvoiceRuns, recurringInvoices, sales, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { recurringInvoiceActionSchema, updateRecurringInvoiceSchema } from '@/lib/validation/schemas/recurring-invoices'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { firstOccurrenceFrom, nextRunDate } from '@/lib/recurring-invoices/schedule'
import { recurringToday, scheduleOf } from '@/lib/recurring-invoices/generate'
import { lineRows } from '@/lib/recurring-invoices/server'

type Ctx = { params: Promise<{ id: string }> }

async function guard(permission: 'createSales' | 'manageSales') {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permError = requirePermission(session, permission)
  if (permError) return { error: permError }
  const moduleError = requireModule(session, 'selling')
  if (moduleError) return { error: moduleError }
  return { session }
}

// GET /api/recurring-invoices/[id] — profile, lines and the history of generated invoices
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const g = await guard('createSales')
    if ('error' in g) return g.error
    const session = g.session
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    return await withTenant(session.user.tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, recurringInvoices, id, { includeUnassigned: true })
      if (denied) return denied
      const [profile] = await db.select({
        profile: recurringInvoices, customerName: customers.name, customerPhone: customers.phone, warehouseName: warehouses.name,
      }).from(recurringInvoices)
        .leftJoin(customers, eq(customers.id, recurringInvoices.customerId))
        .leftJoin(warehouses, eq(warehouses.id, recurringInvoices.warehouseId))
        .where(eq(recurringInvoices.id, id))
      if (!profile || !profile.profile.isActive) return NextResponse.json({ error: 'Recurring invoice not found' }, { status: 404 })
      const lines = await db.select().from(recurringInvoiceItems)
        .where(eq(recurringInvoiceItems.recurringInvoiceId, id)).orderBy(asc(recurringInvoiceItems.sortOrder))
      const runs = await db.select({
        id: recurringInvoiceRuns.id, runDate: recurringInvoiceRuns.runDate, occurrence: recurringInvoiceRuns.occurrence,
        status: recurringInvoiceRuns.status, saleId: recurringInvoiceRuns.saleId, invoiceNo: recurringInvoiceRuns.invoiceNo,
        total: recurringInvoiceRuns.total, dueDate: recurringInvoiceRuns.dueDate, attempts: recurringInvoiceRuns.attempts,
        error: recurringInvoiceRuns.error, triggeredBy: recurringInvoiceRuns.triggeredBy, createdAt: recurringInvoiceRuns.createdAt,
        saleStatus: sales.status, paidAmount: sales.paidAmount,
      }).from(recurringInvoiceRuns)
        .leftJoin(sales, eq(sales.id, recurringInvoiceRuns.saleId))
        .where(eq(recurringInvoiceRuns.recurringInvoiceId, id))
        .orderBy(desc(recurringInvoiceRuns.runDate))
        .limit(200)
      return NextResponse.json({
        ...profile.profile, customerName: profile.customerName, customerPhone: profile.customerPhone,
        warehouseName: profile.warehouseName, lines, runs,
      })
    })
  } catch (error) {
    logError('api/recurring-invoices/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch the recurring invoice' }, { status: 500 })
  }
}

// PUT /api/recurring-invoices/[id] — edit the profile (lines replaced). A schedule change never
// re-runs a date already invoiced: the next occurrence is the first one after the last run.
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const g = await guard('manageSales')
    if ('error' in g) return g.error
    const session = g.session
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, updateRecurringInvoiceSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId

    const result = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, recurringInvoices, id, { includeUnassigned: true })
      if (denied) return { error: denied }
      const [cur] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id)).for('update')
      if (!cur || !cur.isActive) return { error: NextResponse.json({ error: 'Recurring invoice not found' }, { status: 404 }) }
      if (cur.status === 'stopped') return { error: NextResponse.json({ error: 'A stopped profile cannot be edited' }, { status: 400 }) }
      const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, body.customerId))
      if (!customer) return { error: NextResponse.json({ error: 'Customer not found' }, { status: 400 }) }
      const branch = await resolveRecordBranch(session, db, body.warehouseId || cur.warehouseId)
      if (branch.error) return { error: branch.error }

      const schedule = {
        frequency: body.frequency, intervalCount: body.intervalCount, startDate: body.startDate,
        endType: body.endType, endAfterCount: body.endType === 'after' ? body.endAfterCount ?? null : null,
        endDate: body.endType === 'on_date' ? body.endDate ?? null : null,
      }
      const changed = schedule.frequency !== cur.frequency || schedule.intervalCount !== cur.intervalCount || schedule.startDate !== cur.startDate
      let k = cur.occurrencesGenerated
      if (changed) {
        const [{ last }] = await db.select({ last: sql<string | null>`max(${recurringInvoiceRuns.runDate})::text` })
          .from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.recurringInvoiceId, id))
        k = last ? firstOccurrenceFrom(schedule, last, true) : 0
      }
      const next = nextRunDate(schedule, k)
      const status = !next ? 'completed' : cur.status === 'completed' ? 'active' : cur.status
      await db.update(recurringInvoices).set({
        profileName: body.profileName, customerId: body.customerId, warehouseId: branch.warehouseId, ...schedule,
        occurrencesGenerated: k, nextRunDate: next, status, invoiceAction: body.invoiceAction,
        paymentTermsDays: body.paymentTermsDays, notes: body.notes || null, terms: body.terms || null,
        notifyChannel: body.notifyChannel, updatedAt: new Date(),
      }).where(eq(recurringInvoices.id, id))
      await db.delete(recurringInvoiceItems).where(eq(recurringInvoiceItems.recurringInvoiceId, id))
      await db.insert(recurringInvoiceItems).values(lineRows(tenantId, id, body.lines))
      return { ok: true }
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'recurring-invoice', 'updated', id, { userId, entityName: body.profileName })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/recurring-invoices/[id]', error)
    return NextResponse.json({ error: 'Failed to update the recurring invoice' }, { status: 500 })
  }
}

// PATCH /api/recurring-invoices/[id] — { action: pause | resume | stop }. Resuming skips the
// periods missed while paused (they are not invoiced in a burst).
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const g = await guard('manageSales')
    if ('error' in g) return g.error
    const session = g.session
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const parsed = await validateBody(request, recurringInvoiceActionSchema)
    if (!parsed.success) return parsed.response
    const { action } = parsed.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)

    const result = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, recurringInvoices, id, { includeUnassigned: true })
      if (denied) return { error: denied }
      const [cur] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id)).for('update')
      if (!cur || !cur.isActive) return { error: NextResponse.json({ error: 'Recurring invoice not found' }, { status: 404 }) }
      if (cur.status === 'stopped' || cur.status === 'completed') {
        return { error: NextResponse.json({ error: `This profile is ${cur.status}` }, { status: 400 }) }
      }
      if (action === 'pause') {
        await db.update(recurringInvoices).set({ status: 'paused', updatedAt: new Date() }).where(eq(recurringInvoices.id, id))
        return { status: 'paused' }
      }
      if (action === 'stop') {
        await db.update(recurringInvoices).set({ status: 'stopped', nextRunDate: null, updatedAt: new Date() }).where(eq(recurringInvoices.id, id))
        return { status: 'stopped' }
      }
      // resume
      const today = recurringToday()
      const s = scheduleOf(cur)
      let k = cur.occurrencesGenerated
      const due = nextRunDate(s, k)
      if (cur.status === 'paused' && due && due < today) k = Math.max(k, firstOccurrenceFrom(s, today))
      const next = nextRunDate(s, k)
      await db.update(recurringInvoices).set({
        status: next ? 'active' : 'completed', occurrencesGenerated: k, nextRunDate: next, updatedAt: new Date(),
      }).where(eq(recurringInvoices.id, id))
      return { status: next ? 'active' : 'completed', nextRunDate: next }
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'recurring-invoice', 'updated', id, { userId, description: `Recurring invoice ${action}d` })
    return NextResponse.json(result)
  } catch (error) {
    logError('api/recurring-invoices/[id] PATCH', error)
    return NextResponse.json({ error: 'Failed to update the recurring invoice' }, { status: 500 })
  }
}

// DELETE /api/recurring-invoices/[id] — recycle bin (archived; invoices already raised stay)
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const g = await guard('manageSales')
    if ('error' in g) return g.error
    const session = g.session
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)
    const result = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, recurringInvoices, id, { includeUnassigned: true })
      if (denied) return { error: denied }
      const bin = await moveToRecycleBin(db, { tenantId, entityType: 'recurring_invoice', entityId: id, userId, userName: session.user.name })
      if (!bin) return { error: NextResponse.json({ error: 'Recurring invoice not found' }, { status: 404 }) }
      return { bin }
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'recurring-invoice', 'deleted', id, { userId, entityName: result.bin.displayName })
    return NextResponse.json({ ok: true, recycleBinId: result.bin.binId })
  } catch (error) {
    logError('api/recurring-invoices/[id] DELETE', error)
    return NextResponse.json({ error: 'Failed to delete the recurring invoice' }, { status: 500 })
  }
}
