import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { layaways, customers, customerCreditTransactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { postLayawayForfeitToGL } from '@/lib/accounting/auto-post'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { layawayForfeitSchema } from '@/lib/validation/schemas/layaways'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST forfeit a layaway (customer doesn't complete)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, layawayForfeitSchema)
  if (!parsed.success) return parsed.response

  const { refundPercentage, refundAmount, refundToCredit, reason } = parsed.data


  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permError = requirePermission(preSession, 'createSales')
  if (permError) return permError

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    // Get layaway with lock (RLS filters by tenant)
    const [layaway] = await tx
      .select()
      .from(layaways)
      .where(eq(layaways.id, id))
      .for('update')

    if (!layaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    if (layaway.status !== 'active') {
      return {
        error: NextResponse.json({
          error: `Layaway cannot be forfeited. Current status: ${layaway.status}`
        }, { status: 400 })
      }
    }

    const paidAmount = parseCurrency(layaway.paidAmount)

    // Calculate refund amount
    let calculatedRefund = 0
    if (refundAmount !== undefined && refundAmount !== null) {
      // Use direct refund amount if provided
      calculatedRefund = roundCurrency(refundAmount)
    } else if (refundPercentage > 0) {
      // Calculate from percentage
      calculatedRefund = roundCurrency(paidAmount * (refundPercentage / 100))
    }

    // Validate refund amount
    if (calculatedRefund < 0) {
      return {
        error: NextResponse.json({ error: 'Refund amount cannot be negative' }, { status: 400 })
      }
    }
    if (calculatedRefund > paidAmount) {
      return {
        error: NextResponse.json({
          error: `Refund amount cannot exceed paid amount (${paidAmount.toFixed(2)})`
        }, { status: 400 })
      }
    }

    const forfeitedAmount = roundCurrency(paidAmount - calculatedRefund)

    // Handle refund if customer exists and refund is requested
    let refundProcessed = false
    if (calculatedRefund > 0 && layaway.customerId && refundToCredit) {
      // Lock customer row and update credit balance
      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, layaway.customerId))
        .for('update')

      if (customer) {
        const newBalance = roundCurrency(parseCurrency(customer.balance) + calculatedRefund)

        // Create credit transaction
        await tx.insert(customerCreditTransactions).values({
          tenantId: session.user.tenantId,
          customerId: layaway.customerId,
          type: 'refund',
          amount: calculatedRefund.toString(),
          balanceAfter: newBalance.toString(),
          referenceType: 'layaway',
          referenceId: layaway.id,
          notes: `Refund from forfeited layaway ${layaway.layawayNo}${reason ? ` - ${reason}` : ''}`,
          createdBy: session.user.id,
        })

        // Update customer balance
        await tx.update(customers)
          .set({
            balance: newBalance.toString(),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, layaway.customerId))

        refundProcessed = true
      }
    }

    // Reverse original layaway payment GL entries (Dr Cash, Cr Advance)
    try {
      await reverseGLEntries(tx, session.user.tenantId, 'layaway_payment', id)
    } catch {
      // No GL entries to reverse is fine
    }

    // Post GL for the forfeited portion (Dr Advance Received, Cr Revenue)
    if (forfeitedAmount > 0) {
      await postLayawayForfeitToGL(tx, session.user.tenantId, {
        layawayId: id,
        layawayNo: layaway.layawayNo,
        forfeitedAmount,
        customerId: layaway.customerId || '',
      })
    }

    // Update layaway status to forfeited
    await tx.update(layaways)
      .set({
        status: 'forfeited',
        cancellationReason: reason || `Forfeited. Paid: ${paidAmount.toFixed(2)}, Refunded: ${calculatedRefund.toFixed(2)}, Forfeited: ${forfeitedAmount.toFixed(2)}`,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(layaways.id, id))

    return {
      data: {
        layaway: {
          id: layaway.id,
          layawayNo: layaway.layawayNo,
          status: 'forfeited',
        },
        summary: {
          totalPaid: paidAmount.toFixed(2),
          refundAmount: calculatedRefund.toFixed(2),
          forfeitedAmount: forfeitedAmount.toFixed(2),
          refundProcessed,
          refundToCredit: refundProcessed,
        },
      },
      tenantId: session.user.tenantId,
      customerId: layaway.customerId,
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  // Broadcast changes
  logAndBroadcast(result.tenantId, 'layaway', 'updated', id)
  if (result.customerId) {
    logAndBroadcast(result.tenantId, 'customer', 'updated', result.customerId)
  }

  return NextResponse.json(result.data)
}
