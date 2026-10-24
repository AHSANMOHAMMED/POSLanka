import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { createReorderDocuments, ReorderError } from '@/lib/purchasing/reorder'
import { assertBranchAccess } from '@/lib/auth/branch-access'

const schema = z.object({
  mode: z.enum(['purchase_order', 'requisition']).default('purchase_order'),
  lines: z.array(z.object({
    itemId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    supplierId: z.string().uuid().nullish(),
    quantity: z.coerce.number().positive().max(1_000_000_000),
    unitPrice: z.coerce.number().min(0).nullish(),
  })).min(1, 'Select at least one suggestion').max(500),
})

// POST /api/purchase-orders/from-reorder — draft POs (one per supplier + warehouse) or draft
// purchase requisitions (one per warehouse) from selected reorder suggestions.
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, schema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const quotaError = await requireQuota(preSession.user.tenantId, 'standard')
  if (quotaError) return quotaError

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, body.mode === 'requisition' ? 'createRequisitions' : 'managePurchases')
      if (permError) return { error: permError }
      // K4: a branch-restricted user works with their own branches only
      const branchDenied = await assertBranchAccess(session, body.lines.map((l) => l.warehouseId), tx)
      if (branchDenied) return { error: branchDenied }
      const docs = await createReorderDocuments(tx, {
        tenantId: session.user.tenantId, userId: session.user.id, mode: body.mode, lines: body.lines, source: 'reorder',
      })
      for (const d of docs) {
        logAndBroadcast(session.user.tenantId, d.type === 'purchase_order' ? 'purchase-order' : 'purchase-requisition', 'created', d.id, {
          userId: session.user.id, entityName: d.number,
        })
      }
      return { data: { documents: docs } }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    if (err instanceof ReorderError) return NextResponse.json({ error: err.message }, { status: err.status })
    logError('api/purchase-orders/from-reorder', err)
    return NextResponse.json({ error: 'Failed to create documents from reorder suggestions' }, { status: 500 })
  }
}
