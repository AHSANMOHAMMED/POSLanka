import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createStockIntakeSchema, stockIntakeListSchema } from '@/lib/validation/schemas/stock-intake'
import { createIntakeBatch, listIntakeBatches } from '@/lib/inventory/stock-intake'
import { intakeErrorResponse, isMobileRequest } from '@/lib/inventory/stock-intake-http'

// GET /api/stock-intake?status&warehouseId&mine&page&pageSize — list intake batches
export async function GET(request: NextRequest) {
  const parsed = validateSearchParams(request, stockIntakeListSchema)
  if (!parsed.success) return parsed.response
  const q = parsed.data
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      return {
        data: await listIntakeBatches(db, {
          tenantId: session.user.tenantId,
          status: q.status,
          warehouseId: q.warehouseId,
          createdBy: q.mine ? session.user.id : undefined,
          page: q.page,
          pageSize: q.pageSize,
        }),
      }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake GET', 'Failed to load stock intake batches')
  }
}

// POST /api/stock-intake — create a batch (repeat clientBatchId → existing batch, 200)
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, createStockIntakeSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      const out = await createIntakeBatch(db, {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        warehouseId: body.warehouseId,
        notes: body.notes,
        clientBatchId: body.clientBatchId,
        updateCost: body.updateCost,
        supplierId: body.supplierId,
        source: isMobileRequest(request, body.source) ? 'mobile' : 'web',
      })
      if (out.created) {
        logAndBroadcast(session.user.tenantId, 'stock-intake', 'created', out.batch.id, {
          userId: session.user.id, entityName: out.batch.batchNo,
        })
      }
      return { data: out }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json({ ...result.data.batch, created: result.data.created }, { status: result.data.created ? 201 : 200 })
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake POST', 'Failed to create stock intake batch')
  }
}
