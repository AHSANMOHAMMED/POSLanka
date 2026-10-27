import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { attendanceDays } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { markAttendanceSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { ingestPunches, type PunchInput } from '@/lib/attendance/ingest'
import { loadHrSettings } from '@/lib/attendance/settings'
import { addDays, localToUtc } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

/**
 * POST /api/hr/attendance/mark — attendance for staff without a fingerprint machine (manager marks):
 *  - with in / out times → manual punches (source 'manual'), computed like device punches
 *  - with a status only (present / absent / half day / leave) → a manual day (is_manual)
 */
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, markAttendanceSchema)
  if (!parsed.success) return parsed.response
  const { date, entries, note } = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const { ids } = await scopedEmployeeIds(auth.session, db)
      if (ids && entries.some((e) => !ids.has(e.employeeProfileId))) {
        return NextResponse.json({ error: 'You can only manage employees of your own branch.', code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
      }
      const { timezone } = await loadHrSettings(db, tenantId)
      const reason = note || 'Marked by manager'
      const punches: PunchInput[] = []
      const statusRows: Array<typeof attendanceDays.$inferInsert> = []
      const now = new Date()
      for (const e of entries) {
        if (e.inTime || e.outTime) {
          const inAt = e.inTime ? localToUtc(date, e.inTime, timezone) : null
          let outAt = e.outTime ? localToUtc(date, e.outTime, timezone) : null
          if (inAt && outAt && outAt <= inAt) outAt = localToUtc(addDays(date, 1), e.outTime!, timezone)
          if (inAt) punches.push({ employeeProfileId: e.employeeProfileId, punchTime: inAt, punchType: 'in', source: 'manual', note: reason, createdBy: auth.session.user.id })
          if (outAt) punches.push({ employeeProfileId: e.employeeProfileId, punchTime: outAt, punchType: 'out', source: 'manual', note: reason, createdBy: auth.session.user.id })
        } else if (e.status) {
          statusRows.push({
            tenantId, employeeProfileId: e.employeeProfileId, attendanceDate: date, dayType: 'working', status: e.status,
            workedMinutes: 0, leaveFraction: e.status === 'leave' ? '1' : '0', leavePaid: e.status === 'leave',
            isManual: true, notes: reason, approvedBy: auth.session.user.id, approvedAt: now, computedAt: now, updatedAt: now,
          })
        }
      }
      const result = punches.length ? await ingestPunches(db, tenantId, punches, timezone) : { inserted: 0 }
      if (statusRows.length) {
        await db.insert(attendanceDays).values(statusRows).onConflictDoUpdate({
          target: [attendanceDays.tenantId, attendanceDays.employeeProfileId, attendanceDays.attendanceDate],
          set: {
            status: sql`excluded.status`, workedMinutes: sql`excluded.worked_minutes`, leaveFraction: sql`excluded.leave_fraction`,
            leavePaid: sql`excluded.leave_paid`, isManual: sql`true`, notes: sql`excluded.notes`, approvedBy: sql`excluded.approved_by`,
            approvedAt: sql`excluded.approved_at`, updatedAt: sql`excluded.updated_at`,
          },
        })
      }
      logAndBroadcast(tenantId, 'attendance', 'updated', 'mark', {
        userId: auth.session.user.id,
        description: `Attendance marked for ${entries.length} employee(s) on ${date}`,
        metadata: { date, entries, note: reason },
      })
      return NextResponse.json({ punches: result.inserted, days: statusRows.length })
    })
  } catch (error) {
    return hrError('api/hr/attendance/mark', error, 'Failed to mark attendance')
  }
}
