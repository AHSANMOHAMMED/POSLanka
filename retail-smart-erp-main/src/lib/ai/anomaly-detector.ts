import { withTenant } from '@/lib/db'
import { aiAlerts, sales } from '@/lib/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { generateText } from './gemini'
import { SYSTEM_PROMPTS, formatAnomalyForPrompt } from './prompts'

interface AnomalyResult {
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  details: Record<string, unknown>
}

/**
 * Check a completed sale for anomalies.
 * Fire-and-forget — call after sale creation.
 */
export function checkSaleAnomalies(
  tenantId: string,
  sale: {
    id: string
    invoiceNo: string
    subtotal: number
    discountAmount: number
    taxAmount: number
    totalAmount: number
    createdByName?: string
    items: Array<{
      itemName: string
      quantity: number
      unitPrice: number
      costPrice?: number
      discountPercent?: number
    }>
  }
): void {
  _checkSaleAsync(tenantId, sale).catch(err => {
    console.error('[Anomaly] Sale check failed:', err)
  })
}

async function _checkSaleAsync(
  tenantId: string,
  sale: {
    id: string
    invoiceNo: string
    subtotal: number
    discountAmount: number
    taxAmount: number
    totalAmount: number
    createdByName?: string
    items: Array<{
      itemName: string
      quantity: number
      unitPrice: number
      costPrice?: number
      discountPercent?: number
    }>
  }
): Promise<void> {
  const anomalies: AnomalyResult[] = []

  // Rule 1: High discount percentage
  if (sale.subtotal > 0) {
    const discountPercent = (sale.discountAmount / sale.subtotal) * 100
    if (discountPercent > 30) {
      anomalies.push({
        type: 'high_discount',
        severity: discountPercent > 50 ? 'high' : 'medium',
        title: `Unusual discount: ${discountPercent.toFixed(0)}% off on ${sale.invoiceNo}`,
        details: {
          invoiceNo: sale.invoiceNo,
          discountPercent: discountPercent.toFixed(1),
          discountAmount: sale.discountAmount,
          subtotal: sale.subtotal,
          createdBy: sale.createdByName,
        },
      })
    }
  }

  // Rule 2: Items sold below cost price
  for (const item of sale.items) {
    if (item.costPrice && item.unitPrice < item.costPrice) {
      anomalies.push({
        type: 'below_cost',
        severity: 'high',
        title: `${item.itemName} sold below cost price`,
        details: {
          itemName: item.itemName,
          sellingPrice: item.unitPrice,
          costPrice: item.costPrice,
          loss: (item.costPrice - item.unitPrice) * item.quantity,
          invoiceNo: sale.invoiceNo,
        },
      })
    }
  }

  // Rule 3: Per-item high discount
  for (const item of sale.items) {
    if (item.discountPercent && item.discountPercent > 40) {
      anomalies.push({
        type: 'item_high_discount',
        severity: 'medium',
        title: `${item.discountPercent}% discount on ${item.itemName}`,
        details: {
          itemName: item.itemName,
          discountPercent: item.discountPercent,
          invoiceNo: sale.invoiceNo,
        },
      })
    }
  }

  // Create alerts for each anomaly
  for (const anomaly of anomalies) {
    await createAlert(tenantId, 'sale', sale.id, anomaly)
  }
}

/**
 * Check a work order for anomalies.
 * Fire-and-forget — call after work order service/part changes.
 */
export function checkWorkOrderAnomalies(
  tenantId: string,
  workOrder: {
    id: string
    workOrderNo: string
    laborTotal: number
    partsTotal: number
    services: Array<{
      serviceName: string
      laborCharge: number
    }>
  }
): void {
  _checkWorkOrderAsync(tenantId, workOrder).catch(err => {
    console.error('[Anomaly] Work order check failed:', err)
  })
}

async function _checkWorkOrderAsync(
  tenantId: string,
  workOrder: {
    id: string
    workOrderNo: string
    laborTotal: number
    partsTotal: number
    services: Array<{
      serviceName: string
      laborCharge: number
    }>
  }
): Promise<void> {
  const anomalies: AnomalyResult[] = []

  // Rule: Labor charge significantly high (over LKR 50,000 for a single service)
  for (const svc of workOrder.services) {
    if (svc.laborCharge > 50000) {
      anomalies.push({
        type: 'high_labor',
        severity: 'medium',
        title: `High labor charge: LKR ${svc.laborCharge.toLocaleString()} for ${svc.serviceName}`,
        details: {
          workOrderNo: workOrder.workOrderNo,
          serviceName: svc.serviceName,
          laborCharge: svc.laborCharge,
        },
      })
    }
  }

  for (const anomaly of anomalies) {
    await createAlert(tenantId, 'work_order', workOrder.id, anomaly)
  }
}

/**
 * Check stock adjustment for anomalies.
 */
export function checkStockAnomalies(
  tenantId: string,
  movement: {
    id: string
    itemId: string
    itemName: string
    type: string
    quantity: number
    previousStock: number
    reason?: string
  }
): void {
  _checkStockAsync(tenantId, movement).catch(err => {
    console.error('[Anomaly] Stock check failed:', err)
  })
}

async function _checkStockAsync(
  tenantId: string,
  movement: {
    id: string
    itemId: string
    itemName: string
    type: string
    quantity: number
    previousStock: number
    reason?: string
  }
): Promise<void> {
  if (movement.type !== 'adjustment') return

  const anomalies: AnomalyResult[] = []

  // Rule: Large stock adjustment (> 50% change)
  if (movement.previousStock > 0) {
    const changePercent = (Math.abs(movement.quantity) / movement.previousStock) * 100
    if (changePercent > 50) {
      anomalies.push({
        type: 'large_stock_adjustment',
        severity: changePercent > 80 ? 'high' : 'medium',
        title: `Large stock adjustment: ${movement.itemName} changed by ${changePercent.toFixed(0)}%`,
        details: {
          itemName: movement.itemName,
          adjustmentQty: movement.quantity,
          previousStock: movement.previousStock,
          changePercent: changePercent.toFixed(1),
          reason: movement.reason,
        },
      })
    }
  }

  for (const anomaly of anomalies) {
    await createAlert(tenantId, 'stock_movement', movement.id, anomaly)
  }
}

/**
 * Check a refund/return for anomalies.
 * Fire-and-forget — call after refund creation.
 */
export function checkRefundAnomalies(
  tenantId: string,
  refund: {
    id: string
    saleId: string
    invoiceNo: string
    refundAmount: number
    refundMethod: string
    originalSaleTotal: number
    originalSaleDate: string
    originalPaymentMethod?: string
    cashierName?: string
  }
): void {
  _checkRefundAsync(tenantId, refund).catch(err => {
    console.error('[Anomaly] Refund check failed:', err)
  })
}

async function _checkRefundAsync(
  tenantId: string,
  refund: {
    id: string
    saleId: string
    invoiceNo: string
    refundAmount: number
    refundMethod: string
    originalSaleTotal: number
    originalSaleDate: string
    originalPaymentMethod?: string
    cashierName?: string
  }
): Promise<void> {
  const anomalies: AnomalyResult[] = []

  // Rule 1: Full refund on old sale (>7 days)
  const daysSinceSale = Math.floor(
    (Date.now() - new Date(refund.originalSaleDate).getTime()) / 86400000
  )
  if (daysSinceSale > 7 && refund.refundAmount >= refund.originalSaleTotal * 0.95) {
    anomalies.push({
      type: 'old_full_refund',
      severity: 'medium',
      title: `Full refund on ${daysSinceSale}-day-old sale ${refund.invoiceNo}`,
      details: {
        invoiceNo: refund.invoiceNo,
        refundAmount: refund.refundAmount,
        originalTotal: refund.originalSaleTotal,
        daysSinceSale,
        cashier: refund.cashierName,
      },
    })
  }

  // Rule 2: Large refund amount
  if (refund.refundAmount > 100000) {
    anomalies.push({
      type: 'large_refund',
      severity: 'high',
      title: `Large refund: LKR ${refund.refundAmount.toLocaleString()} on ${refund.invoiceNo}`,
      details: {
        invoiceNo: refund.invoiceNo,
        refundAmount: refund.refundAmount,
        cashier: refund.cashierName,
      },
    })
  }

  // Rule 3: Cash refund on non-cash sale
  if (refund.refundMethod === 'cash' && refund.originalPaymentMethod && refund.originalPaymentMethod !== 'cash') {
    anomalies.push({
      type: 'refund_method_mismatch',
      severity: 'medium',
      title: `Cash refund on ${refund.originalPaymentMethod} sale ${refund.invoiceNo}`,
      details: {
        invoiceNo: refund.invoiceNo,
        refundMethod: refund.refundMethod,
        originalMethod: refund.originalPaymentMethod,
        refundAmount: refund.refundAmount,
        cashier: refund.cashierName,
      },
    })
  }

  for (const anomaly of anomalies) {
    await createAlert(tenantId, 'sale', refund.saleId, anomaly)
  }
}

/**
 * Check a purchase for anomalies.
 * Fire-and-forget — call after purchase creation/update.
 */
export function checkPurchaseAnomalies(
  tenantId: string,
  purchase: {
    id: string
    purchaseNo: string
    total: number
    items: Array<{
      itemName: string
      unitPrice: number
      quantity: number
      lastPurchasePrice?: number
    }>
  }
): void {
  _checkPurchaseAsync(tenantId, purchase).catch(err => {
    console.error('[Anomaly] Purchase check failed:', err)
  })
}

async function _checkPurchaseAsync(
  tenantId: string,
  purchase: {
    id: string
    purchaseNo: string
    total: number
    items: Array<{
      itemName: string
      unitPrice: number
      quantity: number
      lastPurchasePrice?: number
    }>
  }
): Promise<void> {
  const anomalies: AnomalyResult[] = []

  // Rule 1: Item price significantly higher than last purchase (>30%)
  for (const item of purchase.items) {
    if (item.lastPurchasePrice && item.lastPurchasePrice > 0) {
      const increase = ((item.unitPrice - item.lastPurchasePrice) / item.lastPurchasePrice) * 100
      if (increase > 30) {
        anomalies.push({
          type: 'purchase_price_spike',
          severity: 'medium',
          title: `${item.itemName}: ${increase.toFixed(0)}% above last purchase in ${purchase.purchaseNo}`,
          details: {
            purchaseNo: purchase.purchaseNo,
            itemName: item.itemName,
            unitPrice: item.unitPrice,
            lastPurchasePrice: item.lastPurchasePrice,
            increasePercent: increase.toFixed(1),
          },
        })
      }
    }
  }

  // Rule 2: Very large purchase total
  if (purchase.total > 1000000) {
    anomalies.push({
      type: 'large_purchase',
      severity: 'medium',
      title: `Large purchase: LKR ${purchase.total.toLocaleString()} (${purchase.purchaseNo})`,
      details: {
        purchaseNo: purchase.purchaseNo,
        total: purchase.total,
      },
    })
  }

  for (const anomaly of anomalies) {
    await createAlert(tenantId, 'purchase', purchase.id, anomaly)
  }
}

/**
 * Check an item price change for anomalies.
 * Fire-and-forget — call after item price update.
 */
export function checkPriceChangeAnomalies(
  tenantId: string,
  change: {
    itemId: string
    itemName: string
    oldSellingPrice: number
    newSellingPrice: number
    oldCostPrice: number
    newCostPrice: number
    changedBy?: string
  }
): void {
  _checkPriceChangeAsync(tenantId, change).catch(err => {
    console.error('[Anomaly] Price change check failed:', err)
  })
}

async function _checkPriceChangeAsync(
  tenantId: string,
  change: {
    itemId: string
    itemName: string
    oldSellingPrice: number
    newSellingPrice: number
    oldCostPrice: number
    newCostPrice: number
    changedBy?: string
  }
): Promise<void> {
  const anomalies: AnomalyResult[] = []

  // Rule 1: Selling price dropped >50%
  if (change.oldSellingPrice > 0 && change.newSellingPrice > 0) {
    const dropPct = ((change.oldSellingPrice - change.newSellingPrice) / change.oldSellingPrice) * 100
    if (dropPct > 50) {
      anomalies.push({
        type: 'drastic_price_drop',
        severity: 'high',
        title: `${change.itemName}: selling price dropped ${dropPct.toFixed(0)}%`,
        details: {
          itemName: change.itemName,
          oldPrice: change.oldSellingPrice,
          newPrice: change.newSellingPrice,
          dropPercent: dropPct.toFixed(1),
          changedBy: change.changedBy,
        },
      })
    }
  }

  // Rule 2: Selling price below cost
  if (change.newSellingPrice > 0 && change.newCostPrice > 0 && change.newSellingPrice < change.newCostPrice) {
    anomalies.push({
      type: 'price_below_cost',
      severity: 'high',
      title: `${change.itemName}: selling price set below cost`,
      details: {
        itemName: change.itemName,
        sellingPrice: change.newSellingPrice,
        costPrice: change.newCostPrice,
        loss: change.newCostPrice - change.newSellingPrice,
        changedBy: change.changedBy,
      },
    })
  }

  // Rule 3: Cost price increased >50%
  if (change.oldCostPrice > 0 && change.newCostPrice > change.oldCostPrice) {
    const costIncrease = ((change.newCostPrice - change.oldCostPrice) / change.oldCostPrice) * 100
    if (costIncrease > 50) {
      anomalies.push({
        type: 'cost_spike',
        severity: 'medium',
        title: `${change.itemName}: cost increased ${costIncrease.toFixed(0)}%`,
        details: {
          itemName: change.itemName,
          oldCost: change.oldCostPrice,
          newCost: change.newCostPrice,
          increasePercent: costIncrease.toFixed(1),
          changedBy: change.changedBy,
        },
      })
    }
  }

  for (const anomaly of anomalies) {
    await createAlert(tenantId, 'item', change.itemId, anomaly)
  }
}

/**
 * Check for potential duplicate transaction.
 * Fire-and-forget — call after sale creation.
 */
export function checkDuplicateTransaction(
  tenantId: string,
  sale: {
    id: string
    invoiceNo: string
    customerId?: string | null
    totalAmount: number
    createdAt: Date
  }
): void {
  _checkDuplicateAsync(tenantId, sale).catch(err => {
    console.error('[Anomaly] Duplicate check failed:', err)
  })
}

async function _checkDuplicateAsync(
  tenantId: string,
  sale: {
    id: string
    invoiceNo: string
    customerId?: string | null
    totalAmount: number
    createdAt: Date
  }
): Promise<void> {
  if (!sale.customerId) return // Can't detect duplicates without customer
  const customerId = sale.customerId

  const tenMinutesAgo = new Date(sale.createdAt.getTime() - 10 * 60 * 1000)
  const tolerance = sale.totalAmount * 0.05 // 5% tolerance

  const [match] = await withTenant(tenantId, async (db) =>
    db
      .select({ id: sales.id, invoiceNo: sales.invoiceNo })
      .from(sales)
      .where(
        and(
          eq(sales.tenantId, tenantId),
          eq(sales.customerId, customerId),
          sql`${sales.id} != ${sale.id}`,
          gte(sales.createdAt, tenMinutesAgo),
          sql`ABS(CAST(${sales.total} AS float) - ${sale.totalAmount}) < ${tolerance}`,
          eq(sales.status, 'completed')
        )
      )
      .limit(1)
  )

  if (match) {
    await createAlert(tenantId, 'sale', sale.id, {
      type: 'possible_duplicate',
      severity: 'medium',
      title: `Possible duplicate: ${sale.invoiceNo} matches ${match.invoiceNo}`,
      details: {
        invoiceNo: sale.invoiceNo,
        matchedInvoice: match.invoiceNo,
        totalAmount: sale.totalAmount,
        customerId: sale.customerId,
        timeWindow: '10 minutes',
      },
    })
  }
}

/** Create an alert with optional AI-enhanced explanation */
async function createAlert(
  tenantId: string,
  entityType: string,
  entityId: string,
  anomaly: AnomalyResult
): Promise<void> {
  // Generate AI explanation (non-blocking)
  let aiMessage = ''
  try {
    const prompt = formatAnomalyForPrompt({
      type: anomaly.type,
      entityType,
      details: anomaly.details,
    })
    const aiResult = await generateText(prompt, {
      systemPrompt: SYSTEM_PROMPTS.anomalyExplanation,
      maxTokens: 200,
      temperature: 0.3,
    })
    if (aiResult) {
      aiMessage = '\n\n' + aiResult.text
    }
  } catch {
    // AI explanation is optional
  }

  const [alert] = await withTenant(tenantId, async (db) =>
    db.insert(aiAlerts).values({
      tenantId,
      type: 'anomaly',
      severity: anomaly.severity,
      title: anomaly.title,
      message: JSON.stringify(anomaly.details) + aiMessage,
      entityType,
      entityId,
      metadata: anomaly.details,
    }).returning()
  )

  if (alert) {
    broadcastChange(tenantId, 'ai-alert', 'created', alert.id)
  }
}
