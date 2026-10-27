import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { employeeShiftAssignments } from '@/lib/db/schema'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { assertEmployeeInScope, hrAuth, hrError } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { todayLocal } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// DELETE /api/hr/shift-assignments/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [row] = await db.select().from(employeeShiftAssignments).where(eq(employeeShiftAssignments.id, p.data.id)).limit(1)
      if (!row) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
      const denied = await assertEmployeeInScope(auth.session, db, row.employeeProfileId)
      if (denied) return denied
      await db.delete(employeeShiftAssignments).where(eq(employeeShiftAssignments.id, row.id))
      const { timezone } = await loadHrSettings(db, tenantId)
      const today = todayLocal(timezone)
      if (row.fromDate <= today) {
        await recomputeAttendance(db, tenantId, { from: row.fromDate, to: row.toDate && row.toDate < today ? row.toDate : today, employeeIds: [row.employeeProfileId] })
      }
      logAndBroadcast(tenantId, 'work-shift', 'updated', row.shiftId, { userId: auth.session.user.id, description: 'Shift assignment removed' })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    return hrError('api/hr/shift-assignments/[id]', error, 'Failed to remove assignment')
  }
}
