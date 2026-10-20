import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { syncIntakeBatch } from '@/lib/inventory/stock-intake-sync'
import { intakeErrorResponse } from '@/lib/inventory/stock-intake-http'

// POST /api/stock-intake/[id]/sync — post open lines into stock (header Idempotency-Key optional)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const idempotencyKey = (request.headers.get('idempotency-key') || '').trim().slice(0, 100) || null

  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(session, 'postStockIntake')
  if (permError) return permError

  try {
    const result = await syncIntakeBatch({
      tenantId: session.user.tenantId,
      userId: session.user.id,
      batchId: p.data.id,
      idempotencyKey,
    })
    if (!result.replayed && !result.noop) {
      const tenantId = session.user.tenantId
      const opts = { userId: session.user.id, entityName: result.batchNo }
      logAndBroadcast(tenantId, 'stock-intake', 'updated', result.batchId, {
        ...opts, description: `Synced ${result.posted} line(s); ${result.errors.length} error(s)`,
      })
      if (result.posted > 0) {
        logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.warehouseId, opts)
        logAndBroadcast(tenantId, 'stock-movement', 'created', 'bulk', opts)
        const created = new Set(result.createdItems.map((c) => c.itemId))
        for (const itemId of result.affectedItemIds) {
          logAndBroadcast(tenantId, 'item', created.has(itemId) ? 'created' : 'updated', itemId, opts)
        }
      }
    }
    return NextResponse.json(result)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id]/sync', 'Failed to sync stock intake batch')
  }
}
