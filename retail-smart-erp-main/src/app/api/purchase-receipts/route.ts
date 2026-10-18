import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseReceipts, purchaseOrders, suppliers, warehouses, users } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { purchaseReceiptsListSchema } from '@/lib/validation/schemas/purchases'

// GET - List purchase receipts with pagination
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, purchaseReceiptsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status, purchaseOrderId, warehouseId, supplierId } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      const conditions = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(or(
          ilike(purchaseReceipts.receiptNo, `%${escaped}%`),
          ilike(purchaseReceipts.supplierInvoiceNo, `%${escaped}%`),
          ilike(suppliers.name, `%${escaped}%`)
        ))
      }
      if (status) conditions.push(eq(purchaseReceipts.status, status))
      if (purchaseOrderId) conditions.push(eq(purchaseReceipts.purchaseOrderId, purchaseOrderId))
      if (warehouseId) conditions.push(eq(purchaseReceipts.warehouseId, warehouseId))
      if (supplierId) conditions.push(eq(purchaseReceipts.supplierId, supplierId))

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count: total }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseReceipts)
        .leftJoin(suppliers, eq(purchaseReceipts.supplierId, suppliers.id))
        .where(whereClause)

      const data = await db
        .select({
          id: purchaseReceipts.id,
          receiptNo: purchaseReceipts.receiptNo,
          purchaseOrderId: purchaseReceipts.purchaseOrderId,
          orderNo: purchaseOrders.orderNo,
          warehouseId: purchaseReceipts.warehouseId,
          warehouseName: warehouses.name,
          supplierId: purchaseReceipts.supplierId,
          supplierName: suppliers.name,
          receiptDate: purchaseReceipts.receiptDate,
          status: purchaseReceipts.status,
          supplierInvoiceNo: purchaseReceipts.supplierInvoiceNo,
          receivedBy: purchaseReceipts.receivedBy,
          receivedByName: users.fullName,
          createdAt: purchaseReceipts.createdAt,
          updatedAt: purchaseReceipts.updatedAt,
        })
        .from(purchaseReceipts)
        .leftJoin(purchaseOrders, eq(purchaseReceipts.purchaseOrderId, purchaseOrders.id))
        .leftJoin(warehouses, eq(purchaseReceipts.warehouseId, warehouses.id))
        .leftJoin(suppliers, eq(purchaseReceipts.supplierId, suppliers.id))
        .leftJoin(users, eq(purchaseReceipts.receivedBy, users.id))
        .where(whereClause)
        .orderBy(desc(purchaseReceipts.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      return {
        data,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/purchase-receipts', error)
    return NextResponse.json({ error: 'Failed to fetch purchase receipts' }, { status: 500 })
  }
}
