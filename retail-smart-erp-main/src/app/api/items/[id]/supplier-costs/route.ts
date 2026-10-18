import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { itemSupplierCosts, suppliers, purchases } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET supplier costs for a specific item
// Optional query param: ?supplierId=xxx to filter to a single supplier
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

    const { searchParams } = new URL(request.url)
    const supplierId = searchParams.get('supplierId')

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = [eq(itemSupplierCosts.itemId, id)]
      if (supplierId) {
        conditions.push(eq(itemSupplierCosts.supplierId, supplierId))
      }

      const costs = await db
        .select({
          id: itemSupplierCosts.id,
          itemId: itemSupplierCosts.itemId,
          supplierId: itemSupplierCosts.supplierId,
          supplierName: suppliers.name,
          lastCostPrice: itemSupplierCosts.lastCostPrice,
          lastPurchaseDate: itemSupplierCosts.lastPurchaseDate,
          lastPurchaseId: itemSupplierCosts.lastPurchaseId,
          lastPurchaseNo: purchases.purchaseNo,
          totalPurchasedQty: itemSupplierCosts.totalPurchasedQty,
          supplierPartNumber: itemSupplierCosts.supplierPartNumber,
          updatedAt: itemSupplierCosts.updatedAt,
        })
        .from(itemSupplierCosts)
        .leftJoin(suppliers, eq(itemSupplierCosts.supplierId, suppliers.id))
        .leftJoin(purchases, eq(itemSupplierCosts.lastPurchaseId, purchases.id))
        .where(and(...conditions))
        .orderBy(suppliers.name)

      return NextResponse.json(costs)
    })
  } catch (error) {
    logError('api/items/[id]/supplier-costs', error)
    return NextResponse.json({ error: 'Failed to fetch supplier costs' }, { status: 500 })
  }
}
