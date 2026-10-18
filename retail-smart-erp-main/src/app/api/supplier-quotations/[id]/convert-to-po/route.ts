import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { supplierQuotations, supplierQuotationItems, purchaseOrders, purchaseOrderItems } from '@/lib/db/schema'
import { eq, ilike, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { convertQuotationToPOSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

async function generateOrderNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `PO-${dateStr}-`

  const existing = await tx
    .select({ orderNo: purchaseOrders.orderNo })
    .from(purchaseOrders)
    .where(ilike(purchaseOrders.orderNo, `${prefix}%`))
    .orderBy(desc(purchaseOrders.orderNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].orderNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

// POST - Convert awarded quotation to PO
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, convertQuotationToPOSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [quotation] = await tx.select()
      .from(supplierQuotations)
      .where(eq(supplierQuotations.id, id))
      .for('update')

    if (!quotation) return { error: NextResponse.json({ error: 'Quotation not found' }, { status: 404 }) }
    if (quotation.status !== 'received') {
      return { error: NextResponse.json({ error: 'Only received quotations can be converted to PO' }, { status: 400 }) }
    }

    const qItems = await tx.select()
      .from(supplierQuotationItems)
      .where(eq(supplierQuotationItems.quotationId, id))

    if (qItems.length === 0) {
      return { error: NextResponse.json({ error: 'Quotation has no items' }, { status: 400 }) }
    }

    const orderNo = await generateOrderNo(tx)

    // Recalculate tax using templates for PO (dual mode)
    const lineItems = qItems.map(item => ({
      itemId: item.itemId,
      lineTotal: parseFloat(item.quantity) * parseFloat(item.unitPrice),
    }))
    const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })

    // Use template values if available, otherwise carry SQ values
    const poSubtotal = (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0)
      ? taxResult.subtotal.toString() : quotation.subtotal
    const poTaxAmount = (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0)
      ? taxResult.totalTax.toString() : quotation.taxAmount
    const poTotal = (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0)
      ? taxResult.total.toString() : quotation.total
    const poTaxBreakdown = (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0)
      ? taxResult.taxBreakdown : (quotation.taxBreakdown || null)

    const [newOrder] = await tx.insert(purchaseOrders).values({
      tenantId: session.user.tenantId,
      orderNo,
      supplierId: quotation.supplierId,
      warehouseId: body.warehouseId,
      expectedDeliveryDate: body.expectedDeliveryDate || null,
      notes: body.notes || `Created from quotation ${quotation.quotationNo}`,
      status: 'draft',
      subtotal: poSubtotal,
      taxAmount: poTaxAmount,
      taxBreakdown: poTaxBreakdown,
      total: poTotal,
      createdBy: session.user.id,
    }).returning()

    await tx.insert(purchaseOrderItems).values(
      qItems.map((item, idx) => {
        const perItem = (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) ? taxResult.perItemTax[idx] : null
        return {
          tenantId: session.user.tenantId,
          purchaseOrderId: newOrder.id,
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          tax: item.tax, // Keep legacy flat amount
          taxRate: perItem ? perItem.taxRate.toString() : (item.taxRate || '0'),
          taxAmount: perItem ? perItem.taxAmount.toString() : (item.taxAmount || '0'),
          taxBreakdown: perItem?.taxBreakdown || item.taxBreakdown || null,
          total: item.total,
        }
      })
    )

    // Mark quotation as awarded
    await tx.update(supplierQuotations)
      .set({
        status: 'awarded',
        convertedToPOId: newOrder.id,
        updatedAt: new Date(),
      })
      .where(eq(supplierQuotations.id, id))

    logAndBroadcast(session.user.tenantId, 'supplier-quotation', 'updated', id)
    logAndBroadcast(session.user.tenantId, 'purchase-order', 'created', newOrder.id)

    return { data: { purchaseOrderId: newOrder.id, orderNo: newOrder.orderNo } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data, { status: 201 })
}
