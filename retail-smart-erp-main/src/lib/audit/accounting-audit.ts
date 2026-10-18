// GL double-entry & account balance audit — 8 checks
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import type { AuditModule, AuditFinding } from './types'

export const accountingAuditModule: AuditModule = {
  category: 'accounting',
  label: 'Accounting',
  run: runAccountingAudit,
}

async function runAccountingAudit(tenantId: string): Promise<AuditFinding[]> {
  return withTenant(tenantId, async (db) => {
    const findings: AuditFinding[] = []

    // 1. Double-entry per voucher: for each (voucherType, voucherId), sum(debit) = sum(credit)
    const unbalancedVouchers = await db.execute<{
      voucher_type: string; voucher_id: string; voucher_number: string
      debit_sum: string; credit_sum: string
    }>(sql`
      SELECT voucher_type, voucher_id,
        MAX(voucher_number) AS voucher_number,
        ROUND(SUM(debit::numeric), 2) AS debit_sum,
        ROUND(SUM(credit::numeric), 2) AS credit_sum
      FROM gl_entries
      WHERE tenant_id = ${tenantId}
      GROUP BY voucher_type, voucher_id
      HAVING ABS(SUM(debit::numeric) - SUM(credit::numeric)) > 0.01
      LIMIT 500
    `)
    for (const r of unbalancedVouchers.rows) {
      findings.push({
        category: 'accounting',
        severity: 'critical',
        title: `Unbalanced GL: ${r.voucher_type} ${r.voucher_number || r.voucher_id}`,
        message: `Debits: ${r.debit_sum}, Credits: ${r.credit_sum}`,
        entityType: r.voucher_type,
        entityId: r.voucher_id,
      })
    }

    // 2. Account balance consistency: chartOfAccounts.balance should match sum of GL entries
    const accountMismatches = await db.execute<{
      id: string; name: string; account_number: string; root_type: string
      recorded_balance: string; calculated_balance: string
    }>(sql`
      SELECT coa.id, coa.name, coa.account_number, coa.root_type,
        coa.balance AS recorded_balance,
        COALESCE(g.calc_balance, 0) AS calculated_balance
      FROM chart_of_accounts coa
      LEFT JOIN (
        SELECT account_id,
          ROUND(SUM(debit::numeric) - SUM(credit::numeric), 2) AS calc_balance
        FROM gl_entries
        WHERE tenant_id = ${tenantId}
        GROUP BY account_id
      ) g ON g.account_id = coa.id
      WHERE coa.tenant_id = ${tenantId}
        AND coa.is_group = false
        AND ABS(coa.balance::numeric - COALESCE(g.calc_balance, 0)) > 0.01
      LIMIT 500
    `)
    for (const r of accountMismatches.rows) {
      findings.push({
        category: 'accounting',
        severity: 'critical',
        title: `Account balance mismatch: ${r.account_number} ${r.name}`,
        message: `Recorded: ${r.recorded_balance}, calculated from GL: ${r.calculated_balance}`,
        entityType: 'account',
        entityId: r.id,
      })
    }

    // 3. Orphaned GL entries: entries referencing non-existent vouchers
    const orphanedEntries = await db.execute<{
      id: string; voucher_type: string; voucher_id: string; voucher_number: string
    }>(sql`
      SELECT g.id, g.voucher_type, g.voucher_id, g.voucher_number
      FROM gl_entries g
      LEFT JOIN sales s ON g.voucher_type = 'sale' AND g.voucher_id = s.id
      LEFT JOIN purchases p ON g.voucher_type = 'purchase' AND g.voucher_id = p.id
      LEFT JOIN journal_entries je ON g.voucher_type = 'journal_entry' AND g.voucher_id = je.id
      LEFT JOIN payment_entries pe ON g.voucher_type = 'payment_entry' AND g.voucher_id = pe.id
      WHERE g.tenant_id = ${tenantId}
        AND (
          (g.voucher_type = 'sale' AND s.id IS NULL)
          OR (g.voucher_type = 'purchase' AND p.id IS NULL)
          OR (g.voucher_type = 'journal_entry' AND je.id IS NULL)
          OR (g.voucher_type = 'payment_entry' AND pe.id IS NULL)
        )
      LIMIT 500
    `)
    for (const r of orphanedEntries.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Orphaned GL entry: ${r.voucher_type} ${r.voucher_number || ''}`,
        message: `GL entry references ${r.voucher_type} ${r.voucher_id} which doesn't exist`,
        entityType: 'gl_entry',
        entityId: r.id,
      })
    }

    // 4. Check for negative account balances where not allowed
    const negativeBalances = await db.execute<{
      id: string; account_number: string; name: string; balance: string; allow_negative: boolean
    }>(sql`
      SELECT id, account_number, name, balance, allow_negative
      FROM chart_of_accounts
      WHERE tenant_id = ${tenantId}
        AND is_group = false
        AND allow_negative = false
        AND balance::numeric < -0.01
      LIMIT 500
    `)
    for (const r of negativeBalances.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Unexpected negative balance: ${r.account_number} ${r.name}`,
        message: `Account has a negative balance of ${r.balance} but is not allowed to.`,
        entityType: 'account',
        entityId: r.id,
      })
    }

    // 5. Check for accounts with missing parent (orphaned accounts)
    const orphanedAccounts = await db.execute<{
      id: string; account_number: string; name: string; parent_id: string
    }>(sql`
      SELECT child.id, child.account_number, child.name, child.parent_id
      FROM chart_of_accounts child
      LEFT JOIN chart_of_accounts parent ON child.parent_id = parent.id AND parent.tenant_id = ${tenantId}
      WHERE child.tenant_id = ${tenantId}
        AND child.parent_id IS NOT NULL
        AND parent.id IS NULL
      LIMIT 500
    `)
    for (const r of orphanedAccounts.rows) {
      findings.push({
        category: 'accounting',
        severity: 'medium',
        title: `Orphaned account: ${r.account_number} ${r.name}`,
        message: `Account references parent ID ${r.parent_id} which does not exist.`,
        entityType: 'account',
        entityId: r.id,
      })
    }

    // 6. Journal entry arithmetic validation: total should match sum of debits/credits
    const journalArithmeticMismatches = await db.execute<{
      id: string; voucher_no: string; expected: string; actual: string
    }>(sql`
      SELECT je.id, je.voucher_no,
        ROUND(COALESCE(SUM(g.debit::numeric), 0), 2) AS expected,
        je.total AS actual
      FROM journal_entries je
      LEFT JOIN gl_entries g ON g.voucher_type = 'journal_entry' AND g.voucher_id = je.id AND g.tenant_id = ${tenantId}
      WHERE je.tenant_id = ${tenantId}
        AND je.status = 'posted'
      GROUP BY je.id, je.voucher_no, je.total
      HAVING ABS(ROUND(COALESCE(SUM(g.debit::numeric), 0), 2) - je.total::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of journalArithmeticMismatches.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Journal entry total mismatch: ${r.voucher_no}`,
        message: `Sum of debits: ${r.expected}, journal total: ${r.actual}`,
        entityType: 'journal_entry',
        entityId: r.id,
      })
    }

    // 7. Payment entry validation: payment amount should match GL entries
    const paymentValidationMismatches = await db.execute<{
      id: string; voucher_no: string; expected: string; actual: string
    }>(sql`
      SELECT pe.id, pe.voucher_no,
        ROUND(COALESCE(SUM(g.debit::numeric), 0), 2) AS expected,
        pe.amount AS actual
      FROM payment_entries pe
      LEFT JOIN gl_entries g ON g.voucher_type = 'payment_entry' AND g.voucher_id = pe.id AND g.tenant_id = ${tenantId}
      WHERE pe.tenant_id = ${tenantId}
        AND pe.status = 'posted'
      GROUP BY pe.id, pe.voucher_no, pe.amount
      HAVING ABS(ROUND(COALESCE(SUM(g.debit::numeric), 0), 2) - pe.amount::numeric) > 0.01
      LIMIT 500
    `)
    for (const r of paymentValidationMismatches.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Payment entry amount mismatch: ${r.voucher_no}`,
        message: `Sum of GL debits: ${r.expected}, payment amount: ${r.actual}`,
        entityType: 'payment_entry',
        entityId: r.id,
      })
    }

    // 8. Account type consistency: revenue/expense accounts should have correct balance types
    const accountTypeInconsistencies = await db.execute<{
      id: string; account_number: string; name: string; root_type: string; balance: string
    }>(sql`
      SELECT id, account_number, name, root_type, balance
      FROM chart_of_accounts
      WHERE tenant_id = ${tenantId}
        AND is_group = false
        AND (
          (root_type = 'Income' AND balance::numeric < -0.01)
          OR (root_type = 'Expense' AND balance::numeric > 0.01)
        )
      LIMIT 500
    `)
    for (const r of accountTypeInconsistencies.rows) {
      const expectedSign = r.root_type === 'Income' ? 'credit' : 'debit'
      // Income accounts should normally have credit balances (positive)
      // Expense accounts should normally have debit balances (positive)
      // If Income has negative balance, it's debit (unusual)
      // If Expense has positive balance, it's credit (unusual)
      const actualSign = parseFloat(r.balance) < 0 ? 'credit' : 'debit'
      findings.push({
        category: 'accounting',
        severity: 'medium',
        title: `Account type inconsistency: ${r.account_number} ${r.name}`,
        message: `${r.root_type} account has ${actualSign} balance of ${r.balance} (expected ${expectedSign} balance)`,
        entityType: 'account',
        entityId: r.id,
      })
    }

    // 9. Transaction date validation: entries in closed periods
    const closedPeriodEntries = await db.execute<{
      id: string; voucher_type: string; voucher_number: string; posting_date: string
    }>(sql`
      SELECT g.id, g.voucher_type, g.voucher_number, g.posting_date
      FROM gl_entries g
      WHERE g.tenant_id = ${tenantId}
        AND g.posting_date < (
          SELECT MIN(start_date)
          FROM accounting_periods
          WHERE tenant_id = ${tenantId}
            AND status = 'open'
        )
      LIMIT 500
    `)
    for (const r of closedPeriodEntries.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `GL entry in closed period: ${r.voucher_type} ${r.voucher_number || ''}`,
        message: `Entry dated ${r.posting_date} falls in a closed accounting period`,
        entityType: 'gl_entry',
        entityId: r.id,
      })
    }

    // 10. Mode of payment validation: ensure payment entries reference valid modes
    const invalidModePayments = await db.execute<{
      id: string; voucher_no: string; mode_of_payment: string
    }>(sql`
      SELECT pe.id, pe.voucher_no, pe.mode_of_payment
      FROM payment_entries pe
      LEFT JOIN modes_of_payment mop ON mop.id = pe.mode_of_payment_id AND mop.tenant_id = ${tenantId}
      WHERE pe.tenant_id = ${tenantId}
        AND pe.mode_of_payment_id IS NOT NULL
        AND mop.id IS NULL
      LIMIT 500
    `)
    for (const r of invalidModePayments.rows) {
      findings.push({
        category: 'accounting',
        severity: 'medium',
        title: `Invalid mode of payment: ${r.voucher_no}`,
        message: `Payment entry references non-existent mode of payment: ${r.mode_of_payment}`,
        entityType: 'payment_entry',
        entityId: r.id,
      })
    }

    // 11. Duplicate voucher numbers across voucher types
    const duplicateVouchers = await db.execute<{
      voucher_number: string; voucher_type: string; count: number
    }>(sql`
      SELECT voucher_number, voucher_type, COUNT(*) as count
      FROM gl_entries
      WHERE tenant_id = ${tenantId}
        AND voucher_number IS NOT NULL
        AND voucher_number != ''
      GROUP BY voucher_number, voucher_type
      HAVING COUNT(*) > 1
      LIMIT 500
    `)
    for (const r of duplicateVouchers.rows) {
      findings.push({
        category: 'accounting',
        severity: 'medium',
        title: `Duplicate voucher number: ${r.voucher_number} (${r.voucher_type})`,
        message: `Voucher number appears ${r.count} times in the system`,
        entityType: r.voucher_type,
        entityId: undefined,
      })
    }

    // 12. Missing posting dates in GL entries
    const missingPostingDates = await db.execute<{
      id: string; voucher_type: string; voucher_number: string
    }>(sql`
      SELECT id, voucher_type, voucher_number
      FROM gl_entries
      WHERE tenant_id = ${tenantId}
        AND (posting_date IS NULL OR posting_date = '')
      LIMIT 500
    `)
    for (const r of missingPostingDates.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Missing posting date: ${r.voucher_type} ${r.voucher_number || ''}`,
        message: `GL entry has no posting date which is required for proper accounting`,
        entityType: 'gl_entry',
        entityId: r.id,
      })
    }

    // 13. Future-dated entries
    const futureDatedEntries = await db.execute<{
      id: string; voucher_type: string; voucher_number: string; posting_date: string
    }>(sql`
      SELECT id, voucher_type, voucher_number, posting_date
      FROM gl_entries
      WHERE tenant_id = ${tenantId}
        AND posting_date::date > CURRENT_DATE
      LIMIT 500
    `)
    for (const r of futureDatedEntries.rows) {
      findings.push({
        category: 'accounting',
        severity: 'medium',
        title: `Future-dated entry: ${r.voucher_type} ${r.voucher_number || ''}`,
        message: `GL entry is dated ${r.posting_date} which is in the future`,
        entityType: 'gl_entry',
        entityId: r.id,
      })
    }

    // 14. Missing account assignments
    const missingAccountAssignments = await db.execute<{
      id: string; voucher_type: string; voucher_number: string
    }>(sql`
      SELECT id, voucher_type, voucher_number
      FROM gl_entries
      WHERE tenant_id = ${tenantId}
        AND (account_id IS NULL OR account_id = '')
      LIMIT 500
    `)
    for (const r of missingAccountAssignments.rows) {
      findings.push({
        category: 'accounting',
        severity: 'critical',
        title: `Missing account assignment: ${r.voucher_type} ${r.voucher_number || ''}`,
        message: `GL entry is not assigned to any account`,
        entityType: 'gl_entry',
        entityId: r.id,
      })
    }

    // 15. Auto-posting validation: sales without GL entries when auto-posting is enabled
    // First, check if auto-posting is enabled by looking for the setting
    const salesMissingGLEntries = await db.execute<{
      id: string; invoice_no: string; created_at: string
    }>(sql`
      SELECT s.id, s.invoice_no, s.created_at
      FROM sales s
      LEFT JOIN gl_entries g ON g.voucher_type = 'sale' 
        AND g.voucher_id = s.id 
        AND g.tenant_id = ${tenantId}
      WHERE s.tenant_id = ${tenantId}
        AND s.status != 'void'
        AND s.is_return = false
        AND g.id IS NULL
        AND EXISTS (
          SELECT 1 FROM system_settings 
          WHERE tenant_id = ${tenantId} 
          AND key = 'auto_posting_enabled' 
          AND value = 'true'
        )
      LIMIT 500
    `)
    for (const r of salesMissingGLEntries.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Missing GL entries for sale: ${r.invoice_no}`,
        message: `Sale was created but has no GL entries while auto-posting is enabled`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    // 16. Stock movement accounting check
    const stockMissingAccounting = await db.execute<{
      id: string; reference_type: string; reference_id: string; item_name: string
    }>(sql`
      SELECT sm.id, sm.reference_type, sm.reference_id, i.name as item_name
      FROM stock_movements sm
      JOIN items i ON i.id = sm.item_id
      LEFT JOIN gl_entries g ON g.voucher_type = 'stock_movement'
        AND g.voucher_id = sm.id
        AND g.tenant_id = ${tenantId}
      WHERE sm.tenant_id = ${tenantId}
        AND sm.quantity != 0
        AND i.track_stock = true
        AND i.inventory_account_id IS NOT NULL
        AND g.id IS NULL
      LIMIT 500
    `)
    for (const r of stockMissingAccounting.rows) {
      findings.push({
        category: 'accounting',
        severity: 'high',
        title: `Missing accounting for stock movement`,
        message: `Stock movement for item "${r.item_name}" (${r.reference_type} ${r.reference_id}) has no GL entries`,
        entityType: 'stock_movement',
        entityId: r.id,
      })
    }

    // 17. Check for sales with auto-posting enabled but created before the start date
    const salesBeforeAutoPostingStart = await db.execute<{
      id: string; invoice_no: string; created_at: string
    }>(sql`
      SELECT s.id, s.invoice_no, s.created_at
      FROM sales s
      WHERE s.tenant_id = ${tenantId}
        AND s.status != 'void'
        AND s.is_return = false
        AND EXISTS (
          SELECT 1 FROM system_settings 
          WHERE tenant_id = ${tenantId} 
          AND key = 'auto_posting_start_date' 
          AND value::date > s.created_at::date
        )
      LIMIT 500
    `)
    for (const r of salesBeforeAutoPostingStart.rows) {
      findings.push({
        category: 'accounting',
        severity: 'medium',
        title: `Sale created before auto-posting start date: ${r.invoice_no}`,
        message: `Sale was created on ${r.created_at} which is before the auto-posting start date`,
        entityType: 'sale',
        entityId: r.id,
      })
    }

    return findings
  })
}
