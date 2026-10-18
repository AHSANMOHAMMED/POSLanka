import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { commissions, users, sales, workOrders } from '@/lib/db/schema'
import { and, eq, sql, gte, lte, desc, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { commissionsListSchema } from '@/lib/validation/schemas/commissions'

// GET all commissions for the tenant (with pagination and filters)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageCommissions')
    if (permError) return permError

    const parsed = validateSearchParams(request, commissionsListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search, userId, status, saleId, workOrderId, dateFrom, dateTo, unpaidOnly } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      if (userId) {
        conditions.push(eq(commissions.userId, userId))
      }
      if (status) {
        conditions.push(eq(commissions.status, status))
      }
      if (saleId) {
        conditions.push(eq(commissions.saleId, saleId))
      }
      if (workOrderId) {
        conditions.push(eq(commissions.workOrderId, workOrderId))
      }
      if (dateFrom) {
        conditions.push(gte(commissions.createdAt, new Date(dateFrom)))
      }
      if (dateTo) {
        // Include the entire end date
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        conditions.push(lte(commissions.createdAt, endDate))
      }
      if (unpaidOnly) {
        // Approved but not yet in a payout
        conditions.push(eq(commissions.status, 'approved'))
        conditions.push(sql`${commissions.payoutId} IS NULL`)
      }
      if (search) {
        conditions.push(
          or(
            ilike(commissions.itemName, `%${escapeLikePattern(search)}%`)
          )
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all commissions
      if (all) {
        const result = await db
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
          .where(whereClause)
          .orderBy(desc(commissions.createdAt))
          .limit(1000)

        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(commissions)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results with joins
      const result = await db
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
        .where(whereClause)
        .orderBy(desc(commissions.createdAt))
        .limit(pageSize)
        .offset(offset)

      // Calculate totals for the current filter
      const [totals] = await db
        .select({
          totalAmount: sql<string>`COALESCE(SUM(CAST(${commissions.amount} AS DECIMAL)), 0)`,
          totalCommission: sql<string>`COALESCE(SUM(CAST(${commissions.commissionAmount} AS DECIMAL)), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(commissions)
        .where(whereClause)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
        summary: {
          totalAmount: totals.totalAmount,
          totalCommission: totals.totalCommission,
          count: Number(totals.count),
        },
      })
    })
  } catch (error) {
    logError('api/commissions', error)
    return NextResponse.json({ error: 'Failed to fetch commissions' }, { status: 500 })
  }
}
