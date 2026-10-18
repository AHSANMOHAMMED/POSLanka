import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems, insuranceEstimateAttachments, customers, vehicles, insuranceCompanies, insuranceAssessors, workOrders, workOrderParts, warehouseStock, heldSales, stockTransfers, stockTransferItems } from '@/lib/db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { deleteEstimateAttachmentFiles } from '@/lib/utils/file-cleanup'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { triggerNotification } from '@/lib/notifications/auto-trigger'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateInsuranceEstimateSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// E12: Valid status transitions for estimates
// Issue 10: Allow cancellation from more statuses
const validStatusTransitions: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'partially_approved', 'rejected', 'cancelled'],
  approved: ['work_order_created', 'cancelled'],
  partially_approved: ['work_order_created', 'draft', 'cancelled'], // Can revise (back to draft), convert, or cancel
  rejected: ['draft', 'cancelled'], // Can revise (back to draft) or cancel
  work_order_created: [], // Terminal state
  cancelled: [], // Terminal state
}

// GET single insurance estimate
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, id),
        with: {
          customer: true,
          vehicle: true,
          insuranceCompany: true,
          assessor: true,
          workOrder: true,
          createdByUser: true,
          submittedByUser: true,
          items: {
            with: {
              serviceType: true,
              item: true,
            },
            orderBy: (items, { asc }) => [asc(items.sortOrder)],
          },
          revisions: {
            orderBy: (revisions, { desc }) => [desc(revisions.revisionNumber)],
          },
        },
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Insurance estimate not found' }, { status: 404 })
      }

      // Enrich items with availableStock (computed from warehouseStock + reservations)
      const stockItemIds = estimate.items
        .filter(item => item.item && !Array.isArray(item.item) && item.item.trackStock && item.itemId)
        .map(item => item.itemId as string)

      if (stockItemIds.length === 0) {
        return NextResponse.json(estimate)
      }

      const warehouseId = estimate.warehouseId

      // 1. Get warehouse stock (batch)
      const currentStockMap = new Map<string, number>()
      if (warehouseId) {
        const stockData = await db
          .select({
            itemId: warehouseStock.itemId,
            currentStock: warehouseStock.currentStock,
          })
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.warehouseId, warehouseId),
            inArray(warehouseStock.itemId, stockItemIds)
          ))
        for (const s of stockData) {
          currentStockMap.set(s.itemId, parseFloat(s.currentStock))
        }
      } else {
        const stockData = await db
          .select({
            itemId: warehouseStock.itemId,
            totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
          })
          .from(warehouseStock)
          .where(inArray(warehouseStock.itemId, stockItemIds))
          .groupBy(warehouseStock.itemId)
        for (const s of stockData) {
          currentStockMap.set(s.itemId, parseFloat(s.totalStock))
        }
      }

      // 2. Reservations from work orders
      const reservedMap = new Map<string, number>()
      const woReservedWhere = warehouseId
        ? and(
            inArray(workOrderParts.itemId, stockItemIds),
            sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
            eq(workOrders.warehouseId, warehouseId)
          )
        : and(
            inArray(workOrderParts.itemId, stockItemIds),
            sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`
          )
      const woReserved = await db
        .select({
          itemId: workOrderParts.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
        })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .where(woReservedWhere)
        .groupBy(workOrderParts.itemId)
      for (const r of woReserved) {
        reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
      }

      // 3. Reservations from held sales
      const heldSalesWhere = warehouseId
        ? and(eq(heldSales.warehouseId, warehouseId), sql`${heldSales.expiresAt} > NOW()`)
        : sql`${heldSales.expiresAt} > NOW()`
      const heldSalesData = await db.query.heldSales.findMany({ where: heldSalesWhere })
      for (const held of heldSalesData) {
        const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
        if (Array.isArray(cartItems)) {
          for (const ci of cartItems) {
            if (ci.itemId && stockItemIds.includes(ci.itemId)) {
              reservedMap.set(ci.itemId, (reservedMap.get(ci.itemId) || 0) + (ci.quantity || 0))
            }
          }
        }
      }

      // 4. Reservations from OTHER estimates with holdStock (excluding this one)
      const estReservedWhere = warehouseId
        ? and(
            inArray(insuranceEstimateItems.itemId, stockItemIds),
            eq(insuranceEstimates.holdStock, true),
            eq(insuranceEstimates.warehouseId, warehouseId),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimates.id} != ${id}`
          )
        : and(
            inArray(insuranceEstimateItems.itemId, stockItemIds),
            eq(insuranceEstimates.holdStock, true),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimates.id} != ${id}`
          )
      const estReserved = await db
        .select({
          itemId: insuranceEstimateItems.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
        })
        .from(insuranceEstimateItems)
        .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
        .where(estReservedWhere)
        .groupBy(insuranceEstimateItems.itemId)
      for (const r of estReserved) {
        if (r.itemId) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // 5. Reservations from outbound stock transfers
      if (warehouseId) {
        const transferReserved = await db
          .select({
            itemId: stockTransferItems.itemId,
            reservedQty: sql<string>`COALESCE(SUM(CAST(${stockTransferItems.quantity} AS DECIMAL)), 0)`,
          })
          .from(stockTransferItems)
          .innerJoin(stockTransfers, eq(stockTransferItems.transferId, stockTransfers.id))
          .where(and(
            inArray(stockTransferItems.itemId, stockItemIds),
            eq(stockTransfers.fromWarehouseId, warehouseId),
            sql`${stockTransfers.status} IN ('approved', 'in_transit')`
          ))
          .groupBy(stockTransferItems.itemId)
        for (const r of transferReserved) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // Attach availableStock to each item's nested item object
      const enrichedItems = estimate.items.map(item => ({
        ...item,
        item: item.item && !Array.isArray(item.item) ? {
          ...item.item,
          availableStock: String(Math.max(0,
            (currentStockMap.get(item.itemId!) ?? 0) - (reservedMap.get(item.itemId!) ?? 0)
          )),
          currentStock: String(currentStockMap.get(item.itemId!) ?? 0),
        } : item.item,
      }))

      return NextResponse.json({ ...estimate, items: enrichedItems })
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch insurance estimate' }, { status: 500 })
  }
}

// PUT update insurance estimate
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // E5: Check permission
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateInsuranceEstimateSchema)
    if (!parsed.success) return parsed.response
    const {
      customerId,
      vehicleId,
      insuranceCompanyId,
      policyNumber,
      claimNumber,
      assessorId,
      assessorName,
      assessorPhone,
      assessorEmail,
      incidentDate,
      incidentDescription,
      odometerIn,
      status,
      insuranceRemarks,
      cancellationReason,
      expectedUpdatedAt,
      holdStock,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Validate foreign keys belong to tenant (prevent cross-tenant reference)
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
        }
      }

      if (vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({
          where: eq(vehicles.id, vehicleId),
        })
        if (!vehicle) {
          return NextResponse.json({ error: 'Invalid vehicle' }, { status: 400 })
        }
      }

      if (insuranceCompanyId) {
        const company = await db.query.insuranceCompanies.findFirst({
          where: eq(insuranceCompanies.id, insuranceCompanyId),
        })
        if (!company) {
          return NextResponse.json({ error: 'Invalid insurance company' }, { status: 400 })
        }
      }

      if (assessorId) {
        const assessor = await db.query.insuranceAssessors.findFirst({
          where: eq(insuranceAssessors.id, assessorId),
        })
        if (!assessor) {
          return NextResponse.json({ error: 'Invalid assessor' }, { status: 400 })
        }
      }

      // Use transaction with FOR UPDATE to prevent TOCTOU race condition
      const result = await db.transaction(async (tx) => {
        // Lock and get current estimate to validate state (RLS scopes to tenant)
        const [currentEstimate] = await tx
          .select()
          .from(insuranceEstimates)
          .where(eq(insuranceEstimates.id, id))
          .for('update')

        if (!currentEstimate) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = currentEstimate.updatedAt ? new Date(currentEstimate.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // E12: Validate status transitions
        if (status && status !== currentEstimate.status) {
          const allowedTransitions = validStatusTransitions[currentEstimate.status] || []
          if (!allowedTransitions.includes(status)) {
            throw new Error(`INVALID_TRANSITION:Cannot change status from '${currentEstimate.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`)
          }
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        // Only allow certain fields to be updated based on status
        if (currentEstimate.status === 'draft') {
          if (customerId !== undefined) updateData.customerId = customerId || null
          if (vehicleId !== undefined) updateData.vehicleId = vehicleId || null
          if (insuranceCompanyId !== undefined) updateData.insuranceCompanyId = insuranceCompanyId || null
          if (policyNumber !== undefined) updateData.policyNumber = policyNumber || null
          if (claimNumber !== undefined) updateData.claimNumber = claimNumber || null
          if (assessorId !== undefined) updateData.assessorId = assessorId || null
          if (assessorName !== undefined) updateData.assessorName = assessorName || null
          if (assessorPhone !== undefined) updateData.assessorPhone = assessorPhone || null
          if (assessorEmail !== undefined) updateData.assessorEmail = assessorEmail || null
          if (incidentDate !== undefined) updateData.incidentDate = incidentDate || null
          if (incidentDescription !== undefined) updateData.incidentDescription = incidentDescription || null
          if (odometerIn !== undefined) updateData.odometerIn = odometerIn || null
        }

        // Allow assessor and incident description updates even after submission (before work order created)
        if (['submitted', 'under_review', 'approved', 'rejected', 'partially_approved'].includes(currentEstimate.status)) {
          if (assessorId !== undefined) updateData.assessorId = assessorId || null
          if (assessorName !== undefined) updateData.assessorName = assessorName || null
          if (assessorPhone !== undefined) updateData.assessorPhone = assessorPhone || null
          if (assessorEmail !== undefined) updateData.assessorEmail = assessorEmail || null
          if (incidentDescription !== undefined) updateData.incidentDescription = incidentDescription || null
        }

        // Status changes and insurance remarks can be updated at various stages
        if (status !== undefined) updateData.status = status
        if (insuranceRemarks !== undefined) updateData.insuranceRemarks = insuranceRemarks || null

        // Allow holdStock to be updated when estimate is not in terminal states
        const stockWarnings: string[] = []
        if (holdStock !== undefined && !['work_order_created', 'cancelled'].includes(currentEstimate.status)) {
          updateData.holdStock = holdStock

          // When enabling holdStock, validate stock availability for all items
          if (holdStock && !currentEstimate.holdStock) {
            // Get all part items in this estimate with their item details
            const estimateParts = await tx.query.insuranceEstimateItems.findMany({
              where: and(
                eq(insuranceEstimateItems.estimateId, id),
                eq(insuranceEstimateItems.itemType, 'part')
              ),
              with: {
                item: true,
              },
            })

            // Aggregate total quantity needed per unique itemId
            // This handles cases where the same item appears on multiple lines
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const itemQtyMap = new Map<string, { item: any, totalQty: number }>()
            for (const part of estimateParts) {
              const item = Array.isArray(part.item) ? part.item[0] : part.item
              if (!part.itemId || !item || !item.trackStock) continue
              const existing = itemQtyMap.get(part.itemId)
              const partQty = parseFloat(part.quantity || '0')
              if (existing) {
                existing.totalQty += partQty
              } else {
                itemQtyMap.set(part.itemId, { item, totalQty: partQty })
              }
            }

            // Calculate reserved stock from all sources and validate each unique item
            for (const [itemId, { item, totalQty }] of itemQtyMap) {
              let totalReserved = 0

              // 1. Reserved from draft work orders (warehouse-scoped)
              const workOrderWhere = currentEstimate.warehouseId
                ? and(eq(workOrderParts.itemId, itemId), eq(workOrders.status, 'draft'), eq(workOrders.warehouseId, currentEstimate.warehouseId))
                : and(eq(workOrderParts.itemId, itemId), eq(workOrders.status, 'draft'))
              const [workOrderReserved] = await tx
                .select({
                  reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
                })
                .from(workOrderParts)
                .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
                .where(workOrderWhere)
              totalReserved += parseFloat(workOrderReserved?.reservedQty || '0')

              // 2. Reserved from non-expired held sales (warehouse-scoped)
              const heldSalesWhere = currentEstimate.warehouseId
                ? and(eq(heldSales.warehouseId, currentEstimate.warehouseId), sql`${heldSales.expiresAt} > NOW()`)
                : sql`${heldSales.expiresAt} > NOW()`
              const heldSalesData = await tx.query.heldSales.findMany({
                where: heldSalesWhere,
              })
              for (const held of heldSalesData) {
                const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
                if (Array.isArray(cartItems)) {
                  for (const cartItem of cartItems) {
                    if (cartItem.itemId === itemId) {
                      totalReserved += cartItem.quantity || 0
                    }
                  }
                }
              }

              // 3. Reserved from OTHER estimates with holdStock (not this one, warehouse-scoped)
              const otherEstWhere = currentEstimate.warehouseId
                ? and(
                    eq(insuranceEstimateItems.itemId, itemId),
                    eq(insuranceEstimates.holdStock, true),
                    eq(insuranceEstimates.warehouseId, currentEstimate.warehouseId),
                    sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
                    sql`${insuranceEstimates.id} != ${id}`
                  )
                : and(
                    eq(insuranceEstimateItems.itemId, itemId),
                    eq(insuranceEstimates.holdStock, true),
                    sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
                    sql`${insuranceEstimates.id} != ${id}`
                  )
              const [otherEstimatesReserved] = await tx
                .select({
                  reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
                })
                .from(insuranceEstimateItems)
                .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
                .where(otherEstWhere)
              totalReserved += parseFloat(otherEstimatesReserved?.reservedQty || '0')

              // Get stock from specific warehouse (or aggregated if no warehouse)
              let currentStock = 0
              if (currentEstimate.warehouseId) {
                const [stockData] = await tx
                  .select({
                    totalStock: sql<string>`COALESCE(${warehouseStock.currentStock}, '0')`,
                  })
                  .from(warehouseStock)
                  .where(
                    and(
                      eq(warehouseStock.warehouseId, currentEstimate.warehouseId),
                      eq(warehouseStock.itemId, itemId)
                    )
                  )
                currentStock = parseFloat(stockData?.totalStock || '0')
              } else {
                const [stockData] = await tx
                  .select({
                    totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
                  })
                  .from(warehouseStock)
                  .where(eq(warehouseStock.itemId, itemId))
                currentStock = parseFloat(stockData?.totalStock || '0')
              }
              const availableStock = Math.max(0, currentStock - totalReserved)

              if (totalQty > availableStock) {
                stockWarnings.push(`${item!.name}: need ${totalQty}, available ${availableStock}`)
              }
            }

            // If any items exceed available stock, reject enabling holdStock
            if (stockWarnings.length > 0) {
              throw new Error(`INSUFFICIENT_STOCK:${stockWarnings.join(', ')}`)
            }
          }
        }

        // Add cancellation data if status is cancelled
        if (status === 'cancelled') {
          updateData.cancellationReason = cancellationReason || null
          updateData.cancelledAt = new Date()
          // Issue 20: Release held stock when cancelling
          updateData.holdStock = false
        }

        const [updated] = await tx.update(insuranceEstimates)
          .set(updateData)
          .where(eq(insuranceEstimates.id, id))
          .returning()

        return { updated, previousEstimate: currentEstimate }
      })

      // Build change description for activity log
      const prev = result.previousEstimate
      const changes: string[] = []
      if (status !== undefined && status !== prev.status) {
        changes.push(`status → ${status}`)
      }
      if (customerId !== undefined && customerId !== prev.customerId) {
        changes.push('customer changed')
      }
      if (vehicleId !== undefined && vehicleId !== prev.vehicleId) {
        changes.push('vehicle changed')
      }
      if (insuranceCompanyId !== undefined && insuranceCompanyId !== prev.insuranceCompanyId) {
        changes.push('insurance company changed')
      }
      if (assessorId !== undefined && assessorId !== prev.assessorId) {
        changes.push('assessor changed')
      }
      if (assessorName !== undefined && assessorName !== prev.assessorName) {
        changes.push('assessor details updated')
      }
      if (incidentDescription !== undefined && incidentDescription !== prev.incidentDescription) {
        changes.push('incident description updated')
      }
      if (insuranceRemarks !== undefined && insuranceRemarks !== prev.insuranceRemarks) {
        changes.push('insurance remarks updated')
      }
      if (holdStock !== undefined && holdStock !== prev.holdStock) {
        changes.push(holdStock ? 'stock hold enabled' : 'stock hold disabled')
      }
      if (policyNumber !== undefined && policyNumber !== prev.policyNumber) {
        changes.push('policy number updated')
      }
      if (claimNumber !== undefined && claimNumber !== prev.claimNumber) {
        changes.push('claim number updated')
      }

      const entityName = prev.estimateNo || id
      const description = changes.length > 0
        ? `${entityName}: ${changes.join('; ')}`
        : `Saved ${entityName}`

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', id, {
        entityName,
        activityAction: status === 'cancelled' ? 'cancel' : 'update',
        description,
      })
      if (holdStock !== undefined) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })
      }

      // Fire-and-forget notification triggers for status changes
      if (status === 'approved') {
        triggerNotification(session.user.tenantId, 'estimate_approved', {
          tenantId: session.user.tenantId,
          customerId: result.updated.customerId,
          estimateId: id,
        }).catch(() => {})
      }
      if (status === 'rejected') {
        triggerNotification(session.user.tenantId, 'estimate_rejected', {
          tenantId: session.user.tenantId,
          customerId: result.updated.customerId,
          estimateId: id,
        }).catch(() => {})
      }

      return NextResponse.json(result.updated)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Insurance estimate not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This estimate was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message.startsWith('INVALID_TRANSITION:')) {
      return NextResponse.json({ error: message.replace('INVALID_TRANSITION:', '') }, { status: 400 })
    }
    if (message.startsWith('INSUFFICIENT_STOCK:')) {
      return NextResponse.json({
        error: `Cannot reserve stock - insufficient availability: ${message.replace('INSUFFICIENT_STOCK:', '')}`,
        code: 'INSUFFICIENT_STOCK'
      }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update insurance estimate' }, { status: 500 })
  }
}

// DELETE insurance estimate
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // E5: Check permission
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Fetch attachments before deletion (for file cleanup)
      const attachmentsToDelete = await db.query.insuranceEstimateAttachments.findMany({
        where: eq(insuranceEstimateAttachments.estimateId, id),
        columns: { filePath: true, fileHash: true },
      })

      // Use transaction with FOR UPDATE to prevent TOCTOU race condition
      await db.transaction(async (tx) => {
        // Lock and get estimate to validate status (RLS scopes to tenant)
        const [estimate] = await tx
          .select()
          .from(insuranceEstimates)
          .where(eq(insuranceEstimates.id, id))
          .for('update')

        if (!estimate) {
          throw new Error('NOT_FOUND')
        }

        if (estimate.status !== 'draft') {
          throw new Error('NOT_DRAFT')
        }

        // Delete attachments first
        await tx.delete(insuranceEstimateAttachments)
          .where(eq(insuranceEstimateAttachments.estimateId, id))

        // Delete items
        await tx.delete(insuranceEstimateItems)
          .where(eq(insuranceEstimateItems.estimateId, id))

        // Delete the estimate
        await tx.delete(insuranceEstimates)
          .where(eq(insuranceEstimates.id, id))
      })

      // Clean up files after successful DB deletion
      // Note: Files may not exist in ephemeral storage environments (e.g., after redeploy)
      if (attachmentsToDelete.length > 0) {
        await deleteEstimateAttachmentFiles(session.user.tenantId, attachmentsToDelete)
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'estimate', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Insurance estimate not found' }, { status: 404 })
    }
    if (message === 'NOT_DRAFT') {
      return NextResponse.json({ error: 'Only draft estimates can be deleted' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to delete insurance estimate' }, { status: 500 })
  }
}
