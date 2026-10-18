import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { dealerPayments, dealers } from '@/lib/db/schema'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { dealerStatementSchema } from '@/lib/validation/schemas/dealership'

// GET dealer statement (all payments with running balance)
export async function GET(
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

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = validateSearchParams(request, dealerStatementSchema)
    if (!parsed.success) return parsed.response
    const { startDate, endDate } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate dealer exists
      const dealer = await db.query.dealers.findFirst({
        where: eq(dealers.id, id),
      })

      if (!dealer) {
        return NextResponse.json({ error: 'Dealer not found' }, { status: 404 })
      }

      // Build conditions for payment query
      const conditions = [eq(dealerPayments.dealerId, id)]
      if (startDate) {
        conditions.push(gte(dealerPayments.paymentDate, startDate))
      }
      if (endDate) {
        conditions.push(lte(dealerPayments.paymentDate, endDate))
      }
      const whereClause = and(...conditions)

      // Fetch all payments ordered by payment date ascending for running balance
      const paymentsResult = await db.query.dealerPayments.findMany({
        where: whereClause,
        with: {
          vehicleInventory: true,
          dealerAllocation: true,
          sale: true,
          createdByUser: true,
          confirmedByUser: true,
        },
        orderBy: [sql`${dealerPayments.paymentDate} ASC, ${dealerPayments.createdAt} ASC`],
      })

      // Calculate running balance
      // If we have a startDate filter, we need the opening balance (sum of all payments before startDate)
      let openingBalance = 0
      if (startDate) {
        const [result] = await db
          .select({
            total: sql<string>`COALESCE(
              SUM(
                CASE
                  WHEN ${dealerPayments.direction} = 'outbound' THEN CAST(${dealerPayments.amount} AS DECIMAL)
                  ELSE -CAST(${dealerPayments.amount} AS DECIMAL)
                END
              ), 0
            )`,
          })
          .from(dealerPayments)
          .where(and(
            eq(dealerPayments.dealerId, id),
            lte(dealerPayments.paymentDate, startDate)
          ))
        openingBalance = parseFloat(result?.total || '0')
      }

      // Build statement entries with running balance
      let runningBalance = openingBalance
      const entries = paymentsResult.map((payment) => {
        const amount = parseFloat(payment.amount || '0')
        // inbound: dealer pays company -> balance decreases
        // outbound: company pays dealer -> balance increases
        if (payment.direction === 'inbound') {
          runningBalance -= amount
        } else {
          runningBalance += amount
        }

        return {
          ...payment,
          runningBalance: runningBalance.toFixed(2),
        }
      })

      return NextResponse.json({
        dealer: {
          id: dealer.id,
          name: dealer.name,
          code: dealer.code,
          currentBalance: dealer.currentBalance,
          creditLimit: dealer.creditLimit,
        },
        openingBalance: openingBalance.toFixed(2),
        closingBalance: runningBalance.toFixed(2),
        entries,
        meta: {
          totalEntries: entries.length,
          startDate: startDate || null,
          endDate: endDate || null,
        },
      })
    })
  } catch (error) {
    logError('api/dealers/[id]/statement', error)
    return NextResponse.json({ error: 'Failed to fetch dealer statement' }, { status: 500 })
  }
}
