import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissionPayouts, commissions, users, sales, workOrders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { postCommissionPayoutToGL } from '@/lib/accounting/auto-post'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCommissionPayoutSchema } from '@/lib/validation/schemas/commissions'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single commission payout with linked commissions
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
      // Get payout with user info
      const [payout] = await db
        .select({
          id: commissionPayouts.id,
          tenantId: commissionPayouts.tenantId,
          payoutNo: commissionPayouts.payoutNo,
          userId: commissionPayouts.userId,
          periodStart: commissionPayouts.periodStart,
          periodEnd: commissionPayouts.periodEnd,
          totalAmount: commissionPayouts.totalAmount,
          commissionsCount: commissionPayouts.commissionsCount,
          status: commissionPayouts.status,
          paymentMethod: commissionPayouts.paymentMethod,
          paymentReference: commissionPayouts.paymentReference,
          paidAt: commissionPayouts.paidAt,
          paidBy: commissionPayouts.paidBy,
          approvedBy: commissionPayouts.approvedBy,
          approvedAt: commissionPayouts.approvedAt,
          notes: commissionPayouts.notes,
          createdBy: commissionPayouts.createdBy,
          createdAt: commissionPayouts.createdAt,
          userName: users.fullName,
        })
        .from(commissionPayouts)
        .leftJoin(users, eq(commissionPayouts.userId, users.id))
        .where(eq(commissionPayouts.id, id))

      if (!payout) {
        return NextResponse.json({ error: 'Commission payout not found' }, { status: 404 })
      }

      // Get linked commissions
      const linkedCommissions = await db
        .select({
          id: commissions.id,
          userId: commissions.userId,
          saleId: commissions.saleId,
          workOrderId: commissions.workOrderId,
          itemName: commissions.itemName,
          amount: commissions.amount,
          rate: commissions.rate,
          rateType: commissions.rateType,
          commissionAmount: commissions.commissionAmount,
          status: commissions.status,
          createdAt: commissions.createdAt,
          saleInvoiceNo: sales.invoiceNo,
          workOrderNo: workOrders.orderNo,
        })
        .from(commissions)
        .leftJoin(sales, eq(commissions.saleId, sales.id))
        .leftJoin(workOrders, eq(commissions.workOrderId, workOrders.id))
        .where(eq(commissions.payoutId, id))

      return NextResponse.json({
        ...payout,
        commissions: linkedCommissions,
      })
    })
  } catch (error) {
    logError('api/commission-payouts/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch commission payout' }, { status: 500 })
  }
}

// PUT update commission payout (approve/pay/cancel)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const currentUserId = await resolveUserIdRequired(session!)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCommissionPayoutSchema)
    if (!parsed.success) return parsed.response
    const { status, paymentMethod, paymentReference, notes } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Get current payout
      const existingPayout = await db.query.commissionPayouts.findFirst({
        where: eq(commissionPayouts.id, id),
      })

      if (!existingPayout) {
        return NextResponse.json({ error: 'Commission payout not found' }, { status: 404 })
      }

      // Build update data based on status transition
      const updateData: Partial<typeof commissionPayouts.$inferInsert> = {}

      if (status) {
        // Validate status transitions
        const validTransitions: Record<string, string[]> = {
          'draft': ['approved', 'cancelled'],
          'approved': ['paid', 'cancelled'],
          'paid': [], // Cannot transition from paid
          'cancelled': [], // Cannot transition from cancelled
        }

        const currentStatus = existingPayout.status
        const allowedNextStatuses = validTransitions[currentStatus] || []

        if (!allowedNextStatuses.includes(status)) {
          return NextResponse.json({
            error: `Cannot transition from "${currentStatus}" to "${status}". Allowed transitions: ${allowedNextStatuses.join(', ') || 'none'}`
          }, { status: 400 })
        }

        updateData.status = status

        // Handle status-specific updates
        if (status === 'approved') {
          updateData.approvedBy = currentUserId
          updateData.approvedAt = new Date()
        } else if (status === 'paid') {
          // Payment method required when marking as paid
          if (!paymentMethod) {
            return NextResponse.json({
              error: 'Payment method is required when marking payout as paid'
            }, { status: 400 })
          }
          updateData.paymentMethod = paymentMethod
          updateData.paymentReference = paymentReference || null
          updateData.paidBy = currentUserId
          updateData.paidAt = new Date()
        }
      }

      // Allow updating notes
      if (notes !== undefined) {
        updateData.notes = notes
      }

      // Allow updating payment details if not yet paid
      if (existingPayout.status !== 'paid' && existingPayout.status !== 'cancelled') {
        if (paymentMethod !== undefined && !status) {
          updateData.paymentMethod = paymentMethod
        }
        if (paymentReference !== undefined && !status) {
          updateData.paymentReference = paymentReference
        }
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
      }

      // Update payout and commissions in transaction
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx.update(commissionPayouts)
          .set(updateData)
          .where(eq(commissionPayouts.id, id))
          .returning()

        // Update linked commissions status if payout is paid or cancelled
        if (status === 'paid') {
          await tx.update(commissions)
            .set({ status: 'paid' })
            .where(eq(commissions.payoutId, id))

          // Post GL: Dr Commission Expense, Cr Cash/Bank
          await postCommissionPayoutToGL(tx, session!.user.tenantId, {
            payoutId: id,
            payoutNo: existingPayout.payoutNo,
            amount: parseFloat(existingPayout.totalAmount),
            paymentMethod: paymentMethod || 'cash',
          })
        } else if (status === 'cancelled') {
          // Unlink commissions and reset their payoutId so they can be included in future payouts
          await tx.update(commissions)
            .set({ payoutId: null })
            .where(eq(commissions.payoutId, id))
        }

        return updated
      })

      // Broadcast the changes
      logAndBroadcast(session!.user.tenantId, 'commission-payout', 'updated', id)
      if (status === 'paid' || status === 'cancelled') {
        logAndBroadcast(session!.user.tenantId, 'commission', 'updated', 'bulk')
      }

      return NextResponse.json(result)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/commission-payouts/[id]', error)
    return NextResponse.json({ error: 'Failed to update commission payout' }, { status: 500 })
  }
}
