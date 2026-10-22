import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { couponQuoteSchema } from '@/lib/validation/schemas/account'
import { quoteCouponForDeposit } from '@/lib/billing/coupons'
import { consumeRateLimit, clientIp, rateLimitedResponse } from '@/lib/auth/rate-limit'

const QUOTE_LIMIT = { maxAttempts: 20, windowMs: 60 * 1000, category: 'coupon_quote' }

/**
 * POST /api/account/coupons/quote — price a promo code for a bank-transfer slip.
 * { code, subscriptionId? | pendingCompanyId?, periodMonths } →
 * 200 { valid: true, code, label, listAmount, discount, finalAmount } | { valid: false, message }
 * Nothing is reserved or counted here; the slip records the code and the use is counted on approval.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const limit = await consumeRateLimit(`${session.user.accountId}:${clientIp(request)}`, QUOTE_LIMIT)
    if (limit.limited) return rateLimitedResponse(limit)

    const parsed = await validateBody(request, couponQuoteSchema)
    if (!parsed.success) return parsed.response
    const { code, subscriptionId, pendingCompanyId, periodMonths } = parsed.data

    const q = await quoteCouponForDeposit({ code, accountId: session.user.accountId, subscriptionId, pendingCompanyId, periodMonths })
    if (!q.ok) return NextResponse.json({ valid: false, message: q.error })
    return NextResponse.json({ valid: true, code: q.code, label: q.label, listAmount: q.listAmount, discount: q.discount, finalAmount: q.finalAmount })
  } catch (error) {
    logError('api/account/coupons/quote', error)
    return NextResponse.json({ error: 'Failed to check the promo code' }, { status: 500 })
  }
}
