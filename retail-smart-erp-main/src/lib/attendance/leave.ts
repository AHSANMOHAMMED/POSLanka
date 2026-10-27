/**
 * Leave helpers: number of leave days of a request (weekly offs and holidays inside the range are
 * not counted) and yearly balances (entitlement = leave_types.days_per_year).
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { employeeProfiles, employeeShiftAssignments, holidays, leaveRequests, leaveTypes } from '@/lib/db/schema'
import { loadShiftContext, resolveShift } from './compute'
import { loadHrSettings } from './settings'
import { eachDate, weekdayOf } from './time'

/** Pure: days of from..to that are neither weekly off nor holiday (0.5 for a half day). */
export function countLeaveDays(from: string, to: string, halfDay: boolean, isOff: (date: string) => boolean): number {
  if (halfDay) return isOff(from) ? 0 : 0.5
  return eachDate(from, to).filter((d) => !isOff(d)).length
}

export async function leaveDaysFor(db: TenantDb, tenantId: string, employeeProfileId: string, from: string, to: string, halfDay: boolean): Promise<number> {
  const { settings } = await loadHrSettings(db, tenantId)
  const [profile] = await db.select({ defaultShiftId: employeeProfiles.defaultShiftId }).from(employeeProfiles).where(eq(employeeProfiles.id, employeeProfileId)).limit(1)
  const ctx = await loadShiftContext(db, settings)
  const assignments = await db.select({ shiftId: employeeShiftAssignments.shiftId, fromDate: employeeShiftAssignments.fromDate, toDate: employeeShiftAssignments.toDate })
    .from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeProfileId, employeeProfileId))
  const hol = await db.select({ d: holidays.holidayDate }).from(holidays).where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)))
  const holSet = new Set(hol.map((h) => h.d))
  return countLeaveDays(from, to, halfDay, (d) => holSet.has(d) || resolveShift(d, {
    assignments, defaultShiftId: profile?.defaultShiftId ?? null, tenantDefaultShiftId: ctx.tenantDefaultShiftId, shifts: ctx.shifts,
  }).weeklyOffDays.includes(weekdayOf(d)))
}

export interface LeaveBalance {
  employeeProfileId: string
  leaveTypeId: string
  leaveTypeName: string
  isPaid: boolean
  entitled: number
  taken: number
  pending: number
  remaining: number
}

/** Balances per employee × active leave type for a calendar year. */
export async function leaveBalances(db: TenantDb, year: number, employeeIds: string[]): Promise<LeaveBalance[]> {
  if (employeeIds.length === 0) return []
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.isActive, true))
  const reqs = await db.select({
    employeeProfileId: leaveRequests.employeeProfileId, leaveTypeId: leaveRequests.leaveTypeId,
    days: leaveRequests.days, status: leaveRequests.status,
  }).from(leaveRequests).where(and(
    inArray(leaveRequests.employeeProfileId, employeeIds),
    gte(leaveRequests.fromDate, `${year}-01-01`), lte(leaveRequests.fromDate, `${year}-12-31`),
    inArray(leaveRequests.status, ['approved', 'pending']),
  ))
  const out: LeaveBalance[] = []
  for (const emp of employeeIds) {
    for (const t of types) {
      const mine = reqs.filter((r) => r.employeeProfileId === emp && r.leaveTypeId === t.id)
      const taken = mine.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days), 0)
      const pending = mine.filter((r) => r.status === 'pending').reduce((s, r) => s + Number(r.days), 0)
      const entitled = Number(t.daysPerYear) || 0
      out.push({ employeeProfileId: emp, leaveTypeId: t.id, leaveTypeName: t.name, isPaid: t.isPaid, entitled, taken, pending, remaining: entitled - taken })
    }
  }
  return out
}
