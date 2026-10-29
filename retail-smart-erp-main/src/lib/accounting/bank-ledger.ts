import { and, asc, eq } from 'drizzle-orm'
import { accountingSettings, chartOfAccounts } from '@/lib/db/schema'

/**
 * The ledger (non-group) account card / bank transfer / cheque payments post to: the first ledger
 * under the "Bank Accounts" group (#1120), or a new "Main Bank Account" ledger created under it.
 * Postings to the group itself are refused by the GL ("Cannot post to group account"), so payment
 * modes and the default bank account must never point at the group (see migration 0188).
 * Also points accounting_settings.default_bank_account_id at it when that is empty or the group.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureBankLedger(tx: any, tenantId: string): Promise<string | null> {
  const group = await tx.query.chartOfAccounts.findFirst({
    where: and(eq(chartOfAccounts.tenantId, tenantId), eq(chartOfAccounts.accountNumber, '1120')),
  })
  if (!group) return null
  if (!group.isGroup) return group.id
  let leaf = await tx.query.chartOfAccounts.findFirst({
    where: and(eq(chartOfAccounts.tenantId, tenantId), eq(chartOfAccounts.parentId, group.id), eq(chartOfAccounts.isGroup, false)),
    orderBy: [asc(chartOfAccounts.accountNumber)],
  })
  if (!leaf) {
    let num = 1121
    while (await tx.query.chartOfAccounts.findFirst({ where: and(eq(chartOfAccounts.tenantId, tenantId), eq(chartOfAccounts.accountNumber, String(num))), columns: { id: true } })) num++
    ;[leaf] = await tx.insert(chartOfAccounts).values({
      tenantId,
      name: 'Main Bank Account',
      accountNumber: String(num),
      rootType: group.rootType,
      accountType: group.accountType,
      isGroup: false,
      isSystemAccount: false,
      parentId: group.id,
    }).returning()
  }
  const settings = await tx.query.accountingSettings.findFirst({ where: eq(accountingSettings.tenantId, tenantId), columns: { id: true, defaultBankAccountId: true } })
  if (settings && (!settings.defaultBankAccountId || settings.defaultBankAccountId === group.id)) {
    await tx.update(accountingSettings).set({ defaultBankAccountId: leaf.id }).where(eq(accountingSettings.id, settings.id))
  }
  return leaf.id
}
