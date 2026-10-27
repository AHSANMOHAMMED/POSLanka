import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, and } from 'drizzle-orm'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { quotations, quotationItems, quotationStatusEnum, tenants } from '@/lib/db/schema'
import { requireTenantFeature } from '@/lib/features/check'
import { validateBody } from '@/lib/validation/helpers'
import { createQuotationSchema, computeQuotation } from '@/lib/quotations/lines'
import { nextDocNo } from '@/lib/documents/numbering'
import { requirePermission, requireModule } from '@/lib/auth/roles'

export async function GET(request: NextRequest) {
  const result = await withAuthTenant(async (session, db) => {
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return { error: 'This module is switched off for your role', status: 403 }
    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Quotation module disabled', status: 403 as const }
    }

    const status = request.nextUrl.searchParams.get('status')
    if (status && !(quotationStatusEnum.enumValues as readonly string[]).includes(status)) {
      return { error: 'Invalid status filter', status: 400 as const }
    }
    const rows = await db.query.quotations.findMany({
      where: status
        ? and(
            eq(quotations.tenantId, session.user.tenantId),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            eq(quotations.status, status as any)
          )
        : eq(quotations.tenantId, session.user.tenantId),
      orderBy: [desc(quotations.createdAt)],
      limit: 100,
      with: { items: true },
    })
    return { rows }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ quotations: result.rows })
}

export async function POST(request: NextRequest) {
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'createSales')
    if (permError) return { response: permError }

    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Quotation module disabled', status: 403 as const }
    }

    const parsed = await validateBody(request, createQuotationSchema)
    if (!parsed.success) {
      const details = await parsed.response.json().catch(() => ({ error: 'Invalid request body' }))
      return { error: details, status: 400 as const }
    }

    // 0179: per-line units, tax rates and warranty; totals recomputed server-side
    const [tenantRow] = await db.select({ taxInclusive: tenants.taxInclusive }).from(tenants).where(eq(tenants.id, session.user.tenantId))
    const computed = computeQuotation(parsed.data.items, { taxInclusive: !!tenantRow?.taxInclusive, headerDiscount: parsed.data.discount })

    const nextNo = await nextDocNo(db, session.user.tenantId, 'quotation')

    const [quote] = await db
      .insert(quotations)
      .values({
        tenantId: session.user.tenantId,
        quotationNo: nextNo,
        customerId: parsed.data.customerId || null,
        customerName: parsed.data.customerName || null,
        customerPhone: parsed.data.customerPhone || null,
        customerEmail: parsed.data.customerEmail || null,
        notes: parsed.data.notes || null,
        validUntil: parsed.data.validUntil ? parsed.data.validUntil.slice(0, 10) : null,
        subtotal: String(computed.subtotal),
        discount: String(computed.discount),
        tax: String(computed.tax),
        total: String(computed.total),
        status: 'draft',
        createdBy: session.user.id,
      })
      .returning()

    await db.insert(quotationItems).values(
      computed.lines.map((line) => ({
        tenantId: session.user.tenantId,
        quotationId: quote.id,
        ...line,
      }))
    )

    return { quote }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('response' in result) return result.response
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.quote, { status: 201 })
}
