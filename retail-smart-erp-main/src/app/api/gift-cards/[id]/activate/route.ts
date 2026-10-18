import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { giftCards } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST activate a gift card
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

        // Validate card is inactive
        if (currentCard.status !== 'inactive') {
          throw new Error('INVALID_STATE')
        }

        // Check if card is expired
        if (currentCard.expiryDate) {
          const expiryDate = new Date(currentCard.expiryDate)
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          if (expiryDate < today) {
            throw new Error('EXPIRED')
          }
        }

        const [updated] = await tx.update(giftCards)
          .set({ status: 'active' })
          .where(eq(giftCards.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'gift-card', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/gift-cards/[id]/activate', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
    }
    if (message === 'INVALID_STATE') {
      return NextResponse.json({ error: 'Gift card is not in inactive state. Only inactive cards can be activated.' }, { status: 400 })
    }
    if (message === 'EXPIRED') {
      return NextResponse.json({ error: 'Cannot activate an expired gift card' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to activate gift card' }, { status: 500 })
  }
}
