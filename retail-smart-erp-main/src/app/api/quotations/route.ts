import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, and } from 'drizzle-orm'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { quotations, quotationItems, quotationStatusEnum } from '@/lib/db/schema'
import { requireTenantFeature } from '@/lib/features/check'
import { z } from 'zod'
import { validateBody } from '@/lib/validation/helpers'
import { nextDocNo } from '@/lib/documents/numbering'
import { requirePermission } from '@/lib/auth/roles'

const itemSchema = z.object({
  itemId: z.string().uuid().optional().nullable(),
  itemName: z.string().min(1).max(255),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
})

const createSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(255).optional(),
  customerPhone: z.string().max(50).optional(),
  customerEmail: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
  validUntil: z.string().optional(),
  subtotal: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  items: z.array(itemSchema).min(1).max(200),
})

export async function GET(request: NextRequest) {
  const result = await withAuthTenant(async (session, db) => {
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

    const parsed = await validateBody(request, createSchema)
    if (!parsed.success) {
      const details = await parsed.response.json().catch(() => ({ error: 'Invalid request body' }))
      return { error: details, status: 400 as const }
    }

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
        validUntil: parsed.data.validUntil || null,
        subtotal: String(parsed.data.subtotal),
        discount: String(parsed.data.discount),
        tax: String(parsed.data.tax),
        total: String(parsed.data.total),
        status: 'draft',
        createdBy: session.user.id,
      })
      .returning()

    await db.insert(quotationItems).values(
      parsed.data.items.map((item) => ({
        tenantId: session.user.tenantId,
        quotationId: quote.id,
        itemId: item.itemId || null,
        itemName: item.itemName,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
        discount: String(item.discount),
        tax: String(item.tax),
        total: String(item.total),
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
