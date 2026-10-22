import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { promotions } from '@/lib/db/schema'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createPromotionSchema, promotionsListSchema } from '@/lib/validation/schemas/pricing'
import { promotionValues } from '@/lib/pricing/promotion-values'
import { promotionLabel } from '@/lib/pricing/engine'
import { toPromotionRuleFromRow } from '@/lib/pricing/promotion-rule'
import { isUniqueViolation } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'

// GET /api/promotions
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const parsed = validateSearchParams(request, promotionsListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all, includeInactive } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const conditions = []
      if (!includeInactive && !all) conditions.push(eq(promotions.isActive, true))
      if (search) {
        const s = `%${escapeLikePattern(search)}%`
        conditions.push(or(ilike(promotions.name, s), ilike(promotions.couponCode, s)))
      }
      const where = conditions.length ? and(...conditions) : undefined
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(promotions).where(where)
      const rows = await db.select().from(promotions).where(where)
        .orderBy(desc(promotions.isActive), desc(promotions.priority), asc(promotions.name))
        .limit(all ? 1000 : pageSize).offset(all ? 0 : (page - 1) * pageSize)
      const data = rows.map((r) => ({ ...r, label: promotionLabel(toPromotionRuleFromRow(r)) }))
      if (all) return NextResponse.json(data)
      return NextResponse.json({ data, pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) } })
    })
  } catch (error) {
    logError('api/promotions', error)
    return NextResponse.json({ error: 'Failed to fetch promotions' }, { status: 500 })
  }
}

// POST /api/promotions
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const parsed = await validateBody(request, createPromotionSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId
    const [row] = await withTenantTransaction(tenantId, (tx) => tx.insert(promotions).values({
      tenantId, ...promotionValues(parsed.data), createdBy: session!.user.id,
    }).returning())
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'Another promotion already uses this coupon code', code: 'DUPLICATE', field: 'couponCode' }, { status: 409 })
    logError('api/promotions', error)
    return NextResponse.json({ error: 'Failed to create promotion' }, { status: 500 })
  }
}
