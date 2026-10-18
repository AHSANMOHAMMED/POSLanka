import { withTenant } from '@/lib/db'
import { aiAlerts } from '@/lib/db/schema'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'

interface SaleAuditData {
  id: string
  invoiceNo: string
  tenantId: string
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    discount: number
    total: number
  }>
}

interface AuditResult {
  verified: boolean
  discrepancies: Array<{
    field: string
    expected: number
    actual: number
    difference: number
  }>
}

/**
 * Audit a sale's calculations.
 * Fire-and-forget — call after sale creation.
 */
export function auditSaleCalculation(sale: SaleAuditData): void {
  _auditSaleAsync(sale).catch(err => {
    console.error('[Audit] Sale audit failed:', err)
  })
}

async function _auditSaleAsync(sale: SaleAuditData): Promise<void> {
  const result = verifySaleCalculation(sale)

  if (!result.verified) {
    // Create alert for calculation discrepancy
    const discrepancyDetails = result.discrepancies.map(d =>
      `${d.field}: expected ${d.expected.toFixed(2)}, got ${d.actual.toFixed(2)} (diff: ${d.difference.toFixed(2)})`
    ).join('; ')

    const [alert] = await withTenant(sale.tenantId, async (db) =>
      db.insert(aiAlerts).values({
        tenantId: sale.tenantId,
        type: 'anomaly',
        severity: 'high',
        title: `Calculation mismatch in ${sale.invoiceNo}`,
        message: `Discrepancies found: ${discrepancyDetails}`,
        entityType: 'sale',
        entityId: sale.id,
        metadata: { discrepancies: result.discrepancies },
      }).returning()
    )

    if (alert) {
      broadcastChange(sale.tenantId, 'ai-alert', 'created', alert.id)
    }
  }
}

/** Verify sale math independently */
function verifySaleCalculation(sale: SaleAuditData): AuditResult {
  const discrepancies: AuditResult['discrepancies'] = []

  // Recalculate item totals
  let calculatedSubtotal = 0
  for (const item of sale.items) {
    const expectedItemTotal = roundCurrency((item.unitPrice * item.quantity) - item.discount)
    calculatedSubtotal += expectedItemTotal

    const diff = Math.abs(expectedItemTotal - item.total)
    if (diff > 0.01) {
      discrepancies.push({
        field: `Item "${item.itemName}" total`,
        expected: expectedItemTotal,
        actual: item.total,
        difference: diff,
      })
    }
  }

  // Check subtotal
  const subtotalDiff = Math.abs(calculatedSubtotal - sale.subtotal)
  if (subtotalDiff > 0.01) {
    discrepancies.push({
      field: 'Subtotal',
      expected: calculatedSubtotal,
      actual: sale.subtotal,
      difference: subtotalDiff,
    })
  }

  // Check grand total: subtotal - discount + tax
  const expectedTotal = roundCurrency(sale.subtotal - sale.discountAmount + sale.taxAmount)
  const totalDiff = Math.abs(expectedTotal - sale.totalAmount)
  if (totalDiff > 0.01) {
    discrepancies.push({
      field: 'Grand total',
      expected: expectedTotal,
      actual: sale.totalAmount,
      difference: totalDiff,
    })
  }

  return {
    verified: discrepancies.length === 0,
    discrepancies,
  }
}

interface WorkOrderAuditData {
  id: string
  workOrderNo: string
  tenantId: string
  laborTotal: number
  partsTotal: number
  grandTotal: number
  services: Array<{
    serviceName: string
    quantity: number
    rate: number
    total: number
  }>
  parts: Array<{
    partName: string
    quantity: number
    unitPrice: number
    total: number
  }>
}

/**
 * Audit a work order's calculations.
 * Fire-and-forget — call after work order changes.
 */
export function auditWorkOrderCalculation(workOrder: WorkOrderAuditData): void {
  _auditWorkOrderAsync(workOrder).catch(err => {
    console.error('[Audit] Work order audit failed:', err)
  })
}

async function _auditWorkOrderAsync(workOrder: WorkOrderAuditData): Promise<void> {
  const result = verifyWorkOrderCalculation(workOrder)

  if (!result.verified) {
    const discrepancyDetails = result.discrepancies.map(d =>
      `${d.field}: expected ${d.expected.toFixed(2)}, got ${d.actual.toFixed(2)} (diff: ${d.difference.toFixed(2)})`
    ).join('; ')

    const [alert] = await withTenant(workOrder.tenantId, async (db) =>
      db.insert(aiAlerts).values({
        tenantId: workOrder.tenantId,
        type: 'anomaly',
        severity: 'high',
        title: `Calculation mismatch in ${workOrder.workOrderNo}`,
        message: `Discrepancies found: ${discrepancyDetails}`,
        entityType: 'work_order',
        entityId: workOrder.id,
        metadata: { discrepancies: result.discrepancies },
      }).returning()
    )

    if (alert) {
      broadcastChange(workOrder.tenantId, 'ai-alert', 'created', alert.id)
    }
  }
}

/** Verify work order math independently */
function verifyWorkOrderCalculation(wo: WorkOrderAuditData): AuditResult {
  const discrepancies: AuditResult['discrepancies'] = []

  // Calculate labor totals
  let calculatedLabor = 0
  for (const svc of wo.services) {
    const expectedTotal = roundCurrency(svc.quantity * svc.rate)
    calculatedLabor += expectedTotal

    const diff = Math.abs(expectedTotal - svc.total)
    if (diff > 0.01) {
      discrepancies.push({
        field: `Service "${svc.serviceName}" total`,
        expected: expectedTotal,
        actual: svc.total,
        difference: diff,
      })
    }
  }

  // Check labor total
  const laborDiff = Math.abs(calculatedLabor - wo.laborTotal)
  if (laborDiff > 0.01) {
    discrepancies.push({
      field: 'Labor total',
      expected: calculatedLabor,
      actual: wo.laborTotal,
      difference: laborDiff,
    })
  }

  // Calculate parts totals
  let calculatedParts = 0
  for (const part of wo.parts) {
    const expectedTotal = roundCurrency(part.quantity * part.unitPrice)
    calculatedParts += expectedTotal

    const diff = Math.abs(expectedTotal - part.total)
    if (diff > 0.01) {
      discrepancies.push({
        field: `Part "${part.partName}" total`,
        expected: expectedTotal,
        actual: part.total,
        difference: diff,
      })
    }
  }

  // Check parts total
  const partsDiff = Math.abs(calculatedParts - wo.partsTotal)
  if (partsDiff > 0.01) {
    discrepancies.push({
      field: 'Parts total',
      expected: calculatedParts,
      actual: wo.partsTotal,
      difference: partsDiff,
    })
  }

  // Check grand total
  const expectedGrand = roundCurrency(calculatedLabor + calculatedParts)
  const grandDiff = Math.abs(expectedGrand - wo.grandTotal)
  if (grandDiff > 0.01) {
    discrepancies.push({
      field: 'Grand total',
      expected: expectedGrand,
      actual: wo.grandTotal,
      difference: grandDiff,
    })
  }

  return {
    verified: discrepancies.length === 0,
    discrepancies,
  }
}
