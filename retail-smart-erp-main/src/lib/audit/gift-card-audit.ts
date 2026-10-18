// Gift card balance consistency audit — 1 check
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const giftCardAuditModule: AuditModule = {
  category: 'gift-cards',
  label: 'Gift Cards',
  run: runGiftCardAudit,
}

async function runGiftCardAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // Balance consistency: last giftCardTransaction.balanceAfter should = giftCard.currentBalance
    const balanceMismatches = await db.execute<{
      id: string; card_number: string; recorded_balance: string; last_balance_after: string
    }>(sql`
      SELECT gc.id, gc.card_number,
        gc.current_balance AS recorded_balance,
        latest.balance_after AS last_balance_after
      FROM gift_cards gc
      JOIN LATERAL (
        SELECT balance_after
        FROM gift_card_transactions
        WHERE gift_card_id = gc.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE ABS(gc.current_balance::numeric - latest.balance_after::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of balanceMismatches.rows) {
      findings.push({
        category: 'gift-cards',
        severity: 'high',
        title: `Balance mismatch: Card ${r.card_number}`,
        message: `Current balance: ${r.recorded_balance}, last transaction balance: ${r.last_balance_after}`,
        entityType: 'gift_card',
        entityId: r.id,
      })
    }

    return findings
  })
}
