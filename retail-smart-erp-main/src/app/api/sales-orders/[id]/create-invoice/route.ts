import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { salesOrders, salesOrderItems, sales, saleItems, items as itemsTable, warehouseStock } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { roundCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { authWithCompany } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createSalesInvoiceSchema } from '@/lib/validation/schemas/sales'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'

// POST create sales invoice from sales order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, createSalesInvoiceSchema)
  if (!parsed.success) return parsed.response

  const { fulfilledQuantities, notes, costCenterId } = parsed.data

  let result
  try {

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  result = await withAuthTenantTransaction(async (session, tx) => {
    // Permission check
    const permError = requirePermission(session, 'createSales')
    if (permError) return { error: permError }
    // Get sales order with lock to prevent double invoicing (RLS filters by tenant)
    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, id))
      .for('update')

    if (!order) {
      return { error: NextResponse.json({ error: 'Sales order not found' }, { status: 404 }) }
    }

    // Allow invoice creation from confirmed or partially_fulfilled statuses
    const allowedForInvoice = ['confirmed', 'partially_fulfilled']
    if (!allowedForInvoice.includes(order.status)) {
      return { error: NextResponse.json({
        error: `Only confirmed or partially fulfilled orders can be converted to invoices. Current status: ${order.status}`
      }, { status: 400 }) }
    }

    // Get SO items
    const orderItems = await tx
      .select()
      .from(salesOrderItems)
      .where(eq(salesOrderItems.salesOrderId, id))

    if (orderItems.length === 0) {
      return { error: NextResponse.json({ error: 'Sales order has no items' }, { status: 400 }) }
    }

    // Validate fulfilled quantities
    if (fulfilledQuantities) {
      for (const item of orderItems) {
        const fulfillQty = fulfilledQuantities[item.id] !== undefined
          ? parseFloat(String(fulfilledQuantities[item.id]))
          : 0
        if (fulfillQty < 0) {
          return { error: NextResponse.json({ error: `Fulfilled quantity cannot be negative for ${item.itemName}` }, { status: 400 }) }
        }
        const orderedQty = parseFloat(item.quantity)
        const previouslyFulfilled = parseFloat(item.fulfilledQuantity || '0')
        const maxFulfillable = orderedQty - previouslyFulfilled
        if (fulfillQty > maxFulfillable) {
          return { error: NextResponse.json({ error: `Fulfilled quantity (${fulfillQty}) exceeds remaining fulfillable quantity (${maxFulfillable}) for ${item.itemName}` }, { status: 400 }) }
        }
      }
    }

    // Calculate invoice items and totals
    let subtotal = 0
    let totalDiscount = 0
    let totalTax = 0

    const invoiceItems = orderItems.map(item => {
      const orderedQty = parseFloat(item.quantity)
      const previouslyFulfilled = parseFloat(item.fulfilledQuantity || '0')
      const remaining = orderedQty - previouslyFulfilled

      // Use provided quantity or default to remaining
      const fulfillQty = fulfilledQuantities?.[item.id] !== undefined
        ? parseFloat(String(fulfilledQuantities[item.id]))
        : remaining

      const unitPrice = parseFloat(item.unitPrice)
      const ratio = orderedQty > 0 ? fulfillQty / orderedQty : 0
      const itemDiscount = roundCurrency(parseFloat(item.discount) * ratio)
      const itemTaxAmount = roundCurrency(parseFloat(item.taxAmount) * ratio)
      const lineSubtotal = roundCurrency(fulfillQty * unitPrice)
      const itemTotal = roundCurrency(lineSubtotal - itemDiscount + itemTaxAmount)

      subtotal += lineSubtotal
      totalDiscount += itemDiscount
      totalTax += itemTaxAmount

      return {
        tenantId: session.user.tenantId,
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: fulfillQty.toString(),
        unitPrice: item.unitPrice,
        discount: itemDiscount.toString(),
        discountType: item.discountType,
        tax: roundCurrency(parseFloat(item.tax) * ratio).toString(),
        taxAmount: itemTaxAmount.toString(),
        taxRate: item.taxRate,
        total: itemTotal.toString(),
        soItemId: item.id,
        fulfillQty,
      }
    }).filter(item => item.fulfillQty > 0)

    if (invoiceItems.length === 0) {
      return { error: NextResponse.json({ error: 'No items to fulfill (all quantities are 0)' }, { status: 400 }) }
    }

    subtotal = roundCurrency(subtotal)
    totalDiscount = roundCurrency(totalDiscount)
    totalTax = roundCurrency(totalTax)
    let total = roundCurrency(subtotal - totalDiscount + totalTax)

    // Dual mode: try template-based tax recalculation
    const lineItems = invoiceItems.map(item => ({
      itemId: item.itemId,
      lineTotal: parseFloat(item.quantity) * parseFloat(item.unitPrice),
    }))
    const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'sales' })
    let invoiceTaxBreakdown: typeof taxResult.taxBreakdown = null

    if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
      // Template configured — override with computed values
      subtotal = taxResult.subtotal
      totalTax = taxResult.totalTax
      total = roundCurrency(subtotal - totalDiscount + totalTax)
      invoiceTaxBreakdown = taxResult.taxBreakdown
    }

    // Invoice number (INV-NNNNNN) from the per-tenant sequence (shared with POS sales)
    const invoiceNo = await nextDocumentNumber(tx, session.user.tenantId, 'invoice')

    // Create sales invoice (sale record) with salesOrderId
    const [newSale] = await tx.insert(sales).values({
      tenantId: session.user.tenantId,
      invoiceNo,
      salesOrderId: id,
      customerId: order.customerId,
      vehicleId: order.vehicleId,
      warehouseId: order.warehouseId,
      customerName: order.customerName,
      vehiclePlate: order.vehiclePlate,
      vehicleDescription: order.vehicleDescription,
      subtotal: subtotal.toString(),
      discountAmount: totalDiscount.toString(),
      taxAmount: totalTax.toString(),
      taxBreakdown: invoiceTaxBreakdown,
      total: total.toString(),
      paidAmount: '0',
      status: 'pending',
      costCenterId: costCenterId || null,
      notes: notes || `Created from SO ${order.orderNo}`,
      createdBy: session.user.id,
    }).returning()

    // Create sale items
    const saleItemsData = invoiceItems.map(item => ({
      tenantId: session.user.tenantId,
      saleId: newSale.id,
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      discountType: item.discountType,
      tax: item.tax,
      taxAmount: item.taxAmount,
      taxRate: item.taxRate,
      total: item.total,
    }))
    await tx.insert(saleItems).values(saleItemsData)

    // Deduct stock and update reserved stock
    const stockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
    for (const item of invoiceItems) {
      if (!item.itemId) continue

      // Check if item tracks stock
      const [itemRecord] = await tx
        .select({ trackStock: itemsTable.trackStock })
        .from(itemsTable)
        .where(eq(itemsTable.id, item.itemId))

      if (!itemRecord?.trackStock) continue

      const qty = item.fulfillQty
      if (!(qty > 0)) continue

      // Single stock writer (locks, enforces non-negative, signed ledger row)
      const input: StockChangeInput = {
        tenantId: session.user.tenantId,
        warehouseId: order.warehouseId,
        itemId: item.itemId,
        mode: 'delta',
        qty: -qty,
        type: 'out',
        referenceType: 'sale',
        referenceId: newSale.id,
        notes: `Sales Invoice ${invoiceNo} (from SO ${order.orderNo})`,
        userId: session.user.id,
        source: 'sales_order',
        costCenterId: costCenterId || null,
        idempotencyKey: `so-invoice:${newSale.id}:${item.soItemId}`,
      }
      const change = await applyStockChange(tx, input)
      stockChanges.push({ result: change, input })

      // Release the reservation made when the SO was confirmed (not ledgered)
      await tx.update(warehouseStock)
        .set({
          reservedStock: sql`GREATEST(${warehouseStock.reservedStock} - ${qty}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(warehouseStock.id, change.warehouseStockId))
    }

    // Update fulfilled quantities cumulatively on SO items
    for (const item of invoiceItems) {
      const previouslyFulfilled = parseFloat(
        orderItems.find(oi => oi.id === item.soItemId)?.fulfilledQuantity || '0'
      )
      const newCumulative = previouslyFulfilled + item.fulfillQty

      await tx.update(salesOrderItems)
        .set({ fulfilledQuantity: newCumulative.toString() })
        .where(eq(salesOrderItems.id, item.soItemId))
    }

    // Determine new SO status
    // Re-read items to check fulfillment
    const updatedItems = await tx
      .select()
      .from(salesOrderItems)
      .where(eq(salesOrderItems.salesOrderId, id))

    const allFulfilled = updatedItems.every(item =>
      parseFloat(item.fulfilledQuantity || '0') >= parseFloat(item.quantity)
    )

    const newStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled'

    await tx.update(salesOrders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(salesOrders.id, id))

    // Broadcast changes
    logAndBroadcast(session.user.tenantId, 'sale', 'created', newSale.id)
    logAndBroadcast(session.user.tenantId, 'sales-order', 'updated', id)
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', 'bulk')

    return {
      data: {
        sale: newSale,
        message: `Invoice ${newSale.invoiceNo} created successfully`,
      },
      stockChanges,
    }
  })

  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('INSUFFICIENT_STOCK:')) {
      const detail = message.replace('INSUFFICIENT_STOCK:', '')
      return NextResponse.json({ error: `Insufficient stock: ${detail}`, code: 'INSUFFICIENT_STOCK' }, { status: 400 })
    }
    const stockError = stockErrorResponse(error)
    if (stockError) return stockError
    logError('api/sales-orders/[id]/create-invoice', error)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  notifyStockDecreased(result.stockChanges)
  return NextResponse.json(result.data)
}
