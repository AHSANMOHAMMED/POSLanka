/**
 * AI Smart Warnings — Pre-action rule-based warning engine.
 * Pure functions, no DB queries, no AI API calls.
 * Returns warnings instantly for UI display before user submits.
 */

export interface SmartWarning {
  id: string
  type: string
  severity: 'info' | 'warning' | 'danger'
  title: string
  message: string
  field?: string
  dismissible: boolean
}

let warningCounter = 0
function nextId(): string {
  return `sw-${++warningCounter}-${Date.now()}`
}

// ─── Sale Warnings ──────────────────────────────────────────────

export function validateSaleWarnings(data: {
  items: Array<{
    itemId?: string
    name: string
    quantity: number
    unitPrice: number
    costPrice?: number
    originalPrice?: number
    discount?: number
  }>
  subtotal: number
  discountAmount: number
  total: number
  customerId?: string
}): SmartWarning[] {
  const warnings: SmartWarning[] = []

  // 1. High overall discount
  if (data.subtotal > 0 && data.discountAmount > 0) {
    const discountPct = (data.discountAmount / data.subtotal) * 100
    if (discountPct > 50) {
      warnings.push({
        id: nextId(),
        type: 'high_discount',
        severity: 'danger',
        title: `Extremely high discount: ${discountPct.toFixed(0)}%`,
        message: `A ${discountPct.toFixed(1)}% discount (${formatAmount(data.discountAmount)}) is being applied to this sale. This is unusually high and may indicate a data entry error.`,
        field: 'discount',
        dismissible: true,
      })
    } else if (discountPct > 25) {
      warnings.push({
        id: nextId(),
        type: 'high_discount',
        severity: 'warning',
        title: `High discount: ${discountPct.toFixed(0)}%`,
        message: `A ${discountPct.toFixed(1)}% discount (${formatAmount(data.discountAmount)}) is being applied. Please verify this is correct.`,
        field: 'discount',
        dismissible: true,
      })
    }
  }

  // 2. Items below cost price
  for (const item of data.items) {
    if (item.costPrice && item.costPrice > 0 && item.unitPrice < item.costPrice) {
      const loss = (item.costPrice - item.unitPrice) * item.quantity
      warnings.push({
        id: nextId(),
        type: 'below_cost',
        severity: 'danger',
        title: `${item.name} sold below cost`,
        message: `Selling at ${formatAmount(item.unitPrice)} but cost is ${formatAmount(item.costPrice)}. This results in a loss of ${formatAmount(loss)} on ${item.quantity} unit(s).`,
        field: 'unitPrice',
        dismissible: true,
      })
    }
  }

  // 3. Per-item high discount (>40% off original price)
  for (const item of data.items) {
    if (item.originalPrice && item.originalPrice > 0 && item.unitPrice < item.originalPrice) {
      const itemDiscPct = ((item.originalPrice - item.unitPrice) / item.originalPrice) * 100
      if (itemDiscPct > 40) {
        warnings.push({
          id: nextId(),
          type: 'item_high_discount',
          severity: 'warning',
          title: `${item.name}: ${itemDiscPct.toFixed(0)}% below catalog price`,
          message: `Catalog price is ${formatAmount(item.originalPrice)} but selling at ${formatAmount(item.unitPrice)}.`,
          field: 'unitPrice',
          dismissible: true,
        })
      }
    }
  }

  // 4. Unusual quantity
  for (const item of data.items) {
    if (item.quantity > 100) {
      warnings.push({
        id: nextId(),
        type: 'unusual_quantity',
        severity: 'info',
        title: `Large quantity: ${item.quantity}x ${item.name}`,
        message: `${item.quantity} units is unusually high. Please verify this is correct.`,
        field: 'quantity',
        dismissible: true,
      })
    }
  }

  // 5. Zero-price item
  for (const item of data.items) {
    if (item.unitPrice === 0) {
      warnings.push({
        id: nextId(),
        type: 'zero_price',
        severity: 'warning',
        title: `${item.name} has zero price`,
        message: `This item is being sold for free. If this is intentional, proceed.`,
        field: 'unitPrice',
        dismissible: true,
      })
    }
  }

  // 6. Large sale without customer
  if (data.total > 50000 && !data.customerId) {
    warnings.push({
      id: nextId(),
      type: 'no_customer_large_sale',
      severity: 'info',
      title: 'Large sale without customer',
      message: `This sale totals ${formatAmount(data.total)}. Consider adding a customer for record-keeping and loyalty tracking.`,
      dismissible: true,
    })
  }

  return warnings
}

// ─── Return/Refund Warnings ─────────────────────────────────────

export function validateReturnWarnings(data: {
  returnItems: Array<{
    itemName: string
    quantity: number
    unitPrice: number
  }>
  refundAmount: number
  originalSaleTotal: number
  originalSaleDate: string
  refundMethod: string
  originalPaymentMethod?: string
  existingReturnTotal: number
}): SmartWarning[] {
  const warnings: SmartWarning[] = []
  const remainingBalance = data.originalSaleTotal - data.existingReturnTotal

  // 1. Full refund
  if (data.refundAmount >= remainingBalance - 0.01) {
    warnings.push({
      id: nextId(),
      type: 'full_refund',
      severity: 'warning',
      title: 'Full refund',
      message: `This will fully refund the original sale of ${formatAmount(data.originalSaleTotal)}. Please verify all return items are correct.`,
      dismissible: true,
    })
  }

  // 2. Old sale return (>30 days)
  const saleDate = new Date(data.originalSaleDate)
  const daysSinceSale = Math.floor((Date.now() - saleDate.getTime()) / 86400000)
  if (daysSinceSale > 30) {
    warnings.push({
      id: nextId(),
      type: 'old_sale_return',
      severity: 'warning',
      title: `Return on ${daysSinceSale}-day-old sale`,
      message: `The original sale was ${daysSinceSale} days ago. Returns on old sales should be reviewed by a manager.`,
      dismissible: true,
    })
  }

  // 3. Cash refund on card/transfer sale
  if (data.refundMethod === 'cash' && data.originalPaymentMethod && data.originalPaymentMethod !== 'cash') {
    warnings.push({
      id: nextId(),
      type: 'refund_method_mismatch',
      severity: 'info',
      title: 'Cash refund on non-cash sale',
      message: `Original sale was paid by ${data.originalPaymentMethod} but refund is in cash. Consider refunding to the original payment method.`,
      dismissible: true,
    })
  }

  // 4. Large refund
  if (data.refundAmount > 100000) {
    warnings.push({
      id: nextId(),
      type: 'large_refund',
      severity: 'warning',
      title: `Large refund: ${formatAmount(data.refundAmount)}`,
      message: `This is a significant refund. Please ensure the return is authorized.`,
      dismissible: true,
    })
  }

  return warnings
}

// ─── Purchase Warnings ──────────────────────────────────────────

export function validatePurchaseWarnings(data: {
  items: Array<{
    itemId?: string
    itemName: string
    quantity: number
    unitPrice: number
    lastPurchasePrice?: number
    averagePurchasePrice?: number
  }>
  total: number
}): SmartWarning[] {
  const warnings: SmartWarning[] = []

  for (const item of data.items) {
    // 1. Price significantly higher than last purchase (>30%)
    if (item.lastPurchasePrice && item.lastPurchasePrice > 0) {
      const increase = ((item.unitPrice - item.lastPurchasePrice) / item.lastPurchasePrice) * 100
      if (increase > 50) {
        warnings.push({
          id: nextId(),
          type: 'purchase_price_spike',
          severity: 'danger',
          title: `${item.itemName}: ${increase.toFixed(0)}% above last purchase`,
          message: `Buying at ${formatAmount(item.unitPrice)} but last purchased at ${formatAmount(item.lastPurchasePrice)}. This is a significant price increase.`,
          field: 'unitPrice',
          dismissible: true,
        })
      } else if (increase > 30) {
        warnings.push({
          id: nextId(),
          type: 'purchase_price_increase',
          severity: 'warning',
          title: `${item.itemName}: ${increase.toFixed(0)}% above last purchase`,
          message: `Buying at ${formatAmount(item.unitPrice)} but last purchased at ${formatAmount(item.lastPurchasePrice)}. Please verify with supplier.`,
          field: 'unitPrice',
          dismissible: true,
        })
      }
    }

    // 2. Price above average (>50%)
    if (item.averagePurchasePrice && item.averagePurchasePrice > 0 && !item.lastPurchasePrice) {
      const aboveAvg = ((item.unitPrice - item.averagePurchasePrice) / item.averagePurchasePrice) * 100
      if (aboveAvg > 50) {
        warnings.push({
          id: nextId(),
          type: 'purchase_above_average',
          severity: 'danger',
          title: `${item.itemName}: ${aboveAvg.toFixed(0)}% above average price`,
          message: `Buying at ${formatAmount(item.unitPrice)} but average purchase price is ${formatAmount(item.averagePurchasePrice)}.`,
          field: 'unitPrice',
          dismissible: true,
        })
      }
    }

    // 3. Zero-price purchase item
    if (item.unitPrice === 0) {
      warnings.push({
        id: nextId(),
        type: 'zero_purchase_price',
        severity: 'warning',
        title: `${item.itemName} has zero cost`,
        message: `This item is being purchased at zero cost. If this is a free sample, proceed.`,
        field: 'unitPrice',
        dismissible: true,
      })
    }
  }

  // 4. Large purchase total
  if (data.total > 500000) {
    warnings.push({
      id: nextId(),
      type: 'large_purchase',
      severity: 'info',
      title: `Large purchase: ${formatAmount(data.total)}`,
      message: `This is a significant purchase. Please ensure proper authorization.`,
      dismissible: true,
    })
  }

  return warnings
}

// ─── Stock Adjustment Warnings ──────────────────────────────────

export function validateStockWarnings(data: {
  itemName: string
  adjustmentQuantity: number
  currentStock: number
  reason?: string
}): SmartWarning[] {
  const warnings: SmartWarning[] = []

  // 1. Large adjustment
  if (data.currentStock > 0) {
    const changePercent = (Math.abs(data.adjustmentQuantity) / data.currentStock) * 100
    if (changePercent > 80) {
      warnings.push({
        id: nextId(),
        type: 'large_stock_adjustment',
        severity: 'danger',
        title: `Massive stock change: ${changePercent.toFixed(0)}%`,
        message: `Adjusting ${data.itemName} by ${data.adjustmentQuantity} units (current: ${data.currentStock}). This changes stock by ${changePercent.toFixed(0)}%.`,
        field: 'quantity',
        dismissible: true,
      })
    } else if (changePercent > 50) {
      warnings.push({
        id: nextId(),
        type: 'large_stock_adjustment',
        severity: 'warning',
        title: `Large stock change: ${changePercent.toFixed(0)}%`,
        message: `Adjusting ${data.itemName} by ${data.adjustmentQuantity} units (current: ${data.currentStock}). Please verify this is correct.`,
        field: 'quantity',
        dismissible: true,
      })
    }
  }

  // 2. Negative result
  const resultingStock = data.currentStock + data.adjustmentQuantity
  if (resultingStock < 0) {
    warnings.push({
      id: nextId(),
      type: 'negative_stock',
      severity: 'danger',
      title: `Stock will go negative`,
      message: `${data.itemName} will have ${resultingStock} units after this adjustment (current: ${data.currentStock}, change: ${data.adjustmentQuantity}).`,
      field: 'quantity',
      dismissible: true,
    })
  }

  // 3. No reason provided
  if (!data.reason || data.reason.trim() === '') {
    warnings.push({
      id: nextId(),
      type: 'no_adjustment_reason',
      severity: 'info',
      title: 'No adjustment reason',
      message: `Consider adding a reason for this stock adjustment for audit purposes.`,
      field: 'reason',
      dismissible: true,
    })
  }

  // 4. Zeroing out stock
  if (data.currentStock > 0 && resultingStock === 0) {
    warnings.push({
      id: nextId(),
      type: 'zeroing_stock',
      severity: 'warning',
      title: `Stock will be zeroed out`,
      message: `${data.itemName} stock will become 0 after this adjustment. If this is from a physical count, proceed.`,
      field: 'quantity',
      dismissible: true,
    })
  }

  return warnings
}

// ─── Price Change Warnings ──────────────────────────────────────

export function validatePriceChangeWarnings(data: {
  itemName: string
  oldSellingPrice: number
  newSellingPrice: number
  oldCostPrice: number
  newCostPrice: number
}): SmartWarning[] {
  const warnings: SmartWarning[] = []

  // 1. Zero selling price
  if (data.newSellingPrice === 0 && data.oldSellingPrice > 0) {
    warnings.push({
      id: nextId(),
      type: 'zero_selling_price',
      severity: 'danger',
      title: `${data.itemName}: selling price set to zero`,
      message: `The selling price is being set to zero. This item will be given away for free.`,
      field: 'sellingPrice',
      dismissible: true,
    })
  }

  // 2. Selling price below cost
  if (data.newSellingPrice > 0 && data.newCostPrice > 0 && data.newSellingPrice < data.newCostPrice) {
    const loss = data.newCostPrice - data.newSellingPrice
    warnings.push({
      id: nextId(),
      type: 'selling_below_cost',
      severity: 'danger',
      title: `${data.itemName}: selling below cost`,
      message: `Selling price (${formatAmount(data.newSellingPrice)}) is below cost (${formatAmount(data.newCostPrice)}). Each sale will lose ${formatAmount(loss)}.`,
      field: 'sellingPrice',
      dismissible: true,
    })
  }

  // 3. Selling price drop >30%
  if (data.oldSellingPrice > 0 && data.newSellingPrice > 0) {
    const dropPct = ((data.oldSellingPrice - data.newSellingPrice) / data.oldSellingPrice) * 100
    if (dropPct > 30) {
      warnings.push({
        id: nextId(),
        type: 'price_drop',
        severity: 'warning',
        title: `${data.itemName}: ${dropPct.toFixed(0)}% price decrease`,
        message: `Selling price dropping from ${formatAmount(data.oldSellingPrice)} to ${formatAmount(data.newSellingPrice)}. Verify this is intentional.`,
        field: 'sellingPrice',
        dismissible: true,
      })
    }
  }

  // 4. Selling price increase >50%
  if (data.oldSellingPrice > 0 && data.newSellingPrice > data.oldSellingPrice) {
    const increasePct = ((data.newSellingPrice - data.oldSellingPrice) / data.oldSellingPrice) * 100
    if (increasePct > 50) {
      warnings.push({
        id: nextId(),
        type: 'price_spike',
        severity: 'warning',
        title: `${data.itemName}: ${increasePct.toFixed(0)}% price increase`,
        message: `Selling price increasing from ${formatAmount(data.oldSellingPrice)} to ${formatAmount(data.newSellingPrice)}. This is a significant increase.`,
        field: 'sellingPrice',
        dismissible: true,
      })
    }
  }

  // 5. Cost price increase >50%
  if (data.oldCostPrice > 0 && data.newCostPrice > data.oldCostPrice) {
    const costIncrease = ((data.newCostPrice - data.oldCostPrice) / data.oldCostPrice) * 100
    if (costIncrease > 50) {
      warnings.push({
        id: nextId(),
        type: 'cost_spike',
        severity: 'warning',
        title: `${data.itemName}: cost increased ${costIncrease.toFixed(0)}%`,
        message: `Cost price increasing from ${formatAmount(data.oldCostPrice)} to ${formatAmount(data.newCostPrice)}. Consider adjusting selling price.`,
        field: 'costPrice',
        dismissible: true,
      })
    }
  }

  return warnings
}

// ─── Payment Warnings ───────────────────────────────────────────

export function validatePaymentWarnings(data: {
  amount: number
  remainingBalance: number
  total: number
  method: string
}): SmartWarning[] {
  const warnings: SmartWarning[] = []

  // 1. Overpayment
  if (data.remainingBalance > 0 && data.amount > data.remainingBalance * 1.2) {
    const overpayment = data.amount - data.remainingBalance
    warnings.push({
      id: nextId(),
      type: 'overpayment',
      severity: 'info',
      title: `Overpayment: ${formatAmount(overpayment)} extra`,
      message: `Payment of ${formatAmount(data.amount)} exceeds the remaining balance of ${formatAmount(data.remainingBalance)} by ${formatAmount(overpayment)}.`,
      field: 'amount',
      dismissible: true,
    })
  }

  // 2. Very large payment
  if (data.amount > 500000) {
    warnings.push({
      id: nextId(),
      type: 'large_payment',
      severity: 'info',
      title: `Large payment: ${formatAmount(data.amount)}`,
      message: `This is a significant payment amount. Please verify before processing.`,
      field: 'amount',
      dismissible: true,
    })
  }

  return warnings
}

// ─── Helpers ────────────────────────────────────────────────────

function formatAmount(amount: number): string {
  return `LKR ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
