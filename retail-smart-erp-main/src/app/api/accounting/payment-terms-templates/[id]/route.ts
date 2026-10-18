import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentTermsTemplates, paymentTermsTemplateItems, paymentTerms } from '@/lib/db/schema'
import { eq, asc, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePaymentTermsTemplateSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const [template] = await db.select().from(paymentTermsTemplates).where(eq(paymentTermsTemplates.id, id))
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    // Fetch items with their payment terms
    const items = await db.select({
      id: paymentTermsTemplateItems.id,
      paymentTermId: paymentTermsTemplateItems.paymentTermId,
      sortOrder: paymentTermsTemplateItems.sortOrder,
      termName: paymentTerms.name,
      invoicePortion: paymentTerms.invoicePortion,
      dueDateBasedOn: paymentTerms.dueDateBasedOn,
      creditDays: paymentTerms.creditDays,
      discountType: paymentTerms.discountType,
      discount: paymentTerms.discount,
      discountValidityDays: paymentTerms.discountValidityDays,
    })
      .from(paymentTermsTemplateItems)
      .leftJoin(paymentTerms, eq(paymentTermsTemplateItems.paymentTermId, paymentTerms.id))
      .where(eq(paymentTermsTemplateItems.templateId, id))
      .orderBy(asc(paymentTermsTemplateItems.sortOrder))

    return NextResponse.json({ ...template, items })
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

    const parsed = await validateBody(request, updatePaymentTermsTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, isActive, items } = parsed.data

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (isActive !== undefined) updateData.isActive = isActive

    if (Object.keys(updateData).length > 0) {
      const [updated] = await db.update(paymentTermsTemplates).set(updateData).where(eq(paymentTermsTemplates.id, id)).returning()
      if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Replace items if provided
    if (items !== undefined) {
      // Validate portions sum to 100
      if (items.length > 0) {
        const termIds = items.map((i: { paymentTermId: string }) => i.paymentTermId)
        const terms = await db.select().from(paymentTerms).where(sql`${paymentTerms.id} IN ${termIds}`)
        const termMap = new Map(terms.map(t => [t.id, t]))
        let totalPortion = 0
        for (const item of items) {
          const term = termMap.get(item.paymentTermId)
          if (!term) return NextResponse.json({ error: `Payment term ${item.paymentTermId} not found` }, { status: 400 })
          totalPortion += Number(term.invoicePortion)
        }
        if (Math.abs(totalPortion - 100) > 0.01) {
          return NextResponse.json({ error: `Template portions must sum to 100%. Current sum: ${totalPortion}%` }, { status: 400 })
        }
      }

      // withAuthTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.
      // Delete existing and re-insert using the withAuthTenant db directly
      await db.delete(paymentTermsTemplateItems).where(eq(paymentTermsTemplateItems.templateId, id))
      if (items.length > 0) {
        await db.insert(paymentTermsTemplateItems).values(
          items.map((item: { paymentTermId: string; sortOrder?: number }, idx: number) => ({
            tenantId: session.user.tenantId,
            templateId: id,
            paymentTermId: item.paymentTermId,
            sortOrder: item.sortOrder ?? idx,
          }))
        )
      }
    }

    logAndBroadcast(session.user.tenantId, 'payment-terms-template', 'updated', id)

    // Return updated template with items
    const [template] = await db.select().from(paymentTermsTemplates).where(eq(paymentTermsTemplates.id, id))
    const updatedItems = await db.select({
      id: paymentTermsTemplateItems.id,
      paymentTermId: paymentTermsTemplateItems.paymentTermId,
      sortOrder: paymentTermsTemplateItems.sortOrder,
      termName: paymentTerms.name,
      invoicePortion: paymentTerms.invoicePortion,
      dueDateBasedOn: paymentTerms.dueDateBasedOn,
      creditDays: paymentTerms.creditDays,
    })
      .from(paymentTermsTemplateItems)
      .leftJoin(paymentTerms, eq(paymentTermsTemplateItems.paymentTermId, paymentTerms.id))
      .where(eq(paymentTermsTemplateItems.templateId, id))
      .orderBy(asc(paymentTermsTemplateItems.sortOrder))

    return NextResponse.json({ ...template, items: updatedItems })
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

    const [deleted] = await db.delete(paymentTermsTemplates).where(eq(paymentTermsTemplates.id, id)).returning()
    if (!deleted) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'payment-terms-template', 'deleted', id)
    return NextResponse.json({ success: true })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
