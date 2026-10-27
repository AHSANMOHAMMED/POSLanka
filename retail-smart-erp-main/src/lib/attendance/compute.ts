/**
 * Attendance engine: turns raw punches into one attendance_days row per employee per date.
 *
 * Pure functions (unit tested in __tests__/compute.test.ts):
 *   resolveShift      assignment (date in from..to) > employee default shift > tenant default > built-in
 *   punchWindow       which instants belong to a work date (handles night shifts across midnight)
 *   computeDay        first in / last out, worked minutes minus break, late, early leave, OT, status
 *   payFraction       how much of the day is paid (used by payroll)
 * DB runner:
 *   recomputeAttendance(db, tenantId, { from, to, employeeIds? })  — rows with is_manual = true are
 *   never overwritten. Called synchronously for the affected employee-days on every new punch
 *   (device push, manual entry, import), on leave approval / holiday changes, by the
 *   "Recalculate period" button and before a payroll run.
 */
import { and, eq, gte, inArray, lte, or, isNull, sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import {
  attendanceDays, attendancePunches, employeeProfiles, employeeShiftAssignments, holidays,
  leaveRequests, leaveTypes, workShifts,
} from '@/lib/db/schema'
import { loadHrSettings, type HrSettings } from './settings'
import { addDays, eachDate, localToUtc, timeToMinutes, todayLocal, utcToLocal, weekdayOf } from './time'

// ==================== TYPES ====================

export interface ShiftRule {
  id: string | null
  name: string
  startTime: string // 'HH:MM[:SS]'
  endTime: string
  crossesMidnight: boolean
  breakMinutes: number
  graceLateMinutes: number
  graceEarlyMinutes: number
  halfDayHours: number
  fullDayHours: number
  otStartsAfterMinutes: number
  weeklyOffDays: number[] // 0 = Sunday
}

export const FALLBACK_SHIFT: ShiftRule = {
  id: null,
  name: 'Standard 08:00-17:00',
  startTime: '08:00',
  endTime: '17:00',
  crossesMidnight: false,
  breakMinutes: 60,
  graceLateMinutes: 10,
  graceEarlyMinutes: 10,
  halfDayHours: 4,
  fullDayHours: 8,
  otStartsAfterMinutes: 30,
  weeklyOffDays: [0],
}

export type DayType = 'working' | 'weekly_off' | 'holiday'
export type DayStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'holiday' | 'weekly_off'

export interface DayLeave {
  leaveTypeId: string | null
  isPaid: boolean
  /** 1 = full day, 0.5 = half day */
  fraction: number
}

export interface DayInput {
  date: string
  shift: ShiftRule
  /** Punch instants (any order, duplicates allowed) already assigned to this work date */
  punches: Date[]
  timezone: string
  holiday?: { name: string; isPaid: boolean } | null
  leave?: DayLeave | null
  otEligible: boolean
  duplicateSeconds?: number
  missedPunchAs?: HrSettings['missedPunchAs']
}

export interface DayResult {
  date: string
  shiftId: string | null
  dayType: DayType
  status: DayStatus
  firstIn: Date | null
  lastOut: Date | null
  punchCount: number
  workedMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  otMinutes: number
  missedPunch: boolean
  leaveTypeId: string | null
  leaveFraction: number
  leavePaid: boolean
}

// ==================== PURE FUNCTIONS ====================

export interface ShiftAssignmentLike { shiftId: string; fromDate: string; toDate: string | null }

/** assignment covering the date (latest from_date wins) > employee default > tenant default > built-in */
export function resolveShift(
  date: string,
  opts: {
    assignments: ShiftAssignmentLike[]
    defaultShiftId: string | null
    tenantDefaultShiftId: string | null
    shifts: Map<string, ShiftRule>
  },
): ShiftRule {
  const covering = opts.assignments
    .filter((a) => a.fromDate <= date && (!a.toDate || a.toDate >= date) && opts.shifts.has(a.shiftId))
    .sort((a, b) => (a.fromDate < b.fromDate ? 1 : a.fromDate > b.fromDate ? -1 : 0))
  if (covering.length > 0) return opts.shifts.get(covering[0].shiftId)!
  if (opts.defaultShiftId && opts.shifts.has(opts.defaultShiftId)) return opts.shifts.get(opts.defaultShiftId)!
  if (opts.tenantDefaultShiftId && opts.shifts.has(opts.tenantDefaultShiftId)) return opts.shifts.get(opts.tenantDefaultShiftId)!
  return FALLBACK_SHIFT
}

/** Shift length in minutes (end before / at start = crosses midnight). */
export function shiftLengthMinutes(shift: ShiftRule): number {
  const s = timeToMinutes(shift.startTime)
  const e = timeToMinutes(shift.endTime)
  return shift.crossesMidnight || e <= s ? e + 1440 - s : e - s
}

/** Scheduled start / end instants of the shift on a work date. */
export function shiftBounds(date: string, shift: ShiftRule, tz: string): { start: Date; end: Date } {
  const start = localToUtc(date, shift.startTime, tz)
  const end = new Date(start.getTime() + shiftLengthMinutes(shift) * 60000)
  return { start, end }
}

/** How long before the scheduled start a punch already counts for the day (1 to 4 hours). */
export function leadMinutes(shift: ShiftRule): number {
  const gap = 1440 - shiftLengthMinutes(shift)
  return Math.max(60, Math.min(240, Math.floor(gap / 2)))
}

/**
 * The instants that belong to a work date: from (start − lead) up to the next date's window start.
 * A night shift 20:00–05:00 thus owns punches from 16:00 until 16:00 the next day.
 */
export function punchWindow(date: string, shift: ShiftRule, nextShift: ShiftRule, tz: string): { from: Date; to: Date } {
  const from = new Date(shiftBounds(date, shift, tz).start.getTime() - leadMinutes(shift) * 60000)
  const nextDate = addDays(date, 1)
  const to = new Date(shiftBounds(nextDate, nextShift, tz).start.getTime() - leadMinutes(nextShift) * 60000)
  return { from, to }
}

/** Sorted punches with duplicates (closer than `seconds` to the previous kept punch) removed. */
export function dedupePunches(punches: Date[], seconds = 120): Date[] {
  const sorted = [...punches].sort((a, b) => a.getTime() - b.getTime())
  const kept: Date[] = []
  for (const p of sorted) {
    const last = kept[kept.length - 1]
    if (!last || p.getTime() - last.getTime() >= seconds * 1000) kept.push(p)
  }
  return kept
}

const minutesBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 60000)

export function computeDay(input: DayInput): DayResult {
  const { date, shift, timezone, otEligible } = input
  const kept = dedupePunches(input.punches, input.duplicateSeconds ?? 120)
  const isWeeklyOff = shift.weeklyOffDays.includes(weekdayOf(date))
  const dayType: DayType = input.holiday ? 'holiday' : isWeeklyOff ? 'weekly_off' : 'working'
  const { start, end } = shiftBounds(date, shift, timezone)

  const firstIn = kept[0] ?? null
  const lastOut = kept.length >= 2 ? kept[kept.length - 1] : null
  const missedPunch = kept.length === 1

  // Worked time: explicit break punches (4, 6 … punches) → sum of in/out pairs;
  // otherwise first-in to last-out minus the shift break when the span is long enough to include it.
  let workedMinutes = 0
  if (firstIn && lastOut) {
    if (kept.length >= 4 && kept.length % 2 === 0) {
      for (let i = 0; i < kept.length; i += 2) workedMinutes += minutesBetween(kept[i], kept[i + 1])
    } else {
      const span = minutesBetween(firstIn, lastOut)
      workedMinutes = span >= shift.halfDayHours * 60 + shift.breakMinutes ? span - shift.breakMinutes : span
    }
  }

  const base: DayResult = {
    date,
    shiftId: shift.id,
    dayType,
    status: 'absent',
    firstIn,
    lastOut,
    punchCount: kept.length,
    workedMinutes: Math.max(0, workedMinutes),
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    otMinutes: 0,
    missedPunch,
    leaveTypeId: null,
    leaveFraction: 0,
    leavePaid: false,
  }

  // Weekly off / holiday: any work is overtime (paid at the holiday multiplier by payroll)
  if (dayType !== 'working') {
    base.status = dayType === 'holiday' ? 'holiday' : 'weekly_off'
    base.otMinutes = otEligible ? base.workedMinutes : 0
    return base
  }

  const leave = input.leave && input.leave.fraction > 0 ? input.leave : null
  if (leave) {
    base.leaveTypeId = leave.leaveTypeId
    base.leaveFraction = Math.min(1, leave.fraction)
    base.leavePaid = leave.isPaid
  }

  if (kept.length === 0) {
    base.status = leave ? 'leave' : 'absent'
    return base
  }

  if (missedPunch) {
    base.status = input.missedPunchAs ?? 'present'
  } else {
    base.status = base.workedMinutes < shift.halfDayHours * 60 ? 'half_day' : 'present'
  }

  // A half-day leave explains the late arrival / early leave
  if (!leave) {
    const lateBy = minutesBetween(start, firstIn!)
    if (lateBy > shift.graceLateMinutes) base.lateMinutes = lateBy
    if (lastOut) {
      const earlyBy = minutesBetween(lastOut, end)
      if (earlyBy > shift.graceEarlyMinutes) base.earlyLeaveMinutes = earlyBy
    }
  }

  if (otEligible && lastOut) {
    const overBy = minutesBetween(end, lastOut)
    if (overBy > 0 && overBy >= shift.otStartsAfterMinutes) base.otMinutes = overBy
  }

  return base
}

export interface PayDayLike {
  dayType: string
  status: string
  leaveFraction: number | string
  leavePaid: boolean
}

/** Paid share of a WORKING day: work (present 1, half day 0.5) + paid leave, at most 1. */
export function payFraction(day: PayDayLike): number {
  const work = day.status === 'present' ? 1 : day.status === 'half_day' ? 0.5 : 0
  const leave = day.leavePaid ? Number(day.leaveFraction) || 0 : 0
  return Math.min(1, work + leave)
}

// ==================== DB RUNNER ====================

export function toShiftRule(row: typeof workShifts.$inferSelect): ShiftRule {
  return {
    id: row.id,
    name: row.name,
    startTime: row.startTime,
    endTime: row.endTime,
    crossesMidnight: row.crossesMidnight,
    breakMinutes: row.breakMinutes,
    graceLateMinutes: row.graceLateMinutes,
    graceEarlyMinutes: row.graceEarlyMinutes,
    halfDayHours: Number(row.halfDayHours) || 0,
    fullDayHours: Number(row.fullDayHours) || 8,
    otStartsAfterMinutes: row.otStartsAfterMinutes,
    weeklyOffDays: Array.isArray(row.weeklyOffDays) ? row.weeklyOffDays.map(Number) : [0],
  }
}

export interface ShiftContext {
  shifts: Map<string, ShiftRule>
  tenantDefaultShiftId: string | null
}

export async function loadShiftContext(db: TenantDb, settings: HrSettings): Promise<ShiftContext> {
  const rows = await db.select().from(workShifts)
  const shifts = new Map(rows.map((r) => [r.id, toShiftRule(r)]))
  const marked = rows.find((r) => r.isDefault && r.isActive)
  const tenantDefaultShiftId = (settings.defaultShiftId && shifts.has(settings.defaultShiftId)) ? settings.defaultShiftId : marked?.id ?? null
  return { shifts, tenantDefaultShiftId }
}

export interface RecomputeOptions {
  from: string
  to: string
  /** Restrict to these employees; omitted = attendance-tracked employees (see below) */
  employeeIds?: string[]
  now?: Date
}

/**
 * Recompute attendance_days for a date range. Without employeeIds only attendance-tracked employees
 * get rows: a fingerprint user id, a punch in the range, or attendancePayroll = true (everyone
 * active). Days after today (local) are skipped; today is computed from the punches so far.
 * Returns the number of rows written.
 */
export async function recomputeAttendance(db: TenantDb, tenantId: string, opts: RecomputeOptions): Promise<number> {
  const { settings, timezone } = await loadHrSettings(db, tenantId)
  const today = todayLocal(timezone, opts.now)
  const to = opts.to > today ? today : opts.to
  const from = opts.from
  if (from > to) return 0
  const dates = eachDate(from, to)
  if (dates.length === 0) return 0

  const rangeStart = localToUtc(addDays(from, -1), '00:00', timezone)
  const rangeEnd = localToUtc(addDays(to, 2), '00:00', timezone)

  // Employees
  const empConds = []
  if (opts.employeeIds) {
    if (opts.employeeIds.length === 0) return 0
    empConds.push(inArray(employeeProfiles.id, opts.employeeIds))
  }
  let employees = await db.select({
    id: employeeProfiles.id,
    defaultShiftId: employeeProfiles.defaultShiftId,
    otEligible: employeeProfiles.otEligible,
    biometricUserId: employeeProfiles.biometricUserId,
    hireDate: employeeProfiles.hireDate,
    terminationDate: employeeProfiles.terminationDate,
    employmentStatus: employeeProfiles.employmentStatus,
  }).from(employeeProfiles).where(empConds.length ? and(...empConds) : undefined)

  const punchRows = employees.length === 0 ? [] : await db.select({
    employeeProfileId: attendancePunches.employeeProfileId,
    punchTime: attendancePunches.punchTime,
  }).from(attendancePunches).where(and(
    eq(attendancePunches.isDeleted, false),
    gte(attendancePunches.punchTime, rangeStart),
    lte(attendancePunches.punchTime, rangeEnd),
    opts.employeeIds ? inArray(attendancePunches.employeeProfileId, opts.employeeIds) : sql`${attendancePunches.employeeProfileId} IS NOT NULL`,
  ))
  const punchesByEmp = new Map<string, Date[]>()
  for (const p of punchRows) {
    if (!p.employeeProfileId) continue
    const list = punchesByEmp.get(p.employeeProfileId) ?? []
    list.push(new Date(p.punchTime))
    punchesByEmp.set(p.employeeProfileId, list)
  }

  if (!opts.employeeIds) {
    employees = employees.filter((e) =>
      punchesByEmp.has(e.id) || (e.employmentStatus === 'active' && (!!e.biometricUserId || settings.attendancePayroll === true)))
  }
  if (employees.length === 0) return 0
  const empIds = employees.map((e) => e.id)

  const shiftCtx = await loadShiftContext(db, settings)

  const assignmentRows = await db.select({
    employeeProfileId: employeeShiftAssignments.employeeProfileId,
    shiftId: employeeShiftAssignments.shiftId,
    fromDate: employeeShiftAssignments.fromDate,
    toDate: employeeShiftAssignments.toDate,
  }).from(employeeShiftAssignments).where(and(
    inArray(employeeShiftAssignments.employeeProfileId, empIds),
    lte(employeeShiftAssignments.fromDate, addDays(to, 1)),
    or(isNull(employeeShiftAssignments.toDate), gte(employeeShiftAssignments.toDate, from)),
  ))
  const assignmentsByEmp = new Map<string, ShiftAssignmentLike[]>()
  for (const a of assignmentRows) {
    const list = assignmentsByEmp.get(a.employeeProfileId) ?? []
    list.push({ shiftId: a.shiftId, fromDate: a.fromDate, toDate: a.toDate })
    assignmentsByEmp.set(a.employeeProfileId, list)
  }

  const holidayRows = await db.select().from(holidays)
    .where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)))
  const holidayByDate = new Map(holidayRows.map((h) => [h.holidayDate, { name: h.name, isPaid: h.isPaid }]))

  const leaveRows = await db.select({
    employeeProfileId: leaveRequests.employeeProfileId,
    leaveTypeId: leaveRequests.leaveTypeId,
    fromDate: leaveRequests.fromDate,
    toDate: leaveRequests.toDate,
    halfDay: leaveRequests.halfDay,
    isPaid: leaveTypes.isPaid,
  }).from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(
      inArray(leaveRequests.employeeProfileId, empIds),
      eq(leaveRequests.status, 'approved'),
      lte(leaveRequests.fromDate, to),
      gte(leaveRequests.toDate, from),
    ))

  const manualRows = await db.select({ employeeProfileId: attendanceDays.employeeProfileId, attendanceDate: attendanceDays.attendanceDate })
    .from(attendanceDays)
    .where(and(
      inArray(attendanceDays.employeeProfileId, empIds),
      eq(attendanceDays.isManual, true),
      gte(attendanceDays.attendanceDate, from),
      lte(attendanceDays.attendanceDate, to),
    ))
  const manual = new Set(manualRows.map((r) => `${r.employeeProfileId}|${r.attendanceDate}`))

  const values: Array<typeof attendanceDays.$inferInsert> = []
  const computedAt = new Date()

  for (const emp of employees) {
    const punches = (punchesByEmp.get(emp.id) ?? []).sort((a, b) => a.getTime() - b.getTime())
    const shiftFor = (d: string) => resolveShift(d, {
      assignments: assignmentsByEmp.get(emp.id) ?? [],
      defaultShiftId: emp.defaultShiftId,
      tenantDefaultShiftId: shiftCtx.tenantDefaultShiftId,
      shifts: shiftCtx.shifts,
    })
    for (const date of dates) {
      if (emp.hireDate && date < emp.hireDate) continue
      if (emp.terminationDate && date > emp.terminationDate) continue
      if (manual.has(`${emp.id}|${date}`)) continue
      const shift = shiftFor(date)
      const window = punchWindow(date, shift, shiftFor(addDays(date, 1)), timezone)
      const dayPunches = punches.filter((p) => p >= window.from && p < window.to)
      const lv = leaveRows.find((l) => l.employeeProfileId === emp.id && l.fromDate <= date && l.toDate >= date)
      const result = computeDay({
        date,
        shift,
        punches: dayPunches,
        timezone,
        holiday: holidayByDate.get(date) ?? null,
        leave: lv ? { leaveTypeId: lv.leaveTypeId, isPaid: lv.isPaid, fraction: lv.halfDay ? 0.5 : 1 } : null,
        otEligible: emp.otEligible,
        duplicateSeconds: settings.duplicatePunchSeconds,
        missedPunchAs: settings.missedPunchAs,
      })
      values.push({
        tenantId,
        employeeProfileId: emp.id,
        attendanceDate: date,
        shiftId: result.shiftId,
        dayType: result.dayType,
        firstIn: result.firstIn,
        lastOut: result.lastOut,
        punchCount: result.punchCount,
        workedMinutes: result.workedMinutes,
        lateMinutes: result.lateMinutes,
        earlyLeaveMinutes: result.earlyLeaveMinutes,
        otMinutes: result.otMinutes,
        missedPunch: result.missedPunch,
        status: result.status,
        leaveTypeId: result.leaveTypeId,
        leaveFraction: String(result.leaveFraction),
        leavePaid: result.leavePaid,
        isManual: false,
        computedAt,
        updatedAt: computedAt,
      })
    }
  }

  const CHUNK = 500
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(attendanceDays).values(values.slice(i, i + CHUNK)).onConflictDoUpdate({
      target: [attendanceDays.tenantId, attendanceDays.employeeProfileId, attendanceDays.attendanceDate],
      set: {
        shiftId: sql`excluded.shift_id`,
        dayType: sql`excluded.day_type`,
        firstIn: sql`excluded.first_in`,
        lastOut: sql`excluded.last_out`,
        punchCount: sql`excluded.punch_count`,
        workedMinutes: sql`excluded.worked_minutes`,
        lateMinutes: sql`excluded.late_minutes`,
        earlyLeaveMinutes: sql`excluded.early_leave_minutes`,
        otMinutes: sql`excluded.ot_minutes`,
        missedPunch: sql`excluded.missed_punch`,
        status: sql`excluded.status`,
        leaveTypeId: sql`excluded.leave_type_id`,
        leaveFraction: sql`excluded.leave_fraction`,
        leavePaid: sql`excluded.leave_paid`,
        computedAt: sql`excluded.computed_at`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${attendanceDays.isManual} = false`,
    })
  }
  return values.length
}

/**
 * Work dates a set of punch instants can affect: the local date and the day before (a punch after
 * midnight can close a night shift). Grouped per employee for recomputeAttendance.
 */
export function affectedDates(punchTimes: Date[], tz: string, localDateOf: (d: Date, tz: string) => string): { from: string; to: string } | null {
  if (punchTimes.length === 0) return null
  let min = '9999-12-31'
  let max = '0000-01-01'
  for (const p of punchTimes) {
    const d = localDateOf(p, tz)
    if (d < min) min = d
    if (d > max) max = d
  }
  return { from: addDays(min, -1), to: max }
}

/**
 * Recompute the employee-days touched by new punches (employeeId → instants): one run over the
 * union of the affected ranges (at most ~13 months; older days via "Recalculate period").
 */
export async function recomputeForPunches(db: TenantDb, tenantId: string, byEmployee: Map<string, Date[]>, tz: string): Promise<number> {
  const all: Date[] = []
  for (const times of byEmployee.values()) all.push(...times)
  const range = affectedDates(all, tz, (d, z) => utcToLocal(d, z).date)
  if (!range || byEmployee.size === 0) return 0
  const from = range.from < addDays(range.to, -395) ? addDays(range.to, -395) : range.from
  return recomputeAttendance(db, tenantId, { from, to: range.to, employeeIds: [...byEmployee.keys()] })
}
