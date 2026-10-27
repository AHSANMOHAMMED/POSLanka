import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant, type TenantDb } from '@/lib/db'
import { projectTimeEntries } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { timeEntryInputSchema } from '@/lib/validation/schemas/projects'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { canManageProjects, projectAccess } from '@/lib/projects/server'
import { checkTask, entryTimes } from '@/lib/projects/time-entries'
import type { CompanySession } from '@/lib/auth'

type Ctx = { params: Promise<{ id: string }> }

/** The entry, if the user may change it: own (or a manager's) not-invoiced, not-running entry */
async function editable(session: CompanySession, db: TenantDb, id: string, userId: string) {
  const [e] = await db.select().from(projectTimeEntries).where(eq(projectTimeEntries.id, id)).for('update')
  if (!e) return { error: NextResponse.json({ error: 'Time entry not found' }, { status: 404 }) }
  const denied = await projectAccess(session, db, e.projectId, userId)
  if (denied) return { error: denied }
  if (e.userId !== userId && !canManageProjects(session)) return { error: NextResponse.json({ error: 'You can only change your own time' }, { status: 403 }) }
  if (e.invoiced) return { error: NextResponse.json({ error: 'This time is already invoiced', code: 'ALREADY_INVOICED' }, { status: 409 }) }
  if (e.isRunning) return { error: NextResponse.json({ error: 'Stop the timer first', code: 'TIMER_RUNNING' }, { status: 409 }) }
  return { entry: e }
}

// PUT /api/time-entries/[id]
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, timeEntryInputSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId
    const result = await withTenant(tenantId, async (db) => {
      const r = await editable(session, db, p.data.id, userId)
      if ('error' in r) return r
      if (body.projectId !== r.entry.projectId) return { error: NextResponse.json({ error: 'Time cannot move to another project' }, { status: 400 }) }
      if (body.taskId && body.taskId !== r.entry.taskId) {
        const bad = await checkTask(db, r.entry.projectId, body.taskId)
        if (bad) return { error: bad }
      }
      const t = entryTimes(body)
      await db.update(projectTimeEntries).set({
        taskId: body.taskId || null, entryDate: body.entryDate, startTime: t.startTime, endTime: t.endTime,
        durationMinutes: t.durationMinutes, notes: body.notes || null, billable: body.billable, updatedAt: new Date(),
      }).where(eq(projectTimeEntries.id, p.data.id))
      return { ok: true }
    })
    if ('error' in result && result.error) return result.error
    logAndBroadcast(tenantId, 'time-entry', 'updated', p.data.id, { userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('api/time-entries/[id] PUT', error)
    return NextResponse.json({ error: 'Failed to update the time entry' }, { status: 500 })
  }
}

// DELETE /api/time-entries/[id] — recycle bin snapshot, then delete (invoiced time cannot be deleted)
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const userId = await resolveUserIdRequired(session)
    const tenantId = session.user.tenantId
    const result = await withTenant(tenantId, async (db) => {
      const r = await editable(session, db, p.data.id, userId)
      if ('error' in r) return r
      await moveToRecycleBin(db, { tenantId, entityType: 'time_entry', entityId: p.data.id, userId, userName: session.user.name })
      await db.delete(projectTimeEntries).where(eq(projectTimeEntries.id, p.data.id))
      return { ok: true }
    })
    if ('error' in result && result.error) return result.error
    logAndBroadcast(tenantId, 'time-entry', 'deleted', p.data.id, { userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('api/time-entries/[id] DELETE', error)
    return NextResponse.json({ error: 'Failed to delete the time entry' }, { status: 500 })
  }
}
