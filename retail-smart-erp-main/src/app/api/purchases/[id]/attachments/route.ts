import { createAttachmentHandler } from '@/lib/api/attachment-handler'
import { purchases } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const handler = createAttachmentHandler({
  entityType: 'purchase',
  broadcastEntityType: 'purchase',
  permission: 'managePurchases',
  validateEntity: async (db, id) => {
    const [record] = await db.select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.id, id))
    return !!record
  },
})

export const GET = handler.GET
export const POST = handler.POST
export const DELETE = handler.DELETE
