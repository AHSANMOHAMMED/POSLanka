// Supplier balance reconciliation — 1 check
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const supplierAuditModule: AuditModule = {
  category: 'suppliers',
  label: 'Suppliers',
  run: runSupplierAudit,
}

async function runSupplierAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // Balance vs audit trail: supplier.balance should match latest newBalance in audit
    const balanceMismatches = await db.execute<{
      id: string; name: string; recorded_balance: string; last_audit_balance: string
    }>(sql`
      SELECT s.id, s.name,
        s.balance AS recorded_balance,
        latest.new_balance AS last_audit_balance
      FROM suppliers s
      JOIN LATERAL (
        SELECT new_balance
        FROM supplier_balance_audit
        WHERE supplier_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE ABS(s.balance::numeric - latest.new_balance::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of balanceMismatches.rows) {
      findings.push({
        category: 'suppliers',
        severity: 'high',
        title: `Balance mismatch: ${r.name}`,
        message: `Supplier balance: ${r.recorded_balance}, last audit balance: ${r.last_audit_balance}`,
        entityType: 'supplier',
        entityId: r.id,
      })
    }

    return findings
  })
}
