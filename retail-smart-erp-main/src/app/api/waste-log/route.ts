import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { wasteLog, items } from '@/lib/db/schema'
import { eq, and, ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { resolveUserIdRequired } from '@/lib/auth/resolve-user'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { wasteLogListSchema, createWasteLogSchema } from '@/lib/validation/schemas/waste-log'

// GET waste log entries for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, wasteLogListSchema)
    if (!parsed.success) return parsed.response
    const { search, startDate, endDate, page, pageSize } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(items.name, `%${escaped}%`),
            ilike(wasteLog.reason, `%${escaped}%`),
            ilike(wasteLog.notes, `%${escaped}%`)
          )!
        )
      }

      if (startDate) {
        conditions.push(sql`${wasteLog.recordedAt} >= ${startDate}::timestamp`)
      }

      if (endDate) {
        // Add 1 day to include the full end date
        conditions.push(sql`${wasteLog.recordedAt} < (${endDate}::timestamp + interval '1 day')`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count (need to join with items for search)
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(wasteLog)
        .leftJoin(items, eq(wasteLog.itemId, items.id))
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results with relations
      const result = await db.query.wasteLog.findMany({
        where: whereClause,
        with: {
          item: true,
          recordedByUser: true,
        },
        orderBy: (wasteLog, { desc }) => [desc(wasteLog.recordedAt)],
        limit: Math.min(pageSize, 100),
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
        }
      })
    })
  } catch (error) {
    logError('api/waste-log', error)
    return NextResponse.json({ error: 'Failed to fetch waste log' }, { status: 500 })
  }
}

// POST log waste
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createWasteLogSchema)
    if (!parsed.success) return parsed.response
    const { itemId, quantity: parsedQuantity, unit, reason, notes } = parsed.data

    // Resolve the user ID for the recordedBy field
    const recordedBy = await resolveUserIdRequired(session!)

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Get item to calculate cost amount
      const item = await db.query.items.findFirst({
        where: eq(items.id, itemId),
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Calculate cost amount from item's costPrice
      const costPrice = parseFloat(item.costPrice || '0')
      const costAmount = String(Math.round(costPrice * parsedQuantity * 100) / 100)

      const [newEntry] = await db.insert(wasteLog).values({
        tenantId: session!.user.tenantId,
        itemId,
        quantity: String(parsedQuantity),
        unit: unit || 'pcs',
        reason,
        notes: notes || null,
        costAmount,
        recordedBy,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'waste-log', 'created', newEntry.id)

      return NextResponse.json(newEntry)
    })
  } catch (error) {
    logError('api/waste-log', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to log waste' }, { status: 500 })
  }
}
