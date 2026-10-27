import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { projectTasks, projectTimeEntries, projects, users } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { getBranchScope } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { timeEntriesListSchema, timeEntryInputSchema } from '@/lib/validation/schemas/projects'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { canManageProjects, projectAccess } from '@/lib/projects/server'
import { checkProjectOpen, checkTask, entryTimes } from '@/lib/projects/time-entries'
import { scopeSql } from '@/lib/payments-received/server'

// GET /api/time-entries — timesheet (managers: everyone on their branches' projects; staff: own time)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, timeEntriesListSchema)
    if (!parsed.success) return parsed.response
    const { projectId, userId: forUser, fromDate, toDate, billable, invoiced, page, pageSize } = parsed.data
    const userId = await resolveUserIdRequired(session)
    return await withTenant(session.user.tenantId, async (db) => {
      const manage = canManageProjects(session)
      const conds: SQL[] = [eq(projects.isActive, true)]
      if (!manage) conds.push(eq(projectTimeEntries.userId, userId))
      else {
        const scope = await getBranchScope(session, db)
        if (scope) conds.push(sql`TRUE${scopeSql(scope, 'projects.warehouse_id')}`)
        if (forUser) conds.push(eq(projectTimeEntries.userId, forUser))
      }
      if (projectId) conds.push(eq(projectTimeEntries.projectId, projectId))
      if (fromDate) conds.push(gte(projectTimeEntries.entryDate, fromDate))
      if (toDate) conds.push(lte(projectTimeEntries.entryDate, toDate))
      if (billable) conds.push(eq(projectTimeEntries.billable, billable === 'true'))
      if (invoiced) conds.push(eq(projectTimeEntries.invoiced, invoiced === 'true'))
      const where = and(...conds)
      const [{ total, minutes }] = await db.select({ total: sql<number>`count(*)::int`, minutes: sql<number>`COALESCE(SUM(${projectTimeEntries.durationMinutes}), 0)::int` })
        .from(projectTimeEntries).innerJoin(projects, eq(projects.id, projectTimeEntries.projectId)).where(where)
      const data = await db.select({
        id: projectTimeEntries.id, projectId: projectTimeEntries.projectId, projectName: projects.name, projectNo: projects.projectNo,
        taskId: projectTimeEntries.taskId, taskName: projectTasks.name, userId: projectTimeEntries.userId, userName: users.fullName,
        entryDate: projectTimeEntries.entryDate, startTime: projectTimeEntries.startTime, endTime: projectTimeEntries.endTime,
        durationMinutes: projectTimeEntries.durationMinutes, notes: projectTimeEntries.notes, billable: projectTimeEntries.billable,
        isRunning: projectTimeEntries.isRunning, invoiced: projectTimeEntries.invoiced, saleId: projectTimeEntries.saleId,
      }).from(projectTimeEntries)
        .innerJoin(projects, eq(projects.id, projectTimeEntries.projectId))
        .leftJoin(projectTasks, eq(projectTasks.id, projectTimeEntries.taskId))
        .leftJoin(users, eq(users.id, projectTimeEntries.userId))
        .where(where)
        .orderBy(desc(projectTimeEntries.entryDate), desc(projectTimeEntries.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize)
      return NextResponse.json({ data, totals: { count: total, minutes }, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
    })
  } catch (error) {
    logError('api/time-entries', error)
    return NextResponse.json({ error: 'Failed to fetch time entries' }, { status: 500 })
  }
}

// POST /api/time-entries — log time (own time on projects you are a member of; managers: anyone's)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = await validateBody(request, timeEntryInputSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId
    const forUser = body.userId || userId
    if (forUser !== userId && !canManageProjects(session)) {
      return NextResponse.json({ error: 'Only managers can log time for someone else' }, { status: 403 })
    }
    const result = await withTenant(tenantId, async (db) => {
      const denied = await projectAccess(session, db, body.projectId, userId)
      if (denied) return { error: denied }
      const closed = await checkProjectOpen(db, body.projectId)
      if (closed) return { error: closed }
      const badTask = await checkTask(db, body.projectId, body.taskId)
      if (badTask) return { error: badTask }
      if (forUser !== userId) {
        const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, forUser), eq(users.isActive, true)))
        if (!u) return { error: NextResponse.json({ error: 'Staff user not found' }, { status: 400 }) }
      }
      const t = entryTimes(body)
      const [row] = await db.insert(projectTimeEntries).values({
        tenantId, projectId: body.projectId, taskId: body.taskId || null, userId: forUser, entryDate: body.entryDate,
        startTime: t.startTime, endTime: t.endTime, durationMinutes: t.durationMinutes, notes: body.notes || null,
        billable: body.billable, createdBy: userId,
      }).returning({ id: projectTimeEntries.id })
      return { row }
    })
    if ('error' in result) return result.error
    logAndBroadcast(tenantId, 'time-entry', 'created', result.row.id, { userId })
    return NextResponse.json({ id: result.row.id }, { status: 201 })
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/time-entries POST', error)
    return NextResponse.json({ error: 'Failed to log time' }, { status: 500 })
  }
}
