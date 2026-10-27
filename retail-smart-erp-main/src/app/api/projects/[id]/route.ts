import { NextRequest, NextResponse } from 'next/server'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, items, projectInvoices, projectMembers, projectTasks, projectTimeEntries, projects, sales, users, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateProjectSchema } from '@/lib/validation/schemas/projects'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { canManageProjects, loadBillingContext, previewFromContext, projectAccess, projectTotalsSql, saveTasksAndMembers } from '@/lib/projects/server'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/projects/[id] — project, tasks, members, timesheet (latest 500), invoices, unbilled preview
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    return await withTenant(session.user.tenantId, async (db) => {
      const denied = await projectAccess(session, db, id, userId)
      if (denied) return denied
      const [row] = await db.select({
        project: projects, customerName: customers.name, warehouseName: warehouses.name, serviceItemName: items.name, ...projectTotalsSql(),
      }).from(projects)
        .leftJoin(customers, eq(customers.id, projects.customerId))
        .leftJoin(warehouses, eq(warehouses.id, projects.warehouseId))
        .leftJoin(items, eq(items.id, projects.serviceItemId))
        .where(eq(projects.id, id))
      const tasks = await db.select().from(projectTasks).where(eq(projectTasks.projectId, id)).orderBy(asc(projectTasks.sortOrder))
      const members = await db.select({ userId: projectMembers.userId, rate: projectMembers.rate, name: users.fullName, email: users.email })
        .from(projectMembers).leftJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, id))
      const manage = canManageProjects(session)
      const entries = await db.select({
        id: projectTimeEntries.id, taskId: projectTimeEntries.taskId, taskName: projectTasks.name, userId: projectTimeEntries.userId,
        userName: users.fullName, entryDate: projectTimeEntries.entryDate, startTime: projectTimeEntries.startTime, endTime: projectTimeEntries.endTime,
        durationMinutes: projectTimeEntries.durationMinutes, notes: projectTimeEntries.notes, billable: projectTimeEntries.billable,
        isRunning: projectTimeEntries.isRunning, invoiced: projectTimeEntries.invoiced, saleId: projectTimeEntries.saleId,
        invoicedAmount: projectTimeEntries.invoicedAmount,
      }).from(projectTimeEntries)
        .leftJoin(projectTasks, eq(projectTasks.id, projectTimeEntries.taskId))
        .leftJoin(users, eq(users.id, projectTimeEntries.userId))
        .where(and(eq(projectTimeEntries.projectId, id), manage ? undefined : eq(projectTimeEntries.userId, userId)))
        .orderBy(desc(projectTimeEntries.entryDate), desc(projectTimeEntries.createdAt))
        .limit(500)
      const invoices = await db.select({
        id: projectInvoices.id, saleId: projectInvoices.saleId, invoiceNo: projectInvoices.invoiceNo, kind: projectInvoices.kind,
        hours: projectInvoices.hours, amount: projectInvoices.amount, createdAt: projectInvoices.createdAt,
        saleStatus: sales.status, saleTotal: sales.total, paidAmount: sales.paidAmount,
      }).from(projectInvoices).leftJoin(sales, eq(sales.id, projectInvoices.saleId))
        .where(and(eq(projectInvoices.projectId, id), sql`${projectInvoices.saleId} IS NOT NULL`))
        .orderBy(desc(projectInvoices.createdAt))
      const ctx = manage ? await loadBillingContext(db, id) : null
      const unbilled = ctx ? previewFromContext(ctx) : null
      return NextResponse.json({
        ...row.project, customerName: row.customerName, warehouseName: row.warehouseName, serviceItemName: row.serviceItemName,
        loggedMinutes: row.loggedMinutes, unbilledMinutes: row.unbilledMinutes, invoicedAmount: row.invoicedAmount,
        tasks, members, entries, invoices, unbilled, canManage: manage,
      })
    })
  } catch (error) {
    logError('api/projects/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch the project' }, { status: 500 })
  }
}

// PUT /api/projects/[id] — edit the project, its tasks and members
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const parsed = await validateBody(request, updateProjectSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId
    const result = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, projects, id, { includeUnassigned: true })
      if (denied) return { error: denied }
      const [cur] = await db.select().from(projects).where(eq(projects.id, id)).for('update')
      if (!cur || !cur.isActive) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }
      const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, body.customerId))
      if (!customer) return { error: NextResponse.json({ error: 'Customer not found' }, { status: 400 }) }
      const branch = await resolveRecordBranch(session, db, body.warehouseId || cur.warehouseId)
      if (branch.error) return { error: branch.error }
      await db.update(projects).set({
        name: body.name, customerId: body.customerId, warehouseId: branch.warehouseId, description: body.description || null,
        billingMethod: body.billingMethod, fixedAmount: String(body.fixedAmount || 0), projectRate: String(body.projectRate || 0),
        budgetType: body.budgetType,
        budgetHours: body.budgetType === 'hours' && body.budgetHours != null ? String(body.budgetHours) : null,
        budgetAmount: body.budgetType === 'amount' && body.budgetAmount != null ? String(body.budgetAmount) : null,
        serviceItemId: body.serviceItemId || null, startDate: body.startDate || null, endDate: body.endDate || null,
        status: body.status, updatedAt: new Date(),
      }).where(eq(projects.id, id))
      const err = await saveTasksAndMembers(db, tenantId, id, body.tasks, body.members)
      if (err) throw Object.assign(new Error('ROLLBACK'), { response: err })
      return { ok: true }
    }).catch((e) => {
      if (e?.response) return { error: e.response as NextResponse }
      throw e
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'project', 'updated', id, { userId, entityName: body.name })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/projects/[id] PUT', error)
    return NextResponse.json({ error: 'Failed to update the project' }, { status: 500 })
  }
}

// DELETE /api/projects/[id] — recycle bin (archived). Refused while a timer runs on it.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId
    const result = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, projects, id, { includeUnassigned: true })
      if (denied) return { error: denied }
      const [running] = await db.select({ id: projectTimeEntries.id }).from(projectTimeEntries)
        .where(and(eq(projectTimeEntries.projectId, id), eq(projectTimeEntries.isRunning, true))).limit(1)
      if (running) return { error: NextResponse.json({ error: 'A timer is running on this project. Stop it first.', code: 'TIMER_RUNNING' }, { status: 409 }) }
      const bin = await moveToRecycleBin(db, { tenantId, entityType: 'project', entityId: id, userId, userName: session.user.name })
      if (!bin) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }
      return { bin }
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'project', 'deleted', id, { userId, entityName: result.bin.displayName })
    return NextResponse.json({ ok: true, recycleBinId: result.bin.binId })
  } catch (error) {
    logError('api/projects/[id] DELETE', error)
    return NextResponse.json({ error: 'Failed to delete the project' }, { status: 500 })
  }
}
