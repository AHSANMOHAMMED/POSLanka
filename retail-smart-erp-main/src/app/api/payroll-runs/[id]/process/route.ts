import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { payrollRuns, salarySlips, accountingSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { createGLEntries, tenantToday, GLValidationError } from '@/lib/accounting/gl'
import { buildSalaryGLEntries } from '@/lib/payroll/slip-gl'
import { applyAdvanceRecovery, AdvanceRecoveryError } from '@/lib/payroll/advance-recovery'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
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

    return await withTenantTransaction(session.user.tenantId, async (db) => {
      // Lock the payroll run with FOR UPDATE to prevent concurrent double-processing
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, id))
        .for('update')

      if (!run) {
        return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
      }

      // Check status AFTER acquiring lock to prevent race conditions
      if (run.status !== 'draft') {
        return NextResponse.json({ error: 'Only draft payroll runs can be processed' }, { status: 400 })
      }

      // Submit all draft salary slips in this run (locked so a concurrent individual submit
      // cannot post the same slip twice)
      const slips = await db.select().from(salarySlips)
        .where(eq(salarySlips.payrollRunId, id))
        .for('update')

      const toSubmit = slips.filter((slip) => slip.status === 'draft')
      let submittedCount = 0
      for (const slip of toSubmit) {
        await db
          .update(salarySlips)
          .set({
            status: 'submitted',
            submittedAt: new Date(),
            submittedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(salarySlips.id, slip.id))
        // Recover the deducted advance installment(s) from the employee's open advances
        await applyAdvanceRecovery(db, session.user.tenantId, slip)
        submittedCount++
      }

      // Consolidated GL for the slips submitted HERE only. Slips that were submitted on their own
      // already posted their own 'salary_slip' voucher, and cancelled slips must not be paid —
      // the stored run totals included both.
      const [settings] = await db
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, session.user.tenantId))
        .limit(1)

      if (settings && toSubmit.length > 0) {
        const glEntries = buildSalaryGLEntries(settings, toSubmit, { label: `Payroll run ${run.runNo}` })
        if (glEntries.length > 0) {
          await createGLEntries(db, {
            tenantId: session.user.tenantId,
            postingDate: await tenantToday(session.user.tenantId),
            voucherType: 'payroll_run',
            voucherId: run.id,
            voucherNumber: run.runNo,
            fiscalYearId: settings.currentFiscalYearId || null,
            entries: glEntries,
          })
        }
      }

      // Run totals = the slips that are actually part of the run now (not cancelled ones)
      const live = slips.filter((slip) => slip.status !== 'cancelled')
      const sum = (pick: (x: typeof slips[number]) => unknown) =>
        (live.reduce((acc, x) => acc + Math.round((Number(pick(x)) || 0) * 100), 0) / 100).toFixed(2)
      const totals = {
        totalEmployees: live.length,
        totalGrossPay: sum((x) => x.grossPay),
        totalDeductions: sum((x) => x.totalDeductions),
        totalEmployerContributions: sum((x) => x.totalEmployerContributions),
        totalNetPay: sum((x) => x.netPay),
        totalCommissions: sum((x) => x.commissionAmount),
      }

      // Mark run as completed — all operations succeeded atomically
      const [updated] = await db
        .update(payrollRuns)
        .set({
          ...totals,
          status: 'completed',
          processedAt: new Date(),
          processedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, id))
        .returning()

      // Broadcast outside transaction scope is fine — these are non-critical notifications
      for (const slip of toSubmit) {
        logAndBroadcast(session.user.tenantId, 'salary-slip', 'updated', slip.id)
      }
      logAndBroadcast(session.user.tenantId, 'payroll-run', 'updated', id)

      return NextResponse.json({ ...updated, submittedSlips: submittedCount })
    })
  } catch (error) {
    if (error instanceof GLValidationError || error instanceof AdvanceRecoveryError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logError('api/payroll-runs/[id]/process', error)
    return NextResponse.json({ error: 'Failed to process payroll run' }, { status: 500 })
  }
}
