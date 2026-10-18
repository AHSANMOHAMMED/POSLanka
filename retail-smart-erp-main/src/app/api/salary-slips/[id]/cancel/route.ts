import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { withTenant } from '@/lib/db'
import { salarySlips } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { cancelSalarySlipSchema } from '@/lib/validation/schemas/hr'
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

    const permError = requirePermission(session, 'processPayroll')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, cancelSalarySlipSchema)
    if (!parsed.success) return parsed.response
    const { cancellationReason } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const slip = await db.query.salarySlips.findFirst({
        where: eq(salarySlips.id, id),
      })

      if (!slip) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      if (slip.status === 'cancelled') {
        return NextResponse.json({ error: 'Salary slip is already cancelled' }, { status: 400 })
      }

      // Reverse GL journal entries if submitted
      // Note: journalEntryId may not be set even when GL was posted (submit route doesn't store it),
      // so we check status only. reverseGLEntries safely returns [] if no entries exist.
      if (slip.status === 'submitted') {
        try {
          await reverseGLEntries(db, session.user.tenantId, 'salary_slip', slip.id)
        } catch (glError) {
          logError('api/salary-slips/[id]/cancel/gl-reversal', glError)
        }
      }

      const [updated] = await db
        .update(salarySlips)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: session.user.id,
          cancellationReason,
          updatedAt: new Date(),
        })
        .where(eq(salarySlips.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'salary-slip', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/salary-slips/[id]/cancel', error)
    return NextResponse.json({ error: 'Failed to cancel salary slip' }, { status: 500 })
  }
}
