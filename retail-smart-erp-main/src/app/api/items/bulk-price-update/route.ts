import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { items } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { bulkPriceUpdateSchema } from '@/lib/validation/schemas/items'

// POST - Apply bulk price updates
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkPriceUpdateSchema)
  if (!parsed.success) return parsed.response
  const { updates } = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageItems')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    let updated = 0
    const errors: string[] = []

    for (const update of updates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const changes: Record<string, any> = { updatedAt: new Date() }

        if (update.costPrice !== undefined) {
          changes.costPrice = update.costPrice.toFixed(2)
        }

        if (update.sellingPrice !== undefined) {
          changes.sellingPrice = update.sellingPrice.toFixed(2)
        }

        const [updatedItem] = await tx.update(items)
          .set(changes)
          .where(eq(items.id, update.itemId))
          .returning({ id: items.id })

        if (updatedItem) {
          updated++
          logAndBroadcast(session.user.tenantId, 'item', 'updated', updatedItem.id)
        } else {
          errors.push(`Item ${update.itemId}: not found`)
        }
      } catch {
        errors.push(`Item ${update.itemId}: update failed`)
      }
    }

    return { data: { updated, total: updates.length, errors } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
