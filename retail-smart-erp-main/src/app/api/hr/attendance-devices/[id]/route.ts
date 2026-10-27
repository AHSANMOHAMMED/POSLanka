import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { attendanceDevices } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateAttendanceDeviceSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { assertRecordBranch, resolveRecordBranch } from '@/lib/auth/branch-access'
import { safeTimezone } from '@/lib/attendance/time'
import { invalidateIclockDevice } from '@/lib/attendance/iclock-server'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// PUT /api/hr/attendance-devices/[id]  (resync: true → the device re-sends its full log)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, updateAttendanceDeviceSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(auth.session, db, attendanceDevices, p.data.id)
      if (denied) return denied
      const [current] = await db.select().from(attendanceDevices).where(eq(attendanceDevices.id, p.data.id)).limit(1)
      if (!current) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
      const set: Partial<typeof attendanceDevices.$inferInsert> = { updatedAt: new Date() }
      if (d.name !== undefined) set.name = d.name
      if (d.serialNumber !== undefined) set.serialNumber = d.serialNumber.trim().toUpperCase()
      if (d.model !== undefined) set.model = d.model || null
      if (d.commKey !== undefined) set.commKey = d.commKey || null
      if (d.timezone !== undefined) set.timezone = safeTimezone(d.timezone)
      if (d.isActive !== undefined) set.isActive = d.isActive
      if (d.warehouseId !== undefined && d.warehouseId !== current.warehouseId) {
        const branch = await resolveRecordBranch(auth.session, db, d.warehouseId)
        if (branch.error) return branch.error
        set.warehouseId = branch.warehouseId
      }
      if (d.resync) set.attlogStamp = null
      const [row] = await db.update(attendanceDevices).set(set)
        .where(eq(attendanceDevices.id, current.id)).returning()
      invalidateIclockDevice(current.serialNumber)
      invalidateIclockDevice(row.serialNumber)
      logAndBroadcast(tenantId, 'attendance-device', 'updated', row.id, { userId: auth.session.user.id, entityName: `${row.name} (${row.serialNumber})` })
      return NextResponse.json(row)
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices/[id]', error, 'Failed to update device')
  }
}

// DELETE /api/hr/attendance-devices/[id] — punches already received are kept
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(auth.session, db, attendanceDevices, p.data.id)
      if (denied) return denied
      const [row] = await db.delete(attendanceDevices).where(eq(attendanceDevices.id, p.data.id)).returning()
      if (!row) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
      invalidateIclockDevice(row.serialNumber)
      logAndBroadcast(tenantId, 'attendance-device', 'deleted', row.id, { userId: auth.session.user.id, entityName: `${row.name} (${row.serialNumber})` })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices/[id]', error, 'Failed to delete device')
  }
}
