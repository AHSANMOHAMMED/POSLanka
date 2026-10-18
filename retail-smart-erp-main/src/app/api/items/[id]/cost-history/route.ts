import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { itemCostHistory, suppliers, users } from '@/lib/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams, validateSearchParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { z } from 'zod'

const searchParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
})

// GET cost change history for a specific item (paginated)
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

    const qsParsed = validateSearchParams(request, searchParamsSchema)
    if (!qsParsed.success) return qsParsed.response
    const { page, pageSize } = qsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const whereCondition = eq(itemCostHistory.itemId, id)

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(itemCostHistory)
        .where(whereCondition)

      const total = countResult?.count ?? 0
      const totalPages = Math.ceil(total / pageSize)

      const history = await db
        .select({
          id: itemCostHistory.id,
          itemId: itemCostHistory.itemId,
          supplierId: itemCostHistory.supplierId,
          supplierName: suppliers.name,
          source: itemCostHistory.source,
          previousCostPrice: itemCostHistory.previousCostPrice,
          newCostPrice: itemCostHistory.newCostPrice,
          purchasePrice: itemCostHistory.purchasePrice,
          quantity: itemCostHistory.quantity,
          stockBefore: itemCostHistory.stockBefore,
          stockAfter: itemCostHistory.stockAfter,
          referenceId: itemCostHistory.referenceId,
          referenceNo: itemCostHistory.referenceNo,
          notes: itemCostHistory.notes,
          createdBy: itemCostHistory.createdBy,
          createdByName: users.fullName,
          createdAt: itemCostHistory.createdAt,
        })
        .from(itemCostHistory)
        .leftJoin(suppliers, eq(itemCostHistory.supplierId, suppliers.id))
        .leftJoin(users, eq(itemCostHistory.createdBy, users.id))
        .where(whereCondition)
        .orderBy(desc(itemCostHistory.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      return NextResponse.json({
        data: history,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/items/[id]/cost-history', error)
    return NextResponse.json({ error: 'Failed to fetch cost history' }, { status: 500 })
  }
}
