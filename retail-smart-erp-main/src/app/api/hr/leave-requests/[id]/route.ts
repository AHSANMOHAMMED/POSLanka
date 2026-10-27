import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { leaveRequests } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { leaveActionSchema } from '@/lib/validation/schemas/attendance'
import { assertEmployeeInScope, hrAuth, hrError } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// PUT /api/hr/leave-requests/[id] { action: approve | reject | cancel }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, leaveActionSchema)
  if (!parsed.success) return parsed.response
  const { action, rejectionReason } = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [current] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, p.data.id)).limit(1).for('update')
      if (!current) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 })
      const denied = await assertEmployeeInScope(auth.session, db, current.employeeProfileId)
      if (denied) return denied
      const allowed: Record<string, string[]> = { approve: ['pending', 'rejected'], reject: ['pending'], cancel: ['pending', 'approved'] }
      if (!allowed[action].includes(current.status)) {
        return NextResponse.json({ error: `A ${current.status} leave request cannot be ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'}` }, { status: 400 })
      }
      const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'
      const [row] = await db.update(leaveRequests).set({
        status,
        approvedBy: action === 'approve' ? auth.session.user.id : current.approvedBy,
        approvedAt: action === 'approve' ? new Date() : current.approvedAt,
        rejectionReason: action === 'reject' ? rejectionReason || null : current.rejectionReason,
        updatedAt: new Date(),
      }).where(eq(leaveRequests.id, current.id)).returning()
      if (action === 'approve' || current.status === 'approved') {
        await recomputeAttendance(db, tenantId, { from: current.fromDate, to: current.toDate, employeeIds: [current.employeeProfileId] })
      }
      logAndBroadcast(tenantId, 'leave-request', 'updated', row.id, { userId: auth.session.user.id, description: `Leave ${current.fromDate}–${current.toDate} ${status}` })
      return NextResponse.json(row)
    })
  } catch (error) {
    return hrError('api/hr/leave-requests/[id]', error, 'Failed to update leave request')
  }
}
