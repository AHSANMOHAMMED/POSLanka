import { NextRequest, NextResponse } from 'next/server'
import { and, eq, ne } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { workShifts, employeeProfiles } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateWorkShiftSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// PUT /api/hr/shifts/[id] — changes apply to days recalculated from now on ("Recalculate period")
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, updateWorkShiftSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [current] = await db.select().from(workShifts).where(eq(workShifts.id, p.data.id)).limit(1)
      if (!current) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
      if (d.isDefault) await db.update(workShifts).set({ isDefault: false }).where(and(eq(workShifts.isDefault, true), ne(workShifts.id, current.id)))
      const set: Partial<typeof workShifts.$inferInsert> = { updatedAt: new Date() }
      if (d.name !== undefined) set.name = d.name
      if (d.startTime !== undefined) set.startTime = d.startTime
      if (d.endTime !== undefined) set.endTime = d.endTime
      if (d.breakMinutes !== undefined) set.breakMinutes = d.breakMinutes
      if (d.graceLateMinutes !== undefined) set.graceLateMinutes = d.graceLateMinutes
      if (d.graceEarlyMinutes !== undefined) set.graceEarlyMinutes = d.graceEarlyMinutes
      if (d.halfDayHours !== undefined) set.halfDayHours = String(d.halfDayHours)
      if (d.fullDayHours !== undefined) set.fullDayHours = String(d.fullDayHours)
      if (d.otStartsAfterMinutes !== undefined) set.otStartsAfterMinutes = d.otStartsAfterMinutes
      if (d.weeklyOffDays !== undefined) set.weeklyOffDays = [...new Set(d.weeklyOffDays)].sort()
      if (d.isDefault !== undefined) set.isDefault = d.isDefault
      if (d.isActive !== undefined) set.isActive = d.isActive
      const start = set.startTime ?? current.startTime
      const end = set.endTime ?? current.endTime
      set.crossesMidnight = (d.crossesMidnight ?? current.crossesMidnight) || end.slice(0, 5) <= start.slice(0, 5)
      const [row] = await db.update(workShifts).set(set).where(eq(workShifts.id, current.id)).returning()
      logAndBroadcast(tenantId, 'work-shift', 'updated', row.id, { userId: auth.session.user.id, entityName: row.name })
      return NextResponse.json(row)
    })
  } catch (error) {
    return hrError('api/hr/shifts/[id]', error, 'Failed to update shift')
  }
}

// DELETE /api/hr/shifts/[id] — employees using it as default fall back to the tenant default
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      await db.update(employeeProfiles).set({ defaultShiftId: null }).where(eq(employeeProfiles.defaultShiftId, p.data.id))
      const [row] = await db.delete(workShifts).where(eq(workShifts.id, p.data.id)).returning({ id: workShifts.id, name: workShifts.name })
      if (!row) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
      logAndBroadcast(tenantId, 'work-shift', 'deleted', row.id, { userId: auth.session.user.id, entityName: row.name })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    return hrError('api/hr/shifts/[id]', error, 'Failed to delete shift')
  }
}
