import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { wasteLog, items, warehouses } from '@/lib/db/schema'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { allocateBatchesFEFO, batchErrorInfo, type BatchAllocation } from '@/lib/inventory/batches'
import { postStockAdjustmentToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { toApiError } from '@/lib/db/errors'
import { eq, and, ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { resolveUserIdRequired } from '@/lib/auth/resolve-user'
import { logError } from '@/lib/ai/error-logger'
import { SAFE_USER } from '@/lib/db/safe-columns'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { wasteReasonCode } from '@/lib/inventory/adjustment-reasons'
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
          recordedByUser: SAFE_USER,
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
    const { itemId, quantity: parsedQuantity, unit, reason, notes, warehouseId: bodyWarehouseId, batchId } = parsed.data
    const reasonCode = parsed.data.reasonCode || wasteReasonCode(reason)

    // Resolve the user ID for the recordedBy field
    const recordedBy = await resolveUserIdRequired(session!)
    const tenantId = session!.user.tenantId

    // Waste reduces stock: log entry, ledger movement, batches and GL in one transaction
    const decreased: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
    const response = await withTenantTransaction(tenantId, async (tx) => {
      // Get item to calculate cost amount
      const item = await tx.query.items.findFirst({
        where: eq(items.id, itemId),
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Warehouse the waste came out of: the given one, else the tenant's default
      const warehouse = await tx.query.warehouses.findFirst({
        where: bodyWarehouseId
          ? and(eq(warehouses.id, bodyWarehouseId), eq(warehouses.isActive, true))
          : and(eq(warehouses.isDefault, true), eq(warehouses.isActive, true)),
        columns: { id: true },
      })
      if (item.trackStock && !warehouse) {
        return NextResponse.json({
          error: bodyWarehouseId ? 'Warehouse not found or inactive' : 'No active default warehouse; choose the warehouse the waste came from',
        }, { status: bodyWarehouseId ? 404 : 400 })
      }

      // Calculate cost amount from item's costPrice
      const costPrice = parseFloat(item.costPrice || '0')
      const costAmount = String(Math.round(costPrice * parsedQuantity * 100) / 100)

      if (item.trackStock && costPrice > 0) {
        const acctError = await requireAccountingConfig(tx, tenantId, 'stock_adjustment')
        if (acctError) return acctError
      }

      const [newEntry] = await tx.insert(wasteLog).values({
        tenantId,
        itemId,
        quantity: String(parsedQuantity),
        unit: unit || 'pcs',
        reason,
        reasonCode,
        notes: notes || null,
        costAmount,
        recordedBy,
        warehouseId: warehouse?.id ?? null,
      }).returning()

      if (!item.trackStock || !warehouse) {
        return NextResponse.json(newEntry)
      }

      const input: StockChangeInput = {
        tenantId,
        warehouseId: warehouse.id,
        itemId,
        mode: 'delta',
        qty: -parsedQuantity,
        type: 'adjustment',
        referenceType: 'waste',
        referenceId: newEntry.id,
        notes: `Waste: ${reason}${notes ? ` (${notes})` : ''}`.slice(0, 1000),
        userId: recordedBy,
        source: 'manual',
        idempotencyKey: `waste:${newEntry.id}`,
        reasonCode,
      }
      const change = await applyStockChange(tx, input)
      decreased.push({ result: change, input })

      let batchAllocations: BatchAllocation[] | null = null
      if (item.trackBatches) {
        // Waste is usually expired goods, so expired batches are eligible
        const picked = await allocateBatchesFEFO(tx, {
          tenantId,
          warehouseId: warehouse.id,
          itemId,
          qty: parsedQuantity,
          preferredBatchId: batchId || null,
          allowExpired: true,
          itemName: item.name,
        })
        batchAllocations = picked.allocations
      }

      if (costPrice > 0 && change.movementId) {
        await postStockAdjustmentToGL(tx, tenantId, {
          adjustmentId: change.movementId,
          tenantId,
          itemName: item.name,
          quantityChange: change.delta,
          costPrice,
          notes: `Waste: ${reason}`,
          reasonCode,
        })
      }

      const [saved] = await tx.update(wasteLog)
        .set({ stockMovementId: change.movementId, batchAllocations })
        .where(eq(wasteLog.id, newEntry.id))
        .returning()

      // H3: a stock item without a cost price leaves stock without a GL entry — flag it
      return NextResponse.json(costPrice > 0 ? saved : { ...saved, unvalued: true, warning: `${item.name} has no cost price: this waste is not valued in the GL` })
    })

    notifyStockDecreased(decreased)
    if (response.status === 200) {
      const body = await response.clone().json().catch(() => null) as { id?: string; warehouseId?: string | null } | null
      if (body?.id) logAndBroadcast(tenantId, 'waste-log', 'created', body.id)
      if (body?.warehouseId) logAndBroadcast(tenantId, 'warehouse-stock', 'updated', body.warehouseId)
      logAndBroadcast(tenantId, 'item', 'updated', itemId)
    }
    return response
  } catch (error) {
    logError('api/waste-log', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant' }, { status: 400 })
    }
    if (message.startsWith('INSUFFICIENT_STOCK:')) {
      return NextResponse.json({
        error: `Insufficient stock for ${message.slice('INSUFFICIENT_STOCK:'.length)}`,
        code: 'INSUFFICIENT_STOCK',
      }, { status: 400 })
    }
    const batchErr = batchErrorInfo(error)
    if (batchErr) return NextResponse.json({ error: batchErr.message, code: batchErr.code }, { status: 400 })
    if (message.startsWith('GL_ACCOUNTS_MISSING:')) {
      return NextResponse.json({ error: message.slice('GL_ACCOUNTS_MISSING:'.length).trim(), code: 'GL_ACCOUNTS_MISSING' }, { status: 400 })
    }
    const mapped = toApiError(error)
    if (mapped) return mapped

    return NextResponse.json({ error: 'Failed to log waste' }, { status: 500 })
  }
}
