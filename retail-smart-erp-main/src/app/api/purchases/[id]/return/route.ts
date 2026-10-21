// POST /api/purchases/[id]/return - Create a purchase return against an existing purchase
// Fix #8: Implements purchase returns with stock reversal and supplier balance adjustment

import { NextRequest, NextResponse } from 'next/server'
import { db as rawDb, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import {
  purchases, purchaseItems, suppliers, supplierBalanceAudit, items as itemsTable, itemSerialNumbers,
} from '@/lib/db/schema'
import { eq, and, inArray, ne } from 'drizzle-orm'
import { applyStockChanges, notifyStockDecreased, type StockChangeInput } from '@/lib/inventory/apply-stock-change'
import { allocateSerials } from '@/lib/inventory/serial-numbers'
import { stockErrorResponse, type StockChangeRecord } from '@/lib/purchasing/stock-cost'
import { roundCurrency } from '@/lib/utils/currency'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postPurchaseToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createPurchaseReturnSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocNo } from '@/lib/documents/numbering'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, createPurchaseReturnSchema)
  if (!parsed.success) return parsed.response
  const { items: returnItems, reason, returnReason } = parsed.data

  try {

    const preSession = await authWithCompany()
    if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
    if (quotaError) return quotaError

    // Pre-validate accounting config before starting transaction
    const acctError = await requireAccountingConfig(rawDb, preSession.user.tenantId, 'purchase')
    if (acctError) return acctError

    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      // Get original purchase with lock
      const [originalPurchase] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, id))
        .for('update')

      if (!originalPurchase) {
        return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
      }

      if (originalPurchase.status === 'draft' || originalPurchase.status === 'cancelled') {
        return { error: NextResponse.json({ error: 'Cannot return items from a draft or cancelled purchase' }, { status: 400 }) }
      }

      // Get original purchase items
      const originalItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, id))

      const originalItemMap = new Map(originalItems.map(i => [i.id, i]))

      // Check already-returned quantities from previous returns
      const existingReturns = await tx
        .select({ id: purchases.id })
        .from(purchases)
        .where(and(
          eq(purchases.returnAgainst, id),
          eq(purchases.isReturn, true),
          ne(purchases.status, 'cancelled')
        ))

      // Lines are matched to prior returns by a stable key: the inventory item
      // when there is one, otherwise the (case-insensitive) name + unit price.
      const lineKey = (l: { itemId: string | null; itemName: string; unitPrice: string }) =>
        l.itemId ? `item:${l.itemId}` : `name:${l.itemName.trim().toLowerCase()}|${parseFloat(l.unitPrice).toFixed(2)}`

      const alreadyReturnedMap = new Map<string, number>()
      if (existingReturns.length > 0) {
        const existingReturnItems = await tx
          .select()
          .from(purchaseItems)
          .where(inArray(purchaseItems.purchaseId, existingReturns.map(r => r.id)))

        for (const eri of existingReturnItems) {
          const key = lineKey(eri)
          alreadyReturnedMap.set(key, (alreadyReturnedMap.get(key) || 0) + Math.abs(parseFloat(eri.quantity)))
        }
      }

      // Aggregate total original quantities per key (same item may appear on multiple lines)
      const totalOriginalQtyByKey = new Map<string, number>()
      for (const oi of originalItems) {
        const key = lineKey(oi)
        totalOriginalQtyByKey.set(key, (totalOriginalQtyByKey.get(key) || 0) + parseFloat(oi.quantity))
      }

      // Validate return quantities
      const validatedItems: { item: typeof originalItems[0]; returnQty: number; serialNumberIds: string[] }[] = []
      // Track return quantities requested in this batch per key to prevent over-returning
      const batchReturnByKey = new Map<string, number>()
      const round3 = (n: number) => Math.round(n * 1000) / 1000

      for (const ri of returnItems) {
        const origItem = originalItemMap.get(ri.purchaseItemId)
        if (!origItem) {
          return { error: NextResponse.json({ error: `Purchase item ${ri.purchaseItemId} not found` }, { status: 404 }) }
        }

        if (ri.returnQuantity <= 0) {
          return { error: NextResponse.json({ error: 'Return quantity must be positive' }, { status: 400 }) }
        }

        // Validate against the total purchased for this key across all lines, minus
        // everything already returned (prior returns + earlier lines of this request).
        const key = lineKey(origItem)
        const totalOriginalQty = totalOriginalQtyByKey.get(key) || 0
        const alreadyReturned = alreadyReturnedMap.get(key) || 0
        const batchReturned = batchReturnByKey.get(key) || 0
        const maxReturnable = round3(totalOriginalQty - alreadyReturned - batchReturned)

        if (ri.returnQuantity > maxReturnable) {
          return { error: NextResponse.json({
            error: alreadyReturned + batchReturned > 0
              ? `Cannot return ${ri.returnQuantity} of ${origItem.itemName}. Only ${Math.max(0, maxReturnable)} remaining (${round3(alreadyReturned + batchReturned)} already returned)`
              : `Return quantity (${ri.returnQuantity}) exceeds original quantity (${totalOriginalQty}) for ${origItem.itemName}`,
          }, { status: 400 }) }
        }

        batchReturnByKey.set(key, round3(batchReturned + ri.returnQuantity))
        validatedItems.push({ item: origItem, returnQty: ri.returnQuantity, serialNumberIds: [...new Set(ri.serialNumberIds || [])] })
      }

      // Serial-tracked items: the serials going back to the supplier must be given,
      // match the quantity, belong to the item and be 'available' in the warehouse.
      const trackedItemIds = [...new Set(validatedItems.map(v => v.item.itemId).filter((x): x is string => !!x))]
      const trackedSet = new Set<string>()
      if (trackedItemIds.length > 0) {
        const tracked = await tx
          .select({ id: itemsTable.id })
          .from(itemsTable)
          .where(and(inArray(itemsTable.id, trackedItemIds), eq(itemsTable.trackSerialNumbers, true)))
        for (const t of tracked) trackedSet.add(t.id)
      }
      const usedSerials = new Set<string>()
      for (const v of validatedItems) {
        const name = v.item.itemName
        if (!v.item.itemId || !trackedSet.has(v.item.itemId)) {
          if (v.serialNumberIds.length > 0) {
            return { error: NextResponse.json({ error: `${name} is not serial-tracked; serial numbers are not allowed` }, { status: 400 }) }
          }
          continue
        }
        if (!Number.isInteger(v.returnQty) || v.serialNumberIds.length !== v.returnQty) {
          return { error: NextResponse.json({
            error: `${name} is serial-tracked: provide exactly ${v.returnQty} serial number(s) to return (got ${v.serialNumberIds.length})`,
          }, { status: 400 }) }
        }
        for (const sid of v.serialNumberIds) {
          if (usedSerials.has(sid)) {
            return { error: NextResponse.json({ error: `Serial number listed more than once for ${name}` }, { status: 400 }) }
          }
          usedSerials.add(sid)
        }
        const serials = await tx
          .select()
          .from(itemSerialNumbers)
          .where(inArray(itemSerialNumbers.id, v.serialNumberIds))
          .for('update')
        const bad = v.serialNumberIds.filter(sid => {
          const s = serials.find(x => x.id === sid)
          return !s || s.itemId !== v.item.itemId || s.status !== 'available'
            || (originalPurchase.warehouseId != null && s.warehouseId !== originalPurchase.warehouseId)
        })
        if (bad.length > 0) {
          const labels = bad.map(sid => serials.find(x => x.id === sid)?.serialNumber || sid)
          return { error: NextResponse.json({
            error: `Serial numbers not available for return of ${name} in this warehouse: ${labels.join(', ')}`,
          }, { status: 400 }) }
        }
      }

      // Recalculate tax using templates for the return line items
      const returnLineItems = validatedItems.map(({ item, returnQty }) => ({
        itemId: item.itemId,
        lineTotal: roundCurrency(returnQty * parseFloat(item.unitPrice)),
      }))
      const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, returnLineItems, { type: 'purchase' })

      const returnSubtotal = taxResult.subtotal
      const returnTax = taxResult.totalTax
      const returnTotal = taxResult.total
      const returnTaxBreakdown = taxResult.taxBreakdown

      // Return number PR-YYYYMMDD-### from the per-tenant daily sequence
      const returnPurchaseNo = await nextDocNo(tx, session.user.tenantId, 'purchase_return')

      // Validate returnReason if provided
      const validReturnReasons = ['defective', 'wrong_item', 'excess_quantity', 'damaged', 'expired', 'other']
      if (returnReason && !validReturnReasons.includes(returnReason)) {
        return { error: NextResponse.json({ error: `Invalid return reason. Valid values: ${validReturnReasons.join(', ')}` }, { status: 400 }) }
      }

      // Create the return purchase record with template tax breakdown
      const [returnPurchase] = await tx.insert(purchases).values({
        tenantId: session.user.tenantId,
        purchaseNo: returnPurchaseNo,
        supplierId: originalPurchase.supplierId,
        warehouseId: originalPurchase.warehouseId,
        supplierInvoiceNo: originalPurchase.supplierInvoiceNo ? `RET-${originalPurchase.supplierInvoiceNo}` : null,
        paymentTerm: originalPurchase.paymentTerm,
        subtotal: (-returnSubtotal).toString(),
        taxAmount: (-returnTax).toString(),
        taxBreakdown: returnTaxBreakdown ? returnTaxBreakdown.map(b => ({ ...b, amount: -b.amount })) : null,
        total: (-returnTotal).toString(),
        paidAmount: '0',
        status: 'pending',
        isReturn: true,
        returnAgainst: id,
        returnReason: returnReason || null,
        notes: reason || `Return against ${originalPurchase.purchaseNo}`,
        costCenterId: originalPurchase.costCenterId,
        createdBy: session.user.id,
      }).returning()

      // Create return purchase items with per-item template tax
      for (let idx = 0; idx < validatedItems.length; idx++) {
        const { item, returnQty } = validatedItems[idx]
        const perItem = taxResult.perItemTax[idx]
        const itemTaxAmount = perItem ? perItem.taxAmount : 0
        const itemLineTotal = roundCurrency(returnQty * parseFloat(item.unitPrice))
        const itemReturnTotal = roundCurrency(itemLineTotal + itemTaxAmount)

        await tx.insert(purchaseItems).values({
          tenantId: session.user.tenantId,
          purchaseId: returnPurchase.id,
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: (-returnQty).toString(),
          unitPrice: item.unitPrice,
          tax: (-itemTaxAmount).toString(),
          taxRate: perItem ? perItem.taxRate.toString() : '0',
          taxAmount: (-itemTaxAmount).toString(),
          taxBreakdown: perItem?.taxBreakdown || null,
          total: (-itemReturnTotal).toString(),
        })
      }

      // Reverse stock for returned items (signed ledger rows; never clamps — if the
      // stock is no longer on hand the return fails with 400)
      const stockInputs: StockChangeInput[] = []
      if (originalPurchase.warehouseId) {
        validatedItems.forEach(({ item, returnQty }, idx) => {
          if (!item.itemId) return
          stockInputs.push({
            tenantId: session.user.tenantId,
            warehouseId: originalPurchase.warehouseId!,
            itemId: item.itemId,
            mode: 'delta',
            qty: -returnQty,
            type: 'out',
            referenceType: 'purchase',
            referenceId: returnPurchase.id,
            notes: `Purchase return ${returnPurchaseNo} against ${originalPurchase.purchaseNo}`,
            userId: session.user.id,
            source: 'purchase_return',
            costCenterId: originalPurchase.costCenterId || null,
            idempotencyKey: `purchase-return:${returnPurchase.id}:${idx}`,
          })
        })
      }
      const stockResults = await applyStockChanges(tx, stockInputs)
      const stockChanges: StockChangeRecord[] = stockResults.map((result, i) => ({ result, input: stockInputs[i] }))

      // Serials go back to the supplier: status 'returned', audit trail on the return
      for (const { serialNumberIds } of validatedItems) {
        if (serialNumberIds.length === 0) continue
        await allocateSerials(tx, {
          tenantId: session.user.tenantId,
          serialNumberIds,
          newStatus: 'returned',
          referenceType: 'purchase_return',
          referenceId: returnPurchase.id,
          changedBy: session.user.id,
          notes: `Returned to supplier on ${returnPurchaseNo} (against ${originalPurchase.purchaseNo})`,
        })
      }

      // Reverse supplier balance
      if (originalPurchase.supplierId && returnTotal > 0) {
        const [currentSupplier] = await tx
          .select({ balance: suppliers.balance })
          .from(suppliers)
          .where(eq(suppliers.id, originalPurchase.supplierId))
          .for('update')

        const previousBalance = parseFloat(currentSupplier?.balance || '0')
        const newBalance = Math.round((previousBalance - returnTotal) * 100) / 100

        await tx.update(suppliers)
          .set({ balance: newBalance.toString() })
          .where(eq(suppliers.id, originalPurchase.supplierId))

        await tx.insert(supplierBalanceAudit).values({
          tenantId: session.user.tenantId,
          supplierId: originalPurchase.supplierId,
          type: 'return',
          amount: (-returnTotal).toString(),
          previousBalance: previousBalance.toString(),
          newBalance: newBalance.toString(),
          referenceType: 'purchase',
          referenceId: returnPurchase.id,
          notes: `Purchase return ${returnPurchaseNo} against ${originalPurchase.purchaseNo}`,
          createdBy: session.user.id,
        })
      }

      // Post return to GL with template breakdown for per-account entries
      // Use positive amounts + isReturn flag (GL function handles reversal)
      await postPurchaseToGL(tx, session.user.tenantId, {
        purchaseId: returnPurchase.id,
        invoiceNumber: returnPurchaseNo,
        purchaseDate: new Date().toISOString().split('T')[0],
        subtotal: returnSubtotal,
        tax: returnTax,
        discount: 0,
        total: returnTotal,
        amountPaid: 0,
        supplierId: originalPurchase.supplierId || null,
        costCenterId: originalPurchase.costCenterId || null,
        taxBreakdown: returnTaxBreakdown || undefined,
        isReturn: true,
      })

      return {
        data: returnPurchase,
        tenantId: session.user.tenantId,
        supplierId: originalPurchase.supplierId,
        stockChanges,
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    notifyStockDecreased(result.stockChanges)

    logAndBroadcast(result.tenantId, 'purchase', 'created', result.data.id)
    if (result.supplierId) {
      logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId)
    }
    logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', 'bulk')

    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    const apiError = stockErrorResponse(error, 'Cannot return items')
    if (apiError) return apiError
    logError('api/purchases/[id]/return', error)
    return NextResponse.json({ error: 'Failed to create purchase return' }, { status: 500 })
  }
}
