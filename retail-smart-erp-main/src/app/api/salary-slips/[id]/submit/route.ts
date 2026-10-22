import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { salarySlips, accountingSettings } from '@/lib/db/schema'
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

      // Create GL entries if accounting settings are configured
      if (settings) {
        const glEntries = buildSalaryGLEntries(settings, [slip], {
          label: `Salary ${slip.slipNo}`,
          party: { userId: slip.userId },
        })
        if (glEntries.length > 0) {
          await createGLEntries(tx, {
            tenantId,
            postingDate: await tenantToday(tenantId),
            voucherType: 'salary_slip',
            voucherId: slip.id,
            voucherNumber: slip.slipNo,
            fiscalYearId: settings.currentFiscalYearId || null,
            entries: glEntries,
          })
        }
      }

      // Recover the deducted advance installment(s) from the employee's open advances
      await applyAdvanceRecovery(tx, tenantId, slip)

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
    if (error instanceof GLValidationError || error instanceof AdvanceRecoveryError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logError('api/salary-slips/[id]/submit', error)
    return NextResponse.json({ error: 'Failed to submit salary slip' }, { status: 500 })
  }
}
