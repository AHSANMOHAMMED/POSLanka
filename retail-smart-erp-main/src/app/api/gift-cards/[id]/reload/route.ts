import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { giftCards, giftCardTransactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency, addCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { reloadGiftCardSchema } from '@/lib/validation/schemas/gift-cards'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { postGiftCardReloadToGL } from '@/lib/accounting/auto-post'

// POST reload/add balance to gift card
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, reloadGiftCardSchema)
    if (!parsed.success) return parsed.response
    const { amount } = parsed.data

    const reloadAmount = roundCurrency(amount)

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current card
        const [currentCard] = await tx
          .select()
          .from(giftCards)
          .where(eq(giftCards.id, id))
          .for('update')

        if (!currentCard) {
          throw new Error('NOT_FOUND')
        }

        // Cannot reload blocked or expired cards
        if (currentCard.status === 'blocked') {
          throw new Error('BLOCKED')
        }
        if (currentCard.status === 'expired') {
          throw new Error('EXPIRED')
        }

        // Calculate new balance
        const currentBalance = parseCurrency(currentCard.currentBalance)
        const newBalance = addCurrency(currentBalance, reloadAmount)

        // Enforce maximum balance cap to prevent unlimited reloads
        const MAX_GIFT_CARD_BALANCE = 1_000_000
        if (newBalance > MAX_GIFT_CARD_BALANCE) {
          throw new Error('MAX_BALANCE_EXCEEDED')
        }

        // If card was 'used' (zero balance), reactivate it
        const newStatus = currentCard.status === 'used' ? 'active' : currentCard.status

        // Update gift card balance
        const [updatedCard] = await tx.update(giftCards)
          .set({
            currentBalance: String(newBalance),
            status: newStatus,
          })
          .where(eq(giftCards.id, id))
          .returning()

        // Create transaction record
        const [transaction] = await tx.insert(giftCardTransactions).values({
          tenantId: session!.user.tenantId,
          giftCardId: id,
          type: 'reload',
          amount: String(reloadAmount),
          balanceAfter: String(newBalance),
          saleId: null,
          createdBy: session!.user.id,
        }).returning()

        // Post GL entry: Dr Cash/Bank, Cr Gift Card Liability
        try {
          await postGiftCardReloadToGL(tx, session!.user.tenantId, {
            giftCardId: id,
            transactionId: transaction.id,
            amount: reloadAmount,
          })
        } catch (glErr) {
          console.warn('[GL] Failed to post gift card reload GL entry:', glErr)
        }

        return {
          card: updatedCard,
          transaction,
          previousBalance: currentBalance,
          amountReloaded: reloadAmount,
          newBalance,
        }
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'gift-card', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/gift-cards/[id]/reload', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
    }
    if (message === 'BLOCKED') {
      return NextResponse.json({ error: 'Cannot reload a blocked gift card' }, { status: 400 })
    }
    if (message === 'EXPIRED') {
      return NextResponse.json({ error: 'Cannot reload an expired gift card' }, { status: 400 })
    }
    if (message === 'MAX_BALANCE_EXCEEDED') {
      return NextResponse.json({ error: 'Reload would exceed maximum gift card balance of 1,000,000. Current balance plus reload amount is too high.' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to reload gift card' }, { status: 500 })
  }
}
