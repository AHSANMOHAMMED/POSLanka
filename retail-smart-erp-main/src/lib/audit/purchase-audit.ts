// Purchase integrity audit — 4 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const purchaseAuditModule: AuditModule = {
  category: 'purchases',
  label: 'Purchases',
  run: runPurchaseAudit,
}

async function runPurchaseAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Arithmetic: purchase.total = sum(purchaseItems.total)
    const totalMismatches = await db.execute<{
      id: string; purchase_no: string; expected: string; actual: string
    }>(sql`
      SELECT p.id, p.purchase_no,
        pi.item_sum AS expected,
        p.total AS actual
      FROM purchases p
      JOIN (
        SELECT purchase_id, ROUND(COALESCE(SUM(total::numeric), 0), 2) AS item_sum
        FROM purchase_items
        WHERE tenant_id = ${tenantId}
        GROUP BY purchase_id
      ) pi ON pi.purchase_id = p.id
      WHERE p.tenant_id = ${tenantId}
        AND p.status != 'cancelled'
        AND ABS(pi.item_sum - p.total::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of totalMismatches.rows) {
      findings.push({
        category: 'purchases',
        severity: 'high',
        title: `Total mismatch on ${r.purchase_no}`,
        message: `Sum of items: ${r.expected}, purchase total: ${r.actual}`,
        entityType: 'purchase',
        entityId: r.id,
      })
    }

    // 2. Stock movements: submitted purchases should have stock-in movements
    const missingStockIn = await db.execute<{
      id: string; purchase_no: string; item_name: string
    }>(sql`
      SELECT DISTINCT p.id, p.purchase_no, pi.item_name
      FROM purchases p
      JOIN purchase_items pi ON pi.purchase_id = p.id
      JOIN items i ON i.id = pi.item_id AND i.track_stock = true
      LEFT JOIN stock_movements sm ON sm.reference_id = p.id
        AND sm.reference_type = 'purchase'
        AND sm.item_id = pi.item_id
        AND sm.type = 'in'
      WHERE p.tenant_id = ${tenantId}
        AND p.status NOT IN ('cancelled')
        AND p.is_return = false
        AND sm.id IS NULL
      LIMIT 500
    `)
    for (const r of missingStockIn.rows) {
      findings.push({
        category: 'purchases',
        severity: 'critical',
        title: `Missing stock-in for ${r.purchase_no}`,
        message: `Item "${r.item_name}" was purchased but no stock-in movement exists`,
        entityType: 'purchase',
        entityId: r.id,
      })
    }

    // 3. Supplier balance audit trail: credit purchases should have supplierBalanceAudit record
    const missingBalanceAudit = await db.execute<{
      id: string; purchase_no: string; supplier_name: string
    }>(sql`
      SELECT p.id, p.purchase_no, s.name AS supplier_name
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN supplier_balance_audit sba ON sba.reference_id = p.id
        AND sba.reference_type = 'purchase'
      WHERE p.tenant_id = ${tenantId}
        AND p.status != 'cancelled'
        AND p.payment_term = 'credit'
        AND p.supplier_id IS NOT NULL
        AND sba.id IS NULL
      LIMIT 500
    `)
    for (const r of missingBalanceAudit.rows) {
      findings.push({
        category: 'purchases',
        severity: 'high',
        title: `Missing supplier audit trail for ${r.purchase_no}`,
        message: `Credit purchase with ${r.supplier_name} has no balance audit record`,
        entityType: 'purchase',
        entityId: r.id,
      })
    }

    // 4. GL entries: if purchases have GL entries, verify they balance
    const unbalancedPurchaseGL = await db.execute<{
      id: string; purchase_no: string; debit_sum: string; credit_sum: string
    }>(sql`
      SELECT p.id, p.purchase_no,
        COALESCE(g.debit_sum, 0) AS debit_sum,
        COALESCE(g.credit_sum, 0) AS credit_sum
      FROM purchases p
      JOIN (
        SELECT voucher_id,
          ROUND(SUM(debit::numeric), 2) AS debit_sum,
          ROUND(SUM(credit::numeric), 2) AS credit_sum
        FROM gl_entries
        WHERE voucher_type = 'purchase'
          AND tenant_id = ${tenantId}
        GROUP BY voucher_id
        HAVING ABS(SUM(debit::numeric) - SUM(credit::numeric)) > 0.01
      ) g ON g.voucher_id = p.id
      WHERE p.tenant_id = ${tenantId}
        AND p.status != 'cancelled'
      LIMIT 500
    `)
    for (const r of unbalancedPurchaseGL.rows) {
      findings.push({
        category: 'purchases',
        severity: 'critical',
        title: `Unbalanced GL for ${r.purchase_no}`,
        message: `Debits: ${r.debit_sum}, Credits: ${r.credit_sum}`,
        entityType: 'purchase',
        entityId: r.id,
      })
    }

    return findings
  })
}
