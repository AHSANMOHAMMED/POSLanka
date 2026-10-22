import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { promotions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updatePromotionSchema } from '@/lib/validation/schemas/pricing'
import { promotionValues } from '@/lib/pricing/promotion-values'
import { promotionLabel } from '@/lib/pricing/engine'
import { toPromotionRuleFromRow } from '@/lib/pricing/promotion-rule'
import { isUniqueViolation } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'

// GET /api/promotions/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    return await withTenant(session!.user.tenantId, async (db) => {
      const [row] = await db.select().from(promotions).where(eq(promotions.id, p.data.id))
      if (!row) return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
      return NextResponse.json({ ...row, label: promotionLabel(toPromotionRuleFromRow(row)) })
    })
  } catch (error) {
    logError('api/promotions/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch promotion' }, { status: 500 })
  }
}

// PUT /api/promotions/[id] — full replace (usage count is kept)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, updatePromotionSchema)
    if (!parsed.success) return parsed.response
    const [row] = await withTenantTransaction(session!.user.tenantId, (tx) => tx.update(promotions)
      .set({ ...promotionValues(parsed.data), updatedAt: new Date() })
      .where(eq(promotions.id, p.data.id)).returning())
    if (!row) return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'Another promotion already uses this coupon code', code: 'DUPLICATE', field: 'couponCode' }, { status: 409 })
    logError('api/promotions/[id]', error)
    return NextResponse.json({ error: 'Failed to update promotion' }, { status: 500 })
  }
}

// DELETE /api/promotions/[id] — a promotion already redeemed is deactivated instead (keeps the history)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const res = await withTenantTransaction(session!.user.tenantId, async (tx) => {
      const [row] = await tx.select({ id: promotions.id, usageCount: promotions.usageCount }).from(promotions).where(eq(promotions.id, p.data.id))
      if (!row) return null
      if (row.usageCount > 0) {
        await tx.update(promotions).set({ isActive: false, updatedAt: new Date() }).where(eq(promotions.id, row.id))
        return { deactivated: true }
      }
      await tx.delete(promotions).where(eq(promotions.id, row.id))
      return { deleted: true }
    })
    if (!res) return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
    return NextResponse.json({ success: true, ...res })
  } catch (error) {
    logError('api/promotions/[id]', error)
    return NextResponse.json({ error: 'Failed to delete promotion' }, { status: 500 })
  }
}
