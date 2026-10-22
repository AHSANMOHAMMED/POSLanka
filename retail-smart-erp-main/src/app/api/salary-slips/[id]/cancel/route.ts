import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { withTenant } from '@/lib/db'
import { salarySlips, payrollRuns, accountingSettings, glEntries } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { reverseGLEntries, createGLEntries, tenantToday, GLValidationError } from '@/lib/accounting/gl'
import { buildSalaryGLEntries } from '@/lib/payroll/slip-gl'
import { reverseAdvanceRecovery } from '@/lib/payroll/advance-recovery'

class SlipCancelError extends Error {}
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
      const tenantId = session.user.tenantId
      // Lock the slip so two cancels cannot both reverse the GL / advance recovery
      const [slip] = await db.select().from(salarySlips).where(eq(salarySlips.id, id)).for('update')

      if (!slip) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      if (slip.status === 'cancelled') {
        return NextResponse.json({ error: 'Salary slip is already cancelled' }, { status: 400 })
      }

      if (slip.status === 'submitted') {
        try {
          // Slip submitted on its own: reverse its own voucher
          const reversed = await reverseGLEntries(db, tenantId, 'salary_slip', slip.id, await tenantToday(tenantId))
          if (reversed.length === 0 && slip.payrollRunId) {
            // Slip posted as part of a processed payroll run: take this slip's share out of the
            // run's consolidated voucher (cancelling the run later reverses only the remainder).
            const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, slip.payrollRunId))
            const [settings] = await db.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
            const [{ count: runPosted }] = await db.select({ count: sql<number>`count(*)::int` }).from(glEntries)
              .where(and(eq(glEntries.voucherType, 'payroll_run'), eq(glEntries.voucherId, slip.payrollRunId)))
            if (run && settings && Number(runPosted) > 0) {
              const lines = buildSalaryGLEntries(settings, [slip], { label: `Payroll run ${run.runNo} - ${slip.slipNo} cancelled` })
              if (lines.length > 0) {
                await createGLEntries(db, {
                  tenantId,
                  postingDate: await tenantToday(tenantId),
                  voucherType: 'payroll_run',
                  voucherId: run.id,
                  voucherNumber: run.runNo,
                  fiscalYearId: settings.currentFiscalYearId || null,
                  entries: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, remarks: `Reversal: ${l.remarks || ''}`.trim() })),
                })
              }
              await db.update(payrollRuns).set({
                totalEmployees: sql`GREATEST(0, ${payrollRuns.totalEmployees} - 1)`,
                totalGrossPay: sql`${payrollRuns.totalGrossPay} - ${slip.grossPay}`,
                totalDeductions: sql`${payrollRuns.totalDeductions} - ${slip.totalDeductions}`,
                totalEmployerContributions: sql`${payrollRuns.totalEmployerContributions} - ${slip.totalEmployerContributions}`,
                totalNetPay: sql`${payrollRuns.totalNetPay} - ${slip.netPay}`,
                totalCommissions: sql`${payrollRuns.totalCommissions} - ${slip.commissionAmount}`,
                updatedAt: new Date(),
              }).where(eq(payrollRuns.id, run.id))
            }
          }
        } catch (glError) {
          if (glError instanceof GLValidationError) {
            // e.g. the period is closed — do not cancel the slip while its GL stays posted
            throw new SlipCancelError(glError.message)
          }
          throw glError
        }

        // Give back the advance installment(s) this slip recovered
        await reverseAdvanceRecovery(db, slip.id)
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
    if (error instanceof SlipCancelError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logError('api/salary-slips/[id]/cancel', error)
    return NextResponse.json({ error: 'Failed to cancel salary slip' }, { status: 500 })
  }
}
