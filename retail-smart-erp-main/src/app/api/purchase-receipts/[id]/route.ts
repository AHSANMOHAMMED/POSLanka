import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseReceipts, purchaseReceiptItems, purchaseOrderItems, purchaseOrders, users } from '@/lib/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { notifyStockDecreased } from '@/lib/inventory/apply-stock-change'
import { reverseMovements, stockErrorResponse, type RecordedMovement, type StockChangeRecord } from '@/lib/purchasing/stock-cost'
import { logError } from '@/lib/ai/error-logger'
import { reversePurchaseCost } from '@/lib/purchasing/purchase-reversal'
import { unbilledGrnStock } from '@/lib/purchasing/grn-coverage'
import { reverseDocBatches } from '@/lib/purchasing/batch-receipt'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { deletePurchaseReceiptSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { reverseGLEntries, tenantToday } from '@/lib/accounting/gl'
import { activeLandedCostFor } from '@/lib/purchasing/landed-cost'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'
import { assertRecordBranch } from '@/lib/auth/branch-access'

// GET - Single purchase receipt detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { permError }

    const [receipt] = await db
      .select({
        id: purchaseReceipts.id,
        receiptNo: purchaseReceipts.receiptNo,
        purchaseOrderId: purchaseReceipts.purchaseOrderId,
        warehouseId: purchaseReceipts.warehouseId,
        supplierId: purchaseReceipts.supplierId,
        receiptDate: purchaseReceipts.receiptDate,
        status: purchaseReceipts.status,
        supplierInvoiceNo: purchaseReceipts.supplierInvoiceNo,
        supplierBillDate: purchaseReceipts.supplierBillDate,
        notes: purchaseReceipts.notes,
        receivedBy: purchaseReceipts.receivedBy,
        receivedByName: users.fullName,
        cancellationReason: purchaseReceipts.cancellationReason,
        cancelledAt: purchaseReceipts.cancelledAt,
        glPosted: purchaseReceipts.glPosted,
        createdAt: purchaseReceipts.createdAt,
        updatedAt: purchaseReceipts.updatedAt,
      })
      .from(purchaseReceipts)
      .leftJoin(users, eq(purchaseReceipts.receivedBy, users.id))
      .where(eq(purchaseReceipts.id, id))

    if (!receipt) return { notFound: true }

    const items = await db
      .select({
        id: purchaseReceiptItems.id,
        purchaseOrderItemId: purchaseReceiptItems.purchaseOrderItemId,
        itemId: purchaseReceiptItems.itemId,
        itemName: purchaseReceiptItems.itemName,
        quantityReceived: purchaseReceiptItems.quantityReceived,
        quantityAccepted: purchaseReceiptItems.quantityAccepted,
        quantityRejected: purchaseReceiptItems.quantityRejected,
        rejectionReason: purchaseReceiptItems.rejectionReason,
        notes: purchaseReceiptItems.notes,
        unitCost: purchaseReceiptItems.unitCost,
      })
      .from(purchaseReceiptItems)
      .where(eq(purchaseReceiptItems.receiptId, id))

    return { data: { ...receipt, items } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('permError' in result) return result.permError
  if ('notFound' in result) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  return NextResponse.json(result.data)
}

// DELETE - Cancel a purchase receipt (reverses stock and receivedQuantity)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, deletePurchaseReceiptSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  let result
  try {
    result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }
      // K4: documents of another branch are off limits to branch-restricted staff
      const branchDenied = await assertRecordBranch(session, tx, purchaseReceipts, id)
      if (branchDenied) return { error: branchDenied }

      // Lock the receipt
      const [receipt] = await tx
        .select()
        .from(purchaseReceipts)
        .where(eq(purchaseReceipts.id, id))
        .for('update')

      if (!receipt) {
        return { error: NextResponse.json({ error: 'Receipt not found' }, { status: 404 }) }
      }

      if (receipt.status === 'cancelled') {
        return { error: NextResponse.json({ error: 'Receipt is already cancelled' }, { status: 400 }) }
      }

      // Lock the PO (receipts / invoices of the same PO serialise on it)
      let poStatus: string | null = null
      if (receipt.purchaseOrderId) {
        const [po] = await tx.select({ status: purchaseOrders.status }).from(purchaseOrders)
          .where(eq(purchaseOrders.id, receipt.purchaseOrderId)).for('update')
        poStatus = po?.status ?? null
      }

      // Get receipt items
      const receiptItems = await tx
        .select()
        .from(purchaseReceiptItems)
        .where(eq(purchaseReceiptItems.receiptId, id))

      // Stock movements this receipt created. Receipts made with updateStock=false created
      // none, so stock is left untouched.
      //  - current receipts: movements keyed 'po-receive:<receiptId>:<poLineId>'
      //  - legacy receipts (no key): PO-receive movements written in the same
      //    transaction as the receipt (identical created_at = transaction now()).
      const recorded = await findReceiptMovements(tx, session.user.tenantId, receipt)

      // Goods already billed: a submitted supplier invoice of this PO took this receipt's
      // stock as its own (it did not receive it again). Taking the stock out now would leave
      // a billed invoice without goods — the invoice must be cancelled / returned first.
      const receiptQtyByItem = new Map<string, number>()
      for (const m of recorded) {
        if (m.qtyChange > 0) receiptQtyByItem.set(m.itemId, (receiptQtyByItem.get(m.itemId) || 0) + m.qtyChange)
      }
      if (receipt.purchaseOrderId && receiptQtyByItem.size > 0) {
        const unbilled = await unbilledGrnStock(tx, session.user.tenantId, receipt.purchaseOrderId)
        for (const [itemId, q] of receiptQtyByItem) {
          if ((unbilled.get(itemId) || 0) - q < -0.0005) {
            const name = receiptItems.find(ri => ri.itemId === itemId)?.itemName || itemId
            return { error: NextResponse.json({
              error: `Cannot cancel receipt ${receipt.receiptNo}: ${name} from this receipt is already billed on a supplier invoice. Cancel or return the invoice first.`,
              code: 'RECEIPT_ALREADY_INVOICED',
            }, { status: 400 }) }
          }
        }
      }

      // H3: a submitted landed cost voucher spread charges onto this receipt's goods: cancel it first
      const landed = await activeLandedCostFor(tx, 'grn', id)
      if (landed) {
        return { error: NextResponse.json({
          error: `Cannot cancel receipt ${receipt.receiptNo}: landed cost voucher ${landed.voucherNo} is allocated to it. Cancel the voucher first.`,
          code: 'HAS_LANDED_COST',
        }, { status: 400 }) }
      }

      // Reverse receivedQuantity on PO items
      for (const item of receiptItems) {
        if (item.purchaseOrderItemId) {
          await tx.update(purchaseOrderItems)
            .set({
              receivedQuantity: sql`GREATEST(0, ${purchaseOrderItems.receivedQuantity}::numeric - ${parseFloat(item.quantityReceived)})`,
            })
            .where(eq(purchaseOrderItems.id, item.purchaseOrderItemId))
        }
      }

      // Take the receipt out of the weighted-average cost (before the stock goes), using the
      // PO line prices it was costed at.
      if (receiptQtyByItem.size > 0) {
        const poLineIds = receiptItems.map(ri => ri.purchaseOrderItemId).filter((x): x is string => !!x)
        const poLines = poLineIds.length > 0
          ? await tx.select({ id: purchaseOrderItems.id, unitPrice: purchaseOrderItems.unitPrice })
            .from(purchaseOrderItems).where(inArray(purchaseOrderItems.id, poLineIds))
          : []
        const priceOf = new Map(poLines.map(l => [l.id, parseFloat(l.unitPrice || '0')]))
        const lines: { itemId: string; qty: number; unitPrice: number }[] = []
        const remaining = new Map(receiptQtyByItem)
        for (const ri of receiptItems) {
          if (!ri.itemId || !remaining.has(ri.itemId)) continue
          const q = Math.min(parseFloat(ri.quantityReceived), remaining.get(ri.itemId)!)
          if (!(q > 0)) continue
          remaining.set(ri.itemId, remaining.get(ri.itemId)! - q)
          lines.push({ itemId: ri.itemId, qty: q, unitPrice: ri.purchaseOrderItemId ? (priceOf.get(ri.purchaseOrderItemId) || 0) : 0 })
        }
        await reversePurchaseCost(tx, {
          tenantId: session.user.tenantId,
          purchaseId: receipt.id,
          purchaseNo: receipt.receiptNo,
          supplierId: receipt.supplierId,
          userId: session.user.id,
          action: 'cancel',
          lines,
          label: 'Goods receipt',
        })
      }

      const stockChanges: StockChangeRecord[] = await reverseMovements(tx, recorded, {
        tenantId: session.user.tenantId,
        referenceType: 'purchase_receipt_cancel',
        referenceId: id,
        keyPrefix: 'po-receive-cancel',
        notes: `Cancelled receipt ${receipt.receiptNo}`,
        userId: session.user.id,
        source: 'purchase',
      })
      // batch-tracked items: take the quantity back out of the batches this receipt filled
      await reverseDocBatches(tx, session.user.tenantId, 'grn', id)

      // H3: GRN posted Dr Stock / Cr SRBNB → reverse it (nothing billed: checked above)
      if (receipt.glPosted) {
        await reverseGLEntries(tx, session.user.tenantId, 'purchase_receipt', id, await tenantToday(session.user.tenantId))
      }

      // Update receipt status
      await tx.update(purchaseReceipts)
        .set({
          status: 'cancelled',
          cancellationReason: body.cancellationReason || null,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(purchaseReceipts.id, id))

      // Recalculate PO status if linked
      if (receipt.purchaseOrderId) {
        const poItems = await tx
          .select({
            quantity: purchaseOrderItems.quantity,
            receivedQuantity: purchaseOrderItems.receivedQuantity,
          })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.purchaseOrderId, receipt.purchaseOrderId))

        let totalOrdered = 0
        let totalReceived = 0
        for (const pi of poItems) {
          totalOrdered += parseFloat(pi.quantity)
          totalReceived += parseFloat(pi.receivedQuantity || '0')
        }

        type POStatus = 'draft' | 'confirmed' | 'submitted' | 'partially_received' | 'fully_received' | 'invoice_created' | 'cancelled'
        let newStatus: POStatus
        if (poStatus === 'cancelled' || poStatus === 'invoice_created') {
          // A cancelled PO stays cancelled; an invoiced PO keeps its invoice
          newStatus = poStatus
        } else if (totalReceived === 0) {
          newStatus = 'confirmed'
        } else if (totalReceived >= totalOrdered) {
          newStatus = 'fully_received'
        } else {
          newStatus = 'partially_received'
        }

        await tx.update(purchaseOrders)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(purchaseOrders.id, receipt.purchaseOrderId))

        logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', receipt.purchaseOrderId)
      }

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'purchase-receipt', 'updated', id)
      if (receipt.warehouseId) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', receipt.warehouseId)
      }

      return {
        data: { success: true, message: `Receipt ${receipt.receiptNo} cancelled` },
        stockChanges,
      }
    })
  } catch (err) {
    const apiError = stockErrorResponse(err, 'Cannot cancel receipt')
    if (apiError) return apiError
    logError('api/purchase-receipts/[id]', err)
    return NextResponse.json({ error: 'Failed to cancel purchase receipt' }, { status: 500 })
  }

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error

  notifyStockDecreased(result.stockChanges)

  return NextResponse.json(result.data)
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

/** Stock movements created by a purchase receipt (see DELETE for the matching rules). */
async function findReceiptMovements(
  tx: Parameters<typeof reverseMovements>[0],
  tenantId: string,
  receipt: { id: string; purchaseOrderId: string | null },
): Promise<RecordedMovement[]> {
  const keyPattern = `po-receive:${receipt.id}:%`
  const list = rowsOf<{ id: string; warehouse_id: string | null; item_id: string; qty_change: string }>(await tx.execute(sql`
    SELECT m.id, m.warehouse_id, m.item_id, m.qty_change
    FROM stock_movements m
    WHERE m.tenant_id = ${tenantId}
      AND m.reference_type = 'purchase_order_receive'
      AND (
        m.idempotency_key LIKE ${keyPattern}
        OR (
          m.idempotency_key IS NULL
          AND m.reference_id = ${receipt.purchaseOrderId}
          AND m.created_at = (SELECT r.created_at FROM purchase_receipts r WHERE r.id = ${receipt.id})
          AND m.item_id IN (
            SELECT ri.item_id FROM purchase_receipt_items ri
            WHERE ri.receipt_id = ${receipt.id} AND ri.item_id IS NOT NULL
          )
        )
      )
    ORDER BY m.created_at, m.id
  `))
  return list.map(m => ({ id: m.id, warehouseId: m.warehouse_id, itemId: m.item_id, qtyChange: parseFloat(m.qty_change) }))
}
