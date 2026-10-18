import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { employeeAdvances } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { approveAdvanceSchema } from '@/lib/validation/schemas/hr'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(
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

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, approveAdvanceSchema)
    if (!parsed.success) return parsed.response
    const { approvedAmount, approvalNotes } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const advance = await db.query.employeeAdvances.findFirst({
        where: eq(employeeAdvances.id, id),
      })

      if (!advance) {
        return NextResponse.json({ error: 'Employee advance not found' }, { status: 404 })
      }

      if (advance.status !== 'draft' && advance.status !== 'pending_approval') {
        return NextResponse.json({ error: 'Advance cannot be approved in current status' }, { status: 400 })
      }

      const approved = approvedAmount != null ? Number(approvedAmount) : Number(advance.requestedAmount)
      const installments = advance.recoveryInstallments || 1
      const installmentAmount = Math.round((approved / installments) * 100) / 100

      const [updated] = await db
        .update(employeeAdvances)
        .set({
          status: 'approved',
          approvedAmount: String(approved),
          recoveryAmountPerInstallment: String(installmentAmount),
          approvedAt: new Date(),
          approvedBy: session.user.id,
          approvalNotes: approvalNotes || null,
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'employee-advance', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/employee-advances/[id]/approve', error)
    return NextResponse.json({ error: 'Failed to approve employee advance' }, { status: 500 })
  }
}
