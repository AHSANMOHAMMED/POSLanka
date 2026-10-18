import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { giftCards, giftCardTransactions, sales } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency, subtractCurrency, currencyGte } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { redeemGiftCardSchema } from '@/lib/validation/schemas/gift-cards'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { postGiftCardRedemptionToGL } from '@/lib/accounting/auto-post'

// POST redeem/use gift card
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, redeemGiftCardSchema)
    if (!parsed.success) return parsed.response
    const { amount, saleId } = parsed.data

    const redeemAmount = roundCurrency(amount)

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

        // Validate card is active
        if (currentCard.status !== 'active') {
          throw new Error('NOT_ACTIVE')
        }

        // Check if card is expired
        if (currentCard.expiryDate) {
          const expiryDate = new Date(currentCard.expiryDate)
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          if (expiryDate < today) {
            // Mark card as expired
            await tx.update(giftCards)
              .set({ status: 'expired' })
              .where(eq(giftCards.id, id))
            throw new Error('EXPIRED')
          }
        }

        // Check sufficient balance
        const currentBalance = parseCurrency(currentCard.currentBalance)
        if (!currencyGte(currentBalance, redeemAmount)) {
          throw new Error('INSUFFICIENT_BALANCE')
        }

        // Validate saleId if provided
        if (saleId) {
          const sale = await tx.query.sales.findFirst({
            where: eq(sales.id, saleId),
          })
          if (!sale) {
            throw new Error('SALE_NOT_FOUND')
          }
        }

        // Calculate new balance
        const newBalance = subtractCurrency(currentBalance, redeemAmount)

        // Fix #18: Use tolerance check for zero balance to handle floating-point edge cases
        const newStatus = Math.abs(newBalance) < 0.01 ? 'used' : 'active'

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
          type: 'redemption',
          amount: String(redeemAmount),
          balanceAfter: String(newBalance),
          saleId: saleId || null,
          createdBy: session!.user.id,
        }).returning()

        // Post GL entry for standalone redemptions (not linked to a sale)
        // Sale-linked redemptions are handled by postSaleToGL in the sales route
        try {
          await postGiftCardRedemptionToGL(tx, session!.user.tenantId, {
            giftCardId: id,
            transactionId: transaction.id,
            amount: redeemAmount,
            saleId: saleId || null,
          })
        } catch (glErr) {
          console.warn('[GL] Failed to post gift card redemption GL entry:', glErr)
        }

        return {
          card: updatedCard,
          transaction,
          previousBalance: currentBalance,
          amountRedeemed: redeemAmount,
          newBalance,
        }
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'gift-card', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/gift-cards/[id]/redeem', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
    }
    if (message === 'NOT_ACTIVE') {
      return NextResponse.json({ error: 'Gift card is not active' }, { status: 400 })
    }
    if (message === 'EXPIRED') {
      return NextResponse.json({ error: 'Gift card has expired' }, { status: 400 })
    }
    if (message === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json({ error: 'Insufficient balance on gift card' }, { status: 400 })
    }
    if (message === 'SALE_NOT_FOUND') {
      return NextResponse.json({ error: 'Sale not found' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to redeem gift card' }, { status: 500 })
  }
}
