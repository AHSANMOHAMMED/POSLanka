import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { itemSupplierCosts, items, purchases } from '@/lib/db/schema'
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams, validateSearchParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { z } from 'zod'

const searchParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
})

// GET items supplied by this supplier with costs (paginated)
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
    const { id: supplierId } = paramsParsed.data

    const qsParsed = validateSearchParams(request, searchParamsSchema)
    if (!qsParsed.success) return qsParsed.response
    const { page, pageSize, search } = qsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const whereClause = search
        ? and(
            eq(itemSupplierCosts.supplierId, supplierId),
            or(ilike(items.name, `%${search}%`), ilike(items.sku, `%${search}%`))
          )
        : eq(itemSupplierCosts.supplierId, supplierId)

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(itemSupplierCosts)
        .innerJoin(items, eq(itemSupplierCosts.itemId, items.id))
        .where(whereClause)

      const total = countResult?.count ?? 0
      const totalPages = Math.ceil(total / pageSize)

      const data = await db
        .select({
          id: itemSupplierCosts.id,
          itemId: itemSupplierCosts.itemId,
          itemName: items.name,
          itemSku: items.sku,
          lastCostPrice: itemSupplierCosts.lastCostPrice,
          totalPurchasedQty: itemSupplierCosts.totalPurchasedQty,
          lastPurchaseDate: itemSupplierCosts.lastPurchaseDate,
          lastPurchaseId: itemSupplierCosts.lastPurchaseId,
          lastPurchaseNo: purchases.purchaseNo,
          supplierPartNumber: itemSupplierCosts.supplierPartNumber,
          updatedAt: itemSupplierCosts.updatedAt,
        })
        .from(itemSupplierCosts)
        .innerJoin(items, eq(itemSupplierCosts.itemId, items.id))
        .leftJoin(purchases, eq(itemSupplierCosts.lastPurchaseId, purchases.id))
        .where(whereClause)
        .orderBy(desc(itemSupplierCosts.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      return NextResponse.json({
        data,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/suppliers/[id]/item-costs', error)
    return NextResponse.json({ error: 'Failed to fetch supplier item costs' }, { status: 500 })
  }
}
