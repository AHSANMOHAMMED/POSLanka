// Sale integrity audit — 7 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const saleAuditModule: AuditModule = {
  category: 'sales',
  label: 'Sales',
  run: runSaleAudit,
}

async function runSaleAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Arithmetic: sale.total = subtotal - discountAmount + taxAmount
    const grandTotalMismatches = await db.execute<{
      id: string; invoice_no: string; expected: string; actual: string
    }>(sql`
      SELECT id, invoice_no,
        ROUND(subtotal::numeric - discount_amount::numeric + tax_amount::numeric, 2) AS expected,
        total AS actual
      FROM sales
      WHERE tenant_id = ${tenantId}
        AND status != 'void'
        AND ABS((subtotal::numeric - discount_amount::numeric + tax_amount::numeric) - total::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of grandTotalMismatches.rows) {
      findings.push({
        category: 'sales',
        severity: 'high',
        title: `Grand total mismatch on ${r.invoice_no}`,
        message: `Expected ${r.expected}, actual ${r.actual}`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 2. Subtotal vs sum(saleItems.total)
    const subtotalMismatches = await db.execute<{
      id: string; invoice_no: string; expected: string; actual: string
    }>(sql`
      SELECT s.id, s.invoice_no,
        si.item_sum AS expected,
        s.subtotal AS actual
      FROM sales s
      JOIN (
        SELECT sale_id, ROUND(COALESCE(SUM(total::numeric), 0), 2) AS item_sum
        FROM sale_items
        WHERE tenant_id = ${tenantId}
        GROUP BY sale_id
      ) si ON si.sale_id = s.id
      WHERE s.tenant_id = ${tenantId}
        AND s.status != 'void'
        AND ABS(si.item_sum - s.subtotal::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of subtotalMismatches.rows) {
      findings.push({
        category: 'sales',
        severity: 'high',
        title: `Subtotal mismatch on ${r.invoice_no}`,
        message: `Sum of items: ${r.expected}, sale subtotal: ${r.actual}`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 3. Payment match: sum(non-voided payments) = sale.paidAmount
    const paymentMismatches = await db.execute<{
      id: string; invoice_no: string; expected: string; actual: string
    }>(sql`
      SELECT s.id, s.invoice_no,
        COALESCE(p.pay_sum, 0) AS expected,
        s.paid_amount AS actual
      FROM sales s
      LEFT JOIN (
        SELECT sale_id, ROUND(SUM(amount::numeric), 2) AS pay_sum
        FROM payments
        WHERE voided_at IS NULL
          AND tenant_id = ${tenantId}
        GROUP BY sale_id
      ) p ON p.sale_id = s.id
      WHERE s.tenant_id = ${tenantId}
        AND s.status != 'void'
        AND ABS(COALESCE(p.pay_sum, 0) - s.paid_amount::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of paymentMismatches.rows) {
      findings.push({
        category: 'sales',
        severity: 'high',
        title: `Payment mismatch on ${r.invoice_no}`,
        message: `Sum of payments: ${r.expected}, sale paidAmount: ${r.actual}`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 4. Stock movements: for completed sales with trackStock items, verify stock movements exist
    const missingStockMovements = await db.execute<{
      id: string; invoice_no: string; item_name: string
    }>(sql`
      SELECT DISTINCT s.id, s.invoice_no, si.item_name
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      JOIN items i ON i.id = si.item_id AND i.track_stock = true
      LEFT JOIN stock_movements sm ON sm.reference_id = s.id
        AND sm.reference_type = 'sale'
        AND sm.item_id = si.item_id
        AND sm.type = 'out'
      WHERE s.tenant_id = ${tenantId}
        AND s.status IN ('completed', 'partial')
        AND s.is_return = false
        AND sm.id IS NULL
      LIMIT 500
    `)
    for (const r of missingStockMovements.rows) {
      findings.push({
        category: 'sales',
        severity: 'critical',
        title: `Missing stock movement for ${r.invoice_no}`,
        message: `Item "${r.item_name}" was sold but no stock-out movement exists`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 5. GL entries: if auto-post is enabled, verify GL entries exist and balance
    const unbalancedSaleGL = await db.execute<{
      id: string; invoice_no: string; debit_sum: string; credit_sum: string
    }>(sql`
      SELECT s.id, s.invoice_no,
        COALESCE(g.debit_sum, 0) AS debit_sum,
        COALESCE(g.credit_sum, 0) AS credit_sum
      FROM sales s
      JOIN (
        SELECT voucher_id,
          ROUND(SUM(debit::numeric), 2) AS debit_sum,
          ROUND(SUM(credit::numeric), 2) AS credit_sum
        FROM gl_entries
        WHERE voucher_type = 'sale'
          AND tenant_id = ${tenantId}
        GROUP BY voucher_id
        HAVING ABS(SUM(debit::numeric) - SUM(credit::numeric)) > 0.01
      ) g ON g.voucher_id = s.id
      WHERE s.tenant_id = ${tenantId}
        AND s.status != 'void'
      LIMIT 500
    `)
    for (const r of unbalancedSaleGL.rows) {
      findings.push({
        category: 'sales',
        severity: 'critical',
        title: `Unbalanced GL entries for ${r.invoice_no}`,
        message: `Debits: ${r.debit_sum}, Credits: ${r.credit_sum}`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 6. Credit transactions: if payment method includes 'credit', verify customerCreditTransaction exists
    const missingCreditTxns = await db.execute<{
      id: string; invoice_no: string; customer_name: string
    }>(sql`
      SELECT DISTINCT s.id, s.invoice_no, s.customer_name
      FROM sales s
      JOIN payments p ON p.sale_id = s.id AND p.method = 'credit' AND p.voided_at IS NULL
      LEFT JOIN customer_credit_transactions cct ON cct.reference_id = s.id
        AND cct.reference_type = 'sale'
        AND cct.type = 'use'
      WHERE s.tenant_id = ${tenantId}
        AND s.status != 'void'
        AND s.customer_id IS NOT NULL
        AND cct.id IS NULL
      LIMIT 500
    `)
    for (const r of missingCreditTxns.rows) {
      findings.push({
        category: 'sales',
        severity: 'high',
        title: `Missing credit transaction for ${r.invoice_no}`,
        message: `Credit payment recorded but no credit transaction for customer "${r.customer_name}"`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 7. Activity log: completed sales should have an activity log entry
    const missingActivityLog = await db.execute<{
      id: string; invoice_no: string
    }>(sql`
      SELECT s.id, s.invoice_no
      FROM sales s
      LEFT JOIN activity_logs al ON al.entity_id = s.id AND al.entity_type = 'sale'
      WHERE s.tenant_id = ${tenantId}
        AND s.status IN ('completed', 'partial')
        AND al.id IS NULL
      LIMIT 500
    `)
    for (const r of missingActivityLog.rows) {
      findings.push({
        category: 'sales',
        severity: 'low',
        title: `Missing activity log for ${r.invoice_no}`,
        message: `Sale completed but no activity log entry exists`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    return findings
  })
}
