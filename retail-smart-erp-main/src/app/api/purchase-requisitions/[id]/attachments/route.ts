import { createAttachmentHandler } from '@/lib/api/attachment-handler'
import { purchaseRequisitions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const handler = createAttachmentHandler({
  entityType: 'purchase-requisition',
  broadcastEntityType: 'purchase-requisition',
  permission: 'createRequisitions',
  validateEntity: async (db, id) => {
    const [record] = await db.select({ id: purchaseRequisitions.id })
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
    return !!record
  },
})

export const GET = handler.GET
export const POST = handler.POST
export const DELETE = handler.DELETE
