// Work order workflow & invoice linkage audit — 3 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const workOrderAuditModule: AuditModule = {
  category: 'work-orders',
  label: 'Work Orders',
  run: runWorkOrderAudit,
}

async function runWorkOrderAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Arithmetic: services total + parts total should equal WO total
    const totalMismatches = await db.execute<{
      id: string; order_no: string; services_total: string; parts_total: string; recorded_total: string
    }>(sql`
      SELECT wo.id, wo.order_no,
        COALESCE(svc.total, 0) AS services_total,
        COALESCE(pts.total, 0) AS parts_total,
        wo.subtotal AS recorded_total
      FROM work_orders wo
      LEFT JOIN (
        SELECT work_order_id, ROUND(SUM(amount::numeric), 2) AS total
        FROM work_order_services
        GROUP BY work_order_id
      ) svc ON svc.work_order_id = wo.id
      LEFT JOIN (
        SELECT work_order_id, ROUND(SUM(total::numeric), 2) AS total
        FROM work_order_parts
        GROUP BY work_order_id
      ) pts ON pts.work_order_id = wo.id
      WHERE wo.status != 'cancelled'
        AND ABS((COALESCE(svc.total, 0) + COALESCE(pts.total, 0)) - wo.subtotal::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of totalMismatches.rows) {
      findings.push({
        category: 'work-orders',
        severity: 'high',
        title: `Total mismatch on ${r.order_no}`,
        message: `Services: ${r.services_total} + Parts: ${r.parts_total} ≠ Subtotal: ${r.recorded_total}`,
        entityType: 'work_order',
        entityId: r.id,
      })
    }

    // 2. Invoiced WO has sale: status='invoiced' should have saleId and linked sale exists
    const invoicedNoSale = await db.execute<{
      id: string; order_no: string
    }>(sql`
      SELECT wo.id, wo.order_no
      FROM work_orders wo
      LEFT JOIN sales s ON s.id = wo.sale_id AND s.status != 'void'
      WHERE wo.status = 'invoiced'
        AND (wo.sale_id IS NULL OR s.id IS NULL)
      LIMIT 500
    `)
    for (const r of invoicedNoSale.rows) {
      findings.push({
        category: 'work-orders',
        severity: 'critical',
        title: `Invoiced WO without sale: ${r.order_no}`,
        message: `Work order is marked as invoiced but has no valid linked sale`,
        entityType: 'work_order',
        entityId: r.id,
      })
    }

    // 3. Sale total vs WO total: when invoiced, the linked sale total should roughly match WO total
    const saleTotalMismatch = await db.execute<{
      id: string; order_no: string; wo_total: string; sale_total: string
    }>(sql`
      SELECT wo.id, wo.order_no,
        wo.total AS wo_total,
        s.total AS sale_total
      FROM work_orders wo
      JOIN sales s ON s.id = wo.sale_id AND s.status != 'void'
      WHERE wo.status = 'invoiced'
        AND ABS(wo.total::numeric - s.total::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of saleTotalMismatch.rows) {
      findings.push({
        category: 'work-orders',
        severity: 'high',
        title: `WO/Sale total mismatch: ${r.order_no}`,
        message: `Work order total: ${r.wo_total}, linked sale total: ${r.sale_total}`,
        entityType: 'work_order',
        entityId: r.id,
      })
    }

    return findings
  })
}
