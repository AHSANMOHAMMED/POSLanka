// Stock consistency audit — 3 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const stockAuditModule: AuditModule = {
  category: 'stock',
  label: 'Stock',
  run: runStockAudit,
}

async function runStockAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Stock vs movements: warehouseStock.currentStock should = sum(in) - sum(out)
    const stockMismatches = await db.execute<{
      item_id: string; warehouse_id: string; item_name: string; warehouse_name: string
      current_stock: string; calculated_stock: string
    }>(sql`
      SELECT ws.item_id, ws.warehouse_id,
        i.name AS item_name,
        w.name AS warehouse_name,
        ws.current_stock,
        COALESCE(m.calc_stock, 0) AS calculated_stock
      FROM warehouse_stock ws
      JOIN items i ON i.id = ws.item_id
      JOIN warehouses w ON w.id = ws.warehouse_id
      LEFT JOIN (
        SELECT item_id, warehouse_id,
          ROUND(
            SUM(CASE WHEN type = 'in' THEN quantity::numeric ELSE 0 END) -
            SUM(CASE WHEN type = 'out' THEN quantity::numeric ELSE 0 END) +
            SUM(CASE WHEN type = 'adjustment' THEN quantity::numeric ELSE 0 END),
          3) AS calc_stock
        FROM stock_movements
        WHERE warehouse_id IS NOT NULL
        GROUP BY item_id, warehouse_id
      ) m ON m.item_id = ws.item_id AND m.warehouse_id = ws.warehouse_id
      WHERE ABS(ws.current_stock::numeric - COALESCE(m.calc_stock, 0)) > 0.001
      LIMIT 500
    `)
    for (const r of stockMismatches.rows) {
      findings.push({
        category: 'stock',
        severity: 'critical',
        title: `Stock mismatch: ${r.item_name} @ ${r.warehouse_name}`,
        message: `Recorded: ${r.current_stock}, calculated from movements: ${r.calculated_stock}`,
        entityType: 'item',
        entityId: r.item_id,
      })
    }

    // 2. Negative stock: any warehouseStock.currentStock < 0
    const negativeStock = await db.execute<{
      item_id: string; warehouse_id: string; item_name: string; warehouse_name: string; current_stock: string
    }>(sql`
      SELECT ws.item_id, ws.warehouse_id,
        i.name AS item_name,
        w.name AS warehouse_name,
        ws.current_stock
      FROM warehouse_stock ws
      JOIN items i ON i.id = ws.item_id
      JOIN warehouses w ON w.id = ws.warehouse_id
      WHERE ws.current_stock::numeric < 0
      LIMIT 500
    `)
    for (const r of negativeStock.rows) {
      findings.push({
        category: 'stock',
        severity: 'high',
        title: `Negative stock: ${r.item_name} @ ${r.warehouse_name}`,
        message: `Current stock is ${r.current_stock}`,
        entityType: 'item',
        entityId: r.item_id,
      })
    }

    // 3. Orphaned stock movements: movements referencing voided or non-existent sales
    const orphanedMovements = await db.execute<{
      id: string; reference_type: string; reference_id: string; item_name: string
    }>(sql`
      SELECT sm.id, sm.reference_type, sm.reference_id, i.name AS item_name
      FROM stock_movements sm
      JOIN items i ON i.id = sm.item_id
      LEFT JOIN sales s ON sm.reference_type = 'sale' AND sm.reference_id = s.id
      LEFT JOIN purchases p ON sm.reference_type = 'purchase' AND sm.reference_id = p.id
      WHERE sm.reference_id IS NOT NULL
        AND sm.reference_type IN ('sale', 'purchase')
        AND (
          (sm.reference_type = 'sale' AND (s.id IS NULL OR s.status = 'void'))
          OR (sm.reference_type = 'purchase' AND (p.id IS NULL OR p.status = 'cancelled'))
        )
      LIMIT 500
    `)
    for (const r of orphanedMovements.rows) {
      findings.push({
        category: 'stock',
        severity: 'high',
        title: `Orphaned stock movement for ${r.item_name}`,
        message: `Movement references ${r.reference_type} ${r.reference_id} which is void/missing`,
        entityType: 'stock_movement',
        entityId: r.id,
      })
    }

    return findings
  })
}
