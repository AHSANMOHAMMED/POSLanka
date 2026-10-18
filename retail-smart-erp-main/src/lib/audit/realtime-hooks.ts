// Fire-and-forget per-entity audit hooks for API routes
// Call these after mutations to detect issues in real-time

import { withTenant } from '@/lib/db'
import { aiAlerts } from '@/lib/db/schema'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { sql } from 'drizzle-orm'

interface RealtimeFinding {
  tenantId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  message: string
  entityType: string
  entityId: string
  auditCategory: string
}

async function storeFinding(finding: RealtimeFinding): Promise<void> {
  try {
    const [alert] = await withTenant(finding.tenantId, async (db) =>
      db.insert(aiAlerts).values({
        tenantId: finding.tenantId,
        type: 'anomaly',
        severity: finding.severity,
        title: finding.title,
        message: finding.message,
        entityType: finding.entityType,
        entityId: finding.entityId,
        metadata: {
          auditCategory: finding.auditCategory,
          realtimeCheck: true,
        },
      }).returning()
    )

    if (alert) {
      broadcastChange(finding.tenantId, 'ai-alert', 'created', alert.id)
    }
  } catch (err) {
    console.error('[Audit] Failed to store realtime finding:', err)
  }
}

/**
 * Fire-and-forget: check a sale's integrity after creation/update.
 */
export function auditSaleIntegrity(saleId: string, tenantId: string): void {
  _auditSale(saleId, tenantId).catch(err =>
    console.error('[Audit] Sale integrity check failed:', err)
  )
}

async function _auditSale(saleId: string, tenantId: string): Promise<void> {
  // Check payment match
  const result = await withTenant(tenantId, async (db) =>
    db.execute<{
      invoice_no: string; paid_amount: string; pay_sum: string
    }>(sql`
      SELECT s.invoice_no, s.paid_amount,
        COALESCE(
          (SELECT ROUND(SUM(amount::numeric), 2) FROM payments WHERE sale_id = s.id AND voided_at IS NULL),
          0
        ) AS pay_sum
      FROM sales s
      WHERE s.id = ${saleId}::uuid AND s.tenant_id = ${tenantId}::uuid
    `)
  )

  if (result.rows.length === 0) return
  const row = result.rows[0]
  const diff = Math.abs(parseFloat(row.paid_amount) - parseFloat(String(row.pay_sum)))

  if (diff > 0.01) {
    await storeFinding({
      tenantId,
      severity: 'high',
      title: `Payment mismatch on ${row.invoice_no}`,
      message: `Paid amount: ${row.paid_amount}, sum of payments: ${row.pay_sum}`,
      entityType: 'sale',
      entityId: saleId,
      auditCategory: 'sales',
    })
  }
}

/**
 * Fire-and-forget: check a purchase's integrity after creation/update.
 */
export function auditPurchaseIntegrity(purchaseId: string, tenantId: string): void {
  _auditPurchase(purchaseId, tenantId).catch(err =>
    console.error('[Audit] Purchase integrity check failed:', err)
  )
}

async function _auditPurchase(purchaseId: string, tenantId: string): Promise<void> {
  // Check total vs item sum
  const result = await withTenant(tenantId, async (db) =>
    db.execute<{
      purchase_no: string; total: string; item_sum: string
    }>(sql`
      SELECT p.purchase_no, p.total,
        COALESCE(
          (SELECT ROUND(SUM(total::numeric), 2) FROM purchase_items WHERE purchase_id = p.id),
          0
        ) AS item_sum
      FROM purchases p
      WHERE p.id = ${purchaseId}::uuid AND p.tenant_id = ${tenantId}::uuid
    `)
  )

  if (result.rows.length === 0) return
  const row = result.rows[0]
  const diff = Math.abs(parseFloat(row.total) - parseFloat(String(row.item_sum)))

  if (diff > 0.01) {
    await storeFinding({
      tenantId,
      severity: 'high',
      title: `Total mismatch on ${row.purchase_no}`,
      message: `Purchase total: ${row.total}, sum of items: ${row.item_sum}`,
      entityType: 'purchase',
      entityId: purchaseId,
      auditCategory: 'purchases',
    })
  }
}

/**
 * Fire-and-forget: check WO→Sale linkage after invoicing.
 */
export function auditWorkOrderInvoiceIntegrity(workOrderId: string, tenantId: string): void {
  _auditWorkOrderInvoice(workOrderId, tenantId).catch(err =>
    console.error('[Audit] WO invoice integrity check failed:', err)
  )
}

async function _auditWorkOrderInvoice(workOrderId: string, tenantId: string): Promise<void> {
  const result = await withTenant(tenantId, async (db) =>
    db.execute<{
      order_no: string; wo_total: string; sale_total: string | null
    }>(sql`
      SELECT wo.order_no, wo.total AS wo_total,
        s.total AS sale_total
      FROM work_orders wo
      LEFT JOIN sales s ON s.id = wo.sale_id AND s.status != 'void'
      WHERE wo.id = ${workOrderId}::uuid AND wo.tenant_id = ${tenantId}::uuid
        AND wo.status = 'invoiced'
    `)
  )

  if (result.rows.length === 0) return
  const row = result.rows[0]

  if (!row.sale_total) {
    await storeFinding({
      tenantId,
      severity: 'critical',
      title: `Invoiced WO without sale: ${row.order_no}`,
      message: `Work order is invoiced but no valid linked sale exists`,
      entityType: 'work_order',
      entityId: workOrderId,
      auditCategory: 'work-orders',
    })
    return
  }

  const diff = Math.abs(parseFloat(row.wo_total) - parseFloat(row.sale_total))
  if (diff > 0.01) {
    await storeFinding({
      tenantId,
      severity: 'high',
      title: `WO/Sale total mismatch: ${row.order_no}`,
      message: `WO total: ${row.wo_total}, sale total: ${row.sale_total}`,
      entityType: 'work_order',
      entityId: workOrderId,
      auditCategory: 'work-orders',
    })
  }
}
