import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, bankTransactions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; txnId: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(
      await params,
      z.object({ id: z.string().uuid(), txnId: z.string().uuid() })
    )
    if (!paramsParsed.success) return paramsParsed.response
    const { id, txnId } = paramsParsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Verify bank account exists
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      // Fetch the transaction
      const transaction = await db.query.bankTransactions.findFirst({
        where: and(
          eq(bankTransactions.id, txnId),
          eq(bankTransactions.bankAccountId, id)
        ),
      })

      if (!transaction) {
        return NextResponse.json({ error: 'Bank transaction not found' }, { status: 404 })
      }

      if (transaction.status === 'reconciled') {
        return NextResponse.json(
          { error: 'Cannot unmatch a reconciled transaction' },
          { status: 400 }
        )
      }

      if (transaction.status === 'unmatched') {
        return NextResponse.json(
          { error: 'Transaction is already unmatched' },
          { status: 400 }
        )
      }

      const [updated] = await db
        .update(bankTransactions)
        .set({
          status: 'unmatched',
          matchedVoucherType: null,
          matchedVoucherId: null,
        })
        .where(eq(bankTransactions.id, txnId))
        .returning()

      logAndBroadcast(tenantId, 'bank-transaction', 'updated', txnId)
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]/transactions/[txnId]/unmatch', error)
    return NextResponse.json({ error: 'Failed to unmatch bank transaction' }, { status: 500 })
  }
}
