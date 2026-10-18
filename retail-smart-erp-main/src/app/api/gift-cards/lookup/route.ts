import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { giftCards } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { lookupGiftCardSchema } from '@/lib/validation/schemas/gift-cards'

// GET /api/gift-cards/lookup?cardNumber=XXX
// Look up a gift card by its card number (used during POS checkout)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, lookupGiftCardSchema)
    if (!parsed.success) return parsed.response
    const { cardNumber } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const card = await db.query.giftCards.findFirst({
        where: eq(giftCards.cardNumber, cardNumber.trim()),
        with: {
          issuedToCustomer: {
            columns: { id: true, name: true },
          },
        },
      })

      if (!card) {
        return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
      }

      // Auto-mark expired cards
      if (card.status === 'active' && card.expiryDate) {
        const expiryDate = new Date(card.expiryDate)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        if (expiryDate < today) {
          await db.update(giftCards)
            .set({ status: 'expired' })
            .where(eq(giftCards.id, card.id))
          card.status = 'expired'
        }
      }

      return NextResponse.json({
        id: card.id,
        cardNumber: card.cardNumber,
        currentBalance: card.currentBalance,
        status: card.status,
        expiryDate: card.expiryDate,
        customerName: card.issuedToCustomer?.name || null,
      })
    })
  } catch (error) {
    logError('api/gift-cards/lookup', error)
    return NextResponse.json({ error: 'Failed to look up gift card' }, { status: 500 })
  }
}
