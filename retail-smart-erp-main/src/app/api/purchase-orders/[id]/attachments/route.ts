import { createAttachmentHandler } from '@/lib/api/attachment-handler'
import { purchaseOrders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const handler = createAttachmentHandler({
  entityType: 'purchase-order',
  broadcastEntityType: 'purchase-order',
  permission: 'managePurchases',
  validateEntity: async (db, id) => {
    const [record] = await db.select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
    return !!record
  },
})

export const GET = handler.GET
export const POST = handler.POST
export const DELETE = handler.DELETE
