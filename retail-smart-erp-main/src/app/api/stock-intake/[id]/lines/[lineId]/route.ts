import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { intakeLineParamsSchema, updateStockIntakeLineSchema } from '@/lib/validation/schemas/stock-intake'
import { deleteIntakeLine, updateIntakeLine } from '@/lib/inventory/stock-intake'
import { intakeErrorResponse } from '@/lib/inventory/stock-intake-http'

type Ctx = { params: Promise<{ id: string; lineId: string }> }

// PATCH /api/stock-intake/[id]/lines/[lineId] — edit a pending / error line
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, intakeLineParamsSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, updateStockIntakeLineSchema)
  if (!parsed.success) return parsed.response
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      const line = await updateIntakeLine(db, {
        tenantId: session.user.tenantId, batchId: p.data.id, lineId: p.data.lineId, patch: parsed.data,
        actor: { userId: session.user.id, role: session.user.role },
      })
      logAndBroadcast(session.user.tenantId, 'stock-intake', 'updated', p.data.id, { userId: session.user.id })
      return { data: line }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id]/lines/[lineId] PATCH', 'Failed to update line')
  }
}

// DELETE /api/stock-intake/[id]/lines/[lineId] — remove a pending / error line
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const p = validateParams(await params, intakeLineParamsSchema)
  if (!p.success) return p.response
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      await deleteIntakeLine(db, {
        tenantId: session.user.tenantId, batchId: p.data.id, lineId: p.data.lineId,
        actor: { userId: session.user.id, role: session.user.role },
      })
      logAndBroadcast(session.user.tenantId, 'stock-intake', 'updated', p.data.id, { userId: session.user.id })
      return { data: { success: true } }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id]/lines/[lineId] DELETE', 'Failed to delete line')
  }
}
