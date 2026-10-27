import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { attendanceDays, employeeProfiles, employeeShiftAssignments, holidays } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { attendanceDayEditSchema } from '@/lib/validation/schemas/attendance'
import { assertEmployeeInScope, hrAuth, hrError } from '@/lib/attendance/api'
import { computeDay, loadShiftContext, recomputeAttendance, resolveShift } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { addDays, localToUtc } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

/**
 * PUT /api/hr/attendance/day — manual correction of one employee-day (is_manual = true: a later
 * recalculation keeps it), or { revert: true } to drop the correction and recompute from punches.
 * Every change is written to the activity log with the previous values.
 */
export async function PUT(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, attendanceDayEditSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const denied = await assertEmployeeInScope(auth.session, db, d.employeeProfileId)
      if (denied) return denied
      const [profile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, d.employeeProfileId)).limit(1)
      if (!profile) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
      const where = and(eq(attendanceDays.employeeProfileId, d.employeeProfileId), eq(attendanceDays.attendanceDate, d.date))
      const [before] = await db.select().from(attendanceDays).where(where).limit(1)

      if (d.revert) {
        if (before) await db.update(attendanceDays).set({ isManual: false, approvedBy: null, approvedAt: null }).where(where)
        await recomputeAttendance(db, tenantId, { from: d.date, to: d.date, employeeIds: [d.employeeProfileId] })
        const [after] = await db.select().from(attendanceDays).where(where).limit(1)
        logAndBroadcast(tenantId, 'attendance', 'updated', d.employeeProfileId, {
          userId: auth.session.user.id, description: `Attendance ${d.date}: manual correction removed`, metadata: { date: d.date, before },
        })
        return NextResponse.json(after ?? null)
      }

      const { settings, timezone } = await loadHrSettings(db, tenantId)
      const shiftCtx = await loadShiftContext(db, settings)
      const assignments = await db.select({ shiftId: employeeShiftAssignments.shiftId, fromDate: employeeShiftAssignments.fromDate, toDate: employeeShiftAssignments.toDate })
        .from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeProfileId, d.employeeProfileId))
      const shift = resolveShift(d.date, { assignments, defaultShiftId: profile.defaultShiftId, tenantDefaultShiftId: shiftCtx.tenantDefaultShiftId, shifts: shiftCtx.shifts })
      const [holiday] = await db.select().from(holidays).where(eq(holidays.holidayDate, d.date)).limit(1)

      const inAt = d.inTime ? localToUtc(d.date, d.inTime, timezone) : before?.firstIn ?? null
      let outAt = d.outTime ? localToUtc(d.outNextDay ? addDays(d.date, 1) : d.date, d.outTime, timezone) : before?.lastOut ?? null
      if (inAt && outAt && outAt <= inAt && d.outTime && !d.outNextDay) outAt = localToUtc(addDays(d.date, 1), d.outTime, timezone)
      const computed = computeDay({
        date: d.date, shift, timezone,
        punches: [inAt, outAt].filter((x): x is Date => !!x),
        holiday: holiday ? { name: holiday.name, isPaid: holiday.isPaid } : null,
        leave: null,
        otEligible: profile.otEligible,
        duplicateSeconds: 0,
        missedPunchAs: settings.missedPunchAs,
      })
      const status = d.status ?? computed.status
      const isLeave = status === 'leave'
      const values = {
        tenantId,
        employeeProfileId: d.employeeProfileId,
        attendanceDate: d.date,
        shiftId: shift.id,
        dayType: computed.dayType,
        firstIn: inAt,
        lastOut: outAt,
        punchCount: computed.punchCount,
        workedMinutes: d.workedMinutes ?? (status === 'absent' || isLeave ? 0 : computed.workedMinutes),
        lateMinutes: d.lateMinutes ?? (status === 'present' || status === 'half_day' ? computed.lateMinutes : 0),
        earlyLeaveMinutes: d.earlyLeaveMinutes ?? (status === 'present' || status === 'half_day' ? computed.earlyLeaveMinutes : 0),
        otMinutes: d.otMinutes ?? computed.otMinutes,
        missedPunch: false,
        status,
        leaveTypeId: isLeave ? before?.leaveTypeId ?? null : null,
        leaveFraction: isLeave ? '1' : status === 'half_day' && before?.leaveFraction && Number(before.leaveFraction) > 0 ? '0.5' : '0',
        leavePaid: isLeave ? (d.leavePaid ?? true) : false,
        isManual: true,
        notes: d.notes ?? before?.notes ?? null,
        approvedBy: auth.session.user.id,
        approvedAt: new Date(),
        computedAt: new Date(),
        updatedAt: new Date(),
      }
      const [row] = await db.insert(attendanceDays).values(values).onConflictDoUpdate({
        target: [attendanceDays.tenantId, attendanceDays.employeeProfileId, attendanceDays.attendanceDate],
        set: { ...values, tenantId: undefined, employeeProfileId: undefined, attendanceDate: undefined },
      }).returning()
      logAndBroadcast(tenantId, 'attendance', 'updated', d.employeeProfileId, {
        userId: auth.session.user.id,
        description: `Attendance ${d.date} corrected: ${before?.status ?? 'none'} → ${row.status}`,
        metadata: { date: d.date, before: before ?? null, after: row },
      })
      return NextResponse.json(row)
    })
  } catch (error) {
    return hrError('api/hr/attendance/day', error, 'Failed to save attendance')
  }
}
