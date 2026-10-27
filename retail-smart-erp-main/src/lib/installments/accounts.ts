/**
 * Ledger accounts used by hire purchase (drizzle/0186). Server-only.
 *
 * Account numbers differ by business type (4200 is "Hire Purchase Interest Income" for
 * electronics but "Online Sales Revenue" for retail), so an account is resolved by:
 *   1. a stable key in its description — `[hp:<key>]` — set when this module created it, then
 *   2. its name (the names the default chart seeds for electronics / hardware), then
 *   3. it is created (leaf under the usual parent group, first free number near the seeded one)
 *      and tagged with the key, so the next lookup is step 1.
 * A business may rename the account; renaming keeps the tag in the description and the link.
 */
import { and, eq, sql } from 'drizzle-orm'
import { accountingSettings, chartOfAccounts } from '@/lib/db/schema'
import type { DbTx } from '@/lib/inventory/db-types'

export type HpAccountKey =
  | 'interest_income'
  | 'late_fee_income'
  | 'installment_receivable'
  | 'bad_debts'
  | 'other_income'
  | 'retained_earnings'

interface AccountSpec {
  name: string
  rootType: 'asset' | 'liability' | 'income' | 'expense' | 'equity'
  accountType: 'income_account' | 'current_asset' | 'expense_account' | 'equity'
  /** name patterns (ILIKE) of an existing account to adopt */
  match: string[]
  /** preferred account numbers, then the parent group numbers */
  numbers: string[]
  parents: string[]
}

const SPECS: Record<HpAccountKey, AccountSpec> = {
  interest_income: {
    name: 'Hire Purchase Interest Income', rootType: 'income', accountType: 'income_account',
    match: ['%hire purchase interest%', '%installment interest%', '%HP interest%'],
    numbers: ['4200', '4220', '4250', '4260'], parents: ['4000'],
  },
  late_fee_income: {
    name: 'Installment Late Fee Income', rootType: 'income', accountType: 'income_account',
    match: ['%late fee%', '%late payment%', '%penalty income%'],
    numbers: ['4210', '4270', '4280'], parents: ['4000'],
  },
  installment_receivable: {
    name: 'Installment Receivable (Hire Purchase)', rootType: 'asset', accountType: 'current_asset',
    match: ['%installment receivable%', '%hire purchase receivable%', '%HP receivable%'],
    numbers: ['1180', '1185', '1190'], parents: ['1100', '1000'],
  },
  bad_debts: {
    name: 'Bad Debts (Hire Purchase)', rootType: 'expense', accountType: 'expense_account',
    match: ['%bad debt%', '%doubtful debt%'],
    numbers: ['5270', '5280', '5810'], parents: ['5200', '5000'],
  },
  other_income: {
    name: 'Other Income', rootType: 'income', accountType: 'income_account',
    match: ['other income', '%other income%', '%miscellaneous income%'],
    numbers: ['4300', '4310', '4900'], parents: ['4000'],
  },
  retained_earnings: {
    name: 'Retained Earnings', rootType: 'equity', accountType: 'equity',
    match: ['retained earnings', '%retained earning%', '%opening balance%'],
    numbers: ['3200', '3210', '3900'], parents: ['3000'],
  },
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export interface HpLedger {
  fiscalYearId: string
  costCenterId: string | null
  receivableId: string | null
  incomeId: string | null
  stockId: string | null
  writeOffId: string | null
}

/**
 * The tenant's accounting set-up, or null when accounting is not set up (no settings row): then
 * hire purchase posts nothing, like every other auto-posting. With settings but no fiscal year
 * it throws (the payment routes map it to a 400), the same rule as sale payments.
 */
export async function hpLedger(tx: DbTx, tenantId: string): Promise<HpLedger | null> {
  const [s] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  if (!s) return null
  if (!s.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }
  return {
    fiscalYearId: s.currentFiscalYearId,
    costCenterId: s.defaultCostCenterId || null,
    receivableId: s.defaultReceivableAccountId || null,
    incomeId: s.defaultIncomeAccountId || null,
    stockId: s.defaultStockAccountId || null,
    writeOffId: s.defaultWriteOffAccountId || null,
  }
}

/** Find (or create) the account for `key`; returns its id. */
export async function hpAccount(tx: DbTx, tenantId: string, key: HpAccountKey): Promise<string> {
  const spec = SPECS[key]
  const tag = `[hp:${key}]`
  const find = async (): Promise<string | null> => {
    const [byTag] = await tx.select({ id: chartOfAccounts.id }).from(chartOfAccounts).where(and(
      eq(chartOfAccounts.tenantId, tenantId),
      eq(chartOfAccounts.isGroup, false),
      eq(chartOfAccounts.isActive, true),
      sql`${chartOfAccounts.description} LIKE ${'%' + tag + '%'}`,
    )).limit(1)
    if (byTag) return byTag.id
    for (const pattern of spec.match) {
      const [byName] = await tx.select({ id: chartOfAccounts.id }).from(chartOfAccounts).where(and(
        eq(chartOfAccounts.tenantId, tenantId),
        eq(chartOfAccounts.isGroup, false),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.rootType} = ${spec.rootType}`,
        sql`${chartOfAccounts.name} ILIKE ${pattern}`,
      )).orderBy(chartOfAccounts.accountNumber).limit(1)
      if (byName) return byName.id
    }
    return null
  }
  const existing = await find()
  if (existing) return existing

  // one creator per tenant + key
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'hp_account:' + tenantId + ':' + key}))`)
  const again = await find()
  if (again) return again

  const groups = rowsOf<{ id: string; account_number: string }>(await tx.execute(sql`
    SELECT id, account_number FROM chart_of_accounts
    WHERE tenant_id = ${tenantId} AND is_group = true AND root_type = ${spec.rootType}
    ORDER BY (parent_id IS NULL) ASC, account_number
  `))
  const parent = spec.parents.map((n) => groups.find((g) => g.account_number === n)).find(Boolean)
    ?? groups[groups.length - 1] ?? null
  const used = new Set(rowsOf<{ account_number: string }>(await tx.execute(sql`
    SELECT account_number FROM chart_of_accounts WHERE tenant_id = ${tenantId}
  `)).map((r) => r.account_number))
  let number = spec.numbers.find((n) => !used.has(n))
  if (!number) {
    const base = Number(spec.numbers[0])
    for (let n = base + 1; n < base + 1000; n++) if (!used.has(String(n))) { number = String(n); break }
  }
  const [row] = await tx.insert(chartOfAccounts).values({
    tenantId,
    name: spec.name,
    accountNumber: number || `${spec.numbers[0]}-HP`,
    parentId: parent?.id ?? null,
    rootType: spec.rootType,
    accountType: spec.accountType,
    isGroup: false,
    description: `${tag} Created automatically for hire purchase postings`,
  }).returning({ id: chartOfAccounts.id })
  return row.id
}
