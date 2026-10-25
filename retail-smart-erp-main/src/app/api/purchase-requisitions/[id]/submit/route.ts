import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { purchaseRequisitions, purchaseRequisitionItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { notify } from '@/lib/notifications/notify'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { assertRecordBranch } from '@/lib/auth/branch-access'

// POST - Submit requisition for approval (draft -> pending_approval)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'createRequisitions')
    if (permError) return { error: permError }
    // K4: a requisition of another branch is refused
    const recordDenied = await assertRecordBranch(session, tx, purchaseRequisitions, id)
    if (recordDenied) return { error: recordDenied }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [requisition] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update')

    if (!requisition) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    if (requisition.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft requisitions can be submitted' }, { status: 400 }) }
    }

    // Verify at least one item exists
    const items = await tx.select({ id: purchaseRequisitionItems.id })
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, id))
      .limit(1)

    if (items.length === 0) {
      return { error: NextResponse.json({ error: 'Cannot submit requisition with no items' }, { status: 400 }) }
    }

    const [updated] = await tx.update(purchaseRequisitions)
      .set({ status: 'pending_approval', updatedAt: new Date() })
      .where(eq(purchaseRequisitions.id, id))
      .returning()

    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'updated', id)
    return { data: updated, tenantId: session.user.tenantId, actor: { id: session.user.id, name: session.user.name } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  // after commit
  void notify(result.tenantId, 'requisition_submitted', {
    title: 'Purchase requisition awaiting approval',
    body: `${result.actor.name || 'A colleague'} submitted ${result.data.requisitionNo || 'a requisition'} for approval`,
    data: { screen: 'approvals', kind: 'purchase_requisition', id },
    permission: 'approveRequisitions',
    excludeUserId: result.actor.id,
  })
  return NextResponse.json(result.data)
}
