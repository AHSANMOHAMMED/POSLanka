import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { supplierQuotations, supplierQuotationItems } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addQuotationItemSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, addQuotationItemSchema)
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
    if (quotation.status !== 'draft' && quotation.status !== 'received') {
      return { error: NextResponse.json({ error: 'Can only modify items on draft or received quotations' }, { status: 400 }) }
    }

    const itemTotal = (body.quantity || 0) * (body.unitPrice || 0)
    const itemTax = body.tax || 0

    const [item] = await tx.insert(supplierQuotationItems).values({
      tenantId: session.user.tenantId,
      quotationId: id,
      itemId: body.itemId || null,
      itemName: body.itemName,
      quantity: body.quantity.toString(),
      unitPrice: (body.unitPrice || 0).toFixed(2),
      tax: itemTax.toFixed(2),
      total: (itemTotal + itemTax).toFixed(2),
      deliveryDays: body.deliveryDays || null,
      notes: body.notes || null,
    }).returning()

    // Recalculate totals
    const [totals] = await tx
      .select({
        subtotal: sql<string>`COALESCE(SUM((quantity::numeric * unit_price::numeric)), 0)`,
        taxAmount: sql<string>`COALESCE(SUM(tax::numeric), 0)`,
        total: sql<string>`COALESCE(SUM(total::numeric), 0)`,
      })
      .from(supplierQuotationItems)
      .where(eq(supplierQuotationItems.quotationId, id))

    await tx.update(supplierQuotations)
      .set({
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        updatedAt: new Date(),
      })
      .where(eq(supplierQuotations.id, id))

    logAndBroadcast(session.user.tenantId, 'supplier-quotation', 'updated', id)
    return { data: item }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data, { status: 201 })
}
