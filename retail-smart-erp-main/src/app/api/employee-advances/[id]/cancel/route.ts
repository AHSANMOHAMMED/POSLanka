import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { withTenant } from '@/lib/db'
import { employeeAdvances } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { cancelEmployeeAdvanceSchema } from '@/lib/validation/schemas/hr'
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

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, cancelEmployeeAdvanceSchema)
    if (!parsed.success) return parsed.response
    const { cancellationReason } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const advance = await db.query.employeeAdvances.findFirst({
        where: eq(employeeAdvances.id, id),
      })

      if (!advance) {
        return NextResponse.json({ error: 'Employee advance not found' }, { status: 404 })
      }

      if (advance.status === 'cancelled' || advance.status === 'fully_recovered') {
        return NextResponse.json({ error: 'Advance cannot be cancelled in current status' }, { status: 400 })
      }

      // Reverse GL entries if advance was disbursed (GL posted during disbursement)
      if (advance.status === 'disbursed' || advance.status === 'partially_recovered') {
        try {
          await reverseGLEntries(db, session.user.tenantId, 'employee_advance', advance.id)
        } catch (glError) {
          logError('api/employee-advances/[id]/cancel/gl-reversal', glError)
        }
      }

      const [updated] = await db
        .update(employeeAdvances)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: session.user.id,
          cancellationReason,
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'employee-advance', 'updated', id)
      logAndBroadcast(session.user.tenantId, 'gl-entry', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/employee-advances/[id]/cancel', error)
    return NextResponse.json({ error: 'Failed to cancel employee advance' }, { status: 500 })
  }
}
