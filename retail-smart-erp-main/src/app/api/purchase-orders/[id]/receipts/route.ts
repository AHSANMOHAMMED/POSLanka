import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseReceipts, purchaseReceiptItems, users, items as itemsTable } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - List all purchase receipts (GRN) for a purchase order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const receipts = await db
      .select({
        id: purchaseReceipts.id,
        receiptNo: purchaseReceipts.receiptNo,
        receiptDate: purchaseReceipts.receiptDate,
        status: purchaseReceipts.status,
        supplierInvoiceNo: purchaseReceipts.supplierInvoiceNo,
        supplierBillDate: purchaseReceipts.supplierBillDate,
        notes: purchaseReceipts.notes,
        receivedBy: purchaseReceipts.receivedBy,
        receivedByName: users.fullName,
        cancellationReason: purchaseReceipts.cancellationReason,
        cancelledAt: purchaseReceipts.cancelledAt,
        createdAt: purchaseReceipts.createdAt,
      })
      .from(purchaseReceipts)
      .leftJoin(users, eq(purchaseReceipts.receivedBy, users.id))
      .where(eq(purchaseReceipts.purchaseOrderId, id))
      .orderBy(desc(purchaseReceipts.createdAt))

    // Fetch items for each receipt
    const receiptsWithItems = await Promise.all(
      receipts.map(async (receipt) => {
        const items = await db
          .select({
            id: purchaseReceiptItems.id,
            itemId: purchaseReceiptItems.itemId,
            itemName: purchaseReceiptItems.itemName,
            itemSku: itemsTable.sku,
            itemBarcode: itemsTable.barcode,
            itemOemPartNumber: itemsTable.oemPartNumber,
            itemPluCode: itemsTable.pluCode,
            quantityReceived: purchaseReceiptItems.quantityReceived,
            quantityAccepted: purchaseReceiptItems.quantityAccepted,
            quantityRejected: purchaseReceiptItems.quantityRejected,
            rejectionReason: purchaseReceiptItems.rejectionReason,
            notes: purchaseReceiptItems.notes,
          })
          .from(purchaseReceiptItems)
          .leftJoin(itemsTable, eq(purchaseReceiptItems.itemId, itemsTable.id))
          .where(eq(purchaseReceiptItems.receiptId, receipt.id))

        const totalQtyReceived = items.reduce((sum, i) => sum + parseFloat(i.quantityReceived), 0)

        return {
          ...receipt,
          items,
          totalItems: items.length,
          totalQtyReceived,
        }
      })
    )

    return { data: receiptsWithItems }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  return NextResponse.json(result.data)
}
