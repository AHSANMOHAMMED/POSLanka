import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { withAuthTenantTransaction } from '@/lib/db/with-auth-tenant'
import { quotations, quotationItems } from '@/lib/db/schema'
import { requireTenantFeature } from '@/lib/features/check'
import { requirePermission } from '@/lib/auth/roles'
import { getTenantTimezone, localParts } from '@/lib/notifications/alert-settings'

/**
 * Marks quotation as converted and returns cart payload for POS/sale creation.
 * Actual sale is created via POST /api/sales from the client with these lines.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
  }

  const result = await withAuthTenantTransaction(async (session, db, _client) => {
    const permError = requirePermission(session, 'createSales')
    if (permError) return { response: permError }

    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Quotation module disabled', status: 403 as const }
    }

    // Lock the quotation row: two concurrent conversions must not both hand out the cart
    // (one quotation -> one sale).
    const [locked] = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)))
      .for('update')
    if (!locked) {
      return { error: 'Quotation not found', status: 404 as const }
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
    if (quote.status === 'cancelled' || quote.status === 'rejected') {
      return { error: `A ${quote.status} quotation cannot be converted`, status: 400 as const }
    }
    // "Valid until" is a calendar date in the shop's timezone: the quote is still valid for the
    // whole of that day (not only until 00:00 UTC = 05:30 in Colombo).
    const today = localParts(new Date(), await getTenantTimezone(session.user.tenantId)).date
    if (quote.validUntil && String(quote.validUntil).slice(0, 10) < today) {
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
  if ('response' in result) return result.response
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
