import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissions, users, sales, workOrders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCommissionSchema } from '@/lib/validation/schemas/commissions'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single commission
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
      const [commission] = await db
        .select({
          id: commissions.id,
          tenantId: commissions.tenantId,
          userId: commissions.userId,
          saleId: commissions.saleId,
          workOrderId: commissions.workOrderId,
          itemName: commissions.itemName,
          amount: commissions.amount,
          rate: commissions.rate,
          rateType: commissions.rateType,
          commissionAmount: commissions.commissionAmount,
          status: commissions.status,
          payoutId: commissions.payoutId,
          approvedBy: commissions.approvedBy,
          approvedAt: commissions.approvedAt,
          createdAt: commissions.createdAt,
          userName: users.fullName,
          saleInvoiceNo: sales.invoiceNo,
          workOrderNo: workOrders.orderNo,
        })
        .from(commissions)
        .leftJoin(users, eq(commissions.userId, users.id))
        .leftJoin(sales, eq(commissions.saleId, sales.id))
        .leftJoin(workOrders, eq(commissions.workOrderId, workOrders.id))
        .where(eq(commissions.id, id))

      if (!commission) {
        return NextResponse.json({ error: 'Commission not found' }, { status: 404 })
      }

      return NextResponse.json(commission)
    })
  } catch (error) {
    logError('api/commissions/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch commission' }, { status: 500 })
  }
}

// PUT update commission status (approve/cancel)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const userId = await resolveUserIdRequired(session!)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCommissionSchema)
    if (!parsed.success) return parsed.response
    const { status } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Get current commission
      const existingCommission = await db.query.commissions.findFirst({
        where: eq(commissions.id, id),
      })

      if (!existingCommission) {
        return NextResponse.json({ error: 'Commission not found' }, { status: 404 })
      }

      // Validate status transitions
      if (existingCommission.status === 'paid') {
        return NextResponse.json({
          error: 'Cannot modify a paid commission'
        }, { status: 400 })
      }

      if (existingCommission.status === 'cancelled') {
        return NextResponse.json({
          error: 'Cannot modify a cancelled commission'
        }, { status: 400 })
      }

      if (existingCommission.payoutId) {
        return NextResponse.json({
          error: 'Cannot modify a commission that is part of a payout'
        }, { status: 400 })
      }

      // Build update data
      const updateData: Partial<typeof commissions.$inferInsert> = {
        status,
      }

      if (status === 'approved') {
        updateData.approvedBy = userId
        updateData.approvedAt = new Date()
      }

      const [updated] = await db.update(commissions)
        .set(updateData)
        .where(eq(commissions.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'commission', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/commissions/[id]', error)
    return NextResponse.json({ error: 'Failed to update commission' }, { status: 500 })
  }
}
