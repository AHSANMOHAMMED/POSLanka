import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { stockTakes, stockTakeItems, warehouses, users, categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateStockTakeSchema } from '@/lib/validation/schemas/stock'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { completeStockTake, StockTakeCompletionError } from '@/lib/inventory/complete-stock-take'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { toApiError } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'

// GET - Single stock take with all items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [stockTake] = await db.select({
      id: stockTakes.id,
      countNo: stockTakes.countNo,
      warehouseId: stockTakes.warehouseId,
      warehouseName: warehouses.name,
      status: stockTakes.status,
      countType: stockTakes.countType,
      categoryId: stockTakes.categoryId,
      categoryName: categories.name,
      notes: stockTakes.notes,
      createdBy: stockTakes.createdBy,
      createdByName: users.fullName,
      approvedBy: stockTakes.approvedBy,
      approvedAt: stockTakes.approvedAt,
      startedAt: stockTakes.startedAt,
      completedAt: stockTakes.completedAt,
      totalItems: stockTakes.totalItems,
      itemsCounted: stockTakes.itemsCounted,
      varianceCount: stockTakes.varianceCount,
      totalVarianceValue: stockTakes.totalVarianceValue,
      cancellationReason: stockTakes.cancellationReason,
      cancelledAt: stockTakes.cancelledAt,
      createdAt: stockTakes.createdAt,
      updatedAt: stockTakes.updatedAt,
    })
      .from(stockTakes)
      .leftJoin(warehouses, eq(stockTakes.warehouseId, warehouses.id))
      .leftJoin(users, eq(stockTakes.createdBy, users.id))
      .leftJoin(categories, eq(stockTakes.categoryId, categories.id))
      .where(eq(stockTakes.id, id))

    if (!stockTake) return { notFound: true }

    const items = await db.select()
      .from(stockTakeItems)
      .where(eq(stockTakeItems.stockTakeId, id))

    return { data: { ...stockTake, items } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('notFound' in result) return NextResponse.json({ error: 'Stock take not found' }, { status: 404 })
  return NextResponse.json(result.data)
}

// PUT - Update stock take status/notes
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateStockTakeSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      // Completing never just flips the status: it applies the counts through the
      // stock ledger (all-or-nothing; throws → rollback).
      if (body.status === 'completed') {
        const acctError = await requireAccountingConfig(tx, session.user.tenantId, 'stock_adjustment')
        if (acctError) return { error: acctError }
        const completed = await completeStockTake(tx, {
          tenantId: session.user.tenantId,
          stockTakeId: id,
          userId: session.user.id,
          allowedStatuses: ['pending_review'],
        })
        if (body.notes !== undefined) {
          await tx.update(stockTakes).set({ notes: body.notes }).where(eq(stockTakes.id, id))
        }
        const [updatedTake] = await tx.select().from(stockTakes).where(eq(stockTakes.id, id))
        const opts = { userId: session.user.id }
        logAndBroadcast(session.user.tenantId, 'stock-take', 'updated', id, opts)
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', completed.warehouseId, opts)
        logAndBroadcast(session.user.tenantId, 'stock-movement', 'created', 'bulk', opts)
        return { data: { ...updatedTake, adjustmentCount: completed.adjustmentCount } }
      }

      const [stockTake] = await tx.select()
        .from(stockTakes)
        .where(eq(stockTakes.id, id))
        .for('update')

      if (!stockTake) return { error: NextResponse.json({ error: 'Stock take not found' }, { status: 404 }) }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = { updatedAt: new Date() }

      if (body.notes !== undefined) updates.notes = body.notes

      // Status transitions
      if (body.status) {
        const validTransitions: Record<string, string[]> = {
          draft: ['in_progress', 'cancelled'],
          in_progress: ['pending_review', 'cancelled'],
          pending_review: ['completed', 'in_progress'],
        }

        const allowed = validTransitions[stockTake.status]
        if (!allowed || !allowed.includes(body.status)) {
          return { error: NextResponse.json({
            error: `Cannot transition from "${stockTake.status}" to "${body.status}"`
          }, { status: 400 }) }
        }

        updates.status = body.status

        if (body.status === 'in_progress' && !stockTake.startedAt) {
          updates.startedAt = new Date()
        }
        if (body.status === 'cancelled') {
          updates.cancelledAt = new Date()
          updates.cancellationReason = body.cancellationReason || null
        }
      }

      const [updated] = await tx.update(stockTakes)
        .set(updates)
        .where(eq(stockTakes.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'stock-take', 'updated', id, { userId: session.user.id })
      return { data: updated }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (error) {
    if (error instanceof StockTakeCompletionError) {
      return NextResponse.json({ error: error.message, lines: error.lines }, { status: error.status })
    }
    const mapped = toApiError(error)
    if (mapped) return mapped
    logError('api/stock-takes/[id]', error)
    return NextResponse.json({ error: 'Failed to update stock take' }, { status: 500 })
  }
}

// DELETE - Delete draft stock take
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return { error: permError }

    const [stockTake] = await tx.select()
      .from(stockTakes)
      .where(eq(stockTakes.id, id))

    if (!stockTake) return { error: NextResponse.json({ error: 'Stock take not found' }, { status: 404 }) }
    if (stockTake.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft stock takes can be deleted' }, { status: 400 }) }
    }

    // Items cascade-delete via FK
    await tx.delete(stockTakes).where(eq(stockTakes.id, id))
    logAndBroadcast(session.user.tenantId, 'stock-take', 'deleted', id)
    return { data: { success: true } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
