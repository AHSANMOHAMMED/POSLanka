import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { workShifts } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { workShiftSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/hr/shifts — work shifts with the number of employees on them as default shift
export async function GET() {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const rows = await db.select({
        shift: workShifts,
        employees: sql<number>`(SELECT count(*)::int FROM employee_profiles ep WHERE ep.default_shift_id = ${workShifts.id})`,
      }).from(workShifts).orderBy(asc(workShifts.name))
      return NextResponse.json(rows.map((r) => ({ ...r.shift, employees: r.employees })))
    })
  } catch (error) {
    return hrError('api/hr/shifts', error, 'Failed to load shifts')
  }
}

// POST /api/hr/shifts
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, workShiftSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      if (d.isDefault) await db.update(workShifts).set({ isDefault: false }).where(eq(workShifts.isDefault, true))
      const [row] = await db.insert(workShifts).values({
        tenantId,
        name: d.name,
        startTime: d.startTime,
        endTime: d.endTime,
        crossesMidnight: d.crossesMidnight || d.endTime <= d.startTime,
        breakMinutes: d.breakMinutes,
        graceLateMinutes: d.graceLateMinutes,
        graceEarlyMinutes: d.graceEarlyMinutes,
        halfDayHours: String(d.halfDayHours),
        fullDayHours: String(d.fullDayHours),
        otStartsAfterMinutes: d.otStartsAfterMinutes,
        weeklyOffDays: [...new Set(d.weeklyOffDays)].sort(),
        isDefault: d.isDefault,
        isActive: d.isActive,
      }).returning()
      logAndBroadcast(tenantId, 'work-shift', 'created', row.id, { userId: auth.session.user.id, entityName: row.name })
      return NextResponse.json(row, { status: 201 })
    })
  } catch (error) {
    return hrError('api/hr/shifts', error, 'Failed to create shift')
  }
}
