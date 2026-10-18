import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { glEntries, chartOfAccounts } from '@/lib/db/schema'
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { cashFlowQuerySchema } from '@/lib/validation/schemas/accounting'

// Human-readable labels for voucher types
const VOUCHER_TYPE_LABELS: Record<string, string> = {
  sale: 'Cash from Sales',
  purchase: 'Cash paid for Purchases',
  payment: 'Cash Payments',
  refund: 'Cash Refunds',
  journal: 'Journal Entries',
  journal_entry: 'Journal Entries',
}

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, cashFlowQuerySchema)
    if (!parsed.success) return parsed.response
    const { fromDate, toDate } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const tenantId = session.user.tenantId

      // Step 1: Find all cash and bank accounts for this tenant
      const cashBankAccounts = await db.select({
        id: chartOfAccounts.id,
        accountType: chartOfAccounts.accountType,
      })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.tenantId, tenantId),
          sql`${chartOfAccounts.accountType} IN ('cash', 'bank')`,
          eq(chartOfAccounts.isActive, true),
        ))

      if (cashBankAccounts.length === 0) {
        return NextResponse.json({
          operating: { items: [], total: 0 },
          investing: { items: [], total: 0 },
          financing: { items: [], total: 0 },
          netCashFlow: 0,
          openingBalance: 0,
          closingBalance: 0,
          filters: { fromDate, toDate },
        })
      }

      const cashBankAccountIds = cashBankAccounts.map((a) => a.id)

      // Step 2: Calculate opening balance (all cash/bank entries before fromDate)
      // Debit on cash/bank = money in (positive), Credit = money out (negative)
      const [openingResult] = await db.select({
        totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
      })
        .from(glEntries)
        .where(and(
          eq(glEntries.tenantId, tenantId),
          inArray(glEntries.accountId, cashBankAccountIds),
          sql`${glEntries.postingDate} < ${fromDate}`,
        ))

      const openingBalance = Math.round(
        (Number(openingResult.totalDebit) - Number(openingResult.totalCredit)) * 100
      ) / 100

      // Step 3: Identify investing activity entries -- cash/bank entries whose
      // voucher also has a counterpart on a fixed_asset / CWIP / depreciation account.
      // We find voucher IDs that touch investing accounts, then sum cash/bank entries for those vouchers.
      const investingVoucherIds = await db.select({
        voucherId: glEntries.voucherId,
      })
        .from(glEntries)
        .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
        .where(and(
          eq(glEntries.tenantId, tenantId),
          gte(glEntries.postingDate, fromDate),
          lte(glEntries.postingDate, toDate),
          sql`${chartOfAccounts.accountType} IN ('fixed_asset', 'capital_work_in_progress', 'accumulated_depreciation')`,
        ))
        .groupBy(glEntries.voucherId)

      let investingTotal = 0
      const investingItems: { label: string; amount: number }[] = []

      if (investingVoucherIds.length > 0) {
        const investVoucherIdList = investingVoucherIds.map((v) => v.voucherId)

        const [investingResult] = await db.select({
          totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
        })
          .from(glEntries)
          .where(and(
            eq(glEntries.tenantId, tenantId),
            inArray(glEntries.accountId, cashBankAccountIds),
            inArray(glEntries.voucherId, investVoucherIdList),
            gte(glEntries.postingDate, fromDate),
            lte(glEntries.postingDate, toDate),
          ))

        const investDebit = Number(investingResult.totalDebit)
        const investCredit = Number(investingResult.totalCredit)
        investingTotal = Math.round((investDebit - investCredit) * 100) / 100

        if (investingTotal !== 0) {
          investingItems.push({
            label: investingTotal >= 0 ? 'Proceeds from Asset Sales' : 'Purchase of Fixed Assets',
            amount: investingTotal,
          })
        }
      }

      // Step 4: Identify financing activity entries -- cash/bank entries whose
      // voucher also has a counterpart on an equity account or loan-related account.
      const investVoucherIdSet = new Set(investingVoucherIds.map((v) => v.voucherId))

      const financingVoucherIdsRaw = await db.select({
        voucherId: glEntries.voucherId,
      })
        .from(glEntries)
        .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
        .where(and(
          eq(glEntries.tenantId, tenantId),
          gte(glEntries.postingDate, fromDate),
          lte(glEntries.postingDate, toDate),
          sql`(${chartOfAccounts.rootType} = 'equity' OR ${chartOfAccounts.accountType} = 'equity')`,
        ))
        .groupBy(glEntries.voucherId)

      // Exclude vouchers already classified as investing to prevent double-counting
      const financingVoucherIds = financingVoucherIdsRaw.filter((v) => !investVoucherIdSet.has(v.voucherId))

      let financingTotal = 0
      const financingItems: { label: string; amount: number }[] = []

      if (financingVoucherIds.length > 0) {
        const finVoucherIdList = financingVoucherIds.map((v) => v.voucherId)

        const [financingResult] = await db.select({
          totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
        })
          .from(glEntries)
          .where(and(
            eq(glEntries.tenantId, tenantId),
            inArray(glEntries.accountId, cashBankAccountIds),
            inArray(glEntries.voucherId, finVoucherIdList),
            gte(glEntries.postingDate, fromDate),
            lte(glEntries.postingDate, toDate),
          ))

        const finDebit = Number(financingResult.totalDebit)
        const finCredit = Number(financingResult.totalCredit)
        financingTotal = Math.round((finDebit - finCredit) * 100) / 100

        if (financingTotal !== 0) {
          financingItems.push({
            label: financingTotal >= 0 ? 'Capital / Equity Inflows' : 'Capital / Equity Withdrawals',
            amount: financingTotal,
          })
        }
      }

      // Step 5: Build operating activities from period entries,
      // excluding vouchers already classified as investing or financing.
      const financingVoucherIdSet = new Set(financingVoucherIds.map((v) => v.voucherId))
      const excludedVoucherIds = [...investVoucherIdSet, ...financingVoucherIdSet]

      // Re-query operating entries excluding investing/financing vouchers
      const operatingConditions = [
        eq(glEntries.tenantId, tenantId),
        inArray(glEntries.accountId, cashBankAccountIds),
        gte(glEntries.postingDate, fromDate),
        lte(glEntries.postingDate, toDate),
      ]

      if (excludedVoucherIds.length > 0) {
        operatingConditions.push(
          sql`${glEntries.voucherId} NOT IN (${sql.join(excludedVoucherIds.map(id => sql`${id}`), sql`, `)})`
        )
      }

      const operatingEntries = await db.select({
        voucherType: glEntries.voucherType,
        totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
      })
        .from(glEntries)
        .where(and(...operatingConditions))
        .groupBy(glEntries.voucherType)

      const operatingItems: { label: string; amount: number }[] = []
      let operatingTotal = 0

      for (const entry of operatingEntries) {
        const debit = Number(entry.totalDebit)
        const credit = Number(entry.totalCredit)
        // Debit on cash/bank = inflow (positive), Credit = outflow (negative)
        const netAmount = Math.round((debit - credit) * 100) / 100

        if (netAmount === 0) continue

        const label = VOUCHER_TYPE_LABELS[entry.voucherType] || `Cash from ${entry.voucherType}`
        operatingItems.push({ label, amount: netAmount })
        operatingTotal += netAmount
      }

      operatingTotal = Math.round(operatingTotal * 100) / 100

      // Step 6: Calculate net cash flow and closing balance
      const netCashFlow = Math.round((operatingTotal + investingTotal + financingTotal) * 100) / 100
      const closingBalance = Math.round((openingBalance + netCashFlow) * 100) / 100

      return NextResponse.json({
        operating: {
          items: operatingItems,
          total: operatingTotal,
        },
        investing: {
          items: investingItems,
          total: investingTotal,
        },
        financing: {
          items: financingItems,
          total: financingTotal,
        },
        netCashFlow,
        openingBalance,
        closingBalance,
        filters: { fromDate, toDate },
      })
    })
  } catch (error) {
    logError('api/accounting/reports/cash-flow', error)
    return NextResponse.json({ error: 'Failed to generate cash flow report' }, { status: 500 })
  }
}
