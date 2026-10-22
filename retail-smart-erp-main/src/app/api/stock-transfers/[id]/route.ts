import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission, requireModule } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { stockTransfers, stockTransferItems, warehouseStock, warehouses, items as itemsTable, itemSerialNumbers } from '@/lib/db/schema'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { toApiError } from '@/lib/db/errors'
import { eq, and, sql } from 'drizzle-orm'
import { transferSerials } from '@/lib/inventory/serial-numbers'
import { allocateBatchesFEFO, putIntoBatch, type BatchAllocation } from '@/lib/inventory/batches'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logStatusChange } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'
import { postStockTransferToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateStockTransferSchema } from '@/lib/validation/schemas/stock'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { SAFE_USER } from '@/lib/db/safe-columns'

// GET single stock transfer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'stock')
    if (moduleError) return moduleError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const transfer = await db.query.stockTransfers.findFirst({
        where: eq(stockTransfers.id, id),
        with: {
          fromWarehouse: true,
          toWarehouse: true,
          requestedByUser: SAFE_USER,
          approvedByUser: SAFE_USER,
          shippedByUser: SAFE_USER,
          receivedByUser: SAFE_USER,
          items: {
            with: {
              item: true,
            }
          },
        },
      })

      if (!transfer) {
        return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 })
      }

      return NextResponse.json(transfer)
    })
  } catch (error) {
    logError('api/stock-transfers/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch stock transfer' }, { status: 500 })
  }
}

// PUT update stock transfer (status changes, items, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateStockTransferSchema)
    if (!parsed.success) return parsed.response
    const { action, notes, cancellationReason, items: updatedItems, receivedItems, expectedUpdatedAt } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get current transfer
      const transfer = await db.query.stockTransfers.findFirst({
        where: eq(stockTransfers.id, id),
        with: {
          items: {
            with: {
              item: true,
            }
          },
          fromWarehouse: true,
          toWarehouse: true,
        },
      })

      if (!transfer) {
        return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 })
      }

      // Optimistic locking - check if transfer was modified since client fetched it
      if (expectedUpdatedAt) {
        const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
        const serverUpdatedAt = transfer.updatedAt ? new Date(transfer.updatedAt).getTime() : 0
        if (serverUpdatedAt > clientUpdatedAt) {
          return NextResponse.json({
            error: 'This transfer was modified by another user. Please refresh and try again.',
            code: 'CONFLICT'
          }, { status: 409 })
        }
      }

      // Handle different actions
      switch (action) {
        case 'submit_for_approval':
          return await handleSubmitForApproval(db, session, transfer)

        case 'approve':
          return await handleApprove(db, session, transfer, userId)

        case 'reject':
          return await handleReject(db, session, transfer, cancellationReason || '', userId)

        case 'ship':
          return await handleShip(db, session, transfer, userId)

        case 'receive':
          return await handleReceive(db, session, transfer, receivedItems || [], userId)

        case 'cancel':
          return await handleCancel(db, session, transfer, cancellationReason || '', userId)

        case 'update':
          // Only allow updates in draft status
          if (transfer.status !== 'draft') {
            return NextResponse.json({
              error: 'Can only update transfers in draft status'
            }, { status: 400 })
          }

          const permError = requirePermission(session, 'manageInventory')
          if (permError) return permError

          // Update notes if provided
          if (notes !== undefined) {
            await db.update(stockTransfers)
              .set({ notes, updatedAt: new Date() })
              .where(eq(stockTransfers.id, id))
          }

          // Update items if provided (atomic delete+insert in transaction)
          if (updatedItems) {
            if (updatedItems.length === 0) {
              return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
            }
            for (const item of updatedItems) {
              const exists = await db.query.items.findFirst({
                where: eq(itemsTable.id, item.itemId),
                columns: { id: true },
              })
              if (!exists) {
                return NextResponse.json({ error: `Item ${item.itemId} not found` }, { status: 404 })
              }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await db.transaction(async (tx: any) => {
              // Delete existing items
              await tx.delete(stockTransferItems).where(eq(stockTransferItems.transferId, id))

              // Insert new items
              for (const item of updatedItems) {
                await tx.insert(stockTransferItems).values({
                  tenantId: session.user.tenantId,
                  transferId: id,
                  itemId: item.itemId,
                  quantity: item.quantity.toString(),
                  notes: item.notes,
                })
              }
            })
          }

          const updated = await db.query.stockTransfers.findFirst({
            where: eq(stockTransfers.id, id),
            with: {
              fromWarehouse: true,
              toWarehouse: true,
              requestedByUser: SAFE_USER,
              items: {
                with: {
                  item: true,
                }
              },
            },
          })

          logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', id)
          return NextResponse.json(updated)

        default:
          return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    if (message.startsWith('VALIDATION:')) {
      return NextResponse.json({ error: message.replace('VALIDATION:', '') }, { status: 400 })
    }
    if (message.startsWith('INSUFFICIENT_STOCK:')) {
      return NextResponse.json({
        error: `Insufficient stock for ${message.slice('INSUFFICIENT_STOCK:'.length)}`,
        code: 'INSUFFICIENT_STOCK',
      }, { status: 400 })
    }
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/stock-transfers/[id]', error)
    return NextResponse.json({ error: 'Failed to update stock transfer' }, { status: 500 })
  }
}

// DELETE stock transfer (only in draft status)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const transfer = await db.query.stockTransfers.findFirst({
        where: eq(stockTransfers.id, id),
      })

      if (!transfer) {
        return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 })
      }

      if (transfer.status !== 'draft') {
        return NextResponse.json({
          error: 'Can only delete transfers in draft status'
        }, { status: 400 })
      }

      // Delete items first
      await db.delete(stockTransferItems).where(eq(stockTransferItems.transferId, id))

      // Delete transfer
      await db.delete(stockTransfers).where(eq(stockTransfers.id, id))

      logAndBroadcast(session!.user.tenantId, 'stock-transfer', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/stock-transfers/[id]', error)
    return NextResponse.json({ error: 'Failed to delete stock transfer' }, { status: 500 })
  }
}

// Helper functions for status transitions

/** Deterministic lock order for multi-line transfers: itemId, then line id. */
function byItemThenLine(a: { itemId: string; id: string }, b: { itemId: string; id: string }): number {
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubmitForApproval(db: any, session: any, transfer: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permError = requirePermission({ user: session.user } as any, 'manageInventory')
  if (permError) return permError

  if (transfer.status !== 'draft') {
    return NextResponse.json({
      error: 'Can only submit draft transfers for approval'
    }, { status: 400 })
  }

  // Wrap in transaction with FOR UPDATE locks to prevent race conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    // Lock transfer row first
    const [lockedTransfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, transfer.id))
      .for('update')

    if (!lockedTransfer || lockedTransfer.status !== 'draft') {
      throw new Error('VALIDATION:Transfer is no longer in draft status')
    }

    // Validate stock availability with locks to ensure accurate check
    for (const item of transfer.items) {
      const [lockedStock] = await tx
        .select()
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.warehouseId, transfer.fromWarehouseId),
          eq(warehouseStock.itemId, item.itemId)
        ))
        .for('update')

      const available = parseFloat(lockedStock?.currentStock || '0')
      const reserved = parseFloat(lockedStock?.reservedStock || '0')
      const requested = parseFloat(item.quantity)

      // Check available stock (current - already reserved)
      if ((available - reserved) < requested) {
        throw new Error(`VALIDATION:Insufficient stock for ${item.item.name}. Available: ${(available - reserved).toFixed(2)}, Requested: ${requested}`)
      }
    }

    const [updated] = await tx.update(stockTransfers)
      .set({ status: 'pending_approval', updatedAt: new Date() })
      .where(eq(stockTransfers.id, transfer.id))
      .returning()

    return updated
  })

  logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', transfer.id)
  return NextResponse.json(result)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleApprove(db: any, session: any, transfer: any, userId: string) {
  // STW-3: Use requirePermission for consistent authorization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permError = requirePermission({ user: session.user } as any, 'manageInventory')
  if (permError) return permError

  if (transfer.status !== 'pending_approval') {
    return NextResponse.json({
      error: 'Can only approve transfers pending approval'
    }, { status: 400 })
  }

  // Wrap in transaction to ensure atomicity of approval + reservation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    // Lock transfer to prevent concurrent approval
    const [lockedTransfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, transfer.id))
      .for('update')

    if (!lockedTransfer || lockedTransfer.status !== 'pending_approval') {
      throw new Error('VALIDATION:Transfer is no longer pending approval')
    }

    // STW-7: Re-validate warehouses are still active
    const fromWarehouse = await tx.query.warehouses.findFirst({
      where: and(eq(warehouses.id, transfer.fromWarehouseId), eq(warehouses.isActive, true)),
    })
    if (!fromWarehouse) {
      throw new Error('VALIDATION:Source warehouse is no longer active')
    }

    const toWarehouse = await tx.query.warehouses.findFirst({
      where: and(eq(warehouses.id, transfer.toWarehouseId), eq(warehouses.isActive, true)),
    })
    if (!toWarehouse) {
      throw new Error('VALIDATION:Destination warehouse is no longer active')
    }

    const [approved] = await tx.update(stockTransfers)
      .set({
        status: 'approved',
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stockTransfers.id, transfer.id))
      .returning()

    // 8G: Increment reservedStock on source warehouse for each transfer item.
    // Stock may have been sold since the transfer was submitted, so availability
    // (current - already reserved) is re-checked under the row lock; lines of the
    // same item are summed.
    const reserveByItem = new Map<string, { qty: number; name: string }>()
    for (const item of transfer.items) {
      const prev = reserveByItem.get(item.itemId)
      reserveByItem.set(item.itemId, {
        qty: Math.round(((prev?.qty || 0) + parseFloat(item.quantity)) * 1000) / 1000,
        name: item.item?.name || 'item',
      })
    }
    for (const itemId of [...reserveByItem.keys()].sort()) {
      const { qty, name } = reserveByItem.get(itemId)!
      const [lockedStock] = await tx
        .select()
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.warehouseId, transfer.fromWarehouseId),
          eq(warehouseStock.itemId, itemId)
        ))
        .for('update')
      const available = Math.round((parseFloat(lockedStock?.currentStock || '0') - parseFloat(lockedStock?.reservedStock || '0')) * 1000) / 1000
      if (!lockedStock || available < qty) {
        throw new Error(`VALIDATION:Insufficient stock for ${name}. Available: ${Math.max(0, available)}, Requested: ${qty}`)
      }
      await tx.update(warehouseStock)
        .set({
          reservedStock: sql`${warehouseStock.reservedStock} + ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(warehouseStock.id, lockedStock.id))
    }

    return approved
  })

  // STW-6: Log status change
  await logStatusChange(db, session.user.tenantId, userId, 'stock_transfer', transfer.id,
    'pending_approval', 'approved')

  logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', transfer.id)
  return NextResponse.json(result)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleReject(db: any, session: any, transfer: any, reason: string | undefined, userId: string) {
  // STW-3: Use requirePermission for consistent authorization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permError = requirePermission({ user: session.user } as any, 'manageInventory')
  if (permError) return permError

  if (transfer.status !== 'pending_approval') {
    return NextResponse.json({
      error: 'Can only reject transfers pending approval'
    }, { status: 400 })
  }

  // STW-8: Use distinct 'rejected' status instead of 'cancelled'
  const [updated] = await db.update(stockTransfers)
    .set({
      status: 'rejected',
      rejectedBy: userId,
      rejectedAt: new Date(),
      rejectionReason: reason || 'Rejected by manager',
      updatedAt: new Date(),
    })
    .where(eq(stockTransfers.id, transfer.id))
    .returning()

  // STW-6: Log status change
  await logStatusChange(db, session.user.tenantId, userId, 'stock_transfer', transfer.id,
    'pending_approval', 'rejected', reason)

  logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', transfer.id)
  return NextResponse.json(updated)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleShip(db: any, session: any, transfer: any, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permError = requirePermission({ user: session.user } as any, 'manageInventory')
  if (permError) return permError

  if (transfer.status !== 'approved') {
    return NextResponse.json({
      error: 'Can only ship approved transfers'
    }, { status: 400 })
  }

  // Issue #63: Wrap ship in transaction with FOR UPDATE locks
  const decreased: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    // STW-7: Re-validate warehouses are still active
    const fromWarehouse = await tx.query.warehouses.findFirst({
      where: and(eq(warehouses.id, transfer.fromWarehouseId), eq(warehouses.isActive, true)),
    })
    if (!fromWarehouse) {
      throw new Error('VALIDATION:Source warehouse is no longer active')
    }

    const toWarehouse = await tx.query.warehouses.findFirst({
      where: and(eq(warehouses.id, transfer.toWarehouseId), eq(warehouses.isActive, true)),
    })
    if (!toWarehouse) {
      throw new Error('VALIDATION:Destination warehouse is no longer active')
    }

    // Lock the transfer row and re-check the status (concurrent ship guard)
    const [lockedTransfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, transfer.id))
      .for('update')
    if (!lockedTransfer || lockedTransfer.status !== 'approved') {
      throw new Error('VALIDATION:Transfer is no longer approved')
    }

    // Deduct stock from source warehouse (lines in lock order: itemId, then line id)
    const shipLines = [...transfer.items].sort(byItemThenLine)
    for (const item of shipLines) {
      const transferQty = parseFloat(item.quantity)

      const shipInput: StockChangeInput = {
        tenantId: session.user.tenantId,
        warehouseId: transfer.fromWarehouseId,
        itemId: item.itemId,
        mode: 'delta',
        qty: -transferQty,
        type: 'out',
        referenceType: 'stock_transfer',
        referenceId: transfer.id,
        notes: `Transfer to ${transfer.toWarehouse?.name || 'another warehouse'}`,
        userId,
        source: 'transfer',
        costCenterId: transfer.costCenterId || null,
        idempotencyKey: `transfer-out:${transfer.id}:${item.id}`,
      }
      let shipResult: StockChangeResult
      try {
        shipResult = await applyStockChange(tx, shipInput)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.startsWith('INSUFFICIENT_STOCK:')) {
          const m = msg.match(/have: (-?[\d.]+)\)$/)
          throw new Error(`VALIDATION:Insufficient stock for ${item.item?.name || 'item'}. Available: ${m ? m[1] : 0}, Requested: ${transferQty}`)
        }
        throw err
      }
      decreased.push({ result: shipResult, input: shipInput })

      // Release the reservation made at approval (8G). Reserved stock is not
      // ledgered; current stock above went through applyStockChange.
      await tx.update(warehouseStock)
        .set({
          reservedStock: sql`GREATEST(0, ${warehouseStock.reservedStock} - ${transferQty})`,
          updatedAt: new Date(),
        })
        .where(eq(warehouseStock.id, shipResult.warehouseStockId))

      // Serial number tracking: transfer serials from source to destination warehouse
      const itemRecord = await tx.query.items.findFirst({
        where: eq(itemsTable.id, item.itemId),
        columns: { trackSerialNumbers: true, trackBatches: true }
      })

      // Batch tracking: take the shipped quantity out of the source batches (FEFO) and keep the
      // picks on the line; receive puts them into the destination warehouse, cancel puts them back.
      if (itemRecord?.trackBatches) {
        const picked = await allocateBatchesFEFO(tx, {
          tenantId: session.user.tenantId,
          warehouseId: transfer.fromWarehouseId,
          itemId: item.itemId,
          qty: transferQty,
          allowExpired: true,
          allowShortfall: true,
          itemName: item.item?.name,
        })
        await tx.update(stockTransferItems)
          .set({ batchAllocations: picked.allocations })
          .where(eq(stockTransferItems.id, item.id))
      }

      if (itemRecord?.trackSerialNumbers) {
        // Find available serials for this item in source warehouse
        const availableSerials = await tx.select()
          .from(itemSerialNumbers)
          .where(and(
            eq(itemSerialNumbers.itemId, item.itemId),
            eq(itemSerialNumbers.warehouseId, transfer.fromWarehouseId),
            eq(itemSerialNumbers.status, 'available'),
          ))
          .orderBy(itemSerialNumbers.id)
          .limit(Math.ceil(transferQty))
          .for('update')

        if (availableSerials.length > 0) {
          const serialIds = availableSerials.map((s: { id: string }) => s.id)
          await transferSerials(tx, {
            tenantId: session.user.tenantId,
            serialNumberIds: serialIds,
            toWarehouseId: transfer.toWarehouseId,
            referenceType: 'stock_transfer',
            referenceId: transfer.id,
            changedBy: userId,
            notes: `Transfer to ${transfer.toWarehouse?.name || 'destination warehouse'}`,
          })

          // Persist picked serial IDs on the transfer item
          await tx.update(stockTransferItems)
            .set({ serialNumberIds: serialIds })
            .where(eq(stockTransferItems.id, item.id))
        }
      }
    }

    const [updated] = await tx.update(stockTransfers)
      .set({
        status: 'in_transit',
        shippedAt: new Date(),
        shippedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(stockTransfers.id, transfer.id))
      .returning()

    return updated
  })

  notifyStockDecreased(decreased)

  // STW-6: Log status change
  await logStatusChange(db, session.user.tenantId, userId, 'stock_transfer', transfer.id,
    'approved', 'in_transit')

  logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', transfer.id)
  logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', transfer.fromWarehouseId)
  // WS-3: Broadcast specific item IDs (not 'all')
  for (const item of transfer.items) {
    logAndBroadcast(session.user.tenantId, 'item', 'updated', item.itemId)
  }

  return NextResponse.json(result)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleReceive(db: any, session: any, transfer: any, receivedItems: any[] | undefined, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permError = requirePermission({ user: session.user } as any, 'manageInventory')
  if (permError) return permError

  if (transfer.status !== 'in_transit') {
    return NextResponse.json({
      error: 'Can only receive transfers in transit'
    }, { status: 400 })
  }

  // Pre-validate accounting config BEFORE moving any stock (a failure after the commit
  // would report an error for a transfer that was in fact received)
  const acctError = await requireAccountingConfig(db, session.user.tenantId, 'stock_transfer')
  if (acctError) return acctError

  // Issue #64: Wrap receive in transaction with FOR UPDATE locks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    // Lock the transfer row and re-check the status (concurrent receive guard)
    const [lockedTransfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, transfer.id))
      .for('update')
    if (!lockedTransfer || lockedTransfer.status !== 'in_transit') {
      throw new Error('VALIDATION:Transfer is no longer in transit')
    }

    // STW-7: Re-validate warehouses are still active
    const fromWarehouse = await tx.query.warehouses.findFirst({
      where: and(eq(warehouses.id, transfer.fromWarehouseId), eq(warehouses.isActive, true)),
    })
    if (!fromWarehouse) {
      throw new Error('VALIDATION:Source warehouse is no longer active')
    }

    const toWarehouse = await tx.query.warehouses.findFirst({
      where: and(eq(warehouses.id, transfer.toWarehouseId), eq(warehouses.isActive, true)),
    })
    if (!toWarehouse) {
      throw new Error('VALIDATION:Destination warehouse is no longer active')
    }

    // Process each item (lock order: itemId, then line id)
    for (const transferItem of [...transfer.items].sort(byItemThenLine)) {
      // STW-5: Match by transferItem.id (line-item ID) not itemId (product ID)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedItem = receivedItems?.find((r: any) => r.transferItemId === transferItem.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?? (transfer.items.filter((ti: any) => ti.itemId === transferItem.itemId).length === 1
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? receivedItems?.find((r: any) => !r.transferItemId && r.itemId === transferItem.itemId)
          : undefined)
      const receivedQty = receivedItem
        ? parseFloat(receivedItem.receivedQuantity)
        : parseFloat(transferItem.quantity)

      // STW-2: Validate received quantity doesn't exceed transferred
      const transferredQty = parseFloat(transferItem.quantity)
      if (receivedQty > transferredQty) {
        throw new Error(`VALIDATION:Cannot receive ${receivedQty} of ${transferItem.item?.name || 'item'} when only ${transferredQty} was transferred`)
      }

      // Update received quantity on transfer item
      await tx.update(stockTransferItems)
        .set({ receivedQuantity: receivedQty.toString() })
        .where(eq(stockTransferItems.id, transferItem.id))

      // Add the received quantity at the destination (paired with the ship 'out')
      if (receivedQty > 0) {
        await applyStockChange(tx, {
          tenantId: session.user.tenantId,
          warehouseId: transfer.toWarehouseId,
          itemId: transferItem.itemId,
          mode: 'delta',
          qty: receivedQty,
          type: 'in',
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          notes: `Transfer from ${transfer.fromWarehouse?.name || 'another warehouse'}`,
          userId,
          source: 'transfer',
          costCenterId: transfer.costCenterId || null,
          idempotencyKey: `transfer-in:${transfer.id}:${transferItem.id}`,
        })

        // Batches picked at ship time arrive in the destination warehouse (earliest pick first;
        // a short receipt leaves the rest out, like the stock itself)
        let left = receivedQty
        for (const a of (transferItem.batchAllocations || []) as BatchAllocation[]) {
          if (left <= 0) break
          const q = Math.round(Math.min(left, Number(a.quantity)) * 1000) / 1000
          if (!(q > 0)) continue
          await putIntoBatch(tx, {
            tenantId: session.user.tenantId,
            srcBatchId: a.batchId,
            toWarehouseId: transfer.toWarehouseId,
            qty: q,
            notes: `Transfer ${transfer.transferNo || ''}`.trim(),
          })
          left = Math.round((left - q) * 1000) / 1000
        }
      }
    }

    // Post stock transfer to GL in the same transaction (all-or-nothing with the receipt)
    const glItems = transfer.items.map((ti: { item?: { name?: string; costPrice?: string }; quantity: string }) => ({
      itemName: ti.item?.name || 'Item',
      quantity: parseFloat(ti.quantity),
      costPrice: parseFloat(ti.item?.costPrice || '0'),
    })).filter((i: { costPrice: number }) => i.costPrice > 0)

    if (glItems.length > 0) {
      await postStockTransferToGL(tx, session.user.tenantId, {
        transferId: transfer.id,
        transferNo: transfer.transferNo,
        items: glItems,
        costCenterId: transfer.costCenterId || null,
      })
    }

    const [updated] = await tx.update(stockTransfers)
      .set({
        status: 'completed',
        receivedAt: new Date(),
        receivedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(stockTransfers.id, transfer.id))
      .returning()

    return updated
  })

  // STW-6: Log status change
  await logStatusChange(db, session.user.tenantId, userId, 'stock_transfer', transfer.id,
    'in_transit', 'completed')

  logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', transfer.id)
  logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', transfer.toWarehouseId)
  // WS-3: Broadcast specific item IDs (not 'all')
  for (const transferItem of transfer.items) {
    logAndBroadcast(session.user.tenantId, 'item', 'updated', transferItem.itemId)
  }

  return NextResponse.json(result)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCancel(db: any, session: any, transfer: any, reason: string | undefined, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permError = requirePermission({ user: session.user } as any, 'manageInventory')
  if (permError) return permError

  // Can cancel draft, pending_approval, approved, or in_transit transfers
  // Completed transfers cannot be cancelled (would require a reverse transfer)
  if (!['draft', 'pending_approval', 'approved', 'in_transit'].includes(transfer.status)) {
    return NextResponse.json({
      error: 'Cannot cancel completed transfers. Create a reverse transfer instead.'
    }, { status: 400 })
  }

  if (!reason) {
    return NextResponse.json({ error: 'Cancellation reason is required' }, { status: 400 })
  }

  // Wrap all stock modifications in a transaction with FOR UPDATE locks
  const previousStatus = transfer.status
  const cancelDecreased: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await db.transaction(async (tx: any) => {
    // Lock transfer row to prevent concurrent cancellation
    const [lockedTransfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, transfer.id))
      .for('update')

    if (!lockedTransfer || !['draft', 'pending_approval', 'approved', 'in_transit'].includes(lockedTransfer.status)) {
      throw new Error('VALIDATION:Transfer can no longer be cancelled')
    }

    // 8G: If approved (not yet shipped), release reservedStock
    if (lockedTransfer.status === 'approved') {
      for (const item of transfer.items) {
        const transferQty = parseFloat(item.quantity)
        await tx.update(warehouseStock)
          .set({
            reservedStock: sql`GREATEST(0, ${warehouseStock.reservedStock} - ${transferQty})`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(warehouseStock.warehouseId, transfer.fromWarehouseId),
            eq(warehouseStock.itemId, item.itemId)
          ))
      }
    }

    // If in_transit, restore stock to source warehouse
    // STW-4: Also reverse any partial receipts from destination warehouse
    if (lockedTransfer.status === 'in_transit') {
      for (const item of [...transfer.items].sort(byItemThenLine)) {
        const transferQty = parseFloat(item.quantity)
        const receivedQty = parseFloat(item.receivedQuantity || '0')

        // STW-4: If any quantity was already received, reverse it from destination
        // (no clamping: insufficient destination stock aborts the cancellation)
        if (receivedQty > 0) {
          const destInput: StockChangeInput = {
            tenantId: session.user.tenantId,
            warehouseId: transfer.toWarehouseId,
            itemId: item.itemId,
            mode: 'delta',
            qty: -receivedQty,
            type: 'out',
            referenceType: 'stock_transfer_cancelled',
            referenceId: transfer.id,
            notes: `Cancelled transfer - partially received stock reversed`,
            userId,
            source: 'transfer',
            costCenterId: transfer.costCenterId || null,
            idempotencyKey: `transfer-cancel-in:${transfer.id}:${item.id}`,
          }
          const destResult = await applyStockChange(tx, destInput)
          cancelDecreased.push({ result: destResult, input: destInput })
        }

        // Restore the shipped quantity at the source warehouse
        await applyStockChange(tx, {
          tenantId: session.user.tenantId,
          warehouseId: transfer.fromWarehouseId,
          itemId: item.itemId,
          mode: 'delta',
          qty: transferQty,
          type: 'in',
          referenceType: 'stock_transfer_cancelled',
          referenceId: transfer.id,
          notes: `Cancelled transfer - stock restored from ${transfer.toWarehouse?.name || 'destination'}`,
          userId,
          source: 'transfer',
          costCenterId: transfer.costCenterId || null,
          idempotencyKey: `transfer-cancel-out:${transfer.id}:${item.id}`,
        })

        // Batches picked at ship time go back into their source batches
        for (const a of (item.batchAllocations || []) as BatchAllocation[]) {
          if (!(Number(a.quantity) > 0)) continue
          await putIntoBatch(tx, {
            tenantId: session.user.tenantId,
            srcBatchId: a.batchId,
            toWarehouseId: transfer.fromWarehouseId,
            qty: Number(a.quantity),
          })
        }

        // Serial number tracking: transfer serials back to source warehouse using stored IDs
        const storedSerialIds = item.serialNumberIds as string[] | null
        if (storedSerialIds?.length) {
          await transferSerials(tx, {
            tenantId: session.user.tenantId,
            serialNumberIds: storedSerialIds,
            toWarehouseId: transfer.fromWarehouseId,
            referenceType: 'stock_transfer_cancelled',
            referenceId: transfer.id,
            changedBy: userId,
            notes: `Transfer cancelled - serials returned to source`,
          })
        }
      }
    }

    const [cancelledTransfer] = await tx.update(stockTransfers)
      .set({
        status: 'cancelled',
        cancellationReason: reason,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stockTransfers.id, transfer.id))
      .returning()

    return cancelledTransfer
  })

  notifyStockDecreased(cancelDecreased)

  // STW-6: Log status change
  await logStatusChange(db, session.user.tenantId, userId, 'stock_transfer', transfer.id,
    previousStatus, 'cancelled', reason)

  logAndBroadcast(session.user.tenantId, 'stock-transfer', 'updated', transfer.id)

  // If we restored stock, broadcast that too
  if (transfer.status === 'in_transit') {
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', transfer.fromWarehouseId)
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', transfer.toWarehouseId)
    // WS-3: Broadcast specific item IDs (not 'all')
    for (const item of transfer.items) {
      logAndBroadcast(session.user.tenantId, 'item', 'updated', item.itemId)
    }
  }

  return NextResponse.json(updated)
}
