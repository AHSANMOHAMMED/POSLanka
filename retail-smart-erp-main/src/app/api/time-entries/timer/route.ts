import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { projectTasks, projectTimeEntries, projects } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { timerActionSchema } from '@/lib/validation/schemas/projects'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { isUniqueViolation } from '@/lib/db/errors'
import { colomboDateOf, projectAccess } from '@/lib/projects/server'
import { checkProjectOpen, checkTask } from '@/lib/projects/time-entries'

const MAX_MINUTES = 1440

// GET /api/time-entries/timer — the signed-in user's running timer (one per user, kept on the server)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const userId = await resolveUserIdRequired(session)
    return await withTenant(session.user.tenantId, async (db) => {
      const [t] = await db.select({
        id: projectTimeEntries.id, projectId: projectTimeEntries.projectId, projectName: projects.name, taskId: projectTimeEntries.taskId,
        taskName: projectTasks.name, startTime: projectTimeEntries.startTime, notes: projectTimeEntries.notes, billable: projectTimeEntries.billable,
      }).from(projectTimeEntries)
        .innerJoin(projects, eq(projects.id, projectTimeEntries.projectId))
        .leftJoin(projectTasks, eq(projectTasks.id, projectTimeEntries.taskId))
        .where(and(eq(projectTimeEntries.userId, userId), eq(projectTimeEntries.isRunning, true)))
      return NextResponse.json({ timer: t || null, serverTime: new Date().toISOString() })
    })
  } catch (error) {
    logError('api/time-entries/timer', error)
    return NextResponse.json({ error: 'Failed to fetch the timer' }, { status: 500 })
  }
}

// POST /api/time-entries/timer — { action: start | stop | discard }. Starting while another timer
// runs is refused (409 TIMER_RUNNING); stopping turns it into a timesheet entry (max 24 h).
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = await validateBody(request, timerActionSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId

    const result = await withTenant(tenantId, async (db) => {
      const [running] = await db.select().from(projectTimeEntries)
        .where(and(eq(projectTimeEntries.userId, userId), eq(projectTimeEntries.isRunning, true))).for('update')
      if (body.action === 'start') {
        if (!body.projectId) return { error: NextResponse.json({ error: 'Choose a project' }, { status: 400 }) }
        if (running) return { error: NextResponse.json({ error: 'A timer is already running. Stop it first.', code: 'TIMER_RUNNING', timerId: running.id }, { status: 409 }) }
        const denied = await projectAccess(session, db, body.projectId, userId)
        if (denied) return { error: denied }
        const closed = await checkProjectOpen(db, body.projectId)
        if (closed) return { error: closed }
        const bad = await checkTask(db, body.projectId, body.taskId)
        if (bad) return { error: bad }
        const now = new Date()
        const [row] = await db.insert(projectTimeEntries).values({
          tenantId, projectId: body.projectId, taskId: body.taskId || null, userId, entryDate: colomboDateOf(now),
          startTime: now, durationMinutes: 0, notes: body.notes || null, billable: body.billable, isRunning: true, createdBy: userId,
        }).returning()
        return { status: 201, body: { timer: row } }
      }
      if (!running) return { error: NextResponse.json({ error: 'No timer is running', code: 'NO_TIMER' }, { status: 404 }) }
      if (body.action === 'discard') {
        await db.delete(projectTimeEntries).where(eq(projectTimeEntries.id, running.id))
        return { status: 200, body: { discarded: running.id } }
      }
      const end = new Date()
      const started = running.startTime ? new Date(running.startTime) : end
      const minutes = Math.min(MAX_MINUTES, Math.max(1, Math.round((end.getTime() - started.getTime()) / 60_000)))
      const [row] = await db.update(projectTimeEntries).set({
        isRunning: false, endTime: end, durationMinutes: minutes, entryDate: colomboDateOf(started),
        notes: body.notes ?? running.notes, updatedAt: new Date(),
      }).where(eq(projectTimeEntries.id, running.id)).returning()
      return { status: 200, body: { entry: row } }
    })
    if ('error' in result && result.error) return result.error
    const ok = result as { status: number; body: Record<string, unknown> }
    logAndBroadcast(tenantId, 'time-entry', body.action === 'start' ? 'created' : 'updated', userId, { userId })
    return NextResponse.json(ok.body, { status: ok.status })
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'A timer is already running. Stop it first.', code: 'TIMER_RUNNING' }, { status: 409 })
    logError('api/time-entries/timer POST', error)
    return NextResponse.json({ error: 'Failed to update the timer' }, { status: 500 })
  }
}
