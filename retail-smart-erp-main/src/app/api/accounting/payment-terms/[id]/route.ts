import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentTerms } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePaymentTermSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const [term] = await db.select().from(paymentTerms).where(eq(paymentTerms.id, id))
    if (!term) return NextResponse.json({ error: 'Payment term not found' }, { status: 404 })
    return NextResponse.json(term)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const parsed = await validateBody(request, updatePaymentTermSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const updateData: Record<string, unknown> = {}

    if (body.name !== undefined) updateData.name = body.name
    if (body.invoicePortion !== undefined) updateData.invoicePortion = String(body.invoicePortion)
    if (body.dueDateBasedOn !== undefined) updateData.dueDateBasedOn = body.dueDateBasedOn
    if (body.creditDays !== undefined) updateData.creditDays = body.creditDays
    if (body.discountType !== undefined) updateData.discountType = body.discountType || null
    if (body.discount !== undefined) updateData.discount = body.discount ? String(body.discount) : null
    if (body.discountValidityDays !== undefined) updateData.discountValidityDays = body.discountValidityDays || null
    if (body.description !== undefined) updateData.description = body.description || null
    if (body.isActive !== undefined) updateData.isActive = body.isActive

    const [updated] = await db.update(paymentTerms).set(updateData).where(eq(paymentTerms.id, id)).returning()
    if (!updated) return NextResponse.json({ error: 'Payment term not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'payment-term', 'updated', id)
    return NextResponse.json(updated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const [deleted] = await db.delete(paymentTerms).where(eq(paymentTerms.id, id)).returning()
    if (!deleted) return NextResponse.json({ error: 'Payment term not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'payment-term', 'deleted', id)
    return NextResponse.json({ success: true })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
