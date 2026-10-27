import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db/with-auth-tenant'
import { quotations, quotationItems, tenants } from '@/lib/db/schema'
import { requireTenantFeature } from '@/lib/features/check'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { updateQuotationSchema, quotationStatusChangeSchema, computeQuotation } from '@/lib/quotations/lines'
import { moveToRecycleBin } from '@/lib/recycle-bin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Statuses a quotation may be moved to from each status (converted / expired are set by the system). */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'accepted', 'rejected', 'cancelled'],
  sent: ['draft', 'accepted', 'rejected', 'cancelled'],
  accepted: ['sent', 'rejected', 'cancelled'],
  rejected: ['draft', 'sent'],
  expired: ['draft', 'cancelled'],
  cancelled: ['draft'],
  converted: [],
}

/** Header + items may be edited while the quote is still open. */
const EDITABLE_STATUSES = ['draft', 'sent', 'expired']

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
  }

  const result = await withAuthTenant(async (session, db) => {
    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Quotation module disabled', status: 403 as const }
    }

    const quotation = await db.query.quotations.findFirst({
      where: and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)),
      with: { items: true },
    })

    if (!quotation) {
      return { error: 'Quotation not found', status: 404 as const }
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, session.user.tenantId),
      columns: {
        name: true,
        legalName: true,
        businessId: true,
        email: true,
        phone: true,
        address: true,
        website: true,
        logoUrl: true,
        brn: true,
        taxId: true,
        currency: true,
        taxInclusive: true,
      },
    })

    return { quotation, tenant }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}

// PUT — edit an open quotation: header fields and (optionally) replace all items. Totals are recomputed.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
  }

  const result = await withAuthTenantTransaction(async (session, db) => {
    const permError = requirePermission(session, 'createSales')
    if (permError) return { response: permError }

    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) return { error: 'Quotation module disabled', status: 403 as const }

    const parsed = await validateBody(request, updateQuotationSchema)
    if (!parsed.success) return { response: parsed.response }
    const body = parsed.data

    const [existing] = await db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)))
      .for('update')
    if (!existing) return { error: 'Quotation not found', status: 404 as const }
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      return { error: `A ${existing.status} quotation cannot be edited`, status: 400 as const }
    }

    const update: Partial<typeof quotations.$inferInsert> = { updatedAt: new Date() }
    if (body.customerId !== undefined) update.customerId = body.customerId || null
    if (body.customerName !== undefined) update.customerName = body.customerName || null
    if (body.customerPhone !== undefined) update.customerPhone = body.customerPhone || null
    if (body.customerEmail !== undefined) update.customerEmail = body.customerEmail || null
    if (body.notes !== undefined) update.notes = body.notes || null
    if (body.validUntil !== undefined) update.validUntil = body.validUntil ? body.validUntil.slice(0, 10) : null
    // An expired quote edited with a new validity date is open again
    if (existing.status === 'expired' && update.validUntil) update.status = 'draft'

    if (body.items) {
      const [tenantRow] = await db.select({ taxInclusive: tenants.taxInclusive }).from(tenants).where(eq(tenants.id, session.user.tenantId))
      const computed = computeQuotation(body.items, { taxInclusive: !!tenantRow?.taxInclusive, headerDiscount: body.discount })
      update.subtotal = String(computed.subtotal)
      update.discount = String(computed.discount)
      update.tax = String(computed.tax)
      update.total = String(computed.total)
      await db.delete(quotationItems).where(eq(quotationItems.quotationId, id))
      await db.insert(quotationItems).values(
        computed.lines.map((line) => ({ tenantId: session.user.tenantId, quotationId: id, ...line }))
      )
    }

    const [updated] = await db.update(quotations).set(update).where(eq(quotations.id, id)).returning()
    return { quote: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('response' in result) return result.response
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.quote)
}

// PATCH { status } — sent / accepted / rejected / cancelled / back to draft
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
  }

  const result = await withAuthTenantTransaction(async (session, db) => {
    const permError = requirePermission(session, 'createSales')
    if (permError) return { response: permError }

    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) return { error: 'Quotation module disabled', status: 403 as const }

    const parsed = await validateBody(request, quotationStatusChangeSchema)
    if (!parsed.success) return { response: parsed.response }
    const next = parsed.data.status

    const [existing] = await db
      .select({ id: quotations.id, status: quotations.status })
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)))
      .for('update')
    if (!existing) return { error: 'Quotation not found', status: 404 as const }
    if (existing.status === next) return { quote: existing }
    if (!(STATUS_TRANSITIONS[existing.status] || []).includes(next)) {
      return { error: `Cannot change a ${existing.status} quotation to ${next}`, status: 400 as const }
    }

    const [updated] = await db
      .update(quotations)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(quotations.id, id))
      .returning()
    return { quote: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('response' in result) return result.response
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.quote)
}

// DELETE — drafts only; a copy is kept in the recycle bin (only a super admin restores it)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
  }

  const result = await withAuthTenantTransaction(async (session, db) => {
    const permError = requirePermission(session, 'createSales')
    if (permError) return { response: permError }

    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) return { error: 'Quotation module disabled', status: 403 as const }

    const [existing] = await db
      .select({ id: quotations.id, status: quotations.status })
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)))
      .for('update')
    if (!existing) return { error: 'Quotation not found', status: 404 as const }
    if (existing.status !== 'draft') {
      return { error: 'Only draft quotations can be deleted — cancel it instead', status: 400 as const }
    }

    await moveToRecycleBin(db, {
      tenantId: session.user.tenantId, entityType: 'quotation', entityId: id,
      userId: session.user.id, userName: session.user.name,
    })
    await db.delete(quotationItems).where(eq(quotationItems.quotationId, id))
    await db.delete(quotations).where(eq(quotations.id, id))
    return { success: true as const }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('response' in result) return result.response
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
