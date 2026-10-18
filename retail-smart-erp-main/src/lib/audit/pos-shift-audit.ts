// POS shift closing totals audit — 2 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const posShiftAuditModule: AuditModule = {
  category: 'pos-shifts',
  label: 'POS Shifts',
  run: runPosShiftAudit,
}

async function runPosShiftAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Closing totals: closingEntry.totalSales should match sum of non-return sales in that shift
    const totalMismatches = await db.execute<{
      id: string; entry_number: string; recorded_total: string; actual_total: string
    }>(sql`
      SELECT ce.id, ce.entry_number,
        ce.total_sales AS recorded_total,
        COALESCE(s.actual_total, 0) AS actual_total
      FROM pos_closing_entries ce
      LEFT JOIN (
        SELECT pos_opening_entry_id,
          ROUND(SUM(CASE WHEN is_return = false THEN total::numeric ELSE 0 END), 2) AS actual_total
        FROM sales
        WHERE status != 'void'
          AND pos_opening_entry_id IS NOT NULL
        GROUP BY pos_opening_entry_id
      ) s ON s.pos_opening_entry_id = ce.opening_entry_id
      WHERE ce.status = 'submitted'
        AND ABS(ce.total_sales::numeric - COALESCE(s.actual_total, 0)) > 0.01
      LIMIT 500
    `)
    for (const r of totalMismatches.rows) {
      findings.push({
        category: 'pos-shifts',
        severity: 'high',
        title: `Closing total mismatch: ${r.entry_number}`,
        message: `Recorded sales total: ${r.recorded_total}, actual: ${r.actual_total}`,
        entityType: 'pos_closing',
        entityId: r.id,
      })
    }

    // 2. Transaction count: closingEntry.totalTransactions should match count of sales
    const countMismatches = await db.execute<{
      id: string; entry_number: string; recorded_count: string; actual_count: string
    }>(sql`
      SELECT ce.id, ce.entry_number,
        ce.total_transactions AS recorded_count,
        COALESCE(s.actual_count, 0) AS actual_count
      FROM pos_closing_entries ce
      LEFT JOIN (
        SELECT pos_opening_entry_id, COUNT(*)::int AS actual_count
        FROM sales
        WHERE status != 'void'
          AND pos_opening_entry_id IS NOT NULL
        GROUP BY pos_opening_entry_id
      ) s ON s.pos_opening_entry_id = ce.opening_entry_id
      WHERE ce.status = 'submitted'
        AND ce.total_transactions != COALESCE(s.actual_count, 0)
      LIMIT 500
    `)
    for (const r of countMismatches.rows) {
      findings.push({
        category: 'pos-shifts',
        severity: 'medium',
        title: `Transaction count mismatch: ${r.entry_number}`,
        message: `Recorded: ${r.recorded_count} transactions, actual: ${r.actual_count}`,
        entityType: 'pos_closing',
        entityId: r.id,
      })
    }

    return findings
  })
}
