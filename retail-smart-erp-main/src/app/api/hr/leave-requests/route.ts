import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { employeeProfiles, leaveRequests, leaveTypes, users } from '@/lib/db/schema'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { leaveRequestSchema, leaveRequestsListSchema } from '@/lib/validation/schemas/attendance'
import { assertEmployeeInScope, hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { leaveDaysFor } from '@/lib/attendance/leave'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/hr/leave-requests?status&employeeProfileId&year
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = validateSearchParams(request, leaveRequestsListSchema)
  if (!parsed.success) return parsed.response
  const q = parsed.data
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const { ids } = await scopedEmployeeIds(auth.session, db)
      const conds = []
      if (q.status) conds.push(eq(leaveRequests.status, q.status))
      if (q.employeeProfileId) conds.push(eq(leaveRequests.employeeProfileId, q.employeeProfileId))
      if (q.year) conds.push(gte(leaveRequests.toDate, `${q.year}-01-01`), lte(leaveRequests.fromDate, `${q.year}-12-31`))
      if (ids) conds.push(inArray(leaveRequests.employeeProfileId, ids.size ? [...ids] : ['00000000-0000-0000-0000-000000000000']))
      const rows = await db.select({
        request: leaveRequests,
        leaveTypeName: leaveTypes.name,
        isPaid: leaveTypes.isPaid,
        employeeName: users.fullName,
        employeeCode: employeeProfiles.employeeCode,
      }).from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .innerJoin(employeeProfiles, eq(employeeProfiles.id, leaveRequests.employeeProfileId))
        .leftJoin(users, eq(users.id, employeeProfiles.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(leaveRequests.fromDate))
        .limit(1000)
      return NextResponse.json(rows.map((r) => ({ ...r.request, leaveTypeName: r.leaveTypeName, isPaid: r.isPaid, employeeName: r.employeeName, employeeCode: r.employeeCode })))
    })
  } catch (error) {
    return hrError('api/hr/leave-requests', error, 'Failed to load leave requests')
  }
}

// POST /api/hr/leave-requests — record a leave request (approve: true records it approved)
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, leaveRequestSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const denied = await assertEmployeeInScope(auth.session, db, d.employeeProfileId)
      if (denied) return denied
      const [type] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, d.leaveTypeId)).limit(1)
      if (!type) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 })
      const [overlap] = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
        eq(leaveRequests.employeeProfileId, d.employeeProfileId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        lte(leaveRequests.fromDate, d.toDate), gte(leaveRequests.toDate, d.fromDate),
      )).limit(1)
      if (overlap) return NextResponse.json({ error: 'The employee already has leave in these dates' }, { status: 409 })
      const days = await leaveDaysFor(db, tenantId, d.employeeProfileId, d.fromDate, d.toDate, d.halfDay)
      if (days <= 0) return NextResponse.json({ error: 'The selected dates are all weekly offs or holidays' }, { status: 400 })
      const approved = d.approve === true
      const [row] = await db.insert(leaveRequests).values({
        tenantId, employeeProfileId: d.employeeProfileId, leaveTypeId: d.leaveTypeId, fromDate: d.fromDate, toDate: d.toDate,
        halfDay: d.halfDay, days: String(days), reason: d.reason || null,
        status: approved ? 'approved' : 'pending',
        approvedBy: approved ? auth.session.user.id : null, approvedAt: approved ? new Date() : null,
        createdBy: auth.session.user.id,
      }).returning()
      if (approved) await recomputeAttendance(db, tenantId, { from: d.fromDate, to: d.toDate, employeeIds: [d.employeeProfileId] })
      logAndBroadcast(tenantId, 'leave-request', 'created', row.id, { userId: auth.session.user.id, description: `${type.name} ${d.fromDate}–${d.toDate} (${days} days)${approved ? ' approved' : ''}` })
      return NextResponse.json(row, { status: 201 })
    })
  } catch (error) {
    return hrError('api/hr/leave-requests', error, 'Failed to create leave request')
  }
}
