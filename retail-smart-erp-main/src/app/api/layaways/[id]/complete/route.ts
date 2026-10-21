import { NextRequest, NextResponse } from 'next/server'
import { db as rawDb, withAuthTenantTransaction } from '@/lib/db'
import { layaways, layawayItems, sales, saleItems, payments, items as itemsTable, warehouseStock, warehouses, workOrderParts, workOrders, heldSales, insuranceEstimateItems, insuranceEstimates } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postSaleToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'
import { logError } from '@/lib/ai/error-logger'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { layawayCompleteSchema } from '@/lib/validation/schemas/layaways'
import { stripNullValues, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { allocateSaleLineBatches } from '@/lib/inventory/batches'
import { getTenantSalesSettings } from '@/lib/sales/return-settings'

// POST complete a layaway (convert to sale)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  let body: { warehouseId?: string | null } = {}
  try {
    const text = await request.text()
    if (text) {
      const raw = stripNullValues(JSON.parse(text))
      const parsed = layawayCompleteSchema.safeParse(raw)
      if (parsed.success) body = parsed.data
    }
  } catch {
    // Allow empty body - warehouse will be resolved to default
  }

  let result
  try {

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permError = requirePermission(preSession, 'createSales')
  if (permError) return permError

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  // Pre-validate accounting config before starting transaction
  const acctError = await requireAccountingConfig(rawDb, preSession.user.tenantId, 'sale')
  if (acctError) return acctError

  result = await withAuthTenantTransaction(async (session, tx) => {
    // Get layaway with lock (RLS filters by tenant)
    const [layaway] = await tx
      .select()
      .from(layaways)
      .where(eq(layaways.id, id))
      .for('update')

    if (!layaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    if (layaway.status !== 'active' && layaway.status !== 'fully_paid') {
      return {
        error: NextResponse.json({
          error: `Layaway cannot be completed. Current status: ${layaway.status}`
        }, { status: 400 })
      }
    }

    // Verify all payments have been made (balance due should be 0 or very close)
    const balanceDue = parseCurrency(layaway.balanceDue)
    if (balanceDue > 0.01) {
      return {
        error: NextResponse.json({
          error: `Layaway has outstanding balance of ${balanceDue.toFixed(2)}. All payments must be made before completing.`
        }, { status: 400 })
      }
    }

    // Get layaway items
    const layawayItemsData = await tx
      .select({
        id: layawayItems.id,
        itemId: layawayItems.itemId,
        itemName: layawayItems.itemName,
        quantity: layawayItems.quantity,
        unitPrice: layawayItems.unitPrice,
        total: layawayItems.total,
      })
      .from(layawayItems)
      .where(eq(layawayItems.layawayId, id))

    // Get warehouse - use provided or default
    let warehouseId = body.warehouseId
    if (!warehouseId) {
      const defaultWarehouse = await tx.query.warehouses.findFirst({
        where: and(
          eq(warehouses.isDefault, true),
          eq(warehouses.isActive, true)
        ),
      })
      if (defaultWarehouse) {
        warehouseId = defaultWarehouse.id
      } else {
        // Fallback: get any active warehouse
        const anyWarehouse = await tx.query.warehouses.findFirst({
          where: eq(warehouses.isActive, true),
        })
        if (anyWarehouse) {
          warehouseId = anyWarehouse.id
        }
      }
    }

    if (!warehouseId) {
      return {
        error: NextResponse.json({
          error: 'No warehouse configured. Please set up a warehouse first.'
        }, { status: 400 })
      }
    }

    // Check stock availability with reservation awareness before creating the sale
    // This prevents overselling items reserved by work orders, held sales, or estimates
    const reservedFromWO = await tx
      .select({
        itemId: workOrderParts.itemId,
        reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
      })
      .from(workOrderParts)
      .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
      .where(and(
        eq(workOrders.status, 'draft'),
        eq(workOrders.warehouseId, warehouseId!)
      ))
      .groupBy(workOrderParts.itemId)

    const heldSalesData = await tx.query.heldSales.findMany({
      where: and(
        eq(heldSales.warehouseId, warehouseId!),
        sql`${heldSales.expiresAt} > NOW()`
      ),
    })

    const reservedFromEst = await tx
      .select({
        itemId: insuranceEstimateItems.itemId,
        reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
      })
      .from(insuranceEstimateItems)
      .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
      .where(
        and(
          eq(insuranceEstimates.holdStock, true),
          eq(insuranceEstimates.warehouseId, warehouseId!),
          sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
          sql`${insuranceEstimateItems.itemId} IS NOT NULL`
        )
      )
      .groupBy(insuranceEstimateItems.itemId)

    const reservedMap = new Map<string, number>()
    for (const r of reservedFromWO) {
      reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
    }
    for (const held of heldSalesData) {
      const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
      if (Array.isArray(cartItems)) {
        for (const ci of cartItems) {
          if (ci.itemId) {
            reservedMap.set(ci.itemId, (reservedMap.get(ci.itemId) || 0) + (ci.quantity || 0))
          }
        }
      }
    }
    for (const r of reservedFromEst) {
      if (r.itemId) {
        reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
      }
    }

    // Validate stock for all items before proceeding
    const insufficientItems: string[] = []
    for (const item of layawayItemsData) {
      if (!item.itemId) continue
      const quantity = parseCurrency(item.quantity)
      const [itemRecord] = await tx
        .select({ id: itemsTable.id, trackStock: itemsTable.trackStock })
        .from(itemsTable)
        .where(eq(itemsTable.id, item.itemId))
      if (itemRecord?.trackStock) {
        const [stock] = await tx
          .select({ currentStock: warehouseStock.currentStock })
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.warehouseId, warehouseId),
            eq(warehouseStock.itemId, item.itemId)
          ))
        const currentStock = stock ? parseFloat(stock.currentStock) : 0
        const reserved = reservedMap.get(item.itemId) || 0
        const available = currentStock - reserved
        if (available < quantity) {
          insufficientItems.push(`${item.itemName} (need: ${quantity}, available: ${Math.max(0, available)})`)
        }
      }
    }

    if (insufficientItems.length > 0) {
      return {
        error: NextResponse.json({
          error: `Insufficient stock for: ${insufficientItems.join(', ')}`,
          insufficientStockItems: insufficientItems,
        }, { status: 400 })
      }
    }

    // Generate invoice number
    const invoiceNo = await nextDocumentNumber(tx, session.user.tenantId, 'invoice')

    // Calculate per-item tax using template system for the sale
    const lineItems = layawayItemsData.map(item => ({
      itemId: item.itemId,
      lineTotal: parseCurrency(item.quantity) * parseCurrency(item.unitPrice),
    }))
    const taxCalcResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'sales' })

    // Use template values if available, otherwise use stored layaway values
    const saleTaxBreakdown = taxCalcResult.taxBreakdown
    const saleSubtotal = (taxCalcResult.taxBreakdown && taxCalcResult.taxBreakdown.length > 0)
      ? taxCalcResult.subtotal.toString()
      : layaway.subtotal
    const saleTaxAmount = (taxCalcResult.taxBreakdown && taxCalcResult.taxBreakdown.length > 0)
      ? taxCalcResult.totalTax.toString()
      : layaway.taxAmount
    const saleTotal = (taxCalcResult.taxBreakdown && taxCalcResult.taxBreakdown.length > 0)
      ? roundCurrency(taxCalcResult.subtotal + taxCalcResult.totalTax).toString()
      : layaway.total

    // Create sale from layaway
    const saleResult = await tx.insert(sales).values({
      tenantId: session.user.tenantId,
      invoiceNo,
      customerId: layaway.customerId,
      warehouseId,
      subtotal: saleSubtotal,
      taxAmount: saleTaxAmount,
      taxBreakdown: saleTaxBreakdown,
      total: saleTotal,
      paidAmount: layaway.paidAmount, // All paid
      paymentMethod: 'cash', // Mark as completed via layaway
      status: 'completed',
      notes: `Converted from layaway ${layaway.layawayNo}`,
      createdBy: session.user.id,
    }).returning()
    const newSale = (saleResult as typeof sales.$inferSelect[])[0]

    // Create sale items and update stock
    let totalCOGS = 0
    const stockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
    let batchSettings: Awaited<ReturnType<typeof getTenantSalesSettings>>['batches'] | null = null
    for (let idx = 0; idx < layawayItemsData.length; idx++) {
      const item = layawayItemsData[idx]
      const quantity = parseCurrency(item.quantity)
      const perItem = taxCalcResult.perItemTax[idx]
      const itemTaxAmount = perItem ? perItem.taxAmount : 0
      const itemLineTotal = parseCurrency(item.quantity) * parseCurrency(item.unitPrice)
      const itemTaxRate = itemLineTotal > 0 ? roundCurrency((itemTaxAmount / itemLineTotal) * 100) : 0

      // Create sale item with per-item tax
      const [saleLine] = await tx.insert(saleItems).values({
        tenantId: session.user.tenantId,
        saleId: newSale.id,
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: itemTaxRate.toString(),
        taxAmount: itemTaxAmount.toString(),
        taxBreakdown: perItem?.taxBreakdown || null,
        total: item.total,
      }).returning({ id: saleItems.id })

      // Update stock if item exists and tracks stock
      if (item.itemId) {
        const [itemRecord] = await tx
          .select({ id: itemsTable.id, trackStock: itemsTable.trackStock, trackBatches: itemsTable.trackBatches, costPrice: itemsTable.costPrice })
          .from(itemsTable)
          .where(eq(itemsTable.id, item.itemId))

        // Accumulate COGS from item cost prices
        if (itemRecord?.costPrice) {
          totalCOGS += roundCurrency(parseCurrency(itemRecord.costPrice) * quantity)
        }

        if (itemRecord?.trackStock && quantity !== 0) {
          // Single stock writer: locks the row, enforces non-negative stock and
          // writes the signed ledger row. Keyed per layaway line (replay-safe).
          const input: StockChangeInput = {
            tenantId: session.user.tenantId,
            warehouseId,
            itemId: item.itemId,
            mode: 'delta',
            qty: -quantity,
            type: 'out',
            referenceType: 'sale',
            referenceId: newSale.id,
            notes: `Sale from layaway ${layaway.layawayNo}`,
            userId: session.user.id,
            source: 'layaway',
            idempotencyKey: `layaway:${id}:${item.id}`,
          }
          const change = await applyStockChange(tx, input)
          stockChanges.push({ result: change, input })

          // E1: batch-tracked lines draw FEFO from item_batches (stock row locked above) and
          // record sale_item_batches for returns / voids. Non-negative policy: missing batch
          // quantity rejects the completion.
          if (itemRecord.trackBatches && quantity > 0) {
            batchSettings ??= (await getTenantSalesSettings(tx, session.user.tenantId)).batches
            await allocateSaleLineBatches(tx, {
              tenantId: session.user.tenantId,
              warehouseId,
              itemId: item.itemId,
              qty: quantity,
              saleItemId: saleLine.id,
              allowExpired: batchSettings.allowExpiredSale,
              itemName: item.itemName,
            })
          }
        }
      }
    }

    // Create a payment record linking all layaway payments to the sale
    // This creates a summary payment for audit purposes
    await tx.insert(payments).values({
      tenantId: session.user.tenantId,
      saleId: newSale.id,
      amount: layaway.paidAmount,
      method: 'cash', // Summary payment method
      reference: `Layaway payments from ${layaway.layawayNo}`,
      receivedBy: session.user.id,
    })

    // Post sale to GL (revenue, tax, COGS)
    const saleTaxBreakdownForGL = saleTaxBreakdown as TaxBreakdownItem[] | undefined
    await postSaleToGL(tx, session.user.tenantId, {
      saleId: newSale.id,
      invoiceNumber: invoiceNo,
      saleDate: new Date().toISOString().split('T')[0],
      subtotal: parseCurrency(saleSubtotal),
      tax: parseCurrency(saleTaxAmount),
      discount: 0,
      total: parseCurrency(saleTotal),
      amountPaid: parseCurrency(layaway.paidAmount),
      creditAmount: 0,
      costOfGoodsSold: totalCOGS,
      paymentMethod: 'cash',
      customerId: layaway.customerId || null,
      taxBreakdown: saleTaxBreakdownForGL,
    })

    // Update layaway status to completed
    await tx.update(layaways)
      .set({
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(layaways.id, id))

    return {
      data: {
        layaway: { id: layaway.id, layawayNo: layaway.layawayNo, status: 'completed' },
        sale: { id: newSale.id, invoiceNo: newSale.invoiceNo },
      },
      tenantId: session.user.tenantId,
      warehouseId,
      stockChanges,
    }
  })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to complete layaway'
    if (message.startsWith('Insufficient stock')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    const stockError = stockErrorResponse(err)
    if (stockError) return stockError
    logError('api/layaways/[id]/complete', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  notifyStockDecreased(result.stockChanges)

  // Broadcast changes
  logAndBroadcast(result.tenantId, 'layaway', 'updated', id)
  logAndBroadcast(result.tenantId, 'sale', 'created', result.data.sale.id)
  logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', result.warehouseId)

  return NextResponse.json(result.data)
}
