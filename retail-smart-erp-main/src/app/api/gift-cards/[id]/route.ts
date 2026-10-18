import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { giftCards, giftCardTransactions } from '@/lib/db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { postGiftCardBreakageToGL } from '@/lib/accounting/auto-post'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateGiftCardSchema } from '@/lib/validation/schemas/gift-cards'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single gift card with transactions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const card = await db.query.giftCards.findFirst({
        where: eq(giftCards.id, id),
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
      })

      if (!card) {
        return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
      }

      // Get transactions for this gift card
      const transactions = await db.query.giftCardTransactions.findMany({
        where: eq(giftCardTransactions.giftCardId, id),
        with: {
          sale: {
            columns: {
              id: true,
              invoiceNo: true,
            },
          },
          createdByUser: {
            columns: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: [desc(giftCardTransactions.createdAt)],
      })

      return NextResponse.json({
        ...card,
        transactions,
      })
    })
  } catch (error) {
    logError('api/gift-cards/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch gift card' }, { status: 500 })
  }
}

// PUT update gift card (status, expiryDate, pin)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateGiftCardSchema)
    if (!parsed.success) return parsed.response
    const { status, expiryDate, pin } = parsed.data

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

        // Build update data
        const updateData: Partial<typeof giftCards.$inferInsert> = {}

        if (status !== undefined) {
          updateData.status = status
        }

        if (expiryDate !== undefined) {
          updateData.expiryDate = expiryDate || null
        }

        if (pin !== undefined) {
          updateData.pin = pin || null
        }

        const [updated] = await tx.update(giftCards)
          .set(updateData)
          .where(eq(giftCards.id, id))
          .returning()

        // If blocking/expiring a card with remaining balance, recognize breakage revenue
        if (status && (status === 'blocked' || status === 'expired')) {
          const remainingBalance = parseFloat(currentCard.currentBalance)
          if (remainingBalance > 0) {
            try {
              await postGiftCardBreakageToGL(tx, session!.user.tenantId, {
                giftCardId: id,
                cardNumber: currentCard.cardNumber,
                remainingBalance,
              })
            } catch (glError) {
              logError('api/gift-cards/[id]', glError)
            }
          }
        }

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'gift-card', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/gift-cards/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
    }
    if (message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update gift card' }, { status: 500 })
  }
}

// DELETE gift card (only if never used)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    // Execute with RLS tenant context
    return await withTenant(tenantId, async (db) => {
      // Check if the gift card exists
      const card = await db.query.giftCards.findFirst({
        where: eq(giftCards.id, id),
      })

      if (!card) {
        return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
      }

      // Check if there are any transactions (means the card has been used)
      const [transactionCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(giftCardTransactions)
        .where(eq(giftCardTransactions.giftCardId, id))

      if (transactionCount?.count > 0) {
        return NextResponse.json({
          error: 'Cannot delete gift card. It has been used and has transaction history.',
          transactionCount: transactionCount.count,
          suggestion: 'Consider blocking the card instead'
        }, { status: 400 })
      }

      const [deleted] = await db.delete(giftCards)
        .where(eq(giftCards.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(tenantId, 'gift-card', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/gift-cards/[id]', error)
    return NextResponse.json({ error: 'Failed to delete gift card' }, { status: 500 })
  }
}
