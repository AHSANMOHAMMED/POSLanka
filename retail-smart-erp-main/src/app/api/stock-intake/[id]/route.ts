import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateStockIntakeSchema } from '@/lib/validation/schemas/stock-intake'
import { getIntakeBatchDetail, updateIntakeBatch } from '@/lib/inventory/stock-intake'
import { intakeErrorResponse } from '@/lib/inventory/stock-intake-http'
import { notify } from '@/lib/notifications/notify'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/stock-intake/[id] — batch + lines with live match preview
export async function GET(_request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      return { data: await getIntakeBatchDetail(db, session.user.tenantId, p.data.id) }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id] GET', 'Failed to load stock intake batch')
  }
}

// PATCH /api/stock-intake/[id] — header / status changes with optimistic version check
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, updateStockIntakeSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      const u = session.user as { role: string; tenantId: string; id: string; customRoleId?: string | null }
      const batch = await updateIntakeBatch(db, {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        batchId: p.data.id,
        expectedVersion: body.expectedVersion,
        notes: body.notes,
        warehouseId: body.warehouseId,
        status: body.status,
        updateCost: body.updateCost,
        supplierId: body.supplierId,
        canPost: hasPermission(u.role, 'postStockIntake', u.tenantId, u.customRoleId || undefined),
        role: u.role,
      })
      logAndBroadcast(session.user.tenantId, 'stock-intake', 'updated', batch.id, {
        userId: session.user.id, entityName: batch.batchNo,
      })
      return { data: batch, tenantId: session.user.tenantId, actor: { id: session.user.id, name: session.user.name } }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    if (body.status === 'submitted' && result.data.status === 'submitted') {
      void notify(result.tenantId, 'intake_awaiting_approval', {
        title: `Stock intake ${result.data.batchNo} submitted`,
        body: `${result.actor.name || 'A colleague'} submitted ${result.data.batchNo} for posting into stock.`,
        data: { screen: 'intake', batchId: result.data.id },
        dedupeKey: `intake_submitted:${result.data.id}`,
        permission: 'postStockIntake',
        excludeUserId: result.actor.id,
      })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id] PATCH', 'Failed to update stock intake batch')
  }
}
