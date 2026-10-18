import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { payrollRuns, salarySlips, accountingSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { createGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
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

      // Submit all draft salary slips in this run
      const slips = await db.query.salarySlips.findMany({
        where: eq(salarySlips.payrollRunId, id),
      })

      let submittedCount = 0
      for (const slip of slips) {
        if (slip.status === 'draft') {
          await db
            .update(salarySlips)
            .set({
              status: 'submitted',
              submittedAt: new Date(),
              submittedBy: session.user.id,
              updatedAt: new Date(),
            })
            .where(eq(salarySlips.id, slip.id))
          submittedCount++
        }
      }

      // Create consolidated GL journal entry for the entire payroll run
      const [settings] = await db
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, session.user.tenantId))
        .limit(1)

      if (settings?.defaultSalaryExpenseAccountId && settings?.defaultSalaryPayableAccountId) {
        const postingDate = new Date().toISOString().split('T')[0]
        const glEntries: GLEntryInput[] = []

        // DEBIT: Salary Expense for total gross pay
        if (run.totalGrossPay && Number(run.totalGrossPay) > 0) {
          glEntries.push({
            accountId: settings.defaultSalaryExpenseAccountId,
            debit: Number(run.totalGrossPay),
            credit: 0,
            remarks: `Payroll run ${run.runNo} - Gross salary expense`,
          })
        }

        // DEBIT: Employer Contribution Expense
        if (run.totalEmployerContributions && Number(run.totalEmployerContributions) > 0 && settings.defaultEmployerContributionAccountId) {
          glEntries.push({
            accountId: settings.defaultEmployerContributionAccountId,
            debit: Number(run.totalEmployerContributions),
            credit: 0,
            remarks: `Payroll run ${run.runNo} - Employer contributions`,
          })
        }

        // CREDIT: Salary Payable for total net pay
        if (run.totalNetPay && Number(run.totalNetPay) > 0) {
          glEntries.push({
            accountId: settings.defaultSalaryPayableAccountId,
            debit: 0,
            credit: Number(run.totalNetPay),
            remarks: `Payroll run ${run.runNo} - Net salary payable`,
          })
        }

        // Separate advance deductions from statutory deductions
        const totalAdvanceDeductions = slips.reduce(
          (sum, s) => sum + Number(s.advanceDeduction || 0), 0
        )
        const pureDeductions = Number(run.totalDeductions || 0) - totalAdvanceDeductions

        // CREDIT: Statutory Contributions Payable (excludes advance recovery)
        const statutoryPayable = pureDeductions + Number(run.totalEmployerContributions || 0)
        if (statutoryPayable > 0 && settings.defaultStatutoryPayableAccountId) {
          glEntries.push({
            accountId: settings.defaultStatutoryPayableAccountId,
            debit: 0,
            credit: statutoryPayable,
            remarks: `Payroll run ${run.runNo} - Statutory contributions payable`,
          })
        }

        // CREDIT: Employee Advance Account (advance recovery reduces the receivable)
        if (totalAdvanceDeductions > 0) {
          const advanceAccountId = settings.defaultEmployeeAdvanceAccountId || settings.defaultStatutoryPayableAccountId
          if (advanceAccountId) {
            glEntries.push({
              accountId: advanceAccountId,
              debit: 0,
              credit: totalAdvanceDeductions,
              remarks: `Payroll run ${run.runNo} - Advance recovery`,
            })
          }
        }

        // Only create GL entries if we have a balanced set
        if (glEntries.length > 0) {
          await createGLEntries(db, {
            tenantId: session.user.tenantId,
            postingDate,
            voucherType: 'payroll_run',
            voucherId: run.id,
            voucherNumber: run.runNo,
            fiscalYearId: settings.currentFiscalYearId || null,
            entries: glEntries,
          })
        }
      }

      // Mark run as completed — all operations succeeded atomically
      const [updated] = await db
        .update(payrollRuns)
        .set({
          status: 'completed',
          processedAt: new Date(),
          processedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, id))
        .returning()

      // Broadcast outside transaction scope is fine — these are non-critical notifications
      for (const slip of slips) {
        if (slip.status === 'draft') {
          logAndBroadcast(session.user.tenantId, 'salary-slip', 'updated', slip.id)
        }
      }
      logAndBroadcast(session.user.tenantId, 'payroll-run', 'updated', id)

      return NextResponse.json({ ...updated, submittedSlips: submittedCount })
    })
  } catch (error) {
    logError('api/payroll-runs/[id]/process', error)
    return NextResponse.json({ error: 'Failed to process payroll run' }, { status: 500 })
  }
}
