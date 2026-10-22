import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { landedCostVouchers } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { saveLandedCostVoucherSchema, cancelLandedCostVoucherSchema } from '@/lib/validation/schemas/landed-cost'
import { saveLandedCostDraft, submitLandedCostVoucher, cancelLandedCostVoucher, getLandedCostVoucher, LandedCostError } from '@/lib/purchasing/landed-cost'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'

type Ctx = { params: Promise<{ id: string }> }

function mapError(err: unknown, context: string): NextResponse {
  if (err instanceof LandedCostError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  const apiError = stockErrorResponse(err, context)
  if (apiError) return apiError
  logError('api/landed-cost-vouchers/[id]', err)
  return NextResponse.json({ error: 'Landed cost voucher operation failed' }, { status: 500 })
}

// GET /api/landed-cost-vouchers/[id]
export async function GET(_request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { error: permError }
    const voucher = await getLandedCostVoucher(db, p.data.id)
    if (!voucher) return { error: NextResponse.json({ error: 'Landed cost voucher not found' }, { status: 404 }) }
    return { data: voucher }
  })
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}

// PUT /api/landed-cost-vouchers/[id] — edit a draft (submit: true also submits it)
export async function PUT(request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, saveLandedCostVoucherSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data
  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }
      const [voucher] = await tx.select().from(landedCostVouchers).where(eq(landedCostVouchers.id, p.data.id)).for('update')
      if (!voucher) return { error: NextResponse.json({ error: 'Landed cost voucher not found' }, { status: 404 }) }
      if (voucher.status !== 'draft') return { error: NextResponse.json({ error: 'Only draft vouchers can be edited' }, { status: 400 }) }
      await tx.update(landedCostVouchers).set({
        postingDate: body.postingDate || voucher.postingDate,
        allocationMethod: body.allocationMethod,
        notes: body.notes ?? voucher.notes,
        updatedAt: new Date(),
      }).where(eq(landedCostVouchers.id, voucher.id))
      await saveLandedCostDraft(tx, { tenantId: session.user.tenantId, voucherId: voucher.id, sources: body.sources, charges: body.charges })
      if (body.submit) await submitLandedCostVoucher(tx, { tenantId: session.user.tenantId, voucherId: voucher.id, userId: session.user.id })
      logAndBroadcast(session.user.tenantId, 'purchase', 'updated', voucher.id, { userId: session.user.id, entityName: voucher.voucherNo })
      return { data: await getLandedCostVoucher(tx, voucher.id) }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return mapError(err, 'Cannot post landed cost')
  }
}

// DELETE /api/landed-cost-vouchers/[id] — cancel (submitted: reverses cost, GL, supplier balances)
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, cancelLandedCostVoucherSchema)
  if (!parsed.success) return parsed.response
  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }
      await cancelLandedCostVoucher(tx, { tenantId: session.user.tenantId, voucherId: p.data.id, userId: session.user.id, reason: parsed.data.cancellationReason })
      logAndBroadcast(session.user.tenantId, 'purchase', 'updated', p.data.id, { userId: session.user.id, activityAction: 'cancel' })
      return { data: await getLandedCostVoucher(tx, p.data.id) }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return mapError(err, 'Cannot cancel landed cost')
  }
}
