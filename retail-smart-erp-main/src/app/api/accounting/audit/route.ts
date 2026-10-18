import { NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { sql } from 'drizzle-orm'

export async function GET() {
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const tenantId = session.user.tenantId
    const checks: {
      name: string
      status: 'pass' | 'warn' | 'fail'
      message: string
      details?: unknown
    }[] = []

    // 1. Debit/Credit Balance Check - total debits must equal total credits
    try {
      const balanceResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(debit::numeric), 0) as total_debit,
          COALESCE(SUM(credit::numeric), 0) as total_credit,
          COALESCE(SUM(debit::numeric), 0) - COALESCE(SUM(credit::numeric), 0) as imbalance
        FROM gl_entries
        WHERE tenant_id = ${tenantId}
      `)
      const balanceCheck = (balanceResult as { rows?: Record<string, unknown>[] }).rows?.[0]
      const imbalance = parseFloat(String(balanceCheck?.imbalance || '0'))
      const totalDebit = parseFloat(String(balanceCheck?.total_debit || '0'))
      const totalCredit = parseFloat(String(balanceCheck?.total_credit || '0'))

      checks.push({
        name: 'Debit/Credit Balance',
        status: Math.abs(imbalance) < 0.01 ? 'pass' : 'fail',
        message: Math.abs(imbalance) < 0.01
          ? `Balanced. Total debits: ${totalDebit.toLocaleString()}, Total credits: ${totalCredit.toLocaleString()}`
          : `IMBALANCED by ${imbalance.toLocaleString()}. Total debits: ${totalDebit.toLocaleString()}, Total credits: ${totalCredit.toLocaleString()}`,
        details: { totalDebit, totalCredit, imbalance },
      })
    } catch {
      checks.push({ name: 'Debit/Credit Balance', status: 'fail', message: 'Failed to check' })
    }

    // 2. Account Balance Consistency - compare running balance with GL sum
    try {
      const inconsistencies = await db.execute(sql`
        SELECT
          coa.id,
          coa.account_number,
          coa.name,
          coa.balance as running_balance,
          COALESCE(SUM(gl.debit::numeric), 0) - COALESCE(SUM(gl.credit::numeric), 0) as calculated_balance,
          coa.balance::numeric - (COALESCE(SUM(gl.debit::numeric), 0) - COALESCE(SUM(gl.credit::numeric), 0)) as drift
        FROM chart_of_accounts coa
        LEFT JOIN gl_entries gl ON gl.account_id = coa.id
        WHERE coa.tenant_id = ${tenantId} AND coa.is_group = false
        GROUP BY coa.id, coa.account_number, coa.name, coa.balance
        HAVING ABS(coa.balance::numeric - (COALESCE(SUM(gl.debit::numeric), 0) - COALESCE(SUM(gl.credit::numeric), 0))) > 0.01
        ORDER BY ABS(coa.balance::numeric - (COALESCE(SUM(gl.debit::numeric), 0) - COALESCE(SUM(gl.credit::numeric), 0))) DESC
        LIMIT 20
      `)

      const rows = inconsistencies.rows || []
      checks.push({
        name: 'Account Balance Consistency',
        status: rows.length === 0 ? 'pass' : 'warn',
        message: rows.length === 0
          ? 'All account balances match GL entry sums'
          : `${rows.length} account(s) have balance drift`,
        details: rows.length > 0 ? rows.slice(0, 10).map((r: Record<string, unknown>) => ({
          accountNumber: r.account_number,
          name: r.name,
          runningBalance: r.running_balance,
          calculatedBalance: r.calculated_balance,
          drift: r.drift,
        })) : undefined,
      })
    } catch {
      checks.push({ name: 'Account Balance Consistency', status: 'fail', message: 'Failed to check' })
    }

    // 3. Unposted Sales - completed sales without GL entries
    try {
      const unpostedSalesRes = await db.execute(sql`
        SELECT count(*)::int as count
        FROM sales s
        WHERE s.tenant_id = ${tenantId}
          AND s.status = 'completed'
          AND NOT EXISTS (
            SELECT 1 FROM gl_entries gl
            WHERE gl.voucher_id = s.id
            AND gl.voucher_type = 'sale'
          )
      `)
      const unpostedSales = (unpostedSalesRes as { rows?: Record<string, unknown>[] }).rows?.[0]

      const count = Number(unpostedSales?.count || 0)
      checks.push({
        name: 'Unposted Sales',
        status: count === 0 ? 'pass' : 'warn',
        message: count === 0
          ? 'All completed sales have GL entries'
          : `${count} completed sale(s) without GL entries`,
      })
    } catch {
      checks.push({ name: 'Unposted Sales', status: 'fail', message: 'Failed to check' })
    }

    // 4. Unposted Purchases - submitted purchases without GL entries
    try {
      const unpostedPurchasesRes = await db.execute(sql`
        SELECT count(*)::int as count
        FROM purchases p
        WHERE p.tenant_id = ${tenantId}
          AND p.status NOT IN ('cancelled', 'draft')
          AND NOT EXISTS (
            SELECT 1 FROM gl_entries gl
            WHERE gl.voucher_id = p.id
            AND gl.voucher_type = 'purchase'
          )
      `)
      const unpostedPurchases = (unpostedPurchasesRes as { rows?: Record<string, unknown>[] }).rows?.[0]

      const count = Number(unpostedPurchases?.count || 0)
      checks.push({
        name: 'Unposted Purchases',
        status: count === 0 ? 'pass' : 'warn',
        message: count === 0
          ? 'All submitted purchases have GL entries'
          : `${count} submitted purchase(s) without GL entries`,
      })
    } catch {
      checks.push({ name: 'Unposted Purchases', status: 'fail', message: 'Failed to check' })
    }

    // 5. Missing System Accounts - check all required default accounts
    try {
      const settingsRes = await db.execute(sql`
        SELECT
          default_cash_account_id,
          default_bank_account_id,
          default_receivable_account_id,
          default_payable_account_id,
          default_income_account_id,
          default_cogs_account_id,
          default_stock_account_id,
          default_tax_account_id,
          default_round_off_account_id,
          default_stock_adjustment_account_id,
          default_wip_account_id,
          auto_post_sales,
          auto_post_purchases
        FROM accounting_settings
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `)
      const settings = (settingsRes as { rows?: Record<string, unknown>[] }).rows?.[0]

      if (!settings) {
        checks.push({
          name: 'System Account Configuration',
          status: 'fail',
          message: 'No accounting settings found. Run setup wizard.',
        })
      } else {
        const required = [
          { key: 'default_cash_account_id', label: 'Cash' },
          { key: 'default_bank_account_id', label: 'Bank' },
          { key: 'default_receivable_account_id', label: 'Receivable' },
          { key: 'default_payable_account_id', label: 'Payable' },
          { key: 'default_income_account_id', label: 'Income' },
          { key: 'default_cogs_account_id', label: 'COGS' },
          { key: 'default_stock_account_id', label: 'Stock' },
          { key: 'default_tax_account_id', label: 'Tax' },
        ]
        const missing = required.filter(r => !(settings as Record<string, unknown>)[r.key])

        checks.push({
          name: 'System Account Configuration',
          status: missing.length === 0 ? 'pass' : 'fail',
          message: missing.length === 0
            ? 'All required system accounts configured'
            : `Missing: ${missing.map(m => m.label).join(', ')}`,
          details: {
            autoPostSales: (settings as Record<string, unknown>).auto_post_sales,
            autoPostPurchases: (settings as Record<string, unknown>).auto_post_purchases,
            missing: missing.map(m => m.label),
          },
        })
      }
    } catch {
      checks.push({ name: 'System Account Configuration', status: 'fail', message: 'Failed to check' })
    }

    // 6. Cost Center Coverage
    try {
      const salesCoverageRes = await db.execute(sql`
        SELECT
          count(*)::int as total,
          count(cost_center_id)::int as with_cost_center
        FROM sales
        WHERE tenant_id = ${tenantId} AND status = 'completed'
      `)
      const salesCoverage = (salesCoverageRes as { rows?: Record<string, unknown>[] }).rows?.[0]

      const total = Number(salesCoverage?.total || 0)
      const withCC = Number(salesCoverage?.with_cost_center || 0)
      const pct = total > 0 ? Math.round((withCC / total) * 100) : 100

      checks.push({
        name: 'Cost Center Coverage (Sales)',
        status: pct >= 80 ? 'pass' : pct >= 50 ? 'warn' : 'fail',
        message: `${pct}% of completed sales have cost centers assigned (${withCC}/${total})`,
      })
    } catch {
      checks.push({ name: 'Cost Center Coverage (Sales)', status: 'fail', message: 'Failed to check' })
    }

    // 7. Orphaned GL Entries
    try {
      const orphanedResults = await db.execute(sql`
        SELECT voucher_type, count(DISTINCT voucher_id)::int as count
        FROM gl_entries
        WHERE tenant_id = ${tenantId}
          AND voucher_type = 'sale'
          AND voucher_id NOT IN (SELECT id FROM sales WHERE tenant_id = ${tenantId})
        GROUP BY voucher_type
        UNION ALL
        SELECT voucher_type, count(DISTINCT voucher_id)::int as count
        FROM gl_entries
        WHERE tenant_id = ${tenantId}
          AND voucher_type = 'purchase'
          AND voucher_id NOT IN (SELECT id FROM purchases WHERE tenant_id = ${tenantId})
        GROUP BY voucher_type
      `)

      const orphanRows = orphanedResults.rows || []
      const totalOrphaned = orphanRows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.count || 0), 0)

      checks.push({
        name: 'Orphaned GL Entries',
        status: totalOrphaned === 0 ? 'pass' : 'warn',
        message: totalOrphaned === 0
          ? 'No orphaned GL entries found'
          : `${totalOrphaned} GL entries reference deleted documents`,
        details: totalOrphaned > 0 ? orphanRows : undefined,
      })
    } catch {
      checks.push({ name: 'Orphaned GL Entries', status: 'fail', message: 'Failed to check' })
    }

    // Summary
    const passCount = checks.filter(c => c.status === 'pass').length
    const warnCount = checks.filter(c => c.status === 'warn').length
    const failCount = checks.filter(c => c.status === 'fail').length

    return {
      checks,
      summary: {
        total: checks.length,
        pass: passCount,
        warn: warnCount,
        fail: failCount,
        overallStatus: failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass',
      },
      auditedAt: new Date().toISOString(),
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(result)
}
