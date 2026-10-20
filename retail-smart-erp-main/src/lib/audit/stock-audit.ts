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

    // 1. Stock vs ledger: warehouseStock.currentStock should equal the latest
    //    ledger_baseline (stock_after) + SUM(qty_change) of later movements.
    //    Movements whose sign could not be derived (sign_source='unknown') are ignored.
    const stockMismatches = await db.execute<{
      item_id: string; warehouse_id: string; item_name: string; warehouse_name: string
      current_stock: string; calculated_stock: string
    }>(sql`
      SELECT ws.item_id, ws.warehouse_id,
        i.name AS item_name,
        w.name AS warehouse_name,
        ws.current_stock,
        ROUND(COALESCE(b.stock_after, 0) + COALESCE(m.sum_change, 0), 3) AS calculated_stock
      FROM warehouse_stock ws
      JOIN items i ON i.id = ws.item_id
      JOIN warehouses w ON w.id = ws.warehouse_id
      LEFT JOIN LATERAL (
        SELECT sb.id, sb.created_at, sb.stock_after
        FROM stock_movements sb
        WHERE sb.tenant_id = ws.tenant_id AND sb.warehouse_id = ws.warehouse_id AND sb.item_id = ws.item_id
          AND sb.reference_type = 'ledger_baseline'
        ORDER BY sb.created_at DESC, sb.id DESC
        LIMIT 1
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT SUM(sm.qty_change) AS sum_change
        FROM stock_movements sm
        WHERE sm.tenant_id = ws.tenant_id AND sm.warehouse_id = ws.warehouse_id AND sm.item_id = ws.item_id
          AND COALESCE(sm.reference_type, '') <> 'ledger_baseline'
          AND COALESCE(sm.sign_source, '') <> 'unknown'
          AND (b.id IS NULL OR sm.created_at > b.created_at)
      ) m ON true
      WHERE ABS(ws.current_stock::numeric - (COALESCE(b.stock_after, 0) + COALESCE(m.sum_change, 0))) > 0.001
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
