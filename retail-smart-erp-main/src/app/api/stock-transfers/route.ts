import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { stockTransfers, stockTransferItems, warehouses, items, warehouseStock } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, or, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { stockTransfersListSchema, createStockTransferSchema } from '@/lib/validation/schemas/stock'

// GET all stock transfers (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, stockTransfersListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, all, status, warehouseId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(ilike(stockTransfers.transferNo, `%${escaped}%`))
      }

      if (status) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const statuses = status.split(',') as any[]
        conditions.push(inArray(stockTransfers.status, statuses))
      }

      if (warehouseId) {
        conditions.push(or(
          eq(stockTransfers.fromWarehouseId, warehouseId),
          eq(stockTransfers.toWarehouseId, warehouseId)
        )!)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(stockTransfers)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)

      // Get results with related data
      const results = await db.query.stockTransfers.findMany({
        where: whereClause,
        with: {
          fromWarehouse: true,
          toWarehouse: true,
          requestedByUser: true,
          approvedByUser: true,
          items: {
            with: {
              item: true,
            }
          },
        },
        orderBy: [desc(stockTransfers.createdAt)],
        limit: all ? 1000 : pageSize,
        offset: all ? 0 : (page - 1) * pageSize,
      })

      if (all) {
        return NextResponse.json(results)
      }

      return NextResponse.json({
        data: results,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/stock-transfers', error)
    return NextResponse.json({ error: 'Failed to fetch stock transfers' }, { status: 500 })
  }
}

// POST create new stock transfer
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createStockTransferSchema)
    if (!parsed.success) return parsed.response
    const { fromWarehouseId, toWarehouseId, items: transferItems, notes } = parsed.data

    // Execute with RLS tenant context in a transaction for atomicity
    return await withTenantTransaction(session.user.tenantId, async (db) => {
      // Verify warehouses exist and belong to tenant (RLS scopes the query)
      const fromWarehouse = await db.query.warehouses.findFirst({
        where: and(
          eq(warehouses.id, fromWarehouseId),
          eq(warehouses.isActive, true)
        ),
      })

      const toWarehouse = await db.query.warehouses.findFirst({
        where: and(
          eq(warehouses.id, toWarehouseId),
          eq(warehouses.isActive, true)
        ),
      })

      if (!fromWarehouse) {
        return NextResponse.json({ error: 'Source warehouse not found or inactive' }, { status: 404 })
      }

      if (!toWarehouse) {
        return NextResponse.json({ error: 'Destination warehouse not found or inactive' }, { status: 404 })
      }

      // Validate items and stock availability (RLS scopes all queries)
      for (const item of transferItems) {
        // Check item exists
        const itemExists = await db.query.items.findFirst({
          where: eq(items.id, item.itemId),
        })

        if (!itemExists) {
          return NextResponse.json({ error: `Item ${item.itemId} not found` }, { status: 404 })
        }

        // Check stock availability in source warehouse (FOR UPDATE to prevent over-commit)
        const [stock] = await db
          .select()
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.warehouseId, fromWarehouseId),
            eq(warehouseStock.itemId, item.itemId)
          ))
          .for('update')

        const available = parseFloat(stock?.currentStock || '0')

        if (available < item.quantity) {
          return NextResponse.json({
            error: `Insufficient stock for ${itemExists.name}. Available: ${available}, Requested: ${item.quantity}`
          }, { status: 400 })
        }
      }

      // Generate transfer number with advisory lock to prevent duplicates
      await db.execute(sql`SELECT pg_advisory_xact_lock(3)`)
      const year = new Date().getFullYear()
      const [lastTransfer] = await db
        .select({ transferNo: stockTransfers.transferNo })
        .from(stockTransfers)
        .where(ilike(stockTransfers.transferNo, `ST${year}%`))
        .orderBy(desc(stockTransfers.transferNo))
        .limit(1)

      let nextNum = 1
      if (lastTransfer?.transferNo) {
        const match = lastTransfer.transferNo.match(/ST\d{4}(\d+)/)
        if (match) {
          nextNum = parseInt(match[1], 10) + 1
        }
      }
      const transferNo = `ST${year}${String(nextNum).padStart(5, '0')}`

      // Create the transfer
      const [newTransfer] = await db.insert(stockTransfers).values({
        tenantId: session.user.tenantId,
        transferNo,
        fromWarehouseId,
        toWarehouseId,
        status: 'draft',
        notes,
        requestedBy: userId,
      }).returning()

      // Create transfer items
      for (const item of transferItems) {
        await db.insert(stockTransferItems).values({
          tenantId: session.user.tenantId,
          transferId: newTransfer.id,
          itemId: item.itemId,
          quantity: item.quantity.toString(),
          notes: item.notes,
        })
      }

      // Fetch the complete transfer with items
      const completeTransfer = await db.query.stockTransfers.findFirst({
        where: eq(stockTransfers.id, newTransfer.id),
        with: {
          fromWarehouse: true,
          toWarehouse: true,
          requestedByUser: true,
          items: {
            with: {
              item: true,
            }
          },
        },
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'stock-transfer', 'created', newTransfer.id)
      logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })

      return NextResponse.json(completeTransfer)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/stock-transfers', error)
    return NextResponse.json({ error: 'Failed to create stock transfer' }, { status: 500 })
  }
}
