import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { purchaseRequisitions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { rejectRequisitionSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST - Reject requisition (pending_approval -> rejected)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, rejectRequisitionSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'approveRequisitions')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [requisition] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update')

    if (!requisition) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    if (requisition.status !== 'pending_approval') {
      return { error: NextResponse.json({ error: 'Only pending approval requisitions can be rejected' }, { status: 400 }) }
    }

    const [updated] = await tx.update(purchaseRequisitions)
      .set({
        status: 'rejected',
        rejectedBy: session.user.id,
        rejectedAt: new Date(),
        rejectionReason: body.rejectionReason,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, id))
      .returning()

    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'updated', id)
    return { data: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
