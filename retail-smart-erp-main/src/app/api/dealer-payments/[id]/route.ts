import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { dealerPayments, dealers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateDealerPaymentSchema } from '@/lib/validation/schemas/dealership'
import { SAFE_USER } from '@/lib/db/safe-columns'

// GET single dealer payment
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

    return await withTenant(session.user.tenantId, async (db) => {
      const payment = await db.query.dealerPayments.findFirst({
        where: eq(dealerPayments.id, id),
        with: {
          dealer: true,
          vehicleInventory: true,
          dealerAllocation: true,
          sale: true,
          journalEntry: true,
          createdByUser: SAFE_USER,
          confirmedByUser: SAFE_USER,
        },
      })

      if (!payment) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      return NextResponse.json(payment)
    })
  } catch (error) {
    logError('api/dealer-payments/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch dealer payment' }, { status: 500 })
  }
}

// PUT update dealer payment
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageDealers')
    if (permError) return permError

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateDealerPaymentSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Lock the payment row: a pending payment has already moved the dealer balance, so a
      // cancel or a direction change must adjust that balance exactly once.
      const [existing] = await db.select().from(dealerPayments).where(eq(dealerPayments.id, id)).for('update')

      if (!existing) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      // Only allow updates on pending payments
      if (existing.status !== 'pending') {
        return NextResponse.json({
          error: `Cannot update a payment with status '${existing.status}'`,
        }, { status: 400 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      }

      if (body.type !== undefined) updateData.type = body.type
      if (body.direction !== undefined) updateData.direction = body.direction
      if (body.paymentMethod !== undefined) updateData.paymentMethod = body.paymentMethod
      if (body.referenceNo !== undefined) updateData.referenceNo = body.referenceNo
      if (body.paymentDate !== undefined) updateData.paymentDate = body.paymentDate
      if (body.dueDate !== undefined) updateData.dueDate = body.dueDate
      if (body.notes !== undefined) updateData.notes = body.notes
      const cancelling = body.cancellationReason !== undefined
      if (cancelling) {
        updateData.cancellationReason = body.cancellationReason
        updateData.status = 'cancelled'
        updateData.cancelledAt = new Date()
      }

      // Balance effect of a payment: inbound (dealer -> company) lowers the dealer balance,
      // outbound (company -> dealer) raises it. It was applied when the payment was created.
      const amount = parseFloat(existing.amount || '0')
      const effect = (direction: string) => (direction === 'inbound' ? -amount : amount)
      const oldEffect = effect(existing.direction)
      const newEffect = cancelling ? 0 : effect(body.direction ?? existing.direction)
      const delta = Math.round((newEffect - oldEffect) * 100) / 100
      if (delta !== 0) {
        const [dealer] = await db.select().from(dealers).where(eq(dealers.id, existing.dealerId)).for('update')
        if (dealer) {
          const before = parseFloat(dealer.currentBalance || '0')
          const after = Math.round((before + delta) * 100) / 100
          await db.update(dealers)
            .set({ currentBalance: String(after), updatedAt: new Date() })
            .where(eq(dealers.id, existing.dealerId))
          if (!cancelling) {
            // keep the payment's own before/after snapshot consistent with its new direction
            const snapBefore = parseFloat(existing.balanceBefore || '0')
            updateData.balanceAfter = String(Math.round((snapBefore + newEffect) * 100) / 100)
          }
        }
      }

      const [updated] = await db.update(dealerPayments)
        .set(updateData)
        .where(eq(dealerPayments.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'dealer-payment', 'updated', updated.id, {
        userId,
        entityName: updated.paymentNo,
        description: `Updated dealer payment ${updated.paymentNo}`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/dealer-payments/[id]', error)
    return NextResponse.json({ error: 'Failed to update dealer payment' }, { status: 500 })
  }
}
