import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { supplierQuotations, supplierQuotationItems, suppliers, users, purchaseRequisitions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSupplierQuotationSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [quotation] = await db.select({
      id: supplierQuotations.id,
      quotationNo: supplierQuotations.quotationNo,
      supplierId: supplierQuotations.supplierId,
      supplierName: suppliers.name,
      requisitionId: supplierQuotations.requisitionId,
      requisitionNo: purchaseRequisitions.requisitionNo,
      status: supplierQuotations.status,
      validUntil: supplierQuotations.validUntil,
      deliveryDays: supplierQuotations.deliveryDays,
      paymentTerms: supplierQuotations.paymentTerms,
      subtotal: supplierQuotations.subtotal,
      taxAmount: supplierQuotations.taxAmount,
      total: supplierQuotations.total,
      supplierReference: supplierQuotations.supplierReference,
      notes: supplierQuotations.notes,
      convertedToPOId: supplierQuotations.convertedToPOId,
      cancellationReason: supplierQuotations.cancellationReason,
      cancelledAt: supplierQuotations.cancelledAt,
      createdBy: supplierQuotations.createdBy,
      createdByName: users.fullName,
      createdAt: supplierQuotations.createdAt,
      updatedAt: supplierQuotations.updatedAt,
    })
      .from(supplierQuotations)
      .leftJoin(suppliers, eq(supplierQuotations.supplierId, suppliers.id))
      .leftJoin(users, eq(supplierQuotations.createdBy, users.id))
      .leftJoin(purchaseRequisitions, eq(supplierQuotations.requisitionId, purchaseRequisitions.id))
      .where(eq(supplierQuotations.id, id))

    if (!quotation) return { notFound: true }

    const items = await db.select()
      .from(supplierQuotationItems)
      .where(eq(supplierQuotationItems.quotationId, id))

    return { data: { ...quotation, items } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('notFound' in result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(result.data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateSupplierQuotationSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const [existing] = await tx.select()
      .from(supplierQuotations)
      .where(eq(supplierQuotations.id, id))
      .for('update')

    if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updatedAt: new Date() }

    if (body.validUntil !== undefined) updates.validUntil = body.validUntil
    if (body.deliveryDays !== undefined) updates.deliveryDays = body.deliveryDays
    if (body.paymentTerms !== undefined) updates.paymentTerms = body.paymentTerms
    if (body.supplierReference !== undefined) updates.supplierReference = body.supplierReference
    if (body.notes !== undefined) updates.notes = body.notes

    if (body.status) {
      const validTransitions: Record<string, string[]> = {
        draft: ['submitted', 'cancelled'],
        submitted: ['received', 'cancelled'],
        received: ['awarded', 'rejected', 'cancelled'],
      }
      const allowed = validTransitions[existing.status] || []
      if (!allowed.includes(body.status)) {
        return { error: NextResponse.json({ error: `Cannot transition from ${existing.status} to ${body.status}` }, { status: 400 }) }
      }
      updates.status = body.status
      if (body.status === 'cancelled') {
        updates.cancellationReason = body.cancellationReason || null
        updates.cancelledAt = new Date()
      }
    }

    const [updated] = await tx.update(supplierQuotations)
      .set(updates)
      .where(eq(supplierQuotations.id, id))
      .returning()

    logAndBroadcast(session.user.tenantId, 'supplier-quotation', 'updated', id)
    return { data: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const [existing] = await tx.select()
      .from(supplierQuotations)
      .where(eq(supplierQuotations.id, id))

    if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    if (existing.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft quotations can be deleted' }, { status: 400 }) }
    }

    await tx.delete(supplierQuotations).where(eq(supplierQuotations.id, id))
    logAndBroadcast(session.user.tenantId, 'supplier-quotation', 'deleted', id)
    return { success: true }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json({ success: true })
}
