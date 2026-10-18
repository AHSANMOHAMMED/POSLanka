import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { workOrderParts, items, insuranceEstimateItems, warehouseStock, heldSales } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET reservations for a specific item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get item details (RLS scopes to tenant)
      const item = await db.query.items.findFirst({
        where: eq(items.id, itemId),
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // 1. Get reservations from draft work orders (RLS scopes)
      const workOrderReservations = await db.query.workOrderParts.findMany({
        where: eq(workOrderParts.itemId, itemId),
        with: {
          workOrder: {
            with: {
              customer: true,
              vehicle: true,
            },
          },
        },
      })

      const draftWorkOrderReservations = workOrderReservations
        .filter(r => {
          const workOrder = Array.isArray(r.workOrder) ? r.workOrder[0] : r.workOrder
          return workOrder?.status === 'draft'
        })
        .map(r => {
          const workOrder = Array.isArray(r.workOrder) ? r.workOrder[0] : r.workOrder
          const customer = workOrder ? (Array.isArray(workOrder.customer) ? workOrder.customer[0] : workOrder.customer) : null
          const vehicle = workOrder ? (Array.isArray(workOrder.vehicle) ? workOrder.vehicle[0] : workOrder.vehicle) : null
          return {
            id: r.id,
            type: 'work_order' as const,
            quantity: parseFloat(r.quantity),
            referenceId: r.workOrderId,
            referenceNo: workOrder?.orderNo,
            customer: customer?.name || 'Walk-in',
            vehicle: vehicle
              ? `${vehicle.licensePlate ? `[${vehicle.licensePlate}] ` : ''}${vehicle.year || ''} ${vehicle.make} ${vehicle.model}`.trim()
              : null,
            createdAt: workOrder?.createdAt,
          }
        })

      // 2. Get reservations from non-expired held sales (RLS scopes)
      const heldSalesData = await db.query.heldSales.findMany({
        where: sql`${heldSales.expiresAt} > NOW()`,
        with: {
          customer: true,
        },
      })

      const heldSaleReservations: Array<{
        id: string
        type: 'held_sale'
        quantity: number
        referenceId: string
        referenceNo: string
        customer: string
        vehicle: null
        createdAt: Date | null
      }> = []

      for (const held of heldSalesData) {
        const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
        const customer = Array.isArray(held.customer) ? held.customer[0] : held.customer
        if (Array.isArray(cartItems)) {
          for (const cartItem of cartItems) {
            if (cartItem.itemId === itemId) {
              heldSaleReservations.push({
                id: `held-${held.id}`,
                type: 'held_sale',
                quantity: cartItem.quantity || 0,
                referenceId: held.id,
                referenceNo: held.holdNumber || 'Held Sale',
                customer: customer?.name || 'Walk-in',
                vehicle: null,
                createdAt: held.createdAt,
              })
            }
          }
        }
      }

      // 3. Get reservations from estimates with holdStock enabled (RLS scopes)
      const estimateReservations = await db.query.insuranceEstimateItems.findMany({
        where: eq(insuranceEstimateItems.itemId, itemId),
        with: {
          estimate: {
            with: {
              customer: true,
              vehicle: true,
            },
          },
        },
      })

      const holdStockEstimateReservations = estimateReservations
        .filter(r => {
          const estimate = Array.isArray(r.estimate) ? r.estimate[0] : r.estimate
          return estimate?.holdStock === true &&
            !['cancelled', 'work_order_created'].includes(estimate?.status || '')
        })
        .map(r => {
          const estimate = Array.isArray(r.estimate) ? r.estimate[0] : r.estimate
          const customer = estimate ? (Array.isArray(estimate.customer) ? estimate.customer[0] : estimate.customer) : null
          const vehicle = estimate ? (Array.isArray(estimate.vehicle) ? estimate.vehicle[0] : estimate.vehicle) : null
          return {
            id: r.id,
            type: 'estimate' as const,
            quantity: parseFloat(r.quantity || '0'),
            referenceId: r.estimateId,
            referenceNo: estimate?.estimateNo || 'Estimate',
            customer: customer?.name || 'Walk-in',
            vehicle: vehicle
              ? `${vehicle.licensePlate ? `[${vehicle.licensePlate}] ` : ''}${vehicle.year || ''} ${vehicle.make} ${vehicle.model}`.trim()
              : null,
            createdAt: estimate?.createdAt,
          }
        })

      // Combine all reservations
      const allReservations = [
        ...draftWorkOrderReservations,
        ...heldSaleReservations,
        ...holdStockEstimateReservations,
      ]

      const totalReserved = allReservations.reduce(
        (sum, r) => sum + r.quantity,
        0
      )

      // Get aggregated stock from all warehouses (RLS scopes)
      const [stockData] = await db
        .select({
          totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
        })
        .from(warehouseStock)
        .where(eq(warehouseStock.itemId, itemId))
      const currentStock = stockData?.totalStock || '0'

      return NextResponse.json({
        item: {
          id: item.id,
          name: item.name,
          currentStock,
        },
        totalReserved,
        availableStock: Math.max(0, Math.round((parseFloat(currentStock) - totalReserved) * 100) / 100),
        reservations: allReservations,
      })
    })
  } catch (error) {
    logError('api/items/[id]/reservations', error)
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}
