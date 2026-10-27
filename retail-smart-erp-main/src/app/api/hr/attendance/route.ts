import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { attendanceDays, employeeProfiles, holidays, users, warehouses, workShifts } from '@/lib/db/schema'
import { validateSearchParams } from '@/lib/validation/helpers'
import { attendanceListSchema } from '@/lib/validation/schemas/attendance'
import { employeeScopeSql, hrAuth, hrError } from '@/lib/attendance/api'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { daysBetweenInclusive, todayLocal } from '@/lib/attendance/time'

/**
 * GET /api/hr/attendance?date=YYYY-MM-DD            daily board
 * GET /api/hr/attendance?from=…&to=…                monthly register (max 62 days)
 *   &warehouseId= &department= &employeeProfileId=
 * Employees (branch-scoped) + their attendance_days + holidays of the range. Past days of
 * attendance-tracked employees that have no row yet (no punch → never computed) are computed
 * first, so absences show up.
 */
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = validateSearchParams(request, attendanceListSchema)
  if (!parsed.success) return parsed.response
  const q = parsed.data
  const from = q.date ?? q.from
  const to = q.date ?? q.to ?? q.from
  if (!from || !to) return NextResponse.json({ error: 'date or from/to is required' }, { status: 400 })
  if (to < from || daysBetweenInclusive(from, to) > 62) return NextResponse.json({ error: 'The range must be 1 to 62 days' }, { status: 400 })

  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const scope = await getBranchScope(auth.session, db)
      if (q.warehouseId && !canAccessBranch(scope, q.warehouseId)) return branchDeniedResponse(scope, db)
      const { settings, timezone } = await loadHrSettings(db, tenantId)

      const conds = [employeeScopeSql(scope)]
      if (q.warehouseId) conds.push(sql`(${employeeProfiles.warehouseId} = ${q.warehouseId} OR (${employeeProfiles.warehouseId} IS NULL AND EXISTS (
        SELECT 1 FROM user_warehouses uw WHERE uw.user_id = ${employeeProfiles.userId} AND uw.is_active = true AND uw.warehouse_id = ${q.warehouseId})))`)
      if (q.department) conds.push(eq(employeeProfiles.department, q.department))
      if (q.employeeProfileId) conds.push(eq(employeeProfiles.id, q.employeeProfileId))
      // Active employees, plus anyone else who has attendance in the range
      conds.push(sql`(${employeeProfiles.employmentStatus} IN ('active', 'on_leave') OR EXISTS (
        SELECT 1 FROM attendance_days ad WHERE ad.employee_profile_id = ${employeeProfiles.id} AND ad.attendance_date BETWEEN ${from} AND ${to}))`)

      const employees = await db.select({
        id: employeeProfiles.id,
        fullName: users.fullName,
        employeeCode: employeeProfiles.employeeCode,
        department: employeeProfiles.department,
        designation: employeeProfiles.designation,
        warehouseId: employeeProfiles.warehouseId,
        warehouseName: warehouses.name,
        biometricUserId: employeeProfiles.biometricUserId,
        otEligible: employeeProfiles.otEligible,
        defaultShiftId: employeeProfiles.defaultShiftId,
        shiftName: workShifts.name,
        hireDate: employeeProfiles.hireDate,
        terminationDate: employeeProfiles.terminationDate,
        employmentStatus: employeeProfiles.employmentStatus,
      }).from(employeeProfiles)
        .leftJoin(users, eq(users.id, employeeProfiles.userId))
        .leftJoin(warehouses, eq(warehouses.id, employeeProfiles.warehouseId))
        .leftJoin(workShifts, eq(workShifts.id, employeeProfiles.defaultShiftId))
        .where(and(...conds))
        .orderBy(asc(users.fullName))
        .limit(2000)

      const ids = employees.map((e) => e.id)
      const loadDays = async (): Promise<Array<typeof attendanceDays.$inferSelect>> => ids.length === 0 ? [] : db.select().from(attendanceDays).where(and(
        inArray(attendanceDays.employeeProfileId, ids), gte(attendanceDays.attendanceDate, from), lte(attendanceDays.attendanceDate, to)))
      let days = await loadDays()

      // Fill in past days of tracked employees that were never computed
      const today = todayLocal(timezone)
      const lastPast = to < today ? to : today
      if (from <= lastPast) {
        const have = new Set(days.map((d) => `${d.employeeProfileId}|${d.attendanceDate}`))
        const tracked = employees.filter((e) => e.employmentStatus === 'active' && (e.biometricUserId || settings.attendancePayroll === true))
        const missing = tracked.filter((e) => {
          const start = e.hireDate && e.hireDate > from ? e.hireDate : from
          if (start > lastPast) return false
          let n = 0
          for (const k of have) if (k.startsWith(`${e.id}|`) && k.slice(-10) >= start && k.slice(-10) <= lastPast) n++
          return n < daysBetweenInclusive(start, lastPast)
        }).map((e) => e.id)
        if (missing.length > 0) {
          await recomputeAttendance(db, tenantId, { from, to: lastPast, employeeIds: missing })
          days = await loadDays()
        }
      }

      const holidayRows = await db.select({ date: holidays.holidayDate, name: holidays.name, isPaid: holidays.isPaid })
        .from(holidays).where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)))

      return NextResponse.json({ from, to, today, timezone, employees, days, holidays: holidayRows })
    })
  } catch (error) {
    return hrError('api/hr/attendance', error, 'Failed to load attendance')
  }
}
