/**
 * Attendance → payroll.
 *
 * summarizeAttendance (pure, unit tested) turns the attendance_days of a period into
 *   totalWorkingDays  calendar mode: days of the period; shift mode: days that are not a weekly off
 *   paymentDays       paid working days (present 1, half day 0.5, + paid leave) + paid holidays
 *                     (+ weekly offs in calendar mode); days after today count as paid
 *   absentDays        totalWorkingDays − paymentDays
 *   lateMinutes, earlyLeaveMinutes, otHours, otAmount (normal OT × employee/tenant multiplier,
 *   weekly-off / holiday OT × holiday multiplier, × hourly rate)
 * and the variables exposed to salary formulas (see ATTENDANCE_FORMULA_VARIABLES).
 *
 * getAttendancePayroll (DB) recomputes the period first, then decides whether attendance applies
 * to the employee (settings.hr.attendancePayroll, see settings.ts).
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { attendanceDays, attendancePunches, employeeProfiles, employeeShiftAssignments, holidays as holidaysTable } from '@/lib/db/schema'
import { loadShiftContext, payFraction, recomputeAttendance, resolveShift, type ShiftRule } from './compute'
import { loadHrSettings, type HrSettings } from './settings'
import { eachDate, localToUtc, addDays, monthRange, todayLocal, weekdayOf } from './time'

export interface AttendanceDayRow {
  attendanceDate: string
  dayType: string
  status: string
  workedMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  otMinutes: number
  leaveFraction: number | string
  leavePaid: boolean
}

export interface AttendancePayrollSummary {
  source: 'attendance' | 'manual'
  from: string
  to: string
  totalWorkingDays: number
  paymentDays: number
  absentDays: number
  presentDays: number
  halfDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  holidays: number
  weeklyOffs: number
  lateMinutes: number
  earlyLeaveMinutes: number
  otHours: number
  holidayOtHours: number
  otAmount: number
  hourlyRate: number
  dailyRate: number
}

/** Formula variables added to the salary formula context (names are reserved abbreviations). */
export const ATTENDANCE_FORMULA_VARIABLES = [
  'payment_days', 'working_days', 'absent_days', 'present_days', 'half_days', 'leave_days', 'unpaid_leave_days',
  'late_minutes', 'early_minutes', 'ot_hours', 'holiday_ot_hours', 'ot_amount', 'hourly_rate', 'daily_rate',
] as const

export function attendanceFormulaVariables(s: AttendancePayrollSummary): Record<string, number> {
  return {
    payment_days: s.paymentDays,
    working_days: s.totalWorkingDays,
    absent_days: s.absentDays,
    present_days: s.presentDays,
    half_days: s.halfDays,
    leave_days: s.paidLeaveDays,
    unpaid_leave_days: s.unpaidLeaveDays,
    late_minutes: s.lateMinutes,
    early_minutes: s.earlyLeaveMinutes,
    ot_hours: s.otHours,
    holiday_ot_hours: s.holidayOtHours,
    ot_amount: s.otAmount,
    hourly_rate: s.hourlyRate,
    daily_rate: s.dailyRate,
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100

export interface SummarizeInput {
  from: string
  to: string
  /** Last date with known attendance (local today); later days count as paid */
  today: string
  days: AttendanceDayRow[]
  /** Weekly off days by date for dates without a row (from the employee's shift) */
  isWeeklyOff: (date: string) => boolean
  isHoliday: (date: string) => { isPaid: boolean } | null
  /** Dates outside employment (before hire / after termination) */
  isEmployed: (date: string) => boolean
  settings: Pick<HrSettings, 'workingDaysMode' | 'otMultiplier' | 'holidayOtMultiplier' | 'otHourlyDivisor'>
  baseSalary: number
  /** employee_profiles.hourly_rate override */
  hourlyRateOverride?: number | null
  /** employee_profiles.ot_rate_multiplier */
  employeeOtMultiplier?: number | null
  /** Shift hours per day for the hourly rate (employee's shift full_day_hours) */
  fullDayHours: number
}

export function summarizeAttendance(input: SummarizeInput): AttendancePayrollSummary {
  const { settings } = input
  const byDate = new Map(input.days.map((d) => [d.attendanceDate, d]))
  const calendar = settings.workingDaysMode !== 'shift'
  let totalWorkingDays = 0
  let paymentDays = 0
  let presentDays = 0
  let halfDays = 0
  let paidLeaveDays = 0
  let unpaidLeaveDays = 0
  let holidaysCount = 0
  let weeklyOffs = 0
  let lateMinutes = 0
  let earlyLeaveMinutes = 0
  let normalOtMinutes = 0
  let holidayOtMinutes = 0
  let scheduledDays = 0 // non-weekly-off days, for the hourly rate

  for (const date of eachDate(input.from, input.to)) {
    const row = byDate.get(date)
    const dayType = row?.dayType ?? (input.isHoliday(date) ? 'holiday' : input.isWeeklyOff(date) ? 'weekly_off' : 'working')
    if (dayType !== 'weekly_off') scheduledDays++

    if (dayType === 'weekly_off') {
      weeklyOffs++
      if (calendar) { totalWorkingDays++; if (input.isEmployed(date)) paymentDays++ }
    } else if (dayType === 'holiday') {
      holidaysCount++
      totalWorkingDays++
      const paid = input.isHoliday(date)?.isPaid ?? true
      if (paid && input.isEmployed(date)) paymentDays++
    } else {
      totalWorkingDays++
      if (!input.isEmployed(date)) continue
      if (!row) {
        if (date > input.today) paymentDays++ // not happened yet: paid
        continue // past working day without any record: absent
      }
      const frac = payFraction(row)
      paymentDays += frac
      if (row.status === 'present') presentDays++
      if (row.status === 'half_day') halfDays++
      const lf = Number(row.leaveFraction) || 0
      if (lf > 0) { if (row.leavePaid) paidLeaveDays += lf; else unpaidLeaveDays += lf }
    }

    if (row) {
      lateMinutes += row.lateMinutes || 0
      earlyLeaveMinutes += row.earlyLeaveMinutes || 0
      if (dayType === 'working') normalOtMinutes += row.otMinutes || 0
      else holidayOtMinutes += row.otMinutes || 0
    }
  }

  paymentDays = Math.min(totalWorkingDays, Math.round(paymentDays * 2) / 2)
  const hoursBasis = settings.otHourlyDivisor && settings.otHourlyDivisor > 0
    ? settings.otHourlyDivisor
    : Math.max(1, scheduledDays) * (input.fullDayHours > 0 ? input.fullDayHours : 8)
  const hourlyRate = input.hourlyRateOverride && input.hourlyRateOverride > 0
    ? input.hourlyRateOverride
    : input.baseSalary / hoursBasis
  const otMult = input.employeeOtMultiplier && input.employeeOtMultiplier > 0 ? input.employeeOtMultiplier : settings.otMultiplier
  const otAmount = hourlyRate * ((normalOtMinutes / 60) * otMult + (holidayOtMinutes / 60) * settings.holidayOtMultiplier)

  return {
    source: 'attendance',
    from: input.from,
    to: input.to,
    totalWorkingDays,
    paymentDays,
    absentDays: r2(totalWorkingDays - paymentDays),
    presentDays,
    halfDays,
    paidLeaveDays,
    unpaidLeaveDays,
    holidays: holidaysCount,
    weeklyOffs,
    lateMinutes,
    earlyLeaveMinutes,
    otHours: r2((normalOtMinutes + holidayOtMinutes) / 60),
    holidayOtHours: r2(holidayOtMinutes / 60),
    otAmount: r2(otAmount),
    hourlyRate: r2(hourlyRate),
    dailyRate: r2(totalWorkingDays > 0 ? input.baseSalary / totalWorkingDays : 0),
  }
}

/** Summary for an employee paid without attendance (old behaviour: entered working days). */
export function manualSummary(from: string, to: string, totalWorkingDays: number, paymentDays: number, baseSalary: number): AttendancePayrollSummary {
  return {
    source: 'manual', from, to, totalWorkingDays, paymentDays,
    absentDays: r2(totalWorkingDays - paymentDays), presentDays: 0, halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
    holidays: 0, weeklyOffs: 0, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, holidayOtHours: 0, otAmount: 0,
    hourlyRate: 0, dailyRate: r2(totalWorkingDays > 0 ? baseSalary / totalWorkingDays : 0),
  }
}

export interface PayrollAttendanceResult {
  summary: AttendancePayrollSummary
  /** Days to pass to computeSalarySlip (absenceMode 'nopay' keeps payment days = working days) */
  totalWorkingDays: number
  paymentDays: number
  variables: Record<string, number>
}

/**
 * Attendance figures of one employee for a payroll month. `fallbackWorkingDays` is the working
 * days entered on the run / slip, used when attendance does not apply to the employee.
 * Set `recompute: false` when the caller already recomputed the period.
 */
export async function getAttendancePayroll(
  db: TenantDb,
  tenantId: string,
  employeeProfileId: string,
  year: number,
  month: number,
  fallbackWorkingDays: number,
  fallbackPaymentDays: number = fallbackWorkingDays,
  opts: { recompute?: boolean; loaded?: { settings: HrSettings; timezone: string } } = {},
): Promise<PayrollAttendanceResult> {
  const { from, to } = monthRange(year, month)
  const loaded = opts.loaded ?? await loadHrSettings(db, tenantId)
  const { settings, timezone } = loaded

  const [profile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, employeeProfileId)).limit(1)
  const baseSalary = Number(profile?.baseSalary) || 0
  const manual = (): PayrollAttendanceResult => {
    const summary = manualSummary(from, to, fallbackWorkingDays, fallbackPaymentDays, baseSalary)
    return { summary, totalWorkingDays: fallbackWorkingDays, paymentDays: fallbackPaymentDays, variables: attendanceFormulaVariables(summary) }
  }
  if (!profile || settings.attendancePayroll === false) return manual()

  if (settings.attendancePayroll !== true) {
    // auto: only attendance-tracked employees
    const rangeStart = localToUtc(from, '00:00', timezone)
    const rangeEnd = localToUtc(addDays(to, 1), '06:00', timezone)
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(attendancePunches).where(and(
      eq(attendancePunches.employeeProfileId, employeeProfileId), eq(attendancePunches.isDeleted, false),
      gte(attendancePunches.punchTime, rangeStart), lte(attendancePunches.punchTime, rangeEnd)))
    const [{ m }] = await db.select({ m: sql<number>`count(*)` }).from(attendanceDays).where(and(
      eq(attendanceDays.employeeProfileId, employeeProfileId), gte(attendanceDays.attendanceDate, from), lte(attendanceDays.attendanceDate, to),
      eq(attendanceDays.isManual, true)))
    if (!profile.biometricUserId && Number(n) === 0 && Number(m) === 0) return manual()
  }

  if (opts.recompute !== false) await recomputeAttendance(db, tenantId, { from, to, employeeIds: [employeeProfileId] })

  const days = await db.select({
    attendanceDate: attendanceDays.attendanceDate,
    dayType: attendanceDays.dayType,
    status: attendanceDays.status,
    workedMinutes: attendanceDays.workedMinutes,
    lateMinutes: attendanceDays.lateMinutes,
    earlyLeaveMinutes: attendanceDays.earlyLeaveMinutes,
    otMinutes: attendanceDays.otMinutes,
    leaveFraction: attendanceDays.leaveFraction,
    leavePaid: attendanceDays.leavePaid,
  }).from(attendanceDays).where(and(
    eq(attendanceDays.employeeProfileId, employeeProfileId), gte(attendanceDays.attendanceDate, from), lte(attendanceDays.attendanceDate, to)))

  const shiftCtx = await loadShiftContext(db, settings)
  const assignments = await db.select({ shiftId: employeeShiftAssignments.shiftId, fromDate: employeeShiftAssignments.fromDate, toDate: employeeShiftAssignments.toDate })
    .from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeProfileId, employeeProfileId))
  const shiftFor = (d: string): ShiftRule => resolveShift(d, {
    assignments, defaultShiftId: profile.defaultShiftId, tenantDefaultShiftId: shiftCtx.tenantDefaultShiftId, shifts: shiftCtx.shifts,
  })
  const holidayRows = await db.select().from(holidaysTable).where(and(gte(holidaysTable.holidayDate, from), lte(holidaysTable.holidayDate, to)))
  const holidayMap = new Map(holidayRows.map((h) => [h.holidayDate, { isPaid: h.isPaid }]))

  const summary = summarizeAttendance({
    from, to,
    today: todayLocal(timezone),
    days,
    isWeeklyOff: (d) => shiftFor(d).weeklyOffDays.includes(weekdayOf(d)),
    isHoliday: (d) => holidayMap.get(d) ?? null,
    isEmployed: (d) => (!profile.hireDate || d >= profile.hireDate) && (!profile.terminationDate || d <= profile.terminationDate),
    settings,
    baseSalary,
    hourlyRateOverride: profile.hourlyRate ? Number(profile.hourlyRate) : null,
    employeeOtMultiplier: profile.otRateMultiplier ? Number(profile.otRateMultiplier) : null,
    fullDayHours: shiftFor(from).fullDayHours,
  })

  const paymentDays = settings.absenceMode === 'nopay' ? summary.totalWorkingDays : summary.paymentDays
  return { summary, totalWorkingDays: summary.totalWorkingDays, paymentDays, variables: attendanceFormulaVariables(summary) }
}
