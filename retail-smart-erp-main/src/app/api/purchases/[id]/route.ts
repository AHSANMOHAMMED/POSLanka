import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchases, purchaseItems, purchasePayments, suppliers, warehouses, users, purchaseOrders, purchaseOrderItems, items as itemsTable, warehouseStock, stockMovements, supplierBalanceAudit, itemSerialNumbers, serialNumberMovements, itemSupplierCosts, itemCostHistory } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postPurchaseToGL, postVoidToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { logError } from '@/lib/ai/error-logger'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { parseSerialNumberInput, checkDuplicateSerials } from '@/lib/inventory/serial-numbers'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePurchaseSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single purchase with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Get purchase with joins (RLS filters by tenant)
    const [purchase] = await db
      .select({
        id: purchases.id,
        purchaseNo: purchases.purchaseNo,
        purchaseOrderId: purchases.purchaseOrderId,
        purchaseOrderNo: purchaseOrders.orderNo,
        supplierId: purchases.supplierId,
        supplierName: suppliers.name,
        warehouseId: purchases.warehouseId,
        warehouseName: warehouses.name,
        supplierInvoiceNo: purchases.supplierInvoiceNo,
        supplierBillDate: purchases.supplierBillDate,
        paymentTerm: purchases.paymentTerm,
        subtotal: purchases.subtotal,
        taxAmount: purchases.taxAmount,
        total: purchases.total,
        paidAmount: purchases.paidAmount,
        status: purchases.status,
        notes: purchases.notes,
        isReturn: purchases.isReturn,
        returnAgainst: purchases.returnAgainst,
        createdBy: purchases.createdBy,
        createdByName: users.fullName,
        cancellationReason: purchases.cancellationReason,
        cancelledAt: purchases.cancelledAt,
        tags: purchases.tags,
        costCenterId: purchases.costCenterId,
        createdAt: purchases.createdAt,
        updatedAt: purchases.updatedAt,
      })
      .from(purchases)
      .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .leftJoin(warehouses, eq(purchases.warehouseId, warehouses.id))
      .leftJoin(users, eq(purchases.createdBy, users.id))
      .leftJoin(purchaseOrders, eq(purchases.purchaseOrderId, purchaseOrders.id))
      .where(eq(purchases.id, id))

    if (!purchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    // Get items
    const items = await db
      .select({
        id: purchaseItems.id,
        itemId: purchaseItems.itemId,
        itemName: purchaseItems.itemName,
        itemSku: itemsTable.sku,
        itemBarcode: itemsTable.barcode,
        itemOemPartNumber: itemsTable.oemPartNumber,
        itemPluCode: itemsTable.pluCode,
        quantity: purchaseItems.quantity,
        unitPrice: purchaseItems.unitPrice,
        tax: purchaseItems.tax,
        total: purchaseItems.total,
      })
      .from(purchaseItems)
      .leftJoin(itemsTable, eq(purchaseItems.itemId, itemsTable.id))
      .where(eq(purchaseItems.purchaseId, id))

    // Get payments
    const payments = await db
      .select({
        id: purchasePayments.id,
        amount: purchasePayments.amount,
        paymentMethod: purchasePayments.paymentMethod,
        paymentReference: purchasePayments.paymentReference,
        notes: purchasePayments.notes,
        paidAt: purchasePayments.paidAt,
        createdByName: users.fullName,
      })
      .from(purchasePayments)
      .leftJoin(users, eq(purchasePayments.createdBy, users.id))
      .where(eq(purchasePayments.purchaseId, id))

    return { data: { ...purchase, items, payments } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update purchase
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updatePurchaseSchema)
  if (!parsed.success) return parsed.response
  const {
    supplierId,
    warehouseId,
    supplierInvoiceNo,
    supplierBillDate,
    paymentTerm,
    notes,
    tags,
    costCenterId,
    status,
    cancellationReason,
    expectedUpdatedAt,
    itemSerials = {},
    changesSummary,
  } = parsed.data

  // Handle cancellation with transaction
  if (status === 'cancelled') {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      // Get current purchase with lock to prevent concurrent cancellation (RLS filters by tenant)
      const [currentPurchase] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, id))
        .for('update')

      if (!currentPurchase) {
        return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
      }

      // Optimistic locking check
      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = currentPurchase.updatedAt ? new Date(currentPurchase.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          return { error: NextResponse.json({
            error: 'This record was modified by another user. Please refresh and try again.',
            code: 'CONFLICT'
          }, { status: 409 }) }
        }
      }

      if (currentPurchase.status === 'cancelled') {
        return { error: NextResponse.json({ error: 'Purchase is already cancelled' }, { status: 400 }) }
      }

      const updateData: Record<string, unknown> = {
        status: 'cancelled',
        cancellationReason: cancellationReason || null,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }

      // Reverse supplier balance with audit trail (only if invoice was submitted - draft never updated balance)
      const unpaidAmount = Math.round((parseFloat(currentPurchase.total) - parseFloat(currentPurchase.paidAmount)) * 100) / 100
      if (currentPurchase.status !== 'draft' && currentPurchase.supplierId && unpaidAmount > 0) {
        // Get current supplier balance BEFORE update
        const [currentSupplier] = await tx
          .select({ balance: suppliers.balance })
          .from(suppliers)
          .where(eq(suppliers.id, currentPurchase.supplierId))
          .for('update')

        const previousBalance = parseFloat(currentSupplier?.balance || '0')
        const newBalance = Math.round((previousBalance - unpaidAmount) * 100) / 100

        await tx.update(suppliers)
          .set({ balance: newBalance.toString() })
          .where(eq(suppliers.id, currentPurchase.supplierId))

        // Create audit record
        await tx.insert(supplierBalanceAudit).values({
          tenantId: session.user.tenantId,
          supplierId: currentPurchase.supplierId,
          type: 'cancel',
          amount: (-unpaidAmount).toString(),
          previousBalance: previousBalance.toString(),
          newBalance: newBalance.toString(),
          referenceType: 'purchase',
          referenceId: currentPurchase.id,
          notes: `Purchase ${currentPurchase.purchaseNo} cancelled - unpaid balance reversed`,
          createdBy: session.user.id,
        })
      }

      // Check if stock movements exist for this purchase
      const existingMovements = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(and(
          eq(stockMovements.referenceType, 'purchase'),
          eq(stockMovements.referenceId, id),
          eq(stockMovements.type, 'in')
        ))
        .limit(1)

      // Reverse stock if there were incoming stock movements
      if (existingMovements.length > 0) {
        const purchaseItemsList = await tx
          .select()
          .from(purchaseItems)
          .where(eq(purchaseItems.purchaseId, id))

        for (const item of purchaseItemsList) {
          if (item.itemId && currentPurchase.warehouseId) {
            const qty = parseFloat(item.quantity)

            const [existingStock] = await tx
              .select()
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.warehouseId, currentPurchase.warehouseId),
                eq(warehouseStock.itemId, item.itemId)
              ))
              .for('update')

            if (existingStock) {
              await tx.update(warehouseStock)
                .set({
                  currentStock: sql`GREATEST(0, ${warehouseStock.currentStock} - ${qty})`,
                  updatedAt: new Date(),
                })
                .where(eq(warehouseStock.id, existingStock.id))
            }

            await tx.insert(stockMovements).values({
              tenantId: session.user.tenantId,
              warehouseId: currentPurchase.warehouseId,
              itemId: item.itemId,
              type: 'out',
              quantity: qty.toString(),
              notes: `Purchase ${currentPurchase.purchaseNo} cancelled - reversal`,
              referenceType: 'purchase',
              referenceId: currentPurchase.id,
              createdBy: session.user.id,
            })

            // Cost reversal: reverse weighted average cost
            const currentStockBeforeReversal = existingStock ? parseFloat(existingStock.currentStock) : 0
            const newStockAfterReversal = Math.max(0, currentStockBeforeReversal - qty)

            const [currentItem] = await tx
              .select({ costPrice: itemsTable.costPrice })
              .from(itemsTable)
              .where(eq(itemsTable.id, item.itemId))
              .for('update')

            if (currentItem) {
              const currentCost = parseFloat(currentItem.costPrice || '0')
              const purchasePrice = parseFloat(item.unitPrice)

              let reversedCost: number
              if (newStockAfterReversal > 0) {
                reversedCost = Math.max(0,
                  Math.round(((currentCost * currentStockBeforeReversal) - (purchasePrice * qty)) / newStockAfterReversal * 100) / 100
                )
              } else {
                reversedCost = 0
              }

              await tx.update(itemsTable)
                .set({ costPrice: reversedCost.toString() })
                .where(eq(itemsTable.id, item.itemId))

              // Log cost reversal history
              await tx.insert(itemCostHistory).values({
                tenantId: session.user.tenantId,
                itemId: item.itemId,
                supplierId: currentPurchase.supplierId,
                source: 'purchase_cancellation',
                previousCostPrice: currentCost.toString(),
                newCostPrice: reversedCost.toString(),
                purchasePrice: item.unitPrice,
                quantity: item.quantity,
                stockBefore: currentStockBeforeReversal.toString(),
                stockAfter: newStockAfterReversal.toString(),
                referenceId: currentPurchase.id,
                referenceNo: currentPurchase.purchaseNo,
                notes: `Cost reversed due to cancellation of ${currentPurchase.purchaseNo}`,
                createdBy: session.user.id,
              })

              // Update supplier cost record - decrement total purchased qty
              if (currentPurchase.supplierId) {
                await tx.update(itemSupplierCosts)
                  .set({
                    totalPurchasedQty: sql`GREATEST(0, ${itemSupplierCosts.totalPurchasedQty} - ${qty})`,
                    updatedAt: new Date(),
                  })
                  .where(and(
                    eq(itemSupplierCosts.itemId, item.itemId),
                    eq(itemSupplierCosts.supplierId, currentPurchase.supplierId)
                  ))
              }
            }
          }
        }
      }

      // Revert linked PO: reverse received quantities and update status
      let purchaseOrderId: string | null = null
      if (currentPurchase.purchaseOrderId) {
        purchaseOrderId = currentPurchase.purchaseOrderId

        // Get invoice items to know how much to reverse
        const invoiceItemsList = await tx
          .select({ itemId: purchaseItems.itemId, quantity: purchaseItems.quantity })
          .from(purchaseItems)
          .where(eq(purchaseItems.purchaseId, id))

        // Build a map of itemId → total invoice qty to reverse
        const reverseMap = new Map<string, number>()
        for (const ii of invoiceItemsList) {
          if (ii.itemId) {
            reverseMap.set(ii.itemId, (reverseMap.get(ii.itemId) || 0) + parseFloat(ii.quantity))
          }
        }

        // Get PO items and reverse received quantities
        const poItems = await tx
          .select({
            id: purchaseOrderItems.id,
            itemId: purchaseOrderItems.itemId,
            quantity: purchaseOrderItems.quantity,
            receivedQuantity: purchaseOrderItems.receivedQuantity,
          })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))

        let totalOrdered = 0
        let totalReceived = 0

        for (const poItem of poItems) {
          const reverseQty = poItem.itemId ? (reverseMap.get(poItem.itemId) || 0) : 0
          const currentReceived = parseFloat(poItem.receivedQuantity || '0')
          const newReceived = Math.max(0, currentReceived - reverseQty)

          // Update the PO item's receivedQuantity
          if (reverseQty > 0) {
            await tx.update(purchaseOrderItems)
              .set({ receivedQuantity: newReceived.toString() })
              .where(eq(purchaseOrderItems.id, poItem.id))

            // Remove used qty from map so duplicate itemIds are handled one at a time
            const remaining = reverseQty - (currentReceived - newReceived)
            if (remaining > 0 && poItem.itemId) {
              reverseMap.set(poItem.itemId, remaining)
            } else if (poItem.itemId) {
              reverseMap.delete(poItem.itemId)
            }
          }

          totalOrdered += parseFloat(poItem.quantity)
          totalReceived += newReceived
        }

        let revertStatus: 'confirmed' | 'partially_received' | 'fully_received'
        if (totalReceived >= totalOrdered && totalOrdered > 0) {
          revertStatus = 'fully_received'
        } else if (totalReceived > 0) {
          revertStatus = 'partially_received'
        } else {
          revertStatus = 'confirmed'
        }

        await tx.update(purchaseOrders)
          .set({ status: revertStatus, updatedAt: new Date() })
          .where(eq(purchaseOrders.id, purchaseOrderId))
      }

      // Reverse GL entries for this purchase (non-blocking)
      if (currentPurchase.status !== 'draft') {
        try {
          await postVoidToGL(tx, session.user.tenantId, 'purchase', id)
        } catch (glError) {
          logError('api/purchases/[id]', glError)
        }
      }

      const [updated] = await tx.update(purchases)
        .set(updateData)
        .where(eq(purchases.id, id))
        .returning()

      return { data: updated, tenantId: session.user.tenantId, userId: session.user.id, supplierId: currentPurchase.supplierId, purchaseOrderId }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    logAndBroadcast(result.tenantId, 'purchase', 'updated', id, {
      userId: result.userId,
      activityAction: 'cancel',
      entityName: result.data.purchaseNo,
      description: `Cancelled ${result.data.purchaseNo}`,
    })
    if (result.supplierId) {
      logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId, { userId: result.userId })
    }
    if (result.purchaseOrderId) {
      logAndBroadcast(result.tenantId, 'purchase-order', 'updated', result.purchaseOrderId, { userId: result.userId })
    }
    logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', 'bulk', { userId: result.userId })

    return NextResponse.json(result.data)
  }

  // Handle submit (draft → pending): update supplier balance + stock
  if (status === 'pending') {
    let result
    try {
      result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      // Pre-validate accounting config before GL posting
      const acctError = await requireAccountingConfig(null, session.user.tenantId, 'purchase')
      if (acctError) return { error: acctError }

      // Issue #39: Lock purchase row with FOR UPDATE to prevent race conditions
      const [currentPurchase] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, id))
        .for('update')

      if (!currentPurchase) {
        return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
      }

      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = currentPurchase.updatedAt ? new Date(currentPurchase.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          return { error: NextResponse.json({
            error: 'This record was modified by another user. Please refresh and try again.',
            code: 'CONFLICT'
          }, { status: 409 }) }
        }
      }

      if (currentPurchase.status !== 'draft') {
        return { error: NextResponse.json({ error: 'Only draft purchases can be submitted' }, { status: 400 }) }
      }

      // Recalculate totals from items (dual mode: template or manual flat tax)
      const purchaseItemsList = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, id))

      // Try template-based tax calculation
      const lineItems = purchaseItemsList.map(item => ({
        itemId: item.itemId,
        lineTotal: parseFloat(item.quantity) * parseFloat(item.unitPrice),
      }))
      const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })

      let subtotal: number, taxAmount: number, total: number
      let purchaseTaxBreakdown: typeof taxResult.taxBreakdown | null = null

      if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
        subtotal = taxResult.subtotal
        taxAmount = taxResult.totalTax
        total = taxResult.total
        purchaseTaxBreakdown = taxResult.taxBreakdown
      } else {
        // Manual flat tax fallback
        subtotal = 0
        taxAmount = 0
        for (const item of purchaseItemsList) {
          subtotal += parseFloat(item.quantity) * parseFloat(item.unitPrice)
          taxAmount += parseFloat(item.tax)
        }
        subtotal = Math.round(subtotal * 100) / 100
        taxAmount = Math.round(taxAmount * 100) / 100
        total = Math.round((subtotal + taxAmount) * 100) / 100
      }

      // Update supplier balance with audit trail (increase what we owe them)
      if (currentPurchase.supplierId && total > 0) {
        // Get current supplier balance BEFORE update
        const [currentSupplier] = await tx
          .select({ balance: suppliers.balance })
          .from(suppliers)
          .where(eq(suppliers.id, currentPurchase.supplierId))
          .for('update')

        const previousBalance = parseFloat(currentSupplier?.balance || '0')
        const newBalance = Math.round((previousBalance + total) * 100) / 100

        await tx.update(suppliers)
          .set({ balance: newBalance.toString() })
          .where(eq(suppliers.id, currentPurchase.supplierId))

        // Create audit record
        await tx.insert(supplierBalanceAudit).values({
          tenantId: session.user.tenantId,
          supplierId: currentPurchase.supplierId,
          type: 'purchase',
          amount: total.toString(),
          previousBalance: previousBalance.toString(),
          newBalance: newBalance.toString(),
          referenceType: 'purchase',
          referenceId: currentPurchase.id,
          notes: `Purchase ${currentPurchase.purchaseNo} submitted`,
          createdBy: session.user.id,
        })
      }

      // Update warehouse stock for each item
      const effectiveWarehouseId = currentPurchase.warehouseId
      if (effectiveWarehouseId) {
        for (const item of purchaseItemsList) {
          if (item.itemId) {
            const qty = parseFloat(item.quantity)

            // Issue #68: Lock stock row with FOR UPDATE before updating
            const [existingStock] = await tx
              .select()
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.warehouseId, effectiveWarehouseId),
                eq(warehouseStock.itemId, item.itemId)
              ))
              .for('update')

            if (existingStock) {
              await tx.update(warehouseStock)
                .set({
                  currentStock: sql`${warehouseStock.currentStock} + ${qty}`,
                  updatedAt: new Date(),
                })
                .where(eq(warehouseStock.id, existingStock.id))
            } else {
              await tx.insert(warehouseStock).values({
                tenantId: session.user.tenantId,
                warehouseId: effectiveWarehouseId,
                itemId: item.itemId,
                currentStock: qty.toString(),
              })
            }

            // Create stock movement record
            await tx.insert(stockMovements).values({
              tenantId: session.user.tenantId,
              warehouseId: effectiveWarehouseId,
              itemId: item.itemId,
              type: 'in',
              quantity: qty.toString(),
              notes: `Purchase Invoice ${currentPurchase.purchaseNo} submitted`,
              referenceType: 'purchase',
              referenceId: currentPurchase.id,
              createdBy: session.user.id,
            })

            // Serial number tracking: create serial numbers for serialized items
            const [itemRecord] = await tx.select({ trackSerialNumbers: itemsTable.trackSerialNumbers })
              .from(itemsTable)
              .where(eq(itemsTable.id, item.itemId))
              .limit(1)

            if (itemRecord?.trackSerialNumbers && itemSerials[item.itemId]) {
              const parsedSerials = parseSerialNumberInput(itemSerials[item.itemId])

              if (parsedSerials.length > 0) {
                // Check for duplicates
                const duplicates = await checkDuplicateSerials(tx, item.itemId, parsedSerials)
                if (duplicates.length > 0) {
                  throw new Error(`DUPLICATE_SERIALS:Duplicate serial numbers for ${item.itemName || item.itemId}: ${duplicates.join(', ')}`)
                }

                // Create serial number records
                const serialValues = parsedSerials.map(sn => ({
                  tenantId: session.user.tenantId,
                  itemId: item.itemId!,
                  serialNumber: sn,
                  status: 'available' as const,
                  warehouseId: effectiveWarehouseId,
                  createdBy: session.user.id,
                }))

                const created = await tx.insert(itemSerialNumbers).values(serialValues).returning()

                // Create movement records
                const movementValues = created.map(sn => ({
                  tenantId: session.user.tenantId,
                  serialNumberId: sn.id,
                  fromStatus: null as null,
                  toStatus: 'available' as const,
                  fromWarehouseId: null as null,
                  toWarehouseId: effectiveWarehouseId,
                  referenceType: 'purchase',
                  referenceId: currentPurchase.id,
                  changedBy: session.user.id,
                  notes: `Purchase ${currentPurchase.purchaseNo}`,
                }))

                if (movementValues.length > 0) {
                  await tx.insert(serialNumberMovements).values(movementValues)
                }
              }
            }

            // Fix #3: Update item costPrice using weighted average
            // Use old stock from warehouseStock (read before increment above)
            const [currentItem] = await tx
              .select({ costPrice: itemsTable.costPrice })
              .from(itemsTable)
              .where(eq(itemsTable.id, item.itemId))
              .for('update')

            if (currentItem) {
              const oldCostPrice = parseFloat(currentItem.costPrice || '0')
              const newPurchasePrice = parseFloat(item.unitPrice)
              const oldStock = existingStock ? parseFloat(existingStock.currentStock) : 0
              // Weighted average: (oldCost * oldStock + newCost * newQty) / (oldStock + newQty)
              const totalStock = oldStock + qty
              const totalValue = Math.round(((oldCostPrice * oldStock) + (newPurchasePrice * qty)) * 100) / 100
              const weightedAvgCost = totalStock > 0
                ? Math.round(totalValue / totalStock * 100) / 100
                : newPurchasePrice

              await tx.update(itemsTable)
                .set({ costPrice: weightedAvgCost.toString() })
                .where(eq(itemsTable.id, item.itemId))

              // Log cost change history
              await tx.insert(itemCostHistory).values({
                tenantId: session.user.tenantId,
                itemId: item.itemId,
                supplierId: currentPurchase.supplierId,
                source: 'purchase',
                previousCostPrice: oldCostPrice.toString(),
                newCostPrice: weightedAvgCost.toString(),
                purchasePrice: item.unitPrice,
                quantity: item.quantity,
                stockBefore: oldStock.toString(),
                stockAfter: totalStock.toString(),
                referenceId: currentPurchase.id,
                referenceNo: currentPurchase.purchaseNo,
                createdBy: session.user.id,
              })

              // Upsert item-supplier cost record
              if (currentPurchase.supplierId) {
                const [existingSupplierCost] = await tx
                  .select()
                  .from(itemSupplierCosts)
                  .where(and(
                    eq(itemSupplierCosts.itemId, item.itemId),
                    eq(itemSupplierCosts.supplierId, currentPurchase.supplierId)
                  ))

                if (existingSupplierCost) {
                  await tx.update(itemSupplierCosts)
                    .set({
                      lastCostPrice: item.unitPrice,
                      lastPurchaseDate: new Date(),
                      lastPurchaseId: currentPurchase.id,
                      totalPurchasedQty: sql`${itemSupplierCosts.totalPurchasedQty} + ${qty}`,
                      updatedAt: new Date(),
                    })
                    .where(eq(itemSupplierCosts.id, existingSupplierCost.id))
                } else {
                  await tx.insert(itemSupplierCosts).values({
                    tenantId: session.user.tenantId,
                    itemId: item.itemId,
                    supplierId: currentPurchase.supplierId,
                    lastCostPrice: item.unitPrice,
                    lastPurchaseDate: new Date(),
                    lastPurchaseId: currentPurchase.id,
                    totalPurchasedQty: qty.toString(),
                  })
                }
              }
            }
          }
        }
      }

      // Update purchase status to pending and set recalculated totals
      const [updated] = await tx.update(purchases)
        .set({
          status: 'pending',
          subtotal: subtotal.toString(),
          taxAmount: taxAmount.toString(),
          taxBreakdown: purchaseTaxBreakdown,
          total: total.toString(),
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, id))
        .returning()

      // Auto-post to General Ledger
      await postPurchaseToGL(tx, session.user.tenantId, {
        purchaseId: currentPurchase.id,
        invoiceNumber: currentPurchase.purchaseNo,
        purchaseDate: new Date().toISOString().split('T')[0],
        subtotal,
        tax: taxAmount,
        taxBreakdown: purchaseTaxBreakdown || undefined,
        discount: 0,
        total,
        amountPaid: 0,
        supplierId: currentPurchase.supplierId || null,
        costCenterId: currentPurchase.costCenterId || null,
      })

      return { data: updated, tenantId: session.user.tenantId, userId: session.user.id, supplierId: currentPurchase.supplierId }
    })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('DUPLICATE_SERIALS:')) {
        return NextResponse.json({ error: message.replace('DUPLICATE_SERIALS:', '') }, { status: 400 })
      }
      throw err
    }

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    logAndBroadcast(result.tenantId, 'purchase', 'updated', id, {
      userId: result.userId,
      activityAction: 'submit',
      entityName: result.data.purchaseNo,
      description: `Submitted ${result.data.purchaseNo}`,
    })
    if (result.supplierId) {
      logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId, { userId: result.userId })
    }
    logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', 'bulk', { userId: result.userId })

    return NextResponse.json(result.data)
  }

  // Non-cancellation, non-submit update (editing draft)
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const [currentPurchase] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, id))

    if (!currentPurchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    if (expectedUpdatedAt) {
      const clientTime = new Date(expectedUpdatedAt).getTime()
      const serverTime = currentPurchase.updatedAt ? new Date(currentPurchase.updatedAt).getTime() : 0
      if (serverTime > clientTime) {
        return { error: NextResponse.json({
          error: 'This record was modified by another user. Please refresh and try again.',
          code: 'CONFLICT'
        }, { status: 409 }) }
      }
    }

    if (currentPurchase.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft purchases can be edited' }, { status: 400 }) }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (supplierId !== undefined) updateData.supplierId = supplierId
    if (warehouseId !== undefined) updateData.warehouseId = warehouseId
    if (supplierInvoiceNo !== undefined) updateData.supplierInvoiceNo = supplierInvoiceNo || null
    if (supplierBillDate !== undefined) updateData.supplierBillDate = supplierBillDate || null
    if (paymentTerm !== undefined) updateData.paymentTerm = paymentTerm || 'cash'
    if (notes !== undefined) updateData.notes = notes || null
    if (tags !== undefined) updateData.tags = tags.length > 0 ? JSON.stringify(tags) : null
    if (costCenterId !== undefined) updateData.costCenterId = costCenterId || null

    const [updated] = await db.update(purchases)
      .set(updateData)
      .where(eq(purchases.id, id))
      .returning()

    // Build change description
    const changes: string[] = []
    if (supplierId !== undefined && supplierId !== currentPurchase.supplierId) {
      changes.push('supplier changed')
    }
    if (warehouseId !== undefined && warehouseId !== currentPurchase.warehouseId) {
      changes.push('warehouse changed')
    }
    if (supplierInvoiceNo !== undefined && supplierInvoiceNo !== currentPurchase.supplierInvoiceNo) {
      changes.push('supplier invoice # updated')
    }
    if (supplierBillDate !== undefined && supplierBillDate !== currentPurchase.supplierBillDate) {
      changes.push('bill date changed')
    }
    if (notes !== undefined && notes !== currentPurchase.notes) {
      changes.push('notes updated')
    }
    if (tags !== undefined) {
      changes.push('tags updated')
    }
    if (costCenterId !== undefined && costCenterId !== currentPurchase.costCenterId) {
      changes.push('cost center changed')
    }
    if (changesSummary) {
      changes.push(changesSummary)
    }

    const description = changes.length > 0
      ? `${updated.purchaseNo}: ${changes.join(', ')}`
      : `Saved ${updated.purchaseNo}`

    return { data: updated, tenantId: session.user.tenantId, userId: session.user.id, description, purchaseNo: updated.purchaseNo }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  logAndBroadcast(result.tenantId, 'purchase', 'updated', id, {
    userId: result.userId,
    entityName: result.purchaseNo,
    description: result.description,
  })
  return NextResponse.json(result.data)
}

// DELETE purchase
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Get current purchase with lock (RLS filters by tenant)
    const [currentPurchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, id))
      .for('update')

    if (!currentPurchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    if (currentPurchase.status !== 'draft' && currentPurchase.status !== 'pending') {
      return { error: NextResponse.json({ error: 'Only draft or pending purchases can be deleted. Cancel the purchase instead.' }, { status: 400 }) }
    }

    if (parseFloat(currentPurchase.paidAmount) > 0) {
      return { error: NextResponse.json({ error: 'Cannot delete purchase with payments. Cancel the purchase instead.' }, { status: 400 }) }
    }

    // Reverse supplier balance with audit trail (only if submitted, not draft)
    const total = parseFloat(currentPurchase.total)
    if (currentPurchase.status !== 'draft' && currentPurchase.supplierId && total > 0) {
      // Get current supplier balance BEFORE update
      const [currentSupplier] = await tx
        .select({ balance: suppliers.balance })
        .from(suppliers)
        .where(eq(suppliers.id, currentPurchase.supplierId))
        .for('update')

      const previousBalance = parseFloat(currentSupplier?.balance || '0')
      const newBalance = Math.round((previousBalance - total) * 100) / 100

      await tx.update(suppliers)
        .set({ balance: newBalance.toString() })
        .where(eq(suppliers.id, currentPurchase.supplierId))

      // Create audit record
      await tx.insert(supplierBalanceAudit).values({
        tenantId: session.user.tenantId,
        supplierId: currentPurchase.supplierId,
        type: 'delete',
        amount: (-total).toString(),
        previousBalance: previousBalance.toString(),
        newBalance: newBalance.toString(),
        referenceType: 'purchase',
        referenceId: currentPurchase.id,
        notes: `Purchase ${currentPurchase.purchaseNo} deleted - balance reversed`,
        createdBy: session.user.id,
      })
    }

    // Reverse stock if items were added to inventory
    const existingMovements = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(and(
        eq(stockMovements.referenceType, 'purchase'),
        eq(stockMovements.referenceId, id),
        eq(stockMovements.type, 'in')
      ))
      .limit(1)

    if (existingMovements.length > 0 && currentPurchase.warehouseId) {
      const purchaseItemsList = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, id))

      for (const item of purchaseItemsList) {
        if (item.itemId) {
          const qty = parseFloat(item.quantity)

          const [existingStock] = await tx
            .select()
            .from(warehouseStock)
            .where(and(
              eq(warehouseStock.warehouseId, currentPurchase.warehouseId),
              eq(warehouseStock.itemId, item.itemId)
            ))
            .for('update')

          if (existingStock) {
            await tx.update(warehouseStock)
              .set({
                currentStock: sql`GREATEST(0, ${warehouseStock.currentStock} - ${qty})`,
                updatedAt: new Date(),
              })
              .where(eq(warehouseStock.id, existingStock.id))
          }

          await tx.insert(stockMovements).values({
            tenantId: session.user.tenantId,
            warehouseId: currentPurchase.warehouseId,
            itemId: item.itemId,
            type: 'out',
            quantity: qty.toString(),
            notes: `Purchase ${currentPurchase.purchaseNo} deleted - reversal`,
            referenceType: 'purchase',
            referenceId: currentPurchase.id,
            createdBy: session.user.id,
          })
        }
      }
    }

    // Reverse GL entries for this purchase (non-blocking)
    if (currentPurchase.status !== 'draft') {
      try {
        await postVoidToGL(tx, session.user.tenantId, 'purchase', id)
      } catch (glError) {
        logError('api/purchases/[id]', glError)
      }
    }

    // Delete stock movements for this purchase
    await tx.delete(stockMovements)
      .where(and(
        eq(stockMovements.referenceType, 'purchase'),
        eq(stockMovements.referenceId, id)
      ))

    // Delete items
    await tx.delete(purchaseItems)
      .where(eq(purchaseItems.purchaseId, id))

    // Delete payments (should be none)
    await tx.delete(purchasePayments)
      .where(eq(purchasePayments.purchaseId, id))

    // Delete purchase
    await tx.delete(purchases)
      .where(eq(purchases.id, id))

    return { data: { success: true }, tenantId: session.user.tenantId, supplierId: currentPurchase.supplierId }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  logAndBroadcast(result.tenantId, 'purchase', 'deleted', id)
  if (result.supplierId) {
    logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId)
  }
  logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', 'bulk')

  return NextResponse.json(result.data)
}
