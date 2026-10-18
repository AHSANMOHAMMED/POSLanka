import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, bankTransactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { importBankStatementSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, importBankStatementSchema)
    if (!parsed.success) return parsed.response
    const { rows } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Verify bank account exists
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      // Generate import batch ID
      const importBatch = new Date().toISOString()

      return await db.transaction(async (tx) => {
        let importedCount = 0

        for (const row of rows) {
          const { transactionDate, description, referenceNumber, debit, credit } = row

          if (!transactionDate) {
            continue // Skip rows without a transaction date
          }

          await tx.insert(bankTransactions).values({
            tenantId,
            bankAccountId: id,
            transactionDate,
            description: description || null,
            referenceNumber: referenceNumber || null,
            debit: String(Number(debit || 0)),
            credit: String(Number(credit || 0)),
            status: 'unmatched',
            importBatch,
          })

          importedCount++
        }

        logAndBroadcast(tenantId, 'bank-transaction', 'created', id)
        return NextResponse.json({
          success: true,
          importedCount,
          importBatch,
        })
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]/import-statement', error)
    return NextResponse.json({ error: 'Failed to import bank statement' }, { status: 500 })
  }
}
