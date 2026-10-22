import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { landedCostVouchers, landedCostItems, users } from '@/lib/db/schema'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { saveLandedCostVoucherSchema, landedCostListSchema } from '@/lib/validation/schemas/landed-cost'
import { nextDocNo } from '@/lib/documents/numbering'
import { tenantToday } from '@/lib/accounting/gl'
import { saveLandedCostDraft, submitLandedCostVoucher, getLandedCostVoucher, LandedCostError } from '@/lib/purchasing/landed-cost'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'

// GET /api/landed-cost-vouchers — list (optionally only those allocated to one GRN / invoice)
export async function GET(request: NextRequest) {
  const parsed = validateSearchParams(request, landedCostListSchema)
  if (!parsed.success) return parsed.response
  const { status, sourceId, page, pageSize } = parsed.data
  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { error: permError }
    const conds = []
    if (status) conds.push(eq(landedCostVouchers.status, status))
    if (sourceId) {
      const ids = await db.selectDistinct({ id: landedCostItems.voucherId }).from(landedCostItems).where(eq(landedCostItems.sourceId, sourceId))
      if (ids.length === 0) return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }
      conds.push(inArray(landedCostVouchers.id, ids.map(r => r.id)))
    }
    const where = conds.length > 0 ? and(...conds) : undefined
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(landedCostVouchers).where(where)
    const data = await db.select({
      id: landedCostVouchers.id,
      voucherNo: landedCostVouchers.voucherNo,
      postingDate: landedCostVouchers.postingDate,
      status: landedCostVouchers.status,
      allocationMethod: landedCostVouchers.allocationMethod,
      totalCharges: landedCostVouchers.totalCharges,
      absorbedAmount: landedCostVouchers.absorbedAmount,
      expensedAmount: landedCostVouchers.expensedAmount,
      createdByName: users.fullName,
      createdAt: landedCostVouchers.createdAt,
      sources: sql<string>`(SELECT string_agg(DISTINCT li.source_no, ', ') FROM landed_cost_items li WHERE li.voucher_id = ${landedCostVouchers.id})`,
    })
      .from(landedCostVouchers)
      .leftJoin(users, eq(users.id, landedCostVouchers.createdBy))
      .where(where)
      .orderBy(desc(landedCostVouchers.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
    const total = Number(count)
    return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
  })
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result)
}

// POST /api/landed-cost-vouchers — create a draft (submit: true also submits it)
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, saveLandedCostVoucherSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data
  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }
      const tenantId = session.user.tenantId
      const voucherNo = await nextDocNo(tx, tenantId, 'landed_cost')
      const [voucher] = await tx.insert(landedCostVouchers).values({
        tenantId,
        voucherNo,
        postingDate: body.postingDate || await tenantToday(tenantId),
        allocationMethod: body.allocationMethod,
        notes: body.notes || null,
        createdBy: session.user.id,
      }).returning()
      await saveLandedCostDraft(tx, { tenantId, voucherId: voucher.id, sources: body.sources, charges: body.charges })
      if (body.submit) await submitLandedCostVoucher(tx, { tenantId, voucherId: voucher.id, userId: session.user.id })
      logAndBroadcast(tenantId, 'purchase', 'updated', voucher.id, { userId: session.user.id, entityName: voucherNo, description: `Landed cost ${voucherNo}${body.submit ? ' submitted' : ' saved'}` })
      return { data: await getLandedCostVoucher(tx, voucher.id) }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    if (err instanceof LandedCostError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    const apiError = stockErrorResponse(err, 'Cannot post landed cost')
    if (apiError) return apiError
    logError('api/landed-cost-vouchers', err)
    return NextResponse.json({ error: 'Failed to save landed cost voucher' }, { status: 500 })
  }
}
