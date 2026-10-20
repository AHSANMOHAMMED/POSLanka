import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { items } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { bulkPriceUpdateSchema } from '@/lib/validation/schemas/items'
import { withSavepoint } from '@/lib/inventory/db-types'
import { recordItemChange } from '@/lib/inventory/item-audit'
import { logError } from '@/lib/ai/error-logger'

// POST - Apply bulk price updates (each item: version bump, updated_by, price history entry)
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkPriceUpdateSchema)
  if (!parsed.success) return parsed.response
  const { updates } = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageItems')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const tenantId = session.user.tenantId
    const userId = session.user.id
    let updated = 0
    const errors: string[] = []
    const changedIds: string[] = []

    for (const update of updates) {
      try {
        // Each item in its own savepoint: one failure never aborts the others
        const outcome = await withSavepoint(tx, async (sp) => {
          const [before] = await sp.select().from(items)
            .where(and(eq(items.id, update.itemId), eq(items.tenantId, tenantId)))
            .for('update')
          if (!before) return 'not_found' as const

          const changes: Record<string, unknown> = {}
          if (update.costPrice !== undefined) changes.costPrice = update.costPrice.toFixed(2)
          if (update.sellingPrice !== undefined) changes.sellingPrice = update.sellingPrice.toFixed(2)
          if (Object.keys(changes).length === 0) return 'unchanged' as const

          const [after] = await sp.update(items).set({
            ...changes,
            version: sql`${items.version} + 1`,
            updatedBy: userId,
            updatedAt: new Date(),
          }).where(eq(items.id, before.id)).returning()

          await recordItemChange(sp, {
            tenantId,
            itemId: before.id,
            userId,
            source: 'bulk_price',
            action: 'update',
            before: before as unknown as Record<string, unknown>,
            after: after as unknown as Record<string, unknown>,
            notes: 'Bulk price update',
          })
          return 'updated' as const
        })
        if (outcome === 'not_found') {
          errors.push(`Item ${update.itemId}: not found`)
        } else {
          updated++
          if (outcome === 'updated') changedIds.push(update.itemId)
        }
      } catch (err) {
        logError('api/items/bulk-price-update', err, { context: { itemId: update.itemId } })
        errors.push(`Item ${update.itemId}: update failed`)
      }
    }

    return { data: { updated, total: updates.length, errors }, changedIds, tenantId, userId }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  for (const id of result.changedIds) {
    logAndBroadcast(result.tenantId, 'item', 'updated', id, { userId: result.userId })
  }
  return NextResponse.json(result.data)
}
