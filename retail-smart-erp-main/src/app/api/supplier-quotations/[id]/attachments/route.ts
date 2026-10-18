import { createAttachmentHandler } from '@/lib/api/attachment-handler'
import { supplierQuotations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const handler = createAttachmentHandler({
  entityType: 'supplier-quotation',
  broadcastEntityType: 'supplier-quotation',
  permission: 'managePurchases',
  validateEntity: async (db, id) => {
    const [record] = await db.select({ id: supplierQuotations.id })
      .from(supplierQuotations)
      .where(eq(supplierQuotations.id, id))
    return !!record
  },
})

export const GET = handler.GET
export const POST = handler.POST
export const DELETE = handler.DELETE
