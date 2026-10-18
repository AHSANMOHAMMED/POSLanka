import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { employeeAdvances } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateEmployeeAdvanceSchema } from '@/lib/validation/schemas/hr'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'approveAdvances')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const advance = await db.query.employeeAdvances.findFirst({
        where: eq(employeeAdvances.id, id),
        with: {
          employeeProfile: { with: { user: true } },
          recoveryRecords: true,
        },
      })

      if (!advance) {
        return NextResponse.json({ error: 'Employee advance not found' }, { status: 404 })
      }

      return NextResponse.json(advance)
    })
  } catch (error) {
    logError('api/employee-advances/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch employee advance' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'approveAdvances')
    if (permError) return permError

    const parsed = await validateBody(request, updateEmployeeAdvanceSchema)
    if (!parsed.success) return parsed.response
    const { requestedAmount, recoveryMethod, recoveryInstallments, purpose, reason, notes: advNotes } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.employeeAdvances.findFirst({
        where: eq(employeeAdvances.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Employee advance not found' }, { status: 404 })
      }

      if (existing.status !== 'draft' && existing.status !== 'pending_approval') {
        return NextResponse.json({ error: 'Only draft or pending advances can be edited' }, { status: 400 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (requestedAmount !== undefined) updateData.requestedAmount = String(requestedAmount)
      if (recoveryMethod !== undefined) updateData.recoveryMethod = recoveryMethod
      if (recoveryInstallments !== undefined) {
        updateData.recoveryInstallments = recoveryInstallments
        const amt = Number(requestedAmount || existing.requestedAmount)
        updateData.recoveryAmountPerInstallment = String(Math.round((amt / recoveryInstallments) * 100) / 100)
      }
      if (purpose !== undefined) updateData.purpose = purpose
      if (reason !== undefined) updateData.reason = reason
      if (advNotes !== undefined) updateData.notes = advNotes

      const [updated] = await db
        .update(employeeAdvances)
        .set(updateData)
        .where(eq(employeeAdvances.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'employee-advance', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/employee-advances/[id]', error)
    return NextResponse.json({ error: 'Failed to update employee advance' }, { status: 500 })
  }
}
