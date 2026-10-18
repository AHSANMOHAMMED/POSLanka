/**
 * Utility functions for POS shift calculations and payment method tracking
 * Follows project patterns: real-time updates, tenant isolation, and TypeScript safety
 */

import type { PaymentMethod } from '@/lib/db/schema'

export interface PaymentMethodTotal {
  paymentMethod: PaymentMethod
  totalSales: number
  totalReturns: number
  netSales: number
  transactionCount: number
}

export interface ShiftPaymentBreakdown {
  openingBalances: Record<PaymentMethod, number>
  salesByMethod: Record<PaymentMethod, PaymentMethodTotal>
  expectedAmounts: Record<PaymentMethod, number>
  varianceByMethod: Record<PaymentMethod, number>
  totalVariance: number
}

export interface SalesAggregationParams {
  shiftId: string
  tenantId: string
}

/**
 * Calculate payment method totals for a POS shift
 * This would typically query the database to aggregate sales by payment method
 * For now, this is a TypeScript interface - implementation will be in API routes
 */
export async function calculatePaymentMethodTotals(
  _params: SalesAggregationParams
): Promise<ShiftPaymentBreakdown> {
  // This function would query the database and aggregate sales by payment method
  // Implementation will be added in API routes with proper database queries
  // For now, returning a TypeScript-compatible placeholder
  
  return {
    openingBalances: {} as Record<PaymentMethod, number>,
    salesByMethod: {} as Record<PaymentMethod, PaymentMethodTotal>,
    expectedAmounts: {} as Record<PaymentMethod, number>,
    varianceByMethod: {} as Record<PaymentMethod, number>,
    totalVariance: 0,
  }
}

/**
 * Calculate expected amount for a payment method
 * Expected = Opening Balance + (Sales - Returns) for that payment method
 */
export function calculateExpectedAmount(
  openingBalance: number,
  salesTotal: number,
  returnsTotal: number
): number {
  return openingBalance + (salesTotal - returnsTotal)
}

/**
 * Calculate variance between expected and actual amounts
 * Variance = Actual - Expected
 */
export function calculateVariance(
  expectedAmount: number,
  actualAmount: number
): number {
  return actualAmount - expectedAmount
}

/**
 * Format currency for display within POS calculations module.
 * For general use, prefer `formatCurrency` from `@/lib/utils/currency`.
 */
function formatPOSCurrency(amount: number, currency: string = 'LKR'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Get variance severity level for UI display
 */
export function getVarianceSeverity(variance: number, tolerance: number = 0.01): 'none' | 'low' | 'medium' | 'high' {
  const absVariance = Math.abs(variance)
  
  if (absVariance <= tolerance) {
    return 'none'
  } else if (absVariance <= 10) {
    return 'low'
  } else if (absVariance <= 50) {
    return 'medium'
  } else {
    return 'high'
  }
}

/**
 * Generate variance description for UI tooltips
 */
export function getVarianceDescription(variance: number): string {
  if (Math.abs(variance) < 0.01) {
    return 'Perfect match'
  } else if (variance > 0) {
    return `Overage of ${formatPOSCurrency(variance)}`
  } else {
    return `Shortage of ${formatPOSCurrency(Math.abs(variance))}`
  }
}

/**
 * Validate payment method breakdown totals match shift totals
 * Ensures data integrity between aggregated payment method data and overall shift totals
 */
export function validatePaymentBreakdown(
  breakdown: ShiftPaymentBreakdown,
  shiftTotals: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
  }
): { isValid: boolean; discrepancies: string[] } {
  const discrepancies: string[] = []
  
  // Sum up all payment method totals
  const aggregatedSales = Object.values(breakdown.salesByMethod).reduce(
    (sum, method) => sum + method.totalSales,
    0
  )
  
  const aggregatedReturns = Object.values(breakdown.salesByMethod).reduce(
    (sum, method) => sum + method.totalReturns,
    0
  )
  
  const aggregatedNetSales = Object.values(breakdown.salesByMethod).reduce(
    (sum, method) => sum + method.netSales,
    0
  )
  
  const aggregatedTransactions = Object.values(breakdown.salesByMethod).reduce(
    (sum, method) => sum + method.transactionCount,
    0
  )
  
  // Compare with shift totals (allow small floating point differences)
  const tolerance = 0.01
  
  if (Math.abs(aggregatedSales - shiftTotals.totalSales) > tolerance) {
    discrepancies.push(`Sales total mismatch: ${aggregatedSales} vs ${shiftTotals.totalSales}`)
  }
  
  if (Math.abs(aggregatedReturns - shiftTotals.totalReturns) > tolerance) {
    discrepancies.push(`Returns total mismatch: ${aggregatedReturns} vs ${shiftTotals.totalReturns}`)
  }
  
  if (Math.abs(aggregatedNetSales - shiftTotals.netSales) > tolerance) {
    discrepancies.push(`Net sales mismatch: ${aggregatedNetSales} vs ${shiftTotals.netSales}`)
  }
  
  if (aggregatedTransactions !== shiftTotals.totalTransactions) {
    discrepancies.push(`Transaction count mismatch: ${aggregatedTransactions} vs ${shiftTotals.totalTransactions}`)
  }
  
  return {
    isValid: discrepancies.length === 0,
    discrepancies,
  }
}

/**
 * Type guard to check if a string is a valid PaymentMethod
 */
export function isValidPaymentMethod(method: string): method is PaymentMethod {
  const validMethods: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'credit', 'gift_card']
  return validMethods.includes(method as PaymentMethod)
}

/**
 * Get display label for a payment method
 * Follows the same pattern used in ShiftOpenModal.tsx
 */
export function getPaymentMethodLabel(method: PaymentMethod): string {
  const labels: Record<PaymentMethod, string> = {
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank Transfer',
    credit: 'Store Credit',
    gift_card: 'Gift Card',
  }
  return labels[method] || method
}