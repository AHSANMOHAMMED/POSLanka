// Layaway payment consistency audit — 2 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const layawayAuditModule: AuditModule = {
  category: 'layaways',
  label: 'Layaways',
  run: runLayawayAudit,
}

async function runLayawayAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Payment consistency: layaway.paidAmount = sum(layawayPayments.amount)
    const paymentMismatches = await db.execute<{
      id: string; layaway_no: string; recorded_paid: string; actual_paid: string
    }>(sql`
      SELECT l.id, l.layaway_no,
        l.paid_amount AS recorded_paid,
        COALESCE(lp.pay_sum, 0) AS actual_paid
      FROM layaways l
      LEFT JOIN (
        SELECT layaway_id, ROUND(SUM(amount::numeric), 2) AS pay_sum
        FROM layaway_payments
        GROUP BY layaway_id
      ) lp ON lp.layaway_id = l.id
      WHERE l.status != 'cancelled'
        AND ABS(l.paid_amount::numeric - COALESCE(lp.pay_sum, 0)) > 0.01
      LIMIT 500
    `)
    for (const r of paymentMismatches.rows) {
      findings.push({
        category: 'layaways',
        severity: 'high',
        title: `Payment mismatch on ${r.layaway_no}`,
        message: `Recorded paid: ${r.recorded_paid}, sum of payments: ${r.actual_paid}`,
        entityType: 'layaway',
        entityId: r.id,
      })
    }

    // 2. Completed layaway should have corresponding sale
    const completedNoSale = await db.execute<{
      id: string; layaway_no: string
    }>(sql`
      SELECT l.id, l.layaway_no
      FROM layaways l
      LEFT JOIN sales s ON s.notes LIKE '%' || l.layaway_no || '%'
        AND s.status != 'void'
      WHERE l.status = 'completed'
        AND s.id IS NULL
      LIMIT 500
    `)
    for (const r of completedNoSale.rows) {
      findings.push({
        category: 'layaways',
        severity: 'medium',
        title: `Completed layaway without sale: ${r.layaway_no}`,
        message: `Layaway is marked as completed but no corresponding sale was found`,
        entityType: 'layaway',
        entityId: r.id,
      })
    }

    return findings
  })
}
