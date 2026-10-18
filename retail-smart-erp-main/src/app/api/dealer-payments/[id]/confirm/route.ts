import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { requireQuota } from '@/lib/db/storage-quota'
import { dealerPayments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requirePermission } from '@/lib/auth/roles'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST confirm a dealer payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.dealerPayments.findFirst({
        where: eq(dealerPayments.id, id),
        with: {
          dealer: true,
        },
      })

      if (!existing) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      if (existing.status !== 'pending') {
        return NextResponse.json({
          error: `Cannot confirm a payment with status '${existing.status}'`,
        }, { status: 400 })
      }

      // Confirm payment - balance was already updated on creation
      const [confirmed] = await db.update(dealerPayments)
        .set({
          status: 'confirmed',
          confirmedBy: userId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dealerPayments.id, id))
        .returning()

      const dealerName = existing.dealer?.name || 'Dealer'

      logAndBroadcast(session.user.tenantId, 'dealer-payment', 'updated', confirmed.id, {
        userId,
        entityName: confirmed.paymentNo,
        description: `Confirmed dealer payment ${confirmed.paymentNo} for ${dealerName}`,
      })

      return NextResponse.json(confirmed)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/dealer-payments/[id]/confirm', error)
    return NextResponse.json({ error: 'Failed to confirm dealer payment' }, { status: 500 })
  }
}
