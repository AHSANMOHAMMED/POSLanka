import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { priceLists } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updatePriceListSchema } from '@/lib/validation/schemas/pricing'
import { isUniqueViolation } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'

// GET /api/price-lists/[id] — header + rules (with item code / name / base price)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenantId = session!.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [list] = await db.select().from(priceLists).where(eq(priceLists.id, p.data.id))
      if (!list) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
      const items = (await db.execute(sql`
        SELECT pli.id, pli.item_id AS "itemId", i.item_code AS "itemCode", i.name AS "itemName", i.barcode,
               i.unit AS "baseUnit", i.selling_price::text AS "basePrice", pli.uom, pli.min_qty::text AS "minQty",
               pli.price::text AS price, pli.discount_percent::text AS "discountPercent"
        FROM price_list_items pli JOIN items i ON i.id = pli.item_id
        WHERE pli.tenant_id = ${tenantId}::uuid AND pli.price_list_id = ${list.id}::uuid
        ORDER BY i.name, pli.uom NULLS FIRST, pli.min_qty
      `)).rows
      return NextResponse.json({ ...list, items })
    })
  } catch (error) {
    logError('api/price-lists/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch price list' }, { status: 500 })
  }
}

// PUT /api/price-lists/[id] — full header replace (rules: PUT /api/price-lists/[id]/items)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, updatePriceListSchema)
    if (!parsed.success) return parsed.response
    const d = parsed.data
    const [row] = await withTenantTransaction(session!.user.tenantId, (tx) => tx.update(priceLists).set({
      name: d.name,
      currency: d.currency || 'LKR',
      priority: d.priority ?? 0,
      isActive: d.isActive ?? true,
      validFrom: d.validFrom || null,
      validTo: d.validTo || null,
      appliesTo: d.appliesTo,
      customerTypes: d.appliesTo === 'customer_group' ? d.customerTypes || [] : [],
      customerIds: d.appliesTo === 'customers' ? d.customerIds || [] : [],
      posProfileIds: d.appliesTo === 'pos_profiles' ? d.posProfileIds || [] : [],
      notes: d.notes || null,
      updatedAt: new Date(),
    }).where(eq(priceLists.id, p.data.id)).returning())
    if (!row) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'A price list with this name already exists', code: 'DUPLICATE', field: 'name' }, { status: 409 })
    logError('api/price-lists/[id]', error)
    return NextResponse.json({ error: 'Failed to update price list' }, { status: 500 })
  }
}

// DELETE /api/price-lists/[id] — sales keep their price_list_id as a plain reference
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const [row] = await withTenantTransaction(session!.user.tenantId, (tx) =>
      tx.delete(priceLists).where(eq(priceLists.id, p.data.id)).returning({ id: priceLists.id }))
    if (!row) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/price-lists/[id]', error)
    return NextResponse.json({ error: 'Failed to delete price list' }, { status: 500 })
  }
}
