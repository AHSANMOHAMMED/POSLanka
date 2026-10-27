import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { validateBody } from '@/lib/validation/helpers'
import { recalculateSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { daysBetweenInclusive } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// POST /api/hr/attendance/recalculate { from, to, employeeProfileIds? } — rebuild computed days
// (manual corrections are kept). Max 93 days per call.
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, recalculateSchema)
  if (!parsed.success) return parsed.response
  const { from, to } = parsed.data
  if (to < from || daysBetweenInclusive(from, to) > 93) return NextResponse.json({ error: 'The range must be 1 to 93 days' }, { status: 400 })
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const { ids } = await scopedEmployeeIds(auth.session, db)
      let employeeIds = parsed.data.employeeProfileIds
      if (ids) employeeIds = (employeeIds ?? [...ids]).filter((id) => ids.has(id))
      const rows = await recomputeAttendance(db, tenantId, { from, to, employeeIds })
      logAndBroadcast(tenantId, 'attendance', 'updated', 'recalculate', { userId: auth.session.user.id, description: `Attendance recalculated ${from} to ${to} (${rows} days)` })
      return NextResponse.json({ days: rows })
    })
  } catch (error) {
    return hrError('api/hr/attendance/recalculate', error, 'Failed to recalculate attendance')
  }
}
