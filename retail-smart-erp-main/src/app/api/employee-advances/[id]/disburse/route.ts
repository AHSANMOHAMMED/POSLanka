import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { employeeAdvances, accountingSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { createGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { disburseAdvanceSchema } from '@/lib/validation/schemas/hr'
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

    const permError = requirePermission(session, 'disburseAdvances')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, disburseAdvanceSchema)
    if (!parsed.success) return parsed.response
    const { disbursementMethod, disbursementReference } = parsed.data
    const tenantId = session.user.tenantId

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const advance = await tx.query.employeeAdvances.findFirst({
        where: eq(employeeAdvances.id, id),
      })

      if (!advance) throw new Error('NOT_FOUND')
      if (advance.status !== 'approved') throw new Error('INVALID_STATUS')

      const disbursedAmount = Number(advance.approvedAmount || advance.requestedAmount)

      // Load accounting settings for default accounts
      const [settings] = await tx
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, tenantId))
        .limit(1)

      // Create GL entries if accounting settings are configured
      if (settings?.defaultEmployeeAdvanceAccountId && settings?.defaultCashAccountId) {
        const postingDate = new Date().toISOString().split('T')[0]
        const glEntries: GLEntryInput[] = [
          // DEBIT: Employee Advances (current asset) - money owed by employee
          {
            accountId: settings.defaultEmployeeAdvanceAccountId,
            debit: disbursedAmount,
            credit: 0,
            partyType: 'employee',
            partyId: advance.userId,
            remarks: `Advance disbursed: ${advance.advanceNo}`,
          },
          // CREDIT: Cash/Bank - money paid out
          {
            accountId: disbursementMethod === 'bank_transfer' && settings.defaultBankAccountId
              ? settings.defaultBankAccountId
              : settings.defaultCashAccountId,
            debit: 0,
            credit: disbursedAmount,
            remarks: `Advance payment: ${advance.advanceNo}`,
          },
        ]

        await createGLEntries(tx, {
          tenantId,
          postingDate,
          voucherType: 'employee_advance',
          voucherId: advance.id,
          voucherNumber: advance.advanceNo,
          fiscalYearId: settings.currentFiscalYearId || null,
          entries: glEntries,
        })
      }

      // Update advance status
      const [updated] = await tx
        .update(employeeAdvances)
        .set({
          status: 'disbursed',
          disbursedAmount: String(disbursedAmount),
          balanceAmount: String(disbursedAmount),
          disbursedAt: new Date(),
          disbursedBy: session.user.id,
          disbursementMethod: disbursementMethod || null,
          disbursementReference: disbursementReference || null,
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, id))
        .returning()

      return updated
    })

    logAndBroadcast(tenantId, 'employee-advance', 'updated', id)
    logAndBroadcast(tenantId, 'gl-entry', 'created', id)

    return NextResponse.json(result)
  } catch (error) {
    const err = error as Error
    if (err?.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Employee advance not found' }, { status: 404 })
    }
    if (err?.message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Only approved advances can be disbursed' }, { status: 400 })
    }
    logError('api/employee-advances/[id]/disburse', error)
    return NextResponse.json({ error: 'Failed to disburse employee advance' }, { status: 500 })
  }
}
