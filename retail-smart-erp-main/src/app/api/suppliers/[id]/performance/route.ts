import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems, purchases, suppliers } from '@/lib/db/schema'
import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { supplierPerformanceSchema } from '@/lib/validation/schemas/suppliers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - Supplier performance metrics
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const parsed = validateSearchParams(request, supplierPerformanceSchema)
  if (!parsed.success) return parsed.response
  const { from: fromDate, to: toDate } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Verify supplier exists
    const [supplier] = await db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.id, id))

    if (!supplier) return { notFound: true }

    // Build date conditions for POs
    const poConditions = [eq(purchaseOrders.supplierId, id)]
    if (fromDate) poConditions.push(gte(purchaseOrders.createdAt, new Date(fromDate)))
    if (toDate) poConditions.push(lte(purchaseOrders.createdAt, new Date(toDate)))

    // Total POs
    const [poStats] = await db.select({
      totalOrders: sql<number>`count(*)`,
      totalValue: sql<string>`COALESCE(SUM(total::numeric), 0)`,
      confirmedOrders: sql<number>`count(*) FILTER (WHERE status IN ('confirmed', 'invoice_created'))`,
      cancelledOrders: sql<number>`count(*) FILTER (WHERE status = 'cancelled')`,
    })
      .from(purchaseOrders)
      .where(and(...poConditions))

    // Purchase invoices
    const purchaseConditions = [eq(purchases.supplierId, id)]
    if (fromDate) purchaseConditions.push(gte(purchases.createdAt, new Date(fromDate)))
    if (toDate) purchaseConditions.push(lte(purchases.createdAt, new Date(toDate)))

    const [purchaseStats] = await db.select({
      totalInvoices: sql<number>`count(*)`,
      totalPurchased: sql<string>`COALESCE(SUM(total::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(paid_amount::numeric), 0)`,
      avgLeadTime: sql<string>`COALESCE(
        AVG(EXTRACT(EPOCH FROM (created_at - (SELECT po.created_at FROM purchase_orders po WHERE po.id = purchases.purchase_order_id LIMIT 1))) / 86400),
        0
      )`,
    })
      .from(purchases)
      .where(and(...purchaseConditions))

    // Fulfillment rate: PO items received vs ordered
    const [fulfillment] = await db.select({
      totalOrdered: sql<string>`COALESCE(SUM(poi.quantity::numeric), 0)`,
      totalReceived: sql<string>`COALESCE(SUM(poi.received_quantity::numeric), 0)`,
    })
      .from(purchaseOrders)
      .innerJoin(purchaseOrderItems, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .where(and(...poConditions))

    const totalOrdered = parseFloat(fulfillment.totalOrdered)
    const totalReceived = parseFloat(fulfillment.totalReceived)
    const fulfillmentRate = totalOrdered > 0 ? (totalReceived / totalOrdered * 100) : 0

    return {
      data: {
        supplier: { id: supplier.id, name: supplier.name },
        metrics: {
          totalOrders: Number(poStats.totalOrders),
          totalOrderValue: poStats.totalValue,
          confirmedOrders: Number(poStats.confirmedOrders),
          cancelledOrders: Number(poStats.cancelledOrders),
          totalInvoices: Number(purchaseStats.totalInvoices),
          totalPurchased: purchaseStats.totalPurchased,
          totalPaid: purchaseStats.totalPaid,
          outstandingBalance: (parseFloat(purchaseStats.totalPurchased) - parseFloat(purchaseStats.totalPaid)).toFixed(2),
          fulfillmentRate: Math.round(fulfillmentRate * 100) / 100,
          avgLeadTimeDays: Math.round(parseFloat(purchaseStats.avgLeadTime) * 10) / 10,
        },
      },
    }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  if ('notFound' in result) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
  return NextResponse.json(result.data)
}
