import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { addStockIntakeLinesSchema } from '@/lib/validation/schemas/stock-intake'
import { addIntakeLines } from '@/lib/inventory/stock-intake'
import { intakeErrorResponse } from '@/lib/inventory/stock-intake-http'

// POST /api/stock-intake/[id]/lines — upsert scanned lines (idempotent by clientLineId)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, addStockIntakeLinesSchema)
  if (!parsed.success) return parsed.response
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      const out = await addIntakeLines(db, {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        batchId: p.data.id,
        lines: parsed.data.lines,
      })
      logAndBroadcast(session.user.tenantId, 'stock-intake', 'updated', p.data.id, { userId: session.user.id })
      return { data: out }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id]/lines POST', 'Failed to add lines')
  }
}
