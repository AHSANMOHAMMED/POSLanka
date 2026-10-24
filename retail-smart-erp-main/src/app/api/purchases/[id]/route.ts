import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchases, purchaseItems, purchasePayments, suppliers, warehouses, users, purchaseOrders, items as itemsTable, itemSerialNumbers, serialNumberMovements, itemSupplierCosts } from '@/lib/db/schema'
import { eq, and, sql, ne } from 'drizzle-orm'
import { applyStockChange, notifyStockDecreased } from '@/lib/inventory/apply-stock-change'
import {
  applyPurchaseCost, findMovements, reverseMovements, stockErrorResponse,
  type StockChangeRecord,
} from '@/lib/purchasing/stock-cost'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postPurchaseToGL, postVoidToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { logError } from '@/lib/ai/error-logger'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { parseSerialNumberInput, checkDuplicateSerials, allocateSerials } from '@/lib/inventory/serial-numbers'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePurchaseSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { reversePurchaseCost, reversePurchaseOrderReceipt } from '@/lib/purchasing/purchase-reversal'
import { adjustSupplierBalance } from '@/lib/purchasing/supplier-balance'
import { unbilledGrnStock } from '@/lib/purchasing/grn-coverage'
import { receiveIntoBatch, reverseDocBatches } from '@/lib/purchasing/batch-receipt'
import { findDuplicateSupplierInvoice, duplicateSupplierInvoiceResponse } from '@/lib/purchasing/supplier-invoice'
import { planGrnClearing, reversePriceVariance } from '@/lib/purchasing/srbnb'
import { evaluateThreeWayMatch, matchBlockedMessage } from '@/lib/purchasing/three-way-match'
import { activeLandedCostFor } from '@/lib/purchasing/landed-cost'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'
import { moveToRecycleBin } from '@/lib/recycle-bin'
import { assertRecordBranch, assertBranchAccess } from '@/lib/auth/branch-access'

// GET single purchase with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { error: permError }
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, db, purchases, id)
    if (branchDenied) return { error: branchDenied }

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
        matchStatus: purchases.matchStatus,
        matchDetails: purchases.matchDetails,
        matchedAt: purchases.matchedAt,
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
        srbnbQty: purchaseItems.srbnbQty,
        srbnbAmount: purchaseItems.srbnbAmount,
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
    itemBatches = {},
    changesSummary,
  } = parsed.data

  // Handle cancellation with transaction
  if (status === 'cancelled') {
    let result
    try {
      result = await withAuthTenantTransaction(async (session, tx) => {
        const permError = requirePermission(session, 'managePurchases')
        if (permError) return { error: permError }
        // K4: documents of another branch are off limits to branch-restricted staff
        const branchDenied = await assertRecordBranch(session, tx, purchases, id)
        if (branchDenied) return { error: branchDenied }

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

        // A purchase with active returns cannot be cancelled: the returns already
        // moved stock / balances and would be reversed twice. Cancel them first.
        // (Checked before anything is written: an error response still commits.)
        if (!currentPurchase.isReturn) {
          const [activeReturn] = await tx
            .select({ id: purchases.id, purchaseNo: purchases.purchaseNo })
            .from(purchases)
            .where(and(
              eq(purchases.returnAgainst, id),
              eq(purchases.isReturn, true),
              ne(purchases.status, 'cancelled'),
            ))
            .limit(1)
          if (activeReturn) {
            return { error: NextResponse.json({
              error: `Cannot cancel: purchase return ${activeReturn.purchaseNo} exists against this purchase. Cancel the return first.`,
              code: 'HAS_ACTIVE_RETURNS',
            }, { status: 400 }) }
          }
        }

        // H3: landed cost charges spread onto this invoice's goods must be cancelled first
        const landed = await activeLandedCostFor(tx, 'purchase', id)
        if (landed) {
          return { error: NextResponse.json({
            error: `Cannot cancel: landed cost voucher ${landed.voucherNo} is allocated to this purchase. Cancel the voucher first.`,
            code: 'HAS_LANDED_COST',
          }, { status: 400 }) }
        }

        // Reverse the supplier balance with audit trail (only if submitted - a draft never
        // touched it). The whole document total is reversed, matching the GL void of the
        // purchase voucher: payments already made stay on the supplier as a credit (negative
        // balance = the supplier owes us). For a purchase return the total is negative, so
        // cancelling it puts the returned amount back on the payable.
        const docTotal = Math.round(parseFloat(currentPurchase.total) * 100) / 100
        if (currentPurchase.status !== 'draft' && currentPurchase.supplierId && docTotal !== 0) {
          await adjustSupplierBalance(tx, {
            tenantId: session.user.tenantId,
            supplierId: currentPurchase.supplierId,
            delta: -docTotal,
            type: 'cancel',
            referenceType: 'purchase',
            referenceId: currentPurchase.id,
            notes: `${currentPurchase.isReturn ? 'Purchase return' : 'Purchase'} ${currentPurchase.purchaseNo} cancelled - balance reversed`,
            userId: session.user.id,
          })
        }

        // Reverse exactly the stock movements recorded for this document (receipt
        // 'in' rows for a purchase, 'out' rows for a purchase return). No clamping:
        // if the stock is no longer there the cancellation fails with 400.
        const recordedMovements = (await findMovements(tx, session.user.tenantId, 'purchase', id))
          .filter(m => m.qtyChange !== 0)
        const addedStock = recordedMovements.some(m => m.qtyChange > 0)

        // Cost reversal (purchases only, before the stock goes): exact restore when this
        // purchase is the item's last cost change, else removal from the weighted average
        // (rule documented in src/lib/purchasing/purchase-reversal.ts).
        if (addedStock && !currentPurchase.isReturn) {
          await reversePurchaseCost(tx, {
            tenantId: session.user.tenantId,
            purchaseId: id,
            purchaseNo: currentPurchase.purchaseNo,
            supplierId: currentPurchase.supplierId,
            userId: session.user.id,
            action: 'cancel',
          })
        }

        // H3: invoice-vs-GRN price difference that went into the item cost comes back out
        if (!currentPurchase.isReturn && currentPurchase.status !== 'draft') {
          await reversePriceVariance(tx, { tenantId: session.user.tenantId, purchaseId: id, purchaseNo: currentPurchase.purchaseNo, userId: session.user.id })
        }

        const stockChanges: StockChangeRecord[] = await reverseMovements(tx, recordedMovements, {
          tenantId: session.user.tenantId,
          referenceType: 'purchase',
          referenceId: id,
          keyPrefix: 'purchase-cancel',
          notes: `${currentPurchase.isReturn ? 'Purchase return' : 'Purchase'} ${currentPurchase.purchaseNo} cancelled - reversal`,
          userId: session.user.id,
          source: currentPurchase.isReturn ? 'purchase_return' : 'purchase',
          costCenterId: currentPurchase.costCenterId || null,
        })
        // batches: received quantity comes out of its batches, returned quantity goes back
        await reverseDocBatches(tx, session.user.tenantId, 'purchase', id)

        // Cancelling a purchase return brings the serials sent back to the supplier
        // into stock again ('returned' -> 'available').
        if (currentPurchase.isReturn) {
          const returnedSerials = await tx
            .selectDistinct({ id: itemSerialNumbers.id })
            .from(serialNumberMovements)
            .innerJoin(itemSerialNumbers, eq(itemSerialNumbers.id, serialNumberMovements.serialNumberId))
            .where(and(
              eq(serialNumberMovements.referenceType, 'purchase_return'),
              eq(serialNumberMovements.referenceId, id),
              eq(serialNumberMovements.toStatus, 'returned'),
              eq(itemSerialNumbers.status, 'returned'),
            ))
          if (returnedSerials.length > 0) {
            await allocateSerials(tx, {
              tenantId: session.user.tenantId,
              serialNumberIds: returnedSerials.map(r => r.id),
              newStatus: 'available',
              referenceType: 'purchase_return_cancel',
              referenceId: id,
              changedBy: session.user.id,
              notes: `Purchase return ${currentPurchase.purchaseNo} cancelled - serial back in stock`,
            })
          }
        }

        // Revert linked PO: take back exactly what this invoice added to received quantities
        const purchaseOrderId = await reversePurchaseOrderReceipt(tx, currentPurchase)

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

        return { data: updated, tenantId: session.user.tenantId, userId: session.user.id, supplierId: currentPurchase.supplierId, purchaseOrderId, stockChanges }
      })
    } catch (err) {
      const apiError = stockErrorResponse(err, 'Cannot cancel purchase')
      if (apiError) return apiError
      throw err
    }

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }
    notifyStockDecreased(result.stockChanges)

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
      // K4: documents of another branch are off limits to branch-restricted staff
      const branchDenied = await assertRecordBranch(session, tx, purchases, id)
      if (branchDenied) return { error: branchDenied }

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

      // The same supplier bill must not be posted twice (locked: concurrent submits serialise)
      const duplicate = await findDuplicateSupplierInvoice(tx, {
        tenantId: session.user.tenantId,
        supplierId: currentPurchase.supplierId,
        supplierInvoiceNo: currentPurchase.supplierInvoiceNo,
        excludePurchaseId: id,
        lock: true,
      })
      if (duplicate) return { error: duplicateSupplierInvoiceResponse(currentPurchase.supplierInvoiceNo!, duplicate) }

      // Invoice for a purchase order: quantities already put into stock by the PO's goods
      // receipts (GRN with updateStock) and not yet billed are NOT received again. The PO row
      // is locked so concurrent invoices / receipt cancellations of the same PO serialise.
      let grnRemaining = new Map<string, number>()
      if (currentPurchase.purchaseOrderId) {
        await tx.select({ id: purchaseOrders.id }).from(purchaseOrders)
          .where(eq(purchaseOrders.id, currentPurchase.purchaseOrderId)).for('update')
        grnRemaining = await unbilledGrnStock(tx, session.user.tenantId, currentPurchase.purchaseOrderId, id)
      }
      const grnRemainingAll = new Map(grnRemaining)
      const fromGrnByLine = new Map<string, number>()

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

      // H3: 3-way match (invoice vs PO price / qty vs GRN received qty). 'block' refuses the submit.
      const match = await evaluateThreeWayMatch(tx, {
        tenantId: session.user.tenantId,
        purchaseOrderId: currentPurchase.purchaseOrderId,
        purchaseId: id,
        lines: purchaseItemsList.map(item => ({ itemId: item.itemId, itemName: item.itemName, quantity: parseFloat(item.quantity), unitPrice: parseFloat(item.unitPrice) })),
      })
      if (match.status === 'mismatch' && match.action === 'block') {
        throw new Error(matchBlockedMessage(match))
      }

      // Update supplier balance with audit trail (increase what we owe them)
      if (currentPurchase.supplierId && total > 0) {
        await adjustSupplierBalance(tx, {
          tenantId: session.user.tenantId,
          supplierId: currentPurchase.supplierId,
          delta: total,
          type: 'purchase',
          referenceType: 'purchase',
          referenceId: currentPurchase.id,
          notes: `Purchase ${currentPurchase.purchaseNo} submitted`,
          userId: session.user.id,
        })
      }

      // Update warehouse stock + weighted-average cost for each line. Lines are
      // processed in itemId order so concurrent documents lock rows consistently.
      const effectiveWarehouseId = currentPurchase.warehouseId
      if (effectiveWarehouseId) {
        const stockLines = purchaseItemsList
          .map((item, idx) => ({ item, idx }))
          .filter(({ item }) => item.itemId)
          .sort((x, y) => (x.item.itemId! < y.item.itemId! ? -1 : x.item.itemId! > y.item.itemId! ? 1 : x.idx - y.idx))
        for (const { item } of stockLines) {
          const itemId = item.itemId!
          const qty = parseFloat(item.quantity)
          // Part of this line may already be in stock from the PO's goods receipt
          const fromGrn = Math.min(qty, Math.max(0, grnRemaining.get(itemId) || 0))
          if (fromGrn > 0) grnRemaining.set(itemId, Math.round(((grnRemaining.get(itemId) || 0) - fromGrn) * 1000) / 1000)
          fromGrnByLine.set(item.id, fromGrn)
          const stockQty = Math.round((qty - fromGrn) * 1000) / 1000

          if (stockQty > 0) {
            // Weighted average over TOTAL stock across all warehouses, read before
            // this line's stock is added (also writes item_cost_history 'purchase').
            await applyPurchaseCost(tx, {
              tenantId: session.user.tenantId,
              itemId,
              supplierId: currentPurchase.supplierId,
              unitPrice: parseFloat(item.unitPrice),
              qty: stockQty,
              referenceId: currentPurchase.id,
              referenceNo: currentPurchase.purchaseNo,
              userId: session.user.id,
            })

            await applyStockChange(tx, {
              tenantId: session.user.tenantId,
              warehouseId: effectiveWarehouseId,
              itemId,
              mode: 'delta',
              qty: stockQty,
              type: 'in',
              referenceType: 'purchase',
              referenceId: currentPurchase.id,
              notes: `Purchase Invoice ${currentPurchase.purchaseNo} submitted`,
              userId: session.user.id,
              source: 'purchase',
              costCenterId: currentPurchase.costCenterId || null,
              idempotencyKey: `purchase-in:${currentPurchase.id}:${item.id}`,
            })
            // batch-tracked items: into the given batch, else a batch named after the invoice
            const b = itemBatches[item.id] || {}
            await receiveIntoBatch(tx, {
              tenantId: session.user.tenantId, itemId, warehouseId: effectiveWarehouseId, qty: stockQty,
              batchNumber: b.batchNumber, expiryDate: b.expiryDate, manufacturingDate: b.manufacturingDate,
              defaultBatchNumber: currentPurchase.purchaseNo, supplierId: currentPurchase.supplierId,
              docType: 'purchase', docId: currentPurchase.id, lineId: item.id,
            })
          }

          // Serial number tracking: create serial numbers for serialized items
          const [itemRecord] = await tx.select({ trackSerialNumbers: itemsTable.trackSerialNumbers })
            .from(itemsTable)
            .where(eq(itemsTable.id, itemId))
            .limit(1)

          if (itemRecord?.trackSerialNumbers && itemSerials[itemId]) {
            const parsedSerials = parseSerialNumberInput(itemSerials[itemId])

            if (parsedSerials.length > 0) {
              // Check for duplicates
              const duplicates = await checkDuplicateSerials(tx, itemId, parsedSerials)
              if (duplicates.length > 0) {
                throw new Error(`DUPLICATE_SERIALS:Duplicate serial numbers for ${item.itemName || itemId}: ${duplicates.join(', ')}`)
              }

              // Create serial number records
              const serialValues = parsedSerials.map(sn => ({
                tenantId: session.user.tenantId,
                itemId,
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

          // Upsert item-supplier cost record
          if (currentPurchase.supplierId) {
            const [existingSupplierCost] = await tx
              .select()
              .from(itemSupplierCosts)
              .where(and(
                eq(itemSupplierCosts.itemId, itemId),
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
                itemId,
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

      // H3: the part billed against GL-posted GRN stock clears Stock Received But Not Billed
      let grnClearing: { srbnbAmount: number; priceVariance: number; cogsAdjustment: number } | undefined
      if (currentPurchase.purchaseOrderId && fromGrnByLine.size > 0) {
        const linesValue = purchaseItemsList.reduce((sum, item) => sum + parseFloat(item.quantity) * parseFloat(item.unitPrice), 0)
        const plan = await planGrnClearing(tx, {
          tenantId: session.user.tenantId,
          purchaseOrderId: currentPurchase.purchaseOrderId,
          excludePurchaseId: id,
          grnRemaining: grnRemainingAll,
          lines: purchaseItemsList.map(item => ({
            lineId: item.id, itemId: item.itemId, qty: parseFloat(item.quantity), unitPrice: parseFloat(item.unitPrice),
            fromGrn: fromGrnByLine.get(item.id) || 0,
          })),
          netFactor: linesValue > 0 ? (total - taxAmount) / linesValue : 1,
          purchaseId: id,
          purchaseNo: currentPurchase.purchaseNo,
          supplierId: currentPurchase.supplierId,
          userId: session.user.id,
        })
        for (let i = 0; i < purchaseItemsList.length; i++) {
          const l = plan.lines[i]
          if (l.srbnbQty > 0) {
            await tx.update(purchaseItems)
              .set({ srbnbQty: l.srbnbQty.toString(), srbnbAmount: l.srbnbAmount.toFixed(2) })
              .where(eq(purchaseItems.id, purchaseItemsList[i].id))
          }
        }
        if (plan.srbnbAmount !== 0) grnClearing = plan
      }

      // Update purchase status to pending and set recalculated totals
      const [updated] = await tx.update(purchases)
        .set({
          status: 'pending',
          subtotal: subtotal.toString(),
          taxAmount: taxAmount.toString(),
          taxBreakdown: purchaseTaxBreakdown,
          total: total.toString(),
          matchStatus: match.status,
          matchDetails: match,
          matchedAt: new Date(),
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
        grnClearing,
      })

      return { data: updated, tenantId: session.user.tenantId, userId: session.user.id, supplierId: currentPurchase.supplierId }
    })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('DUPLICATE_SERIALS:')) {
        return NextResponse.json({ error: message.replace('DUPLICATE_SERIALS:', '') }, { status: 400 })
      }
      const apiError = stockErrorResponse(err)
      if (apiError) return apiError
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
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, db, purchases, id)
    if (branchDenied) return { error: branchDenied }

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

    // Referenced supplier / warehouse must exist in this tenant (RLS-scoped lookups)
    if (supplierId !== undefined && supplierId !== currentPurchase.supplierId) {
      if (currentPurchase.purchaseOrderId) {
        return { error: NextResponse.json({ error: 'Supplier of an invoice linked to a purchase order cannot be changed' }, { status: 400 }) }
      }
      const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, supplierId))
      if (!s) return { error: NextResponse.json({ error: 'Supplier not found' }, { status: 404 }) }
    }
    if (warehouseId !== undefined && warehouseId !== currentPurchase.warehouseId) {
      const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId))
      if (!w) return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }
      // K4: a draft can only be moved to one of the user's own branches
      const moveDenied = await assertBranchAccess(session, warehouseId, db)
      if (moveDenied) return { error: moveDenied }
    }
    const nextSupplierId = supplierId !== undefined ? supplierId : currentPurchase.supplierId
    const nextBillNo = supplierInvoiceNo !== undefined ? supplierInvoiceNo : currentPurchase.supplierInvoiceNo
    const duplicate = await findDuplicateSupplierInvoice(db, {
      tenantId: session.user.tenantId,
      supplierId: nextSupplierId,
      supplierInvoiceNo: nextBillNo,
      excludePurchaseId: id,
    })
    if (duplicate) return { error: duplicateSupplierInvoiceResponse(nextBillNo!, duplicate) }

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

  let result
  try {
    result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }
      // K4: documents of another branch are off limits to branch-restricted staff
      const branchDenied = await assertRecordBranch(session, tx, purchases, id)
      if (branchDenied) return { error: branchDenied }

      // Get current purchase with lock (RLS filters by tenant)
      const [currentPurchase] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, id))
        .for('update')

      if (!currentPurchase) {
        return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
      }

      // A submitted purchase is a posted document (stock, payable, GL): vendors cancel it, never delete it
      if (currentPurchase.status !== 'draft') {
        return { error: NextResponse.json({ error: 'Only draft purchases can be deleted. Cancel the purchase instead.' }, { status: 400 }) }
      }

      if (parseFloat(currentPurchase.paidAmount) > 0) {
        return { error: NextResponse.json({ error: 'Cannot delete purchase with payments. Cancel the purchase instead.' }, { status: 400 }) }
      }

      if (!currentPurchase.isReturn) {
        const [activeReturn] = await tx
          .select({ id: purchases.id, purchaseNo: purchases.purchaseNo })
          .from(purchases)
          .where(and(eq(purchases.returnAgainst, id), eq(purchases.isReturn, true)))
          .limit(1)
        if (activeReturn) {
          return { error: NextResponse.json({
            error: `Cannot delete: purchase return ${activeReturn.purchaseNo} references this purchase. Cancel the purchase instead.`,
            code: 'HAS_RETURNS',
          }, { status: 400 }) }
        }
      }

      const landed = await activeLandedCostFor(tx, 'purchase', id)
      if (landed) {
        return { error: NextResponse.json({
          error: `Cannot delete: landed cost voucher ${landed.voucherNo} is allocated to this purchase. Cancel the voucher first.`,
          code: 'HAS_LANDED_COST',
        }, { status: 400 }) }
      }

      // Reverse supplier balance with audit trail (only if submitted, not draft). Signed:
      // a purchase return carries a negative total, so deleting it restores the payable.
      const total = Math.round(parseFloat(currentPurchase.total) * 100) / 100
      if (currentPurchase.status !== 'draft' && currentPurchase.supplierId && total !== 0) {
        await adjustSupplierBalance(tx, {
          tenantId: session.user.tenantId,
          supplierId: currentPurchase.supplierId,
          delta: -total,
          type: 'delete',
          referenceType: 'purchase',
          referenceId: currentPurchase.id,
          notes: `${currentPurchase.isReturn ? 'Purchase return' : 'Purchase'} ${currentPurchase.purchaseNo} deleted - balance reversed`,
          userId: session.user.id,
        })
      }

      // Reverse exactly the stock movements recorded for this purchase (no clamping;
      // insufficient stock fails the delete with 400). The ledger rows — originals
      // and reversals — are kept as the audit trail.
      const recordedMovements = (await findMovements(tx, session.user.tenantId, 'purchase', id))
        .filter(m => m.qtyChange !== 0)

      if (!currentPurchase.isReturn && currentPurchase.status !== 'draft') {
        await reversePriceVariance(tx, { tenantId: session.user.tenantId, purchaseId: id, purchaseNo: currentPurchase.purchaseNo, userId: session.user.id })
      }

      // D1: undo the cost effect (before the stock goes) and the PO received quantities
      if (!currentPurchase.isReturn && recordedMovements.some(m => m.qtyChange > 0)) {
        await reversePurchaseCost(tx, {
          tenantId: session.user.tenantId,
          purchaseId: id,
          purchaseNo: currentPurchase.purchaseNo,
          supplierId: currentPurchase.supplierId,
          userId: session.user.id,
          action: 'delete',
        })
      }
      const purchaseOrderId = await reversePurchaseOrderReceipt(tx, currentPurchase)

      const stockChanges: StockChangeRecord[] = await reverseMovements(tx, recordedMovements, {
        tenantId: session.user.tenantId,
        referenceType: 'purchase',
        referenceId: id,
        keyPrefix: 'purchase-delete',
        notes: `Purchase ${currentPurchase.purchaseNo} deleted - reversal`,
        userId: session.user.id,
        source: currentPurchase.isReturn ? 'purchase_return' : 'purchase',
        costCenterId: currentPurchase.costCenterId || null,
      })
      await reverseDocBatches(tx, session.user.tenantId, 'purchase', id)

      // Reverse GL entries for this purchase (non-blocking)
      if (currentPurchase.status !== 'draft') {
        try {
          await postVoidToGL(tx, session.user.tenantId, 'purchase', id)
        } catch (glError) {
          logError('api/purchases/[id]', glError)
        }
      }

      // Keep a copy in the recycle bin (super admin can restore it)
      await moveToRecycleBin(tx, {
        tenantId: session.user.tenantId, entityType: 'purchase', entityId: id,
        userId: session.user.id, userName: session.user.name,
      })
      // Delete items
      await tx.delete(purchaseItems)
        .where(eq(purchaseItems.purchaseId, id))

      // Delete payments (should be none)
      await tx.delete(purchasePayments)
        .where(eq(purchasePayments.purchaseId, id))

      // Delete purchase
      await tx.delete(purchases)
        .where(eq(purchases.id, id))

      return { data: { success: true }, tenantId: session.user.tenantId, userId: session.user.id, supplierId: currentPurchase.supplierId, purchaseOrderId, stockChanges }
    })
  } catch (err) {
    const apiError = stockErrorResponse(err, 'Cannot delete purchase')
    if (apiError) return apiError
    throw err
  }

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  notifyStockDecreased(result.stockChanges)

  logAndBroadcast(result.tenantId, 'purchase', 'deleted', id, { userId: result.userId })
  if (result.supplierId) {
    logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId, { userId: result.userId })
  }
  if (result.purchaseOrderId) {
    logAndBroadcast(result.tenantId, 'purchase-order', 'updated', result.purchaseOrderId, { userId: result.userId })
  }
  logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', 'bulk')

  return NextResponse.json(result.data)
}
