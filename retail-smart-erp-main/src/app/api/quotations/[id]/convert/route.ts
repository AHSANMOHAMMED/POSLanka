import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { withAuthTenantTransaction } from '@/lib/db/with-auth-tenant'
import { quotations, quotationItems } from '@/lib/db/schema'
import { requireTenantFeature } from '@/lib/features/check'

/**
 * Marks quotation as converted and returns cart payload for POS/sale creation.
 * Actual sale is created via POST /api/sales from the client with these lines.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const result = await withAuthTenantTransaction(async (session, db, _client) => {
    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Quotation module disabled', status: 403 as const }
    }

    const quote = await db.query.quotations.findFirst({
      where: and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)),
      with: { items: true },
    })
    if (!quote) {
      return { error: 'Quotation not found', status: 404 as const }
    }
    if (quote.status === 'converted') {
      return { error: 'Already converted', status: 400 as const }
    }
    if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
      await db
        .update(quotations)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(quotations.id, id))
      return { error: 'Quotation expired', status: 400 as const }
    }

    await db
      .update(quotations)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(eq(quotations.id, id))

    return {
      quotationId: quote.id,
      customerId: quote.customerId,
      customerName: quote.customerName,
      cartItems: quote.items.map((i: typeof quotationItems.$inferSelect) => ({
        itemId: i.itemId,
        name: i.itemName,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        discount: Number(i.discount),
        tax: Number(i.tax),
      })),
      subtotal: Number(quote.subtotal),
      discount: Number(quote.discount),
      tax: Number(quote.tax),
      total: Number(quote.total),
    }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
