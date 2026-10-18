import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { dealerPayments, dealers } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike, gte, lte } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { dealerPaymentsListSchema, createDealerPaymentSchema } from '@/lib/validation/schemas/dealership'

// GET all dealer payments for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, dealerPaymentsListSchema)
    if (!parsed.success) return parsed.response
    const { dealerId, type, direction, status, startDate, endDate, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (dealerId) {
        conditions.push(eq(dealerPayments.dealerId, dealerId))
      }
      if (type) {
        conditions.push(eq(dealerPayments.type, type))
      }
      if (direction) {
        conditions.push(eq(dealerPayments.direction, direction))
      }
      if (status) {
        conditions.push(eq(dealerPayments.status, status))
      }
      if (startDate) {
        conditions.push(gte(dealerPayments.paymentDate, startDate))
      }
      if (endDate) {
        conditions.push(lte(dealerPayments.paymentDate, endDate))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(dealerPayments.paymentNo, `%${escaped}%`),
            ilike(dealerPayments.referenceNo, `%${escaped}%`),
            ilike(dealerPayments.notes, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealerPayments)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.dealerPayments.findMany({
        where: whereClause,
        with: {
          dealer: true,
          vehicleInventory: true,
          dealerAllocation: true,
          sale: true,
          createdByUser: true,
          confirmedByUser: true,
        },
        orderBy: [desc(dealerPayments.createdAt)],
        limit,
        offset,
      })

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
        },
      })
    })
  } catch (error) {
    logError('api/dealer-payments', error)
    return NextResponse.json({ error: 'Failed to fetch dealer payments' }, { status: 500 })
  }
}

// POST create a new dealer payment
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createDealerPaymentSchema)
    if (!parsed.success) return parsed.response
    const {
      dealerId, type, direction, amount, paymentMethod, referenceNo,
      vehicleInventoryId: vehInvId, dealerAllocationId, saleId,
      paymentDate, dueDate, notes,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Lock dealer row to prevent stale balance reads (race condition fix)
        const [dealer] = await tx.select().from(dealers).where(eq(dealers.id, dealerId)).for('update')
        if (!dealer) {
          throw new Error('DEALER_NOT_FOUND')
        }

        // Auto-generate payment number: DP-YYYYMMDD-NNN
        const today = new Date()
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
        const prefix = `DP-${dateStr}-`

        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${dealerPayments.paymentNo})` })
          .from(dealerPayments)
          .where(ilike(dealerPayments.paymentNo, `${prefix}%`))

        let nextSeq = 1
        if (maxResult?.maxNo) {
          const lastSeq = parseInt(maxResult.maxNo.replace(prefix, ''))
          if (!isNaN(lastSeq)) {
            nextSeq = lastSeq + 1
          }
        }
        const paymentNo = `${prefix}${String(nextSeq).padStart(3, '0')}`

        // Calculate balance changes
        const parsedAmount = amount
        const balanceBefore = parseFloat(dealer.currentBalance || '0')
        // inbound (dealer -> company): decrease balance (dealer owes less)
        // outbound (company -> dealer): increase balance (company pays dealer)
        const balanceAfter = direction === 'inbound'
          ? balanceBefore - parsedAmount
          : balanceBefore + parsedAmount

        // Create payment
        const [payment] = await tx.insert(dealerPayments).values({
          tenantId: session.user.tenantId,
          dealerId,
          paymentNo,
          type,
          direction,
          amount: String(parsedAmount),
          paymentMethod: paymentMethod || null,
          referenceNo: referenceNo || null,
          vehicleInventoryId: vehInvId || null,
          dealerAllocationId: dealerAllocationId || null,
          saleId: saleId || null,
          balanceBefore: String(balanceBefore),
          balanceAfter: String(balanceAfter),
          paymentDate: paymentDate || today.toISOString().slice(0, 10),
          dueDate: dueDate || null,
          status: 'pending',
          createdBy: userId,
          notes: notes || null,
        }).returning()

        // Update dealer's current balance
        await tx.update(dealers)
          .set({
            currentBalance: String(balanceAfter),
            updatedAt: new Date(),
          })
          .where(eq(dealers.id, dealerId))

        return { payment, dealerName: dealer.name }
      })

      logAndBroadcast(session.user.tenantId, 'dealer-payment', 'created', result.payment.id, {
        userId,
        entityName: result.payment.paymentNo,
        description: `Created dealer payment ${result.payment.paymentNo} (${direction} ${type})`,
      })

      // Also broadcast dealer change since balance was updated
      logAndBroadcast(session.user.tenantId, 'dealer', 'updated', dealerId, {
        userId,
        entityName: result.dealerName,
        description: `Balance updated via payment ${result.payment.paymentNo}`,
      })

      return NextResponse.json(result.payment)
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    if (err.message === 'DEALER_NOT_FOUND') {
      return NextResponse.json({ error: 'Dealer not found' }, { status: 404 })
    }
    logError('api/dealer-payments', error)
    return NextResponse.json({ error: 'Failed to create dealer payment' }, { status: 500 })
  }
}
