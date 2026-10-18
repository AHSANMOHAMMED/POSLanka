import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { withTenantTransaction } from '@/lib/db'
import { payrollRuns, salarySlips } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { cancelPayrollRunSchema } from '@/lib/validation/schemas/hr'
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

    const parsed = await validateBody(request, cancelPayrollRunSchema)
    if (!parsed.success) return parsed.response
    const { cancellationReason } = parsed.data

    const result = await withTenantTransaction(session.user.tenantId, async (db) => {
      const run = await db.query.payrollRuns.findFirst({
        where: eq(payrollRuns.id, id),
      })

      if (!run) {
        return { error: NextResponse.json({ error: 'Payroll run not found' }, { status: 404 }) }
      }

      if (run.status === 'cancelled') {
        return { error: NextResponse.json({ error: 'Payroll run is already cancelled' }, { status: 400 }) }
      }

      // Reverse GL entries if the run was completed (had GL entries posted)
      if (run.status === 'completed') {
        try {
          await reverseGLEntries(db, session.user.tenantId, 'payroll_run', id)
        } catch (glError) {
          logError('api/payroll-runs/[id]/cancel/gl-reversal', glError)
          // Don't block cancellation if GL reversal fails — log for manual correction
        }
      }

      // Cancel all associated salary slips
      const slips = await db.query.salarySlips.findMany({
        where: eq(salarySlips.payrollRunId, id),
      })

      const slipIds: string[] = []
      for (const slip of slips) {
        if (slip.status !== 'cancelled') {
          // Reverse individual GL entries if this slip was submitted independently
          // (slips submitted via payroll run process have GL under 'payroll_run' voucher, already reversed above)
          if (slip.status === 'submitted') {
            try {
              await reverseGLEntries(db, session.user.tenantId, 'salary_slip', slip.id)
            } catch {
              // No individual GL entries for this slip — posted via run consolidation
            }
          }

          await db
            .update(salarySlips)
            .set({
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelledBy: session.user.id,
              cancellationReason: `Payroll run cancelled: ${cancellationReason}`,
              updatedAt: new Date(),
            })
            .where(eq(salarySlips.id, slip.id))

          slipIds.push(slip.id)
        }
      }

      const [updated] = await db
        .update(payrollRuns)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: session.user.id,
          cancellationReason,
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, id))
        .returning()

      return { data: updated, slipIds }
    })

    if (!result) {
      return NextResponse.json({ error: 'Failed to cancel payroll run' }, { status: 500 })
    }
    if ('error' in result) {
      return result.error
    }

    // Broadcast after transaction commits
    for (const slipId of result.slipIds) {
      logAndBroadcast(session.user.tenantId, 'salary-slip', 'updated', slipId)
    }
    logAndBroadcast(session.user.tenantId, 'payroll-run', 'updated', id)

    return NextResponse.json(result.data)
  } catch (error) {
    logError('api/payroll-runs/[id]/cancel', error)
    return NextResponse.json({ error: 'Failed to cancel payroll run' }, { status: 500 })
  }
}
