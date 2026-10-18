// Customer balance & loyalty reconciliation — 2 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const customerAuditModule: AuditModule = {
  category: 'customers',
  label: 'Customers',
  run: runCustomerAudit,
}

async function runCustomerAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Balance vs credit transactions: customer.balance should match latest balanceAfter
    const balanceMismatches = await db.execute<{
      id: string; name: string; recorded_balance: string; last_balance_after: string
    }>(sql`
      SELECT c.id, c.name,
        c.balance AS recorded_balance,
        latest.balance_after AS last_balance_after
      FROM customers c
      JOIN LATERAL (
        SELECT balance_after
        FROM customer_credit_transactions
        WHERE customer_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE ABS(c.balance::numeric - latest.balance_after::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of balanceMismatches.rows) {
      findings.push({
        category: 'customers',
        severity: 'high',
        title: `Balance mismatch: ${r.name}`,
        message: `Customer balance: ${r.recorded_balance}, last transaction balance: ${r.last_balance_after}`,
        entityType: 'customer',
        entityId: r.id,
      })
    }

    // 2. Loyalty points vs transactions: customer.loyaltyPoints should match latest balanceAfter
    const loyaltyMismatches = await db.execute<{
      id: string; name: string; recorded_points: string; last_balance_after: string
    }>(sql`
      SELECT c.id, c.name,
        c.loyalty_points AS recorded_points,
        latest.balance_after AS last_balance_after
      FROM customers c
      JOIN LATERAL (
        SELECT balance_after
        FROM loyalty_transactions
        WHERE customer_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE c.loyalty_points != latest.balance_after
      LIMIT 500
    `)
    for (const r of loyaltyMismatches.rows) {
      findings.push({
        category: 'customers',
        severity: 'high',
        title: `Loyalty points mismatch: ${r.name}`,
        message: `Customer points: ${r.recorded_points}, last transaction balance: ${r.last_balance_after}`,
        entityType: 'customer',
        entityId: r.id,
      })
    }

    return findings
  })
}
