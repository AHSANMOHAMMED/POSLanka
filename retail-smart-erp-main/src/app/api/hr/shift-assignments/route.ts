import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { employeeProfiles, employeeShiftAssignments, users, workShifts } from '@/lib/db/schema'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { shiftAssignmentSchema } from '@/lib/validation/schemas/attendance'
import { z } from 'zod'
import { hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { todayLocal } from '@/lib/attendance/time'
import { loadHrSettings } from '@/lib/attendance/settings'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

const listSchema = z.object({ employeeProfileId: z.string().uuid().optional(), shiftId: z.string().uuid().optional() })

// GET /api/hr/shift-assignments
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = validateSearchParams(request, listSchema)
  if (!parsed.success) return parsed.response
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const { ids } = await scopedEmployeeIds(auth.session, db)
      const conds = []
      if (parsed.data.employeeProfileId) conds.push(eq(employeeShiftAssignments.employeeProfileId, parsed.data.employeeProfileId))
      if (parsed.data.shiftId) conds.push(eq(employeeShiftAssignments.shiftId, parsed.data.shiftId))
      const rows = await db.select({
        id: employeeShiftAssignments.id,
        employeeProfileId: employeeShiftAssignments.employeeProfileId,
        shiftId: employeeShiftAssignments.shiftId,
        fromDate: employeeShiftAssignments.fromDate,
        toDate: employeeShiftAssignments.toDate,
        notes: employeeShiftAssignments.notes,
        shiftName: workShifts.name,
        employeeName: users.fullName,
        employeeCode: employeeProfiles.employeeCode,
      }).from(employeeShiftAssignments)
        .innerJoin(workShifts, eq(workShifts.id, employeeShiftAssignments.shiftId))
        .innerJoin(employeeProfiles, eq(employeeProfiles.id, employeeShiftAssignments.employeeProfileId))
        .leftJoin(users, eq(users.id, employeeProfiles.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(employeeShiftAssignments.fromDate))
        .limit(1000)
      return NextResponse.json(ids ? rows.filter((r) => ids.has(r.employeeProfileId)) : rows)
    })
  } catch (error) {
    return hrError('api/hr/shift-assignments', error, 'Failed to load shift assignments')
  }
}

// POST /api/hr/shift-assignments — assign a shift to one or many employees for a date range
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, shiftAssignmentSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  if (d.toDate && d.toDate < d.fromDate) return NextResponse.json({ error: 'To date must be on or after from date' }, { status: 400 })
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const { ids } = await scopedEmployeeIds(auth.session, db)
      if (ids && d.employeeProfileIds.some((id) => !ids.has(id))) {
        return NextResponse.json({ error: 'You can only manage employees of your own branch.', code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
      }
      const [shift] = await db.select({ id: workShifts.id }).from(workShifts).where(eq(workShifts.id, d.shiftId)).limit(1)
      if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
      const rows = await db.insert(employeeShiftAssignments).values(d.employeeProfileIds.map((employeeProfileId) => ({
        tenantId, employeeProfileId, shiftId: d.shiftId, fromDate: d.fromDate, toDate: d.toDate || null,
        notes: d.notes || null, createdBy: auth.session.user.id,
      }))).returning({ id: employeeShiftAssignments.id })
      if (d.setAsDefault) {
        await db.update(employeeProfiles).set({ defaultShiftId: d.shiftId, updatedAt: new Date() }).where(inArray(employeeProfiles.id, d.employeeProfileIds))
      }
      // Re-evaluate the past days the assignment covers
      const { timezone } = await loadHrSettings(db, tenantId)
      const today = todayLocal(timezone)
      if (d.fromDate <= today) {
        const to = d.toDate && d.toDate < today ? d.toDate : today
        await recomputeAttendance(db, tenantId, { from: d.fromDate, to, employeeIds: d.employeeProfileIds })
      }
      logAndBroadcast(tenantId, 'work-shift', 'updated', d.shiftId, { userId: auth.session.user.id, description: `Shift assigned to ${rows.length} employee(s) from ${d.fromDate}` })
      return NextResponse.json({ created: rows.length }, { status: 201 })
    })
  } catch (error) {
    return hrError('api/hr/shift-assignments', error, 'Failed to assign shift')
  }
}
