import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { salarySlips, accountingSettings } from '@/lib/db/schema'
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

    const tenantId = session.user.tenantId

    const result = await withTenantTransaction(tenantId, async (tx) => {
      // Lock the salary slip with FOR UPDATE to prevent concurrent double-submission
      const [slip] = await tx
        .select()
        .from(salarySlips)
        .where(eq(salarySlips.id, id))
        .for('update')

      if (!slip) throw new Error('NOT_FOUND')
      // Check status AFTER acquiring lock to prevent race conditions
      if (slip.status !== 'draft') throw new Error('INVALID_STATUS')

      // Load accounting settings for default accounts
      const [settings] = await tx
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, tenantId))
        .limit(1)

      const grossPay = Number(slip.grossPay || 0)
      const netPay = Number(slip.netPay || 0)
      const totalDeductions = Number(slip.totalDeductions || 0)
      const totalEmployerContributions = Number(slip.totalEmployerContributions || 0)

      // Create GL entries if accounting settings are configured
      if (settings?.defaultSalaryExpenseAccountId && settings?.defaultSalaryPayableAccountId) {
        const glEntries: GLEntryInput[] = []
        const postingDate = new Date().toISOString().split('T')[0]

        // DEBIT: Salary Expense account for gross pay
        if (grossPay > 0) {
          glEntries.push({
            accountId: settings.defaultSalaryExpenseAccountId,
            debit: grossPay,
            credit: 0,
            partyType: 'employee',
            partyId: slip.userId,
            remarks: `Salary expense for ${slip.slipNo}`,
          })
        }

        // DEBIT: Employer Contribution Expense for employer statutory contributions
        if (totalEmployerContributions > 0 && settings.defaultEmployerContributionAccountId) {
          glEntries.push({
            accountId: settings.defaultEmployerContributionAccountId,
            debit: totalEmployerContributions,
            credit: 0,
            partyType: 'employee',
            partyId: slip.userId,
            remarks: `Employer contributions for ${slip.slipNo}`,
          })
        }

        // CREDIT: Salary Payable for net pay (what employee receives)
        if (netPay > 0) {
          glEntries.push({
            accountId: settings.defaultSalaryPayableAccountId,
            debit: 0,
            credit: netPay,
            partyType: 'employee',
            partyId: slip.userId,
            remarks: `Net salary payable for ${slip.slipNo}`,
          })
        }

        // CREDIT: Statutory Contributions Payable for employee deductions + employer contributions
        const statutoryPayable = totalDeductions + totalEmployerContributions
        if (statutoryPayable > 0 && settings.defaultStatutoryPayableAccountId) {
          glEntries.push({
            accountId: settings.defaultStatutoryPayableAccountId,
            debit: 0,
            credit: statutoryPayable,
            remarks: `Statutory contributions for ${slip.slipNo}`,
          })
        }

        // Only post if we have balanced entries
        if (glEntries.length > 0) {
          await createGLEntries(tx, {
            tenantId,
            postingDate,
            voucherType: 'salary_slip',
            voucherId: slip.id,
            voucherNumber: slip.slipNo,
            fiscalYearId: settings.currentFiscalYearId || null,
            entries: glEntries,
          })
        }
      }

      // Update salary slip status
      const [updated] = await tx
        .update(salarySlips)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          submittedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(salarySlips.id, id))
        .returning()

      return updated
    })

    logAndBroadcast(tenantId, 'salary-slip', 'updated', id)
    logAndBroadcast(tenantId, 'gl-entry', 'created', id)

    return NextResponse.json(result)
  } catch (error) {
    const err = error as Error
    if (err?.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
    }
    if (err?.message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Only draft slips can be submitted' }, { status: 400 })
    }
    logError('api/salary-slips/[id]/submit', error)
    return NextResponse.json({ error: 'Failed to submit salary slip' }, { status: 500 })
  }
}
