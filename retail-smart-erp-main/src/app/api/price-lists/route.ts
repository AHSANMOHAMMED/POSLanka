import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { priceLists } from '@/lib/db/schema'
import { and, desc, asc, eq, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createPriceListSchema, priceListsListSchema } from '@/lib/validation/schemas/pricing'
import { isUniqueViolation } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'

// GET /api/price-lists — product price lists (H5); not the SaaS /api/pricing tiers
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const parsed = validateSearchParams(request, priceListsListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all, includeInactive } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const conditions = []
      if (!includeInactive && !all) conditions.push(eq(priceLists.isActive, true))
      if (search) conditions.push(ilike(priceLists.name, `%${escapeLikePattern(search)}%`))
      const where = conditions.length ? and(...conditions) : undefined
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(priceLists).where(where)
      const rows = await db.select({
        id: priceLists.id, name: priceLists.name, currency: priceLists.currency, priority: priceLists.priority,
        isActive: priceLists.isActive, validFrom: priceLists.validFrom, validTo: priceLists.validTo,
        appliesTo: priceLists.appliesTo, customerTypes: priceLists.customerTypes, customerIds: priceLists.customerIds,
        posProfileIds: priceLists.posProfileIds, notes: priceLists.notes, updatedAt: priceLists.updatedAt,
        itemCount: sql<number>`(SELECT count(*)::int FROM price_list_items pli WHERE pli.price_list_id = "price_lists"."id")`,
      }).from(priceLists).where(where)
        .orderBy(desc(priceLists.priority), asc(priceLists.name))
        .limit(all ? 1000 : pageSize).offset(all ? 0 : (page - 1) * pageSize)
      if (all) return NextResponse.json(rows)
      return NextResponse.json({ data: rows, pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) } })
    })
  } catch (error) {
    logError('api/price-lists', error)
    return NextResponse.json({ error: 'Failed to fetch price lists' }, { status: 500 })
  }
}

// POST /api/price-lists
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const parsed = await validateBody(request, createPriceListSchema)
    if (!parsed.success) return parsed.response
    const d = parsed.data
    const tenantId = session!.user.tenantId
    const [row] = await withTenantTransaction(tenantId, (tx) => tx.insert(priceLists).values({
      tenantId,
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
      createdBy: session!.user.id,
    }).returning())
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'A price list with this name already exists', code: 'DUPLICATE', field: 'name' }, { status: 409 })
    logError('api/price-lists', error)
    return NextResponse.json({ error: 'Failed to create price list' }, { status: 500 })
  }
}
