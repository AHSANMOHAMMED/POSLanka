import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { refunds } from '@/lib/db/schema'
import { eq, desc, sql, and, gte, lte } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams } from '@/lib/validation/helpers'
import { refundsListSchema } from '@/lib/validation/schemas/waste-log'

// GET all refunds for the tenant (with pagination)
export async function GET(request: NextRequest) {
  const parsed = validateSearchParams(request, refundsListSchema)
  if (!parsed.success) return parsed.response
  const { page, pageSize, startDate, endDate, saleId } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    // When filtering by saleId, allow any authenticated user (they need to see refunds on their sale)
    // Otherwise require viewReports permission for the full refunds list
    if (!saleId) {
      const permError = requirePermission(session, 'viewReports')
      if (permError) return { error: permError }
    }

    // Build where conditions - RLS handles tenant filtering
    const conditions: ReturnType<typeof eq>[] = []
    if (saleId) {
      conditions.push(eq(refunds.originalSaleId, saleId))
    }
    if (startDate) {
      conditions.push(gte(refunds.createdAt, new Date(startDate)))
    }
    if (endDate) {
      conditions.push(lte(refunds.createdAt, new Date(endDate + 'T23:59:59')))
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get total count
    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(refunds)
      .where(whereClause)

    const offset = (page - 1) * pageSize
    const limit = Math.min(pageSize, 100)

    // Get refunds with sale and user info via joins
    const data = await db
      .select({
        id: refunds.id,
        saleId: refunds.saleId,
        originalSaleId: refunds.originalSaleId,
        amount: refunds.amount,
        method: refunds.method,
        reason: refunds.reason,
        createdAt: refunds.createdAt,
        saleInvoiceNo: sql<string>`s1.invoice_no`,
        originalSaleInvoiceNo: sql<string>`s2.invoice_no`,
        processedByName: sql<string>`u.full_name`,
      })
      .from(refunds)
      .leftJoin(sql`sales s1`, sql`s1.id = ${refunds.saleId}`)
      .leftJoin(sql`sales s2`, sql`s2.id = ${refunds.originalSaleId}`)
      .leftJoin(sql`users u`, sql`u.id = ${refunds.processedBy}`)
      .where(whereClause)
      .orderBy(desc(refunds.createdAt))
      .limit(limit)
      .offset(offset)

    return {
      data,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  return NextResponse.json(result)
}
