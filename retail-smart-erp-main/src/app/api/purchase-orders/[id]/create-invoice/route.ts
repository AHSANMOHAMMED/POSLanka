import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems, purchases, purchaseItems, suppliers, warehouseStock, stockMovements } from '@/lib/db/schema'
import { eq, and, ilike, desc, sql } from 'drizzle-orm'
import { roundCurrency } from '@/lib/utils/currency'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { postPurchaseToGL } from '@/lib/accounting/auto-post'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createPurchaseInvoiceSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Generate purchase number with transaction lock
async function generatePurchaseNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `PI-${dateStr}-`

  // RLS filters by tenant
  const existing = await tx
    .select({ purchaseNo: purchases.purchaseNo })
    .from(purchases)
    .where(ilike(purchases.purchaseNo, `${prefix}%`))
    .orderBy(desc(purchases.purchaseNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].purchaseNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

// POST create invoice from purchase order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, createPurchaseInvoiceSchema)
  if (!parsed.success) return parsed.response
  const { supplierInvoiceNo, supplierBillDate, paymentTerm, notes, costCenterId, updateStock, receivedQuantities } = parsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Get purchase order with lock to prevent double invoicing (RLS filters by tenant)
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .for('update')

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    // Allow invoice creation from confirmed, partially_received, or fully_received statuses
    const allowedForInvoice = ['confirmed', 'partially_received', 'fully_received']
    if (!allowedForInvoice.includes(order.status)) {
      return { error: NextResponse.json({
        error: `Only confirmed or received orders can be converted to invoices. Current status: ${order.status}`
      }, { status: 400 }) }
    }

    // Issue #43: Check if non-cancelled invoice already exists for this PO
    const [existingInvoice] = await tx
      .select({ id: purchases.id, purchaseNo: purchases.purchaseNo, status: purchases.status })
      .from(purchases)
      .where(and(
        eq(purchases.purchaseOrderId, id),
        sql`${purchases.status} != 'cancelled'`
      ))

    if (existingInvoice) {
      return { error: NextResponse.json({
        error: `Invoice ${existingInvoice.purchaseNo} already exists for this purchase order`,
        existingInvoiceId: existingInvoice.id
      }, { status: 400 }) }
    }

    // Check if stock was already updated during receiving (prevent double stock update)
    if (updateStock) {
      const [existingStockMovement] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(and(
          eq(stockMovements.referenceType, 'purchase_order_receive'),
          eq(stockMovements.referenceId, id)
        ))
        .limit(1)

      if (existingStockMovement) {
        return { error: NextResponse.json({
          error: 'Stock was already updated during receiving. Cannot update stock again during invoice creation.',
          code: 'STOCK_ALREADY_UPDATED'
        }, { status: 400 }) }
      }
    }

    // Get PO items
    const orderItems = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, id))

    if (orderItems.length === 0) {
      return { error: NextResponse.json({ error: 'Purchase order has no items' }, { status: 400 }) }
    }

    // Generate purchase number with lock
    const purchaseNo = await generatePurchaseNo(tx)

    // Issue #37: Validate received quantities before processing
    if (receivedQuantities) {
      for (const item of orderItems) {
        const receivedQty = receivedQuantities[item.id] !== undefined
          ? parseFloat(receivedQuantities[item.id])
          : 0
        if (receivedQty < 0) {
          return { error: NextResponse.json({ error: `Received quantity cannot be negative for ${item.itemName}` }, { status: 400 }) }
        }
        const orderedQty = parseFloat(item.quantity)
        const previouslyReceived = parseFloat(item.receivedQuantity || '0')
        const maxReceivable = orderedQty - previouslyReceived
        if (receivedQty > maxReceivable) {
          return { error: NextResponse.json({ error: `Received quantity (${receivedQty}) exceeds remaining receivable quantity (${maxReceivable}) for ${item.itemName}` }, { status: 400 }) }
        }
      }
    }

    // Calculate totals, optionally using received quantities
    let subtotal = 0
    let taxAmount = 0
    const invoiceItems = orderItems.map(item => {
      const receivedQty = receivedQuantities?.[item.id] !== undefined
        ? parseFloat(receivedQuantities[item.id])
        : parseFloat(item.receivedQuantity || '0')

      const unitPrice = parseFloat(item.unitPrice)
      const orderedQty = parseFloat(item.quantity)
      const itemTax = roundCurrency(orderedQty > 0 ? parseFloat(item.tax) * (receivedQty / orderedQty) : 0)
      const lineSubtotal = roundCurrency(receivedQty * unitPrice)
      const itemTotal = roundCurrency(lineSubtotal + itemTax)

      subtotal += lineSubtotal
      taxAmount += itemTax

      return {
        tenantId: session.user.tenantId,
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: receivedQty.toString(),
        unitPrice: item.unitPrice,
        tax: itemTax.toString(),
        total: itemTotal.toString(),
        purchaseOrderItemId: item.id,
      }
    }).filter(item => parseFloat(item.quantity) > 0)

    if (invoiceItems.length === 0) {
      return { error: NextResponse.json({ error: 'No items to receive (all quantities are 0)' }, { status: 400 }) }
    }

    subtotal = roundCurrency(subtotal)
    taxAmount = roundCurrency(taxAmount)
    let total = roundCurrency(subtotal + taxAmount)

    // Dual mode: try template-based tax recalculation
    const lineItems = invoiceItems.map(item => ({
      itemId: item.itemId,
      lineTotal: parseFloat(item.quantity) * parseFloat(item.unitPrice),
    }))
    const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })
    let invoiceTaxBreakdown: typeof taxResult.taxBreakdown | null = null

    if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
      // Template configured — override with computed values
      subtotal = taxResult.subtotal
      taxAmount = taxResult.totalTax
      total = taxResult.total
      invoiceTaxBreakdown = taxResult.taxBreakdown
    }

    // Create purchase invoice
    const [newPurchase] = await tx.insert(purchases).values({
      tenantId: session.user.tenantId,
      purchaseNo,
      purchaseOrderId: id,
      supplierId: order.supplierId,
      warehouseId: order.warehouseId,
      supplierInvoiceNo: supplierInvoiceNo || null,
      supplierBillDate: supplierBillDate || null,
      paymentTerm: paymentTerm || 'credit',
      subtotal: subtotal.toString(),
      taxAmount: taxAmount.toString(),
      taxBreakdown: invoiceTaxBreakdown,
      total: total.toString(),
      paidAmount: '0',
      status: 'pending',
      costCenterId: costCenterId || null,
      notes: notes || null,
      createdBy: session.user.id,
    }).returning()

    // Add invoice items
    const purchaseItemsData = invoiceItems.map(item => ({
      ...item,
      purchaseId: newPurchase.id,
    }))
    await tx.insert(purchaseItems).values(purchaseItemsData)

    // Update supplier balance
    if (total > 0) {
      await tx.update(suppliers)
        .set({ balance: sql`${suppliers.balance} + ${total}` })
        .where(eq(suppliers.id, order.supplierId))
    }

    // Post purchase GL entries (Dr Stock/Inventory, Dr Tax, Cr Accounts Payable)
    await postPurchaseToGL(tx, session.user.tenantId, {
      purchaseId: newPurchase.id,
      invoiceNumber: purchaseNo,
      purchaseDate: new Date().toISOString().split('T')[0],
      subtotal,
      tax: taxAmount,
      taxBreakdown: invoiceTaxBreakdown || undefined,
      discount: 0,
      total,
      amountPaid: 0,
      supplierId: order.supplierId || null,
      costCenterId: costCenterId || null,
    })

    // Update stock if requested
    if (updateStock && order.warehouseId) {
      for (const item of invoiceItems) {
        if (item.itemId) {
          const qty = parseFloat(item.quantity)

          const [existingStock] = await tx
            .select()
            .from(warehouseStock)
            .where(and(
              eq(warehouseStock.warehouseId, order.warehouseId),
              eq(warehouseStock.itemId, item.itemId)
            ))
            .for('update')

          if (existingStock) {
            await tx.update(warehouseStock)
              .set({
                currentStock: sql`${warehouseStock.currentStock} + ${qty}`,
                updatedAt: new Date(),
              })
              .where(eq(warehouseStock.id, existingStock.id))
          } else {
            await tx.insert(warehouseStock).values({
              tenantId: session.user.tenantId,
              warehouseId: order.warehouseId,
              itemId: item.itemId,
              currentStock: qty.toString(),
            })
          }

          await tx.insert(stockMovements).values({
            tenantId: session.user.tenantId,
            warehouseId: order.warehouseId,
            itemId: item.itemId,
            type: 'in',
            quantity: qty.toString(),
            notes: `Purchase Invoice ${purchaseNo} (from PO ${order.orderNo})`,
            referenceType: 'purchase',
            referenceId: newPurchase.id,
            createdBy: session.user.id,
          })
        }
      }
    }

    // Issue #38: Update received quantities cumulatively on PO items
    for (const item of orderItems) {
      const receivedQty = receivedQuantities?.[item.id] !== undefined
        ? parseFloat(receivedQuantities[item.id])
        : 0

      if (receivedQty <= 0) continue

      const previouslyReceived = parseFloat(item.receivedQuantity || '0')
      const newCumulative = previouslyReceived + receivedQty

      await tx.update(purchaseOrderItems)
        .set({ receivedQuantity: newCumulative.toString() })
        .where(eq(purchaseOrderItems.id, item.id))
    }

    // Update PO status
    await tx.update(purchaseOrders)
      .set({ status: 'invoice_created', updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))

    // Broadcast changes
    logAndBroadcast(session.user.tenantId, 'purchase', 'created', newPurchase.id)
    logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id)
    logAndBroadcast(session.user.tenantId, 'supplier', 'updated', order.supplierId)
    if (updateStock) {
      logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', 'bulk')
    }

    return {
      data: {
        purchase: newPurchase,
        message: `Invoice ${newPurchase.purchaseNo} created successfully`,
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
