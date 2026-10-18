import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems, workOrders, workOrderServices, workOrderParts, items, warehouseStock } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { convertEstimateSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST convert approved estimate to work order (supports partial conversion)
export async function POST(
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

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data

    // Parse request body (empty body is OK for backward compatibility)
    let checkOnly = false
    let itemAdjustments: { itemId: string; action: 'convert' | 'skip' | 'partial'; quantity?: number }[] = []
    try {
      const parsed = await validateBody(request, convertEstimateSchema)
      if (!parsed.success) return parsed.response
      checkOnly = parsed.data.checkOnly
      itemAdjustments = parsed.data.itemAdjustments
    } catch {
      // Empty body is OK for backward compatibility
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get estimate with items (RLS scopes to tenant)
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, estimateId),
        with: {
          items: {
            with: {
              serviceType: true,
              item: true,
            },
          },
        },
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      const isDirectEstimate = estimate.estimateType === 'direct'

      // Reject terminal/invalid statuses explicitly (defense-in-depth)
      if (['rejected', 'cancelled'].includes(estimate.status)) {
        return NextResponse.json({ error: `Cannot convert a ${estimate.status} estimate` }, { status: 400 })
      }

      // Validate current status based on estimate type
      if (isDirectEstimate) {
        // Direct estimates can be converted from draft or work_order_created (for remaining items)
        if (!['draft', 'work_order_created'].includes(estimate.status)) {
          return NextResponse.json({ error: 'Cannot convert this estimate' }, { status: 400 })
        }
      } else {
        // Insurance estimates require approval, or work_order_created for remaining items
        if (!['approved', 'partially_approved', 'work_order_created'].includes(estimate.status)) {
          return NextResponse.json({ error: 'Can only convert approved or partially approved estimates' }, { status: 400 })
        }
      }

      // Get items to convert - only items not yet converted
      // For direct estimates: all items at original amounts
      // For insurance estimates: only approved/price_adjusted items at approved amounts
      // C7: Services must have hours > 0 to be converted
      const approvedServices = estimate.items.filter(
        item => item.itemType === 'service' &&
                !item.convertedToWorkOrderId && // Not yet converted
                parseFloat(item.hours || '0') > 0 && // C7: Must have positive hours
                (isDirectEstimate || ['approved', 'price_adjusted'].includes(item.status))
      )

      // Track services with zero hours that would otherwise be approved
      const servicesWithZeroHours = estimate.items.filter(
        item => item.itemType === 'service' &&
                !item.convertedToWorkOrderId && // Not yet converted
                parseFloat(item.hours || '0') <= 0 && // Zero or negative hours
                (isDirectEstimate || ['approved', 'price_adjusted'].includes(item.status))
      )

      // E1: Track parts that would be approved but lack itemId (cannot be added to work order)
      const partsNeedingInventoryLink = estimate.items.filter(
        item => item.itemType === 'part' &&
                !item.convertedToWorkOrderId && // Not yet converted
                !item.itemId && // Missing inventory item link
                (isDirectEstimate || ['approved', 'price_adjusted'].includes(item.status))
      )

      // C7: Parts must have itemId and quantity > 0 to be converted to work order
      const approvedParts = estimate.items.filter(
        item => item.itemType === 'part' &&
                !item.convertedToWorkOrderId && // Not yet converted
                item.itemId && // Must have linked inventory item
                parseFloat(item.quantity || '0') > 0 && // C7: Must have positive quantity
                (isDirectEstimate || ['approved', 'price_adjusted'].includes(item.status))
      )

      if (approvedServices.length === 0 && approvedParts.length === 0) {
        // E1: Include info about skipped parts in the error
        if (partsNeedingInventoryLink.length > 0) {
          return NextResponse.json({
            error: `No items to convert. ${partsNeedingInventoryLink.length} part(s) were skipped because they are not linked to inventory items.`
          }, { status: 400 })
        }
        return NextResponse.json({ error: 'No items to convert. All eligible items may have already been converted.' }, { status: 400 })
      }

      // Check stock availability for all parts
      const stockInfo: {
        itemId: string // estimate item id
        partName: string
        inventoryItemId: string
        requiredQty: number
        availableStock: number
        hasStockIssue: boolean
        trackStock: boolean
      }[] = []

      for (const part of approvedParts) {
        if (part.itemId) {
          const item = await db.query.items.findFirst({
            where: eq(items.id, part.itemId),
          })
          if (item) {
            const requiredQty = parseFloat(part.quantity || '1')
            const trackStock = item.trackStock

            // Get stock from specific warehouse (or aggregated if no warehouse)
            let currentStock = 0
            if (estimate.warehouseId) {
              const [stockData] = await db
                .select({
                  totalStock: sql<string>`COALESCE(${warehouseStock.currentStock}, '0')`,
                })
                .from(warehouseStock)
                .where(
                  and(
                    eq(warehouseStock.warehouseId, estimate.warehouseId),
                    eq(warehouseStock.itemId, part.itemId)
                  )
                )
              currentStock = parseFloat(stockData?.totalStock || '0')
            } else {
              const [stockData] = await db
                .select({
                  totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
                })
                .from(warehouseStock)
                .where(eq(warehouseStock.itemId, part.itemId))
              currentStock = parseFloat(stockData?.totalStock || '0')
            }

            stockInfo.push({
              itemId: part.id,
              partName: part.partName || item.name,
              inventoryItemId: part.itemId,
              requiredQty,
              availableStock: currentStock,
              hasStockIssue: trackStock && currentStock < requiredQty,
              trackStock,
            })
          }
        }
      }

      // If checkOnly, return stock availability info
      if (checkOnly) {
        const itemsWithStockIssues = stockInfo.filter(s => s.hasStockIssue)
        return NextResponse.json({
          checkOnly: true,
          canConvert: true,
          services: approvedServices.length,
          parts: approvedParts.length,
          partsNeedingInventoryLink: partsNeedingInventoryLink.length,
          stockInfo,
          hasStockIssues: itemsWithStockIssues.length > 0,
          itemsWithStockIssues,
        })
      }

      // Build adjustment map from user decisions
      const adjustmentMap = new Map<string, typeof itemAdjustments[number]>()
      for (const adj of itemAdjustments) {
        adjustmentMap.set(adj.itemId, adj)
      }

      // Process parts based on stock and user adjustments
      const partsToConvert: (typeof approvedParts[0] & { adjustedQuantity?: number })[] = []
      const partsSkippedNoStock: { part: typeof approvedParts[0], reason: string }[] = []
      const partsSkippedByUser: typeof approvedParts = []

      for (const part of approvedParts) {
        const info = stockInfo.find(s => s.itemId === part.id)
        const adjustment = adjustmentMap.get(part.id)

        if (adjustment) {
          // User made a decision for this item
          if (adjustment.action === 'skip') {
            partsSkippedByUser.push(part)
            continue
          } else if (adjustment.action === 'partial' && adjustment.quantity !== undefined) {
            // Validate partial quantity
            if (adjustment.quantity <= 0) {
              partsSkippedByUser.push(part)
              continue
            }
            if (info && info.trackStock && adjustment.quantity > info.availableStock) {
              return NextResponse.json({
                error: `Invalid quantity for ${part.partName}. Requested: ${adjustment.quantity}, Available: ${info.availableStock}`
              }, { status: 400 })
            }
            partsToConvert.push({ ...part, adjustedQuantity: adjustment.quantity })
            continue
          }
          // action === 'convert' - fall through to normal processing
        }

        // No user adjustment or action is 'convert' - check stock
        if (info && info.hasStockIssue) {
          partsSkippedNoStock.push({
            part,
            reason: `Insufficient stock (need: ${info.requiredQty}, available: ${info.availableStock})`
          })
          continue
        }

        partsToConvert.push(part)
      }

      // If nothing can be converted at all, return error
      if (approvedServices.length === 0 && partsToConvert.length === 0) {
        // Issue #59: Append skip reasons instead of overwriting
        for (const { part, reason } of partsSkippedNoStock) {
          const existing = part.conversionSkippedReason
          await db.update(insuranceEstimateItems)
            .set({ conversionSkippedReason: existing ? `${existing}; ${reason}` : reason })
            .where(eq(insuranceEstimateItems.id, part.id))
        }

        for (const part of partsSkippedByUser) {
          const reason = 'Skipped by user during conversion'
          const existing = part.conversionSkippedReason
          await db.update(insuranceEstimateItems)
            .set({ conversionSkippedReason: existing ? `${existing}; ${reason}` : reason })
            .where(eq(insuranceEstimateItems.id, part.id))
        }

        return NextResponse.json({
          error: 'No items could be converted due to insufficient stock',
          skippedItems: partsSkippedNoStock.map(p => ({
            name: p.part.partName || 'Unknown part',
            reason: p.reason
          }))
        }, { status: 400 })
      }

      // Calculate totals from items that will actually be converted
      // Build line items for tax template calculation
      const lineItems: { itemId: string | null; lineTotal: number }[] = []
      for (const service of approvedServices) {
        const amount = parseFloat(isDirectEstimate ? service.originalAmount : (service.approvedAmount || service.originalAmount))
        lineItems.push({ itemId: null, lineTotal: amount })
      }
      for (const part of partsToConvert) {
        const hasAdjustedQty = 'adjustedQuantity' in part && part.adjustedQuantity !== undefined
        const originalUnitPrice = parseFloat(part.unitPrice || '0')
        const originalAmount = parseFloat(part.originalAmount)
        const approvedAmount = parseFloat(part.approvedAmount || part.originalAmount)

        // Compute the same adjusted unit price used for work order line items
        let finalUnitPrice: number
        if (isDirectEstimate) {
          finalUnitPrice = originalUnitPrice
        } else {
          if (approvedAmount !== originalAmount && originalAmount > 0) {
            const adjustmentRatio = approvedAmount / originalAmount
            finalUnitPrice = roundCurrency(originalUnitPrice * adjustmentRatio)
          } else {
            finalUnitPrice = originalUnitPrice
          }
        }

        let lineTotal: number
        if (hasAdjustedQty) {
          lineTotal = roundCurrency(finalUnitPrice * part.adjustedQuantity!)
        } else {
          lineTotal = isDirectEstimate ? originalAmount : approvedAmount
        }
        lineItems.push({ itemId: part.itemId || null, lineTotal })
      }

      // Use tax template system for consistent tax calculation across conversion chain
      const taxResult = await recalculateDocumentTax(db, session.user.tenantId, lineItems, { type: 'sales' })
      const subtotal = taxResult.subtotal
      const taxAmount = taxResult.totalTax
      const total = taxResult.total
      const taxBreakdown = taxResult.taxBreakdown

      // Create work order in transaction
      const result = await db.transaction(async (tx) => {
        // Lock estimate to prevent double conversion
        const [lockedEstimate] = await tx
          .select({ status: insuranceEstimates.status })
          .from(insuranceEstimates)
          .where(eq(insuranceEstimates.id, estimateId))
          .for('update')

        if (!lockedEstimate) {
          throw new Error('ESTIMATE_NOT_FOUND')
        }

        // Reject terminal statuses explicitly (defense-in-depth against race conditions)
        if (['rejected', 'cancelled'].includes(lockedEstimate.status)) {
          throw new Error('INVALID_STATUS')
        }

        const allowedStatuses = isDirectEstimate
          ? ['draft', 'work_order_created']
          : ['approved', 'partially_approved', 'work_order_created']
        if (!allowedStatuses.includes(lockedEstimate.status)) {
          throw new Error('INVALID_STATUS')
        }

        // Generate work order number atomically (RLS scopes to tenant)
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${workOrders.orderNo})` })
          .from(workOrders)

        const lastOrderNo = maxResult?.maxNo
        const nextNumber = lastOrderNo ? parseInt(lastOrderNo.replace(/\D/g, '')) + 1 : 1
        const orderNo = `WO-${String(nextNumber).padStart(6, '0')}`

        // Create work order with customer complaint containing estimate info
        const customerComplaint = isDirectEstimate
          ? `Estimate: ${estimate.estimateNo}\n${estimate.incidentDescription || ''}`
          : `Insurance Estimate: ${estimate.estimateNo}\n` +
            `Claim #: ${estimate.claimNumber || 'N/A'}\n` +
            `Policy #: ${estimate.policyNumber || 'N/A'}\n` +
            `Incident: ${estimate.incidentDescription || 'N/A'}`

        const [newWorkOrder] = await tx.insert(workOrders).values({
          tenantId: session.user.tenantId,
          orderNo,
          customerId: estimate.customerId,
          vehicleId: estimate.vehicleId,
          warehouseId: estimate.warehouseId, // Carry forward from estimate
          status: 'draft',
          priority: 'normal',
          customerComplaint,
          odometerIn: estimate.odometerIn, // Carry forward from estimate
          createdBy: userId,
          subtotal: String(subtotal),
          taxAmount: String(taxAmount),
          taxBreakdown,
          total: String(total),
        }).returning()

        // Insert services and mark as converted
        if (approvedServices.length > 0) {
          await tx.insert(workOrderServices).values(
            approvedServices.map(s => {
              const originalAmount = parseFloat(s.originalAmount)
              const approvedAmount = parseFloat(s.approvedAmount || s.originalAmount)
              const originalRate = parseFloat(s.rate || '0')

              let finalRate: number
              let finalAmount: number

              if (isDirectEstimate) {
                finalRate = originalRate
                finalAmount = originalAmount
              } else {
                if (approvedAmount !== originalAmount && originalAmount > 0) {
                  const adjustmentRatio = approvedAmount / originalAmount
                  finalRate = roundCurrency(originalRate * adjustmentRatio)
                } else {
                  finalRate = originalRate
                }
                finalAmount = approvedAmount
              }

              return {
                tenantId: session.user.tenantId,
                workOrderId: newWorkOrder.id,
                serviceTypeId: s.serviceTypeId,
                description: s.description,
                hours: s.hours || '1',
                rate: String(finalRate.toFixed(2)),
                amount: String(finalAmount.toFixed(2)),
              }
            })
          )

          // Mark services as converted
          for (const service of approvedServices) {
            await tx.update(insuranceEstimateItems)
              .set({ convertedToWorkOrderId: newWorkOrder.id })
              .where(eq(insuranceEstimateItems.id, service.id))
          }
        }

        // Insert parts with row-level stock locking
        if (partsToConvert.length > 0) {
          for (const p of partsToConvert) {
            if (p.itemId) {
              const [lockedItem] = await tx
                .select()
                .from(items)
                .where(eq(items.id, p.itemId))
                .for('update')

              if (lockedItem && lockedItem.trackStock && estimate.warehouseId) {
                // Use adjusted quantity if available
                const requiredQty = 'adjustedQuantity' in p && p.adjustedQuantity !== undefined
                  ? p.adjustedQuantity
                  : parseFloat(p.quantity || '1')

                // Get stock from specific warehouse
                const [stockData] = await tx
                  .select({
                    totalStock: sql<string>`COALESCE(${warehouseStock.currentStock}, '0')`,
                  })
                  .from(warehouseStock)
                  .where(
                    and(
                      eq(warehouseStock.warehouseId, estimate.warehouseId),
                      eq(warehouseStock.itemId, p.itemId)
                    )
                  )
                const currentStock = parseFloat(stockData?.totalStock || '0')

                if (currentStock < requiredQty) {
                  throw new Error(`Insufficient stock for ${p.partName || lockedItem.name}. Available: ${currentStock}, Required: ${requiredQty}`)
                }
              }
            }
          }

          await tx.insert(workOrderParts).values(
            partsToConvert.map(p => {
              const originalUnitPrice = parseFloat(p.unitPrice || '0')

              // Use adjusted quantity if available
              const hasAdjustedQty = 'adjustedQuantity' in p && p.adjustedQuantity !== undefined
              const finalQuantity = hasAdjustedQty ? p.adjustedQuantity! : parseFloat(p.quantity || '1')

              let finalUnitPrice: number
              let finalAmount: number

              if (isDirectEstimate) {
                finalUnitPrice = originalUnitPrice
                finalAmount = roundCurrency(originalUnitPrice * finalQuantity)
              } else {
                const originalAmount = parseFloat(p.originalAmount)
                const approvedAmount = parseFloat(p.approvedAmount || p.originalAmount)

                if (approvedAmount !== originalAmount && originalAmount > 0) {
                  const adjustmentRatio = approvedAmount / originalAmount
                  finalUnitPrice = roundCurrency(originalUnitPrice * adjustmentRatio)
                } else {
                  finalUnitPrice = originalUnitPrice
                }

                // If quantity was adjusted, recalculate amount
                if (hasAdjustedQty) {
                  finalAmount = roundCurrency(finalUnitPrice * finalQuantity)
                } else {
                  finalAmount = approvedAmount
                }
              }

              return {
                tenantId: session.user.tenantId,
                workOrderId: newWorkOrder.id,
                itemId: p.itemId!,
                quantity: String(finalQuantity),
                unitPrice: String(finalUnitPrice.toFixed(2)),
                total: String(finalAmount.toFixed(2)),
              }
            })
          )

          // Mark parts as converted (with partial note if applicable)
          for (const part of partsToConvert) {
            const hasAdjustedQty = 'adjustedQuantity' in part && part.adjustedQuantity !== undefined
            const originalQty = parseFloat(part.quantity || '1')

            await tx.update(insuranceEstimateItems)
              .set({
                convertedToWorkOrderId: newWorkOrder.id,
                // If partial, note the remaining quantity
                conversionSkippedReason: hasAdjustedQty
                  ? `Partial: ${part.adjustedQuantity} of ${originalQty} converted`
                  : null
              })
              .where(eq(insuranceEstimateItems.id, part.id))
          }
        }

        // Issue #59: Append skip reasons instead of overwriting
        for (const { part, reason } of partsSkippedNoStock) {
          const existing = part.conversionSkippedReason
          await tx.update(insuranceEstimateItems)
            .set({ conversionSkippedReason: existing ? `${existing}; ${reason}` : reason })
            .where(eq(insuranceEstimateItems.id, part.id))
        }

        for (const part of partsSkippedByUser) {
          const reason = 'Skipped by user during conversion'
          const existing = part.conversionSkippedReason
          await tx.update(insuranceEstimateItems)
            .set({ conversionSkippedReason: existing ? `${existing}; ${reason}` : reason })
            .where(eq(insuranceEstimateItems.id, part.id))
        }

        for (const part of partsNeedingInventoryLink) {
          const reason = 'Not linked to inventory item'
          const existing = part.conversionSkippedReason
          await tx.update(insuranceEstimateItems)
            .set({ conversionSkippedReason: existing ? `${existing}; ${reason}` : reason })
            .where(eq(insuranceEstimateItems.id, part.id))
        }

        // Update estimate status - set work_order_created and link work order(s)
        // AEW-3: Track multiple work orders from partial conversions
        const currentWorkOrderIds = estimate.workOrderIds || []
        const updatedWorkOrderIds = [...currentWorkOrderIds, newWorkOrder.id]

        const updateData: Record<string, unknown> = {
          status: 'work_order_created',
          workOrderIds: updatedWorkOrderIds, // AEW-3: Array of all work orders
          updatedAt: new Date(),
        }
        // Keep workOrderId for backward compatibility (first work order)
        if (!estimate.workOrderId) {
          updateData.workOrderId = newWorkOrder.id
        }

        await tx.update(insuranceEstimates)
          .set(updateData)
          .where(eq(insuranceEstimates.id, estimateId))

        return newWorkOrder
      })

      // Fetch the complete work order
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, result.id),
        with: {
          customer: true,
          vehicle: true,
          services: {
            with: {
              serviceType: true,
            },
          },
          parts: {
            with: {
              item: true,
            },
          },
        },
      })

      // Build response with conversion details
      const warnings: string[] = []

      // Count partial conversions
      const partialConversions = partsToConvert.filter(p => 'adjustedQuantity' in p && p.adjustedQuantity !== undefined)

      if (partsSkippedNoStock.length > 0) {
        warnings.push(
          `${partsSkippedNoStock.length} part(s) skipped due to insufficient stock: ${partsSkippedNoStock.map(p => p.part.partName || 'Unknown').join(', ')}. You can convert these later when stock is available.`
        )
      }

      if (partsSkippedByUser.length > 0) {
        warnings.push(
          `${partsSkippedByUser.length} part(s) skipped by user: ${partsSkippedByUser.map(p => p.partName || 'Unknown').join(', ')}`
        )
      }

      if (partialConversions.length > 0) {
        warnings.push(
          `${partialConversions.length} part(s) converted with reduced quantity`
        )
      }

      if (partsNeedingInventoryLink.length > 0) {
        warnings.push(
          `${partsNeedingInventoryLink.length} part(s) skipped because not linked to inventory: ${partsNeedingInventoryLink.map(p => p.partName || p.description || 'Unknown').join(', ')}`
        )
      }

      if (servicesWithZeroHours.length > 0) {
        warnings.push(
          `${servicesWithZeroHours.length} service(s) skipped because hours = 0: ${servicesWithZeroHours.map(s => s.description || 'Unknown service').join(', ')}`
        )
      }

      const response: {
        success: boolean
        workOrder: typeof workOrder
        message: string
        warnings?: string[]
        converted: { services: number; parts: number; partialParts: number }
        skipped: { noStock: number; noInventoryLink: number; byUser: number; zeroHourServices: number }
      } = {
        success: true,
        workOrder,
        message: `Work order ${result.orderNo} created successfully`,
        converted: {
          services: approvedServices.length,
          parts: partsToConvert.length,
          partialParts: partialConversions.length,
        },
        skipped: {
          noStock: partsSkippedNoStock.length,
          noInventoryLink: partsNeedingInventoryLink.length,
          byUser: partsSkippedByUser.length,
          zeroHourServices: servicesWithZeroHours.length,
        },
      }

      if (warnings.length > 0) {
        response.warnings = warnings
      }

      // Broadcast changes for both estimate and work order
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)
      logAndBroadcast(session.user.tenantId, 'work-order', 'created', result.id)

      return NextResponse.json(response)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/insurance-estimates/[id]/convert', error)
    if (message === 'ESTIMATE_NOT_FOUND') {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }
    if (message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Estimate can no longer be converted' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to convert estimate' }, { status: 500 })
  }
}
