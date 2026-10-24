import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { syncIntakeBatch } from '@/lib/inventory/stock-intake-sync'
import { syncStockIntakeSchema } from '@/lib/validation/schemas/stock-intake'
import { withTenant } from '@/lib/db'
import { stockIntakeLines } from '@/lib/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { intakeErrorResponse } from '@/lib/inventory/stock-intake-http'
import { notify } from '@/lib/notifications/notify'

// POST /api/stock-intake/[id]/sync — post open lines into stock (header Idempotency-Key optional;
// body { priceChanges?: 'apply' | 'keep' } answers undecided price changes — unanswered ones are kept)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const idempotencyKey = (request.headers.get('idempotency-key') || '').trim().slice(0, 100) || null

  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(session, 'postStockIntake')
  if (permError) return permError

  try {
    // Optional { priceChanges: 'apply' | 'keep' }: the user's answer for every undecided price change
    // eslint-disable-next-line custom-rules/no-direct-request-json -- the body is optional (older apps send none)
    const body = syncStockIntakeSchema.safeParse(await request.json().catch(() => ({})))
    if (body.success && body.data.priceChanges) {
      const decision = body.data.priceChanges
      await withTenant(session.user.tenantId, (db) => db.update(stockIntakeLines)
        .set({ priceDecision: decision, updatedAt: new Date() })
        .where(and(eq(stockIntakeLines.batchId, p.data.id), isNull(stockIntakeLines.priceDecision), inArray(stockIntakeLines.status, ['pending', 'error']))))
    }
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
      if (result.errors.length > 0) {
        void notify(tenantId, 'intake_sync_errors', {
          title: `Stock intake ${result.batchNo}: ${result.errors.length} line(s) failed`,
          body: `${result.posted} line(s) posted, ${result.errors.length} need attention. ${result.errors[0].error}`.slice(0, 300),
          data: { screen: 'intake', batchId: result.batchId },
          permission: 'postStockIntake',
          userIds: [session.user.id],
        })
      }
    }
    return NextResponse.json(result)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id]/sync', 'Failed to sync stock intake batch')
  }
}
