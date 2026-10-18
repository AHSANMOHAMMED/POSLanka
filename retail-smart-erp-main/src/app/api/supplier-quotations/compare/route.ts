import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { supplierQuotations, supplierQuotationItems, suppliers } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'

// GET - Compare quotations side by side
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quotationIds = searchParams.get('ids')?.split(',').filter(Boolean) || []
  const requisitionId = searchParams.get('requisitionId')

  // Validate UUID format for ID params
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (requisitionId && !UUID_RE.test(requisitionId)) {
    return NextResponse.json({ error: 'Invalid requisitionId format' }, { status: 400 })
  }
  for (const qId of quotationIds) {
    if (!UUID_RE.test(qId)) {
      return NextResponse.json({ error: 'Invalid quotation ID format' }, { status: 400 })
    }
  }

  if (quotationIds.length === 0 && !requisitionId) {
    return NextResponse.json({ error: 'Provide quotation ids or requisitionId' }, { status: 400 })
  }

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    let qIds = quotationIds

    // If requisitionId provided, find all quotations for that requisition
    if (requisitionId) {
      const quotations = await db.select({ id: supplierQuotations.id })
        .from(supplierQuotations)
        .where(eq(supplierQuotations.requisitionId, requisitionId))

      qIds = quotations.map(q => q.id)
    }

    if (qIds.length === 0) {
      return { quotations: [], comparison: [] }
    }

    // Get quotation headers
    const quotationHeaders = await db.select({
      id: supplierQuotations.id,
      quotationNo: supplierQuotations.quotationNo,
      supplierId: supplierQuotations.supplierId,
      supplierName: suppliers.name,
      status: supplierQuotations.status,
      validUntil: supplierQuotations.validUntil,
      deliveryDays: supplierQuotations.deliveryDays,
      paymentTerms: supplierQuotations.paymentTerms,
      subtotal: supplierQuotations.subtotal,
      taxAmount: supplierQuotations.taxAmount,
      total: supplierQuotations.total,
    })
      .from(supplierQuotations)
      .leftJoin(suppliers, eq(supplierQuotations.supplierId, suppliers.id))
      .where(inArray(supplierQuotations.id, qIds))

    // Get all items across all quotations
    const allItems = await db.select()
      .from(supplierQuotationItems)
      .where(inArray(supplierQuotationItems.quotationId, qIds))

    // Build comparison matrix: group by itemName
    const itemMap = new Map<string, {
      itemName: string
      itemId: string | null
      quotations: Record<string, {
        quotationId: string
        unitPrice: string
        quantity: string
        tax: string
        total: string
        deliveryDays: number | null
      }>
    }>()

    for (const item of allItems) {
      const key = item.itemId || item.itemName
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          itemName: item.itemName,
          itemId: item.itemId,
          quotations: {},
        })
      }
      itemMap.get(key)!.quotations[item.quotationId] = {
        quotationId: item.quotationId,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        tax: item.tax,
        total: item.total,
        deliveryDays: item.deliveryDays,
      }
    }

    // Mark best prices
    const comparison = Array.from(itemMap.values()).map(row => {
      const prices = Object.values(row.quotations).map(q => parseFloat(q.unitPrice))
      const bestPrice = Math.min(...prices)
      return {
        ...row,
        bestPrice: bestPrice.toFixed(2),
      }
    })

    return { quotations: quotationHeaders, comparison }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result)
}
