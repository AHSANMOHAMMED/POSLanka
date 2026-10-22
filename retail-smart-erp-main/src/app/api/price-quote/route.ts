import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { validateBody } from '@/lib/validation/helpers'
import { priceQuoteSchema } from '@/lib/validation/schemas/pricing'
import { canSyncCatalog } from '@/lib/inventory/item-sync'
import { quoteCart, PricingLineError } from '@/lib/pricing/load-context'
import { logError } from '@/lib/ai/error-logger'

// POST /api/price-quote — price a cart with the tenant's price lists and promotions (H5 engine,
// src/lib/pricing/engine.ts). Base prices come from the catalog, never from the client; a line's
// unitPrice is only used with priceLocked (scale label / barcode price override).
// Body: { customerId?, posProfileId?, couponCodes?, at?, lines: [{ key?, itemId, quantity, uom?, unitPrice?, priceLocked? }] }
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canSyncCatalog(session)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    const parsed = await validateBody(request, priceQuoteSchema)
    if (!parsed.success) return parsed.response
    const { at, ...input } = parsed.data
    // pricing another moment (what-if / back-dated orders) is for item managers only
    if (at && requirePermission(session, 'manageItems')) {
      return NextResponse.json({ error: 'Insufficient permissions to price another date' }, { status: 403 })
    }
    const tenantId = session.user.tenantId
    const result = await withTenant(tenantId, (db) => quoteCart(db, tenantId, {
      ...input,
      customerId: input.customerId || null,
      posProfileId: input.posProfileId || null,
      at: at ? new Date(at) : undefined,
    }))
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PricingLineError) {
      const message = error.code === 'ITEM_NOT_FOUND' ? 'Item not found' : `Item has no "${error.uom}" unit`
      return NextResponse.json({ error: message, code: error.code, itemId: error.itemId }, { status: 400 })
    }
    logError('api/price-quote', error)
    return NextResponse.json({ error: 'Failed to price cart' }, { status: 500 })
  }
}
