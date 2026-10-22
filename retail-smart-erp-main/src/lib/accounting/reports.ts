// Accounting report calculation logic
// All reports are computed from gl_entries table

import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm'
import { glEntries, chartOfAccounts } from '@/lib/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any

export interface TrialBalanceRow {
  accountId: string
  accountNumber: string
  accountName: string
  rootType: string
  openingDebit: number
  openingCredit: number
  periodDebit: number
  periodCredit: number
  closingDebit: number
  closingCredit: number
}

export interface ProfitAndLossRow {
  accountId: string
  accountNumber: string
  accountName: string
  rootType: string
  accountType: string
  amount: number // positive for income, negative for expense from P&L perspective
}

export interface BalanceSheetRow {
  accountId: string
  accountNumber: string
  accountName: string
  rootType: string
  accountType: string
  balance: number
}

/**
 * Trial Balance: For each account, shows opening balance, period movement, closing balance.
 * Opening = all entries before fromDate
 * Period = entries between fromDate and toDate
 * Closing = opening + period
 */
export async function getTrialBalance(
  db: DbInstance,
  tenantId: string,
  fromDate: string,
  toDate: string,
  costCenterId?: string
): Promise<TrialBalanceRow[]> {
  // All active ledger accounts, plus deactivated ones that still carry postings — dropping
  // those made the trial balance stop balancing as soon as a used account was deactivated.
  const accounts = await db.select({
    id: chartOfAccounts.id,
    accountNumber: chartOfAccounts.accountNumber,
    name: chartOfAccounts.name,
    rootType: chartOfAccounts.rootType,
  })
    .from(chartOfAccounts)
    .where(and(
      eq(chartOfAccounts.tenantId, tenantId),
      eq(chartOfAccounts.isGroup, false),
      sql`(${chartOfAccounts.isActive} = true OR EXISTS (
        SELECT 1 FROM gl_entries g WHERE g.account_id = ${chartOfAccounts.id} AND g.posting_date <= ${toDate}
      ))`,
    ))
    .orderBy(chartOfAccounts.accountNumber)

  if (accounts.length === 0) return []

  const accountIds = accounts.map((a: { id: string }) => a.id)

  // Opening balances (before fromDate)
  const openingConditions = [
    eq(glEntries.tenantId, tenantId),
    sql`${glEntries.postingDate} < ${fromDate}`,
    inArray(glEntries.accountId, accountIds),
  ]
  if (costCenterId) openingConditions.push(eq(glEntries.costCenterId, costCenterId))

  const openingQuery = await db.select({
    accountId: glEntries.accountId,
    totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
    totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
  })
    .from(glEntries)
    .where(and(...openingConditions))
    .groupBy(glEntries.accountId)

  // Period balances
  const periodConditions = [
    eq(glEntries.tenantId, tenantId),
    gte(glEntries.postingDate, fromDate),
    lte(glEntries.postingDate, toDate),
    inArray(glEntries.accountId, accountIds),
  ]
  if (costCenterId) periodConditions.push(eq(glEntries.costCenterId, costCenterId))

  const periodQuery = await db.select({
    accountId: glEntries.accountId,
    totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
    totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
  })
    .from(glEntries)
    .where(and(...periodConditions))
    .groupBy(glEntries.accountId)

  // Build lookup maps
  type BalanceEntry = { accountId: string; totalDebit: string; totalCredit: string }
  const zeroEntry: BalanceEntry = { accountId: '', totalDebit: '0', totalCredit: '0' }
  const openingMap = new Map<string, BalanceEntry>(openingQuery.map((r: BalanceEntry) => [r.accountId, r]))
  const periodMap = new Map<string, BalanceEntry>(periodQuery.map((r: BalanceEntry) => [r.accountId, r]))

  const rows: TrialBalanceRow[] = []

  for (const account of accounts) {
    const opening = openingMap.get(account.id) || zeroEntry
    const period = periodMap.get(account.id) || zeroEntry

    const openingDebit = Number(opening.totalDebit)
    const openingCredit = Number(opening.totalCredit)
    const periodDebit = Number(period.totalDebit)
    const periodCredit = Number(period.totalCredit)

    // Fix #7: Include all accounts in trial balance per accounting standards,
    // even those with zero balances (previously excluded)

    // Calculate NET balances for proper trial balance presentation
    // Opening and closing show net balance (debit OR credit, not both)
    // Period shows gross movements (both debit and credit)
    const netOpening = Math.round((openingDebit - openingCredit) * 100) / 100
    const netClosing = Math.round((netOpening + periodDebit - periodCredit) * 100) / 100

    rows.push({
      accountId: account.id,
      accountNumber: account.accountNumber,
      accountName: account.name,
      rootType: account.rootType,
      openingDebit: netOpening > 0 ? netOpening : 0,
      openingCredit: netOpening < 0 ? Math.abs(netOpening) : 0,
      periodDebit,
      periodCredit,
      closingDebit: netClosing > 0 ? netClosing : 0,
      closingCredit: netClosing < 0 ? Math.abs(netClosing) : 0,
    })
  }

  return rows
}

/**
 * Profit & Loss: Shows income and expense accounts for a period.
 * Income accounts have natural credit balances (shown as positive).
 * Expense accounts have natural debit balances (shown as positive).
 */
export async function getProfitAndLoss(
  db: DbInstance,
  tenantId: string,
  fromDate: string,
  toDate: string,
  costCenterId?: string
): Promise<{
  income: ProfitAndLossRow[]
  expenses: ProfitAndLossRow[]
  totalIncome: number
  totalExpenses: number
  netProfit: number
}> {
  const result = await db.select({
    accountId: glEntries.accountId,
    accountNumber: chartOfAccounts.accountNumber,
    accountName: chartOfAccounts.name,
    rootType: chartOfAccounts.rootType,
    accountType: chartOfAccounts.accountType,
    totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
    totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
  })
    .from(glEntries)
    .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
    .where(and(
      eq(glEntries.tenantId, tenantId),
      gte(glEntries.postingDate, fromDate),
      lte(glEntries.postingDate, toDate),
      sql`${chartOfAccounts.rootType} IN ('income', 'expense')`,
      // Period-closing vouchers zero income/expense into retained earnings; counting them made
      // the P&L of a closed year (and the voucher's own stored net profit) read 0.
      sql`${glEntries.voucherType} <> 'period_closing'`,
      ...(costCenterId ? [eq(glEntries.costCenterId, costCenterId)] : []),
    ))
    .groupBy(glEntries.accountId, chartOfAccounts.accountNumber, chartOfAccounts.name, chartOfAccounts.rootType, chartOfAccounts.accountType)
    .orderBy(chartOfAccounts.accountNumber)

  const income: ProfitAndLossRow[] = []
  const expenses: ProfitAndLossRow[] = []
  let totalIncome = 0
  let totalExpenses = 0

  for (const row of result) {
    const debit = Number(row.totalDebit)
    const credit = Number(row.totalCredit)

    if (row.rootType === 'income') {
      const amount = Math.round((credit - debit) * 100) / 100 // Natural credit balance
      income.push({
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        rootType: row.rootType,
        accountType: row.accountType,
        amount,
      })
      totalIncome += amount
    } else if (row.rootType === 'expense') {
      const amount = Math.round((debit - credit) * 100) / 100 // Natural debit balance
      expenses.push({
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        rootType: row.rootType,
        accountType: row.accountType,
        amount,
      })
      totalExpenses += amount
    }
  }

  return {
    income,
    expenses,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    netProfit: Math.round((totalIncome - totalExpenses) * 100) / 100,
  }
}

/**
 * Balance Sheet: Shows asset, liability, and equity balances as of a date.
 * Also includes net profit from P&L (beginning of fiscal year to asOfDate).
 */
export async function getBalanceSheet(
  db: DbInstance,
  tenantId: string,
  asOfDate: string,
  fiscalYearStartDate?: string,
  costCenterId?: string
): Promise<{
  assets: BalanceSheetRow[]
  liabilities: BalanceSheetRow[]
  equity: BalanceSheetRow[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  netProfit: number
}> {
  const result = await db.select({
    accountId: glEntries.accountId,
    accountNumber: chartOfAccounts.accountNumber,
    accountName: chartOfAccounts.name,
    rootType: chartOfAccounts.rootType,
    accountType: chartOfAccounts.accountType,
    totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
    totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
  })
    .from(glEntries)
    .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
    .where(and(
      eq(glEntries.tenantId, tenantId),
      lte(glEntries.postingDate, asOfDate),
      sql`${chartOfAccounts.rootType} IN ('asset', 'liability', 'equity')`,
      ...(costCenterId ? [eq(glEntries.costCenterId, costCenterId)] : []),
    ))
    .groupBy(glEntries.accountId, chartOfAccounts.accountNumber, chartOfAccounts.name, chartOfAccounts.rootType, chartOfAccounts.accountType)
    .orderBy(chartOfAccounts.accountNumber)

  const assets: BalanceSheetRow[] = []
  const liabilities: BalanceSheetRow[] = []
  const equity: BalanceSheetRow[] = []
  let totalAssets = 0
  let totalLiabilities = 0
  let totalEquity = 0

  for (const row of result) {
    const debit = Number(row.totalDebit)
    const credit = Number(row.totalCredit)

    if (row.rootType === 'asset') {
      const balance = Math.round((debit - credit) * 100) / 100 // Natural debit balance
      assets.push({
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        rootType: row.rootType,
        accountType: row.accountType,
        balance,
      })
      totalAssets += balance
    } else if (row.rootType === 'liability') {
      const balance = Math.round((credit - debit) * 100) / 100 // Natural credit balance
      liabilities.push({
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        rootType: row.rootType,
        accountType: row.accountType,
        balance,
      })
      totalLiabilities += balance
    } else if (row.rootType === 'equity') {
      const balance = Math.round((credit - debit) * 100) / 100 // Natural credit balance
      equity.push({
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        rootType: row.rootType,
        accountType: row.accountType,
        balance,
      })
      totalEquity += balance
    }
  }

  // Profit not yet closed into equity: ALL income/expense postings up to asOfDate, including
  // period-closing vouchers (which net closed years to zero). Restricting this to the current
  // fiscal year dropped prior unclosed years' profit (and any comparison date before the current
  // year start), so the balance sheet did not balance.
  void fiscalYearStartDate
  const [pl] = await db.select({
    income: sql<string>`COALESCE(SUM(CASE WHEN ${chartOfAccounts.rootType} = 'income' THEN CAST(${glEntries.credit} AS numeric) - CAST(${glEntries.debit} AS numeric) ELSE 0 END), 0)`,
    expense: sql<string>`COALESCE(SUM(CASE WHEN ${chartOfAccounts.rootType} = 'expense' THEN CAST(${glEntries.debit} AS numeric) - CAST(${glEntries.credit} AS numeric) ELSE 0 END), 0)`,
  })
    .from(glEntries)
    .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
    .where(and(
      eq(glEntries.tenantId, tenantId),
      lte(glEntries.postingDate, asOfDate),
      sql`${chartOfAccounts.rootType} IN ('income', 'expense')`,
      ...(costCenterId ? [eq(glEntries.costCenterId, costCenterId)] : []),
    ))
  const netProfit = Math.round((Number(pl?.income || 0) - Number(pl?.expense || 0)) * 100) / 100

  return {
    assets,
    liabilities,
    equity,
    totalAssets: Math.round(totalAssets * 100) / 100,
    totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    totalEquity: Math.round(totalEquity * 100) / 100,
    netProfit,
  }
}

/**
 * General Ledger detail: All entries for an account in a date range.
 */
export async function getGeneralLedgerDetail(
  db: DbInstance,
  tenantId: string,
  filters: {
    accountId?: string
    fromDate?: string
    toDate?: string
    partyType?: string
    partyId?: string
    voucherType?: string
    costCenterId?: string
    page?: number
    pageSize?: number
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: Record<string, any>[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const { accountId, fromDate, toDate, partyType, partyId, voucherType, costCenterId, page = 1, pageSize = 50 } = filters

  const conditions = [eq(glEntries.tenantId, tenantId)]

  if (accountId) conditions.push(eq(glEntries.accountId, accountId))
  if (fromDate) conditions.push(gte(glEntries.postingDate, fromDate))
  if (toDate) conditions.push(lte(glEntries.postingDate, toDate))
  if (partyType) conditions.push(sql`${glEntries.partyType} = ${partyType}`)
  if (partyId) conditions.push(eq(glEntries.partyId, partyId))
  if (voucherType) conditions.push(eq(glEntries.voucherType, voucherType))
  if (costCenterId) conditions.push(eq(glEntries.costCenterId, costCenterId))

  // Count total
  const [{ count }] = await db.select({
    count: sql<number>`COUNT(*)::int`,
  })
    .from(glEntries)
    .where(and(...conditions))

  const total = count
  const totalPages = Math.ceil(total / pageSize)
  const offset = (page - 1) * pageSize

  // Fetch entries with account info
  const data = await db.select({
    id: glEntries.id,
    postingDate: glEntries.postingDate,
    accountId: glEntries.accountId,
    accountNumber: chartOfAccounts.accountNumber,
    accountName: chartOfAccounts.name,
    debit: glEntries.debit,
    credit: glEntries.credit,
    partyType: glEntries.partyType,
    partyId: glEntries.partyId,
    voucherType: glEntries.voucherType,
    voucherId: glEntries.voucherId,
    voucherNumber: glEntries.voucherNumber,
    costCenterId: glEntries.costCenterId,
    remarks: glEntries.remarks,
    createdAt: glEntries.createdAt,
  })
    .from(glEntries)
    .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
    .where(and(...conditions))
    .orderBy(sql`${glEntries.postingDate} DESC, ${glEntries.createdAt} DESC`)
    .limit(pageSize)
    .offset(offset)

  return {
    data,
    pagination: { page, pageSize, total, totalPages },
  }
}
