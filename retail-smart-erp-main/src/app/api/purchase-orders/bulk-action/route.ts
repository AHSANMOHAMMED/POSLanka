import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { purchaseOrders, purchaseOrderItems } from '@/lib/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation/helpers'
import { purchaseOrderBulkActionSchema } from '@/lib/validation/schemas/purchases'

// Valid status transitions (same as single PO route)
const validTransitions: Record<string, string[]> = {
  'draft': ['submitted', 'cancelled'],
  'submitted': ['confirmed', 'cancelled'],
  'confirmed': ['cancelled'],
  'partially_received': ['cancelled'],
  'fully_received': ['cancelled'],
  'invoice_created': ['cancelled'],
  'cancelled': [],
}

// POST - Bulk action on purchase orders
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, purchaseOrderBulkActionSchema)
  if (!parsed.success) return parsed.response
  const { action, orderIds, cancellationReason } = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    // Fetch all selected orders
    const orders = await tx.select({
      id: purchaseOrders.id,
      orderNo: purchaseOrders.orderNo,
      status: purchaseOrders.status,
    })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, orderIds))

    let processed = 0
    const errors: string[] = []
    const skipped: string[] = []

    for (const order of orders) {
      try {
        if (action === 'delete') {
          // Only draft orders can be deleted
          if (order.status !== 'draft') {
            errors.push(`${order.orderNo}: can only delete draft orders`)
            continue
          }

          await tx.delete(purchaseOrderItems)
            .where(eq(purchaseOrderItems.purchaseOrderId, order.id))
          await tx.delete(purchaseOrders)
            .where(eq(purchaseOrders.id, order.id))

          logAndBroadcast(session.user.tenantId, 'purchase-order', 'deleted', order.id)
          processed++
          continue
        }

        // Map action to target status
        const targetStatus = action === 'submit' ? 'submitted'
          : action === 'confirm' ? 'confirmed'
          : 'cancelled'

        // Check valid transition
        const allowed = validTransitions[order.status] || []
        if (!allowed.includes(targetStatus)) {
          skipped.push(`${order.orderNo}: cannot ${action} from "${order.status}"`)
          continue
        }

        // For submit: check items exist
        if (action === 'submit') {
          const [{ count }] = await tx.select({ count: sql<number>`count(*)` })
            .from(purchaseOrderItems)
            .where(eq(purchaseOrderItems.purchaseOrderId, order.id))
          if (Number(count) === 0) {
            errors.push(`${order.orderNo}: no items`)
            continue
          }
        }

        // Build update
        const updateData: Record<string, unknown> = {
          status: targetStatus,
          updatedAt: new Date(),
        }

        if (action === 'confirm') {
          updateData.approvedBy = session.user.id
          updateData.approvedAt = new Date()
        }

        if (action === 'cancel') {
          updateData.cancellationReason = cancellationReason || `Bulk cancelled`
          updateData.cancelledAt = new Date()
        }

        await tx.update(purchaseOrders)
          .set(updateData)
          .where(eq(purchaseOrders.id, order.id))

        logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', order.id, {
          userId: session.user.id,
          entityName: order.orderNo,
          activityAction: action === 'cancel' ? 'cancel' : 'update',
          description: `Bulk ${action}: ${order.orderNo} → ${targetStatus}`,
        })

        processed++
      } catch {
        errors.push(`${order.orderNo}: action failed`)
      }
    }

    // Check for missing orders
    const foundIds = new Set(orders.map(o => o.id))
    const missing = orderIds.filter(id => !foundIds.has(id))
    if (missing.length > 0) {
      errors.push(`${missing.length} order(s) not found`)
    }

    return { data: { processed, total: orderIds.length, errors, skipped } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
