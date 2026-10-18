// POST /api/purchases/[id]/return - Create a purchase return against an existing purchase
// Fix #8: Implements purchase returns with stock reversal and supplier balance adjustment

import { NextRequest, NextResponse } from 'next/server'
import { db as rawDb, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import {
  purchases, purchaseItems, suppliers, warehouseStock, stockMovements, supplierBalanceAudit,
} from '@/lib/db/schema'
import { eq, and, sql, ilike, desc, inArray, ne } from 'drizzle-orm'
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

      const alreadyReturnedMap = new Map<string, number>()
      if (existingReturns.length > 0) {
        const existingReturnItems = await tx
          .select()
          .from(purchaseItems)
          .where(inArray(purchaseItems.purchaseId, existingReturns.map(r => r.id)))

        for (const eri of existingReturnItems) {
          if (eri.itemId) {
            const prev = alreadyReturnedMap.get(eri.itemId) || 0
            alreadyReturnedMap.set(eri.itemId, prev + Math.abs(parseFloat(eri.quantity)))
          }
        }
      }

      // Aggregate total original quantities per itemId (same item may appear on multiple lines)
      const totalOriginalQtyByItemId = new Map<string, number>()
      for (const oi of originalItems) {
        if (oi.itemId) {
          const prev = totalOriginalQtyByItemId.get(oi.itemId) || 0
          totalOriginalQtyByItemId.set(oi.itemId, prev + parseFloat(oi.quantity))
        }
      }

      // Validate return quantities
      const validatedItems: { item: typeof originalItems[0]; returnQty: number }[] = []
      // Track return quantities requested in this batch per itemId to prevent over-returning
      const batchReturnByItemId = new Map<string, number>()

      for (const ri of returnItems) {
        const origItem = originalItemMap.get(ri.purchaseItemId)
        if (!origItem) {
          return { error: NextResponse.json({ error: `Purchase item ${ri.purchaseItemId} not found` }, { status: 404 }) }
        }

        if (ri.returnQuantity <= 0) {
          return { error: NextResponse.json({ error: 'Return quantity must be positive' }, { status: 400 }) }
        }

        // For items with itemId, validate against total original qty for that item across all lines
        // This correctly handles the same inventory item appearing on multiple purchase lines
        if (origItem.itemId) {
          const totalOriginalQty = totalOriginalQtyByItemId.get(origItem.itemId) || 0
          const alreadyReturned = alreadyReturnedMap.get(origItem.itemId) || 0
          const batchReturned = batchReturnByItemId.get(origItem.itemId) || 0
          const maxReturnable = totalOriginalQty - alreadyReturned - batchReturned

          if (ri.returnQuantity > maxReturnable) {
            return { error: NextResponse.json({
              error: alreadyReturned > 0
                ? `Cannot return ${ri.returnQuantity} of ${origItem.itemName}. Only ${maxReturnable} remaining (${alreadyReturned} already returned)`
                : `Return quantity (${ri.returnQuantity}) exceeds original quantity (${totalOriginalQty}) for ${origItem.itemName}`,
            }, { status: 400 }) }
          }

          batchReturnByItemId.set(origItem.itemId, batchReturned + ri.returnQuantity)
        } else {
          // For items without itemId, validate against the specific line item quantity only
          const originalQty = parseFloat(origItem.quantity)
          if (ri.returnQuantity > originalQty) {
            return { error: NextResponse.json({
              error: `Return quantity (${ri.returnQuantity}) exceeds original quantity (${originalQty}) for ${origItem.itemName}`,
            }, { status: 400 }) }
          }
        }

        validatedItems.push({ item: origItem, returnQty: ri.returnQuantity })
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

      // Generate return purchase number
      const today = new Date()
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
      const prefix = `PR-${dateStr}-`
      const existing = await tx
        .select({ purchaseNo: purchases.purchaseNo })
        .from(purchases)
        .where(ilike(purchases.purchaseNo, `${prefix}%`))
        .orderBy(desc(purchases.purchaseNo))
        .limit(1)
        .for('update')

      let nextNum = 1
      if (existing.length > 0) {
        const lastNum = parseInt(existing[0].purchaseNo.split('-').pop() || '0', 10)
        nextNum = lastNum + 1
      }
      const returnPurchaseNo = `${prefix}${nextNum.toString().padStart(3, '0')}`

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

      // Reverse stock for returned items
      if (originalPurchase.warehouseId) {
        for (const { item, returnQty } of validatedItems) {
          if (item.itemId) {
            const [existingStock] = await tx
              .select()
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.warehouseId, originalPurchase.warehouseId!),
                eq(warehouseStock.itemId, item.itemId)
              ))
              .for('update')

            if (existingStock) {
              await tx.update(warehouseStock)
                .set({
                  currentStock: sql`GREATEST(0, ${warehouseStock.currentStock} - ${returnQty})`,
                  updatedAt: new Date(),
                })
                .where(eq(warehouseStock.id, existingStock.id))
            }

            // Create stock movement record
            await tx.insert(stockMovements).values({
              tenantId: session.user.tenantId,
              warehouseId: originalPurchase.warehouseId!,
              itemId: item.itemId,
              type: 'out',
              quantity: returnQty.toString(),
              notes: `Purchase return ${returnPurchaseNo} against ${originalPurchase.purchaseNo}`,
              referenceType: 'purchase',
              referenceId: returnPurchase.id,
              createdBy: session.user.id,
            })
          }
        }
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
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    logAndBroadcast(result.tenantId, 'purchase', 'created', result.data.id)
    if (result.supplierId) {
      logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId)
    }
    logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', 'bulk')

    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logError('api/purchases/[id]/return', error)
    return NextResponse.json({ error: 'Failed to create purchase return' }, { status: 500 })
  }
}
