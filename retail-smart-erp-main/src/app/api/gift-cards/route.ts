import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { giftCards, customers } from '@/lib/db/schema'
import { eq, and, sql, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { giftCardsListSchema, createGiftCardSchema } from '@/lib/validation/schemas/gift-cards'

// GET all gift cards for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, giftCardsListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause
      const conditions = []
      if (search) {
        conditions.push(ilike(giftCards.cardNumber, `%${escapeLikePattern(search)}%`))
      }
      if (status) {
        conditions.push(eq(giftCards.status, status as 'inactive' | 'active' | 'used' | 'expired' | 'blocked'))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(giftCards)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get gift cards with pagination
      const result = await db.query.giftCards.findMany({
        where: whereClause,
        with: {
          issuedToCustomer: {
            columns: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          createdByUser: {
            columns: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: (giftCards, { desc }) => [desc(giftCards.createdAt)],
        limit,
        offset,
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/gift-cards', error)
    return NextResponse.json({ error: 'Failed to fetch gift cards' }, { status: 500 })
  }
}

// POST create new gift card
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createGiftCardSchema)
    if (!parsed.success) return parsed.response
    const { cardNumber, initialBalance, pin, expiryDate, issuedTo } = parsed.data

    const balance = roundCurrency(initialBalance)

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate card number
      const existingCard = await db.query.giftCards.findFirst({
        where: eq(giftCards.cardNumber, cardNumber),
      })
      if (existingCard) {
        return NextResponse.json({ error: 'A gift card with this card number already exists' }, { status: 400 })
      }

      // Validate issuedTo customer exists if provided
      if (issuedTo) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, issuedTo),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Customer not found' }, { status: 400 })
        }
      }

      // Create gift card in transaction
      const newCard = await db.transaction(async (tx) => {
        // Re-verify card number uniqueness inside transaction
        const existingCardInTx = await tx.query.giftCards.findFirst({
          where: eq(giftCards.cardNumber, cardNumber),
        })
        if (existingCardInTx) {
          throw new Error('DUPLICATE_CARD')
        }

        const [card] = await tx.insert(giftCards).values({
          tenantId: session.user.tenantId,
          cardNumber,
          initialBalance: String(balance),
          currentBalance: String(balance),
          pin: pin || null,
          status: 'inactive',
          expiryDate: expiryDate || null,
          issuedTo: issuedTo || null,
          createdBy: session.user.id,
        }).returning()

        return card
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'gift-card', 'created', newCard.id)

      return NextResponse.json(newCard)
    })
  } catch (error) {
    logError('api/gift-cards', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'DUPLICATE_CARD') {
      return NextResponse.json({ error: 'A gift card with this card number already exists' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to create gift card' }, { status: 500 })
  }
}
