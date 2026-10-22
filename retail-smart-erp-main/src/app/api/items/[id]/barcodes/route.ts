import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { items } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { replaceItemBarcodesSchema } from '@/lib/validation/schemas/pricing'
import { CatalogValidationError, listItemBarcodes, replaceItemBarcodes } from '@/lib/pricing/catalog'
import { toApiError } from '@/lib/db/errors'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'

// GET /api/items/[id]/barcodes — additional barcodes of an item (items.barcode stays the primary)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenantId = session.user.tenantId
    return await withTenant(tenantId, async (db) => NextResponse.json(await listItemBarcodes(db, tenantId, p.data.id)))
  } catch (error) {
    logError('api/items/[id]/barcodes', error)
    return NextResponse.json({ error: 'Failed to fetch barcodes' }, { status: 500 })
  }
}

// PUT /api/items/[id]/barcodes { barcodes: [{ barcode, uom?, packQty?, priceOverride?, label? }] } — replace all
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, replaceItemBarcodesSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId
    const itemId = p.data.id

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const [item] = await tx.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.id, itemId)).for('update')
      if (!item) return null
      await replaceItemBarcodes(tx, tenantId, itemId, item.unit, parsed.data.barcodes)
      // offline catalogs re-download the item on their next delta sync
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, itemId))
      return { item, barcodes: await listItemBarcodes(tx, tenantId, itemId) }
    })
    if (!result) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    logAndBroadcast(tenantId, 'item', 'updated', itemId, { userId: session!.user.id, entityName: result.item.name })
    return NextResponse.json(result.barcodes)
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 })
    }
    const mapped = toApiError(error)
    if (mapped) return mapped
    logError('api/items/[id]/barcodes', error)
    return NextResponse.json({ error: 'Failed to save barcodes' }, { status: 500 })
  }
}
