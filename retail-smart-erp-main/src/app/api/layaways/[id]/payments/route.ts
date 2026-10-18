import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { layaways, layawayPayments, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postLayawayPaymentToGL } from '@/lib/accounting/auto-post'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { layawayPaymentSchema } from '@/lib/validation/schemas/layaways'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET payments for a layaway
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Verify layaway exists (RLS filters by tenant)
    const [layaway] = await db
      .select({
        id: layaways.id,
        layawayNo: layaways.layawayNo,
        total: layaways.total,
        paidAmount: layaways.paidAmount,
        balanceDue: layaways.balanceDue,
        status: layaways.status,
      })
      .from(layaways)
      .where(eq(layaways.id, id))

    if (!layaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    // Get payments
    const payments = await db
      .select({
        id: layawayPayments.id,
        amount: layawayPayments.amount,
        paymentMethod: layawayPayments.paymentMethod,
        reference: layawayPayments.reference,
        receivedBy: layawayPayments.receivedBy,
        receivedByName: users.fullName,
        createdAt: layawayPayments.createdAt,
      })
      .from(layawayPayments)
      .leftJoin(users, eq(layawayPayments.receivedBy, users.id))
      .where(eq(layawayPayments.layawayId, id))

    return {
      data: {
        layaway: {
          id: layaway.id,
          layawayNo: layaway.layawayNo,
          total: layaway.total,
          paidAmount: layaway.paidAmount,
          balanceDue: layaway.balanceDue,
          status: layaway.status,
        },
        payments,
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// POST record a payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, layawayPaymentSchema)
  if (!parsed.success) return parsed.response

  const { amount, paymentMethod, reference } = parsed.data


  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permError = requirePermission(preSession, 'createSales')
  if (permError) return permError

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    // Get layaway with lock to prevent concurrent payment race conditions (RLS filters by tenant)
    const [layaway] = await tx
      .select()
      .from(layaways)
      .where(eq(layaways.id, id))
      .for('update')

    if (!layaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    if (layaway.status !== 'active') {
      return { error: NextResponse.json({ error: 'Layaway is not active' }, { status: 400 }) }
    }

    const currentBalanceDue = parseCurrency(layaway.balanceDue)
    const paymentAmount = roundCurrency(amount)

    // Account for floating point precision with small tolerance
    if (paymentAmount > currentBalanceDue + 0.01) {
      return {
        error: NextResponse.json({
          error: `Payment amount exceeds remaining balance. Maximum payment: ${currentBalanceDue.toFixed(2)}`
        }, { status: 400 })
      }
    }

    // Clamp to remaining if very close (due to floating point)
    const effectiveAmount = Math.min(paymentAmount, currentBalanceDue)
    const effectiveMethod = (paymentMethod || 'cash') as 'cash' | 'card' | 'bank_transfer' | 'credit' | 'gift_card'

    // Create payment record
    const [payment] = await tx.insert(layawayPayments).values({
      tenantId: session.user.tenantId,
      layawayId: id,
      amount: effectiveAmount.toString(),
      paymentMethod: effectiveMethod,
      reference: reference || null,
      receivedBy: session.user.id,
    }).returning()

    // Post payment to GL: Dr Cash/Bank, Cr Advance Received
    try {
      await postLayawayPaymentToGL(tx, session.user.tenantId, {
        layawayId: id,
        layawayNo: layaway.layawayNo,
        paymentDate: new Date().toISOString().split('T')[0],
        amount: effectiveAmount,
        paymentMethod: effectiveMethod,
        customerId: layaway.customerId,
        costCenterId: null,
      })
    } catch (glErr) {
      console.warn('[GL] Failed to post layaway payment GL entry:', glErr)
    }

    // Update layaway paidAmount, balanceDue, and status
    const currentPaid = parseCurrency(layaway.paidAmount)
    const newPaidAmount = roundCurrency(currentPaid + effectiveAmount)
    const newBalanceDue = roundCurrency(parseCurrency(layaway.total) - newPaidAmount)

    // Check if layaway is fully paid
    const isFullyPaid = newBalanceDue <= 0.01
    const newStatus = isFullyPaid ? 'fully_paid' : 'active'

    await tx.update(layaways)
      .set({
        paidAmount: newPaidAmount.toString(),
        balanceDue: Math.max(0, newBalanceDue).toString(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(layaways.id, id))

    return {
      data: {
        payment,
        layawayStatus: newStatus,
        newPaidAmount: newPaidAmount.toFixed(2),
        remaining: Math.max(0, newBalanceDue).toFixed(2),
        autoCompleted: isFullyPaid,
      },
      tenantId: session.user.tenantId,
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  logAndBroadcast(result.tenantId, 'layaway', 'updated', id)
  return NextResponse.json(result.data)
}
