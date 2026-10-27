import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { leaveRequests, leaveTypes } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateLeaveTypeSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'

// PUT /api/hr/leave-types/[id]
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, updateLeaveTypeSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const set: Partial<typeof leaveTypes.$inferInsert> = { updatedAt: new Date() }
      if (d.name !== undefined) set.name = d.name
      if (d.code !== undefined) set.code = d.code || null
      if (d.daysPerYear !== undefined) set.daysPerYear = String(d.daysPerYear)
      if (d.isPaid !== undefined) set.isPaid = d.isPaid
      if (d.isActive !== undefined) set.isActive = d.isActive
      const [row] = await db.update(leaveTypes).set(set).where(eq(leaveTypes.id, p.data.id)).returning()
      if (!row) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 })
      return NextResponse.json(row)
    })
  } catch (error) {
    return hrError('api/hr/leave-types/[id]', error, 'Failed to update leave type')
  }
}

// DELETE /api/hr/leave-types/[id] — only when no request uses it (else deactivate)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const [used] = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(eq(leaveRequests.leaveTypeId, p.data.id)).limit(1)
      if (used) return NextResponse.json({ error: 'This leave type has leave requests. Deactivate it instead.' }, { status: 409 })
      const [row] = await db.delete(leaveTypes).where(eq(leaveTypes.id, p.data.id)).returning({ id: leaveTypes.id })
      if (!row) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    return hrError('api/hr/leave-types/[id]', error, 'Failed to delete leave type')
  }
}
