import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissionPayouts, commissions, users } from '@/lib/db/schema'
import { and, eq, sql, gte, lte, desc, isNull, ilike, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { commissionPayoutsListSchema, createCommissionPayoutSchema } from '@/lib/validation/schemas/commissions'

// GET all commission payouts for the tenant (with pagination and filters)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, commissionPayoutsListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search, userId, status, dateFrom, dateTo } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      if (userId) {
        conditions.push(eq(commissionPayouts.userId, userId))
      }
      if (status) {
        conditions.push(eq(commissionPayouts.status, status))
      }
      if (dateFrom) {
        conditions.push(gte(commissionPayouts.createdAt, new Date(dateFrom)))
      }
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        conditions.push(lte(commissionPayouts.createdAt, endDate))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(commissionPayouts.payoutNo, `%${escaped}%`)
          )
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all payouts
      if (all) {
        const result = await db
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
          .where(whereClause)
          .orderBy(desc(commissionPayouts.createdAt))
          .limit(1000)

        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(commissionPayouts)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results with joins
      const result = await db
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
        .where(whereClause)
        .orderBy(desc(commissionPayouts.createdAt))
        .limit(pageSize)
        .offset(offset)

      // Calculate totals for the current filter
      const [totals] = await db
        .select({
          totalAmount: sql<string>`COALESCE(SUM(CAST(${commissionPayouts.totalAmount} AS DECIMAL)), 0)`,
          totalCount: sql<number>`COALESCE(SUM(${commissionPayouts.commissionsCount}), 0)`,
        })
        .from(commissionPayouts)
        .where(whereClause)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
        summary: {
          totalAmount: totals.totalAmount,
          totalCommissionsCount: Number(totals.totalCount),
        },
      })
    })
  } catch (error) {
    logError('api/commission-payouts', error)
    return NextResponse.json({ error: 'Failed to fetch commission payouts' }, { status: 500 })
  }
}

// POST create new commission payout
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const currentUserId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createCommissionPayoutSchema)
    if (!parsed.success) return parsed.response
    const { userId, periodStart, periodEnd, notes } = parsed.data

    const startDate = new Date(periodStart)
    const endDate = new Date(periodEnd)

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify user exists
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // Create payout and link commissions in transaction (all inside tx to prevent double-payout)
      const result = await db.transaction(async (tx) => {
        // Find all approved commissions for user in period without payoutId (inside tx with lock)
        const eligibleCommissions = await tx
          .select()
          .from(commissions)
          .where(and(
            eq(commissions.userId, userId),
            eq(commissions.status, 'approved'),
            isNull(commissions.payoutId),
            gte(commissions.createdAt, startDate),
            lte(commissions.createdAt, new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1))
          ))
          .for('update')

        if (eligibleCommissions.length === 0) {
          throw new Error('NO_ELIGIBLE_COMMISSIONS')
        }

        // Calculate total amount
        const totalAmount = eligibleCommissions.reduce(
          (sum, c) => sum + parseCurrency(c.commissionAmount),
          0
        )

        // Generate payoutNo atomically inside transaction
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${commissionPayouts.payoutNo})` })
          .from(commissionPayouts)
          .where(sql`${commissionPayouts.payoutNo} LIKE 'PAY-%'`)

        const lastNo = maxResult?.maxNo
        const nextNumber = lastNo ? parseInt(lastNo.replace(/\D/g, '')) + 1 : 1
        const payoutNo = `PAY-${String(nextNumber).padStart(6, '0')}`

        // Create payout record
        const [newPayout] = await tx.insert(commissionPayouts).values({
          tenantId: session.user.tenantId,
          payoutNo,
          userId,
          periodStart: periodStart,
          periodEnd: periodEnd,
          totalAmount: String(roundCurrency(totalAmount)),
          commissionsCount: eligibleCommissions.length,
          status: 'draft',
          notes: notes || null,
          createdBy: currentUserId,
        }).returning()

        // Link commissions to payout
        for (const commission of eligibleCommissions) {
          await tx.update(commissions)
            .set({ payoutId: newPayout.id })
            .where(eq(commissions.id, commission.id))
        }

        return { payout: newPayout, count: eligibleCommissions.length, total: totalAmount }
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'commission-payout', 'created', result.payout.id)
      logAndBroadcast(session.user.tenantId, 'commission', 'updated', 'bulk')

      return NextResponse.json({
        ...result.payout,
        commissionsIncluded: result.count,
        totalAmount: roundCurrency(result.total),
      })
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    if (err.message === 'NO_ELIGIBLE_COMMISSIONS') {
      return NextResponse.json({
        error: 'No approved commissions found for this user in the specified period'
      }, { status: 400 })
    }
    logError('api/commission-payouts', error)
    return NextResponse.json({ error: 'Failed to create commission payout' }, { status: 500 })
  }
}
