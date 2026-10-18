import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { chartOfAccounts, accountingSettings, modesOfPayment } from '@/lib/db/schema'
import { sql, isNotNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { getChartOfAccountsForBusinessType, SYSTEM_ACCOUNT_DEFAULTS, type AccountTemplate } from '@/lib/accounting/default-coa'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'

export async function POST(_request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const tenantId = session!.user.tenantId

    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError

    return await withTenant(tenantId, async (db) => {
      // Check if chart of accounts already has entries for this tenant
      const [{ totalCount }] = await db
        .select({ totalCount: sql<number>`count(*)::int` })
        .from(chartOfAccounts)

      const [{ childCount }] = await db
        .select({ childCount: sql<number>`count(*)::int` })
        .from(chartOfAccounts)
        .where(isNotNull(chartOfAccounts.parentId))

      const total = Number(totalCount)
      const children = Number(childCount)

      // If fully seeded (has child accounts), skip
      if (total > 0 && children > 0) {
        return NextResponse.json({
          message: 'Accounting is already set up for this tenant',
          alreadySetup: true,
        })
      }

      // If partially seeded (only root groups, no children), delete and re-seed
      if (total > 0 && children === 0) {
        // Delete existing incomplete accounts and settings
        await db.delete(accountingSettings)
        await db.delete(modesOfPayment)
        await db.delete(chartOfAccounts)
      }

      // Seed chart of accounts from business-type-specific template
      const businessType = session!.user.businessType || 'retail'
      const template = getChartOfAccountsForBusinessType(businessType)
      const accountNumberToId = new Map<string, string>()

      // Recursive function to insert accounts with correct parentId linkage
      async function insertAccounts(accounts: AccountTemplate[], parentId: string | null) {
        for (const account of accounts) {
          const [inserted] = await db.insert(chartOfAccounts).values({
            tenantId,
            name: account.name,
            accountNumber: account.accountNumber,
            rootType: account.rootType,
            accountType: account.accountType as typeof chartOfAccounts.$inferInsert['accountType'],
            isGroup: account.isGroup,
            isSystemAccount: account.isSystemAccount,
            parentId,
          }).returning()

          accountNumberToId.set(account.accountNumber, inserted.id)

          // Recursively insert children
          if (account.children && account.children.length > 0) {
            await insertAccounts(account.children, inserted.id)
          }
        }
      }

      await insertAccounts(template, null)

      // Create accounting settings with system account defaults mapped via account numbers
      const settingsData: Record<string, unknown> = {
        tenantId,
      }

      for (const [settingKey, accountNumber] of Object.entries(SYSTEM_ACCOUNT_DEFAULTS)) {
        const accountId = accountNumberToId.get(accountNumber)
        if (accountId) {
          settingsData[settingKey] = accountId
        }
      }

      // Auto-enable journal posting for sales and purchases
      settingsData.autoPostSales = true
      settingsData.autoPostPurchases = true

      const [settings] = await db.insert(accountingSettings).values(settingsData as typeof accountingSettings.$inferInsert).returning()

      // Seed default modes of payment
      const defaultModes = [
        { name: 'Cash', type: 'cash' as const, sortOrder: 1 },
        { name: 'Bank Transfer', type: 'bank' as const, sortOrder: 2 },
        { name: 'Credit Card', type: 'bank' as const, sortOrder: 3 },
        { name: 'Cheque', type: 'bank' as const, sortOrder: 4 },
      ]

      // Map modes to default accounts where possible
      const cashAccountId = accountNumberToId.get('1110') || null // Cash account
      const bankAccountId = accountNumberToId.get('1120') || null // Bank Accounts group (individual bank COA entries are created when bank accounts are added)

      for (const mode of defaultModes) {
        await db.insert(modesOfPayment).values({
          tenantId,
          name: mode.name,
          type: mode.type,
          defaultAccountId: mode.type === 'cash' ? cashAccountId : bankAccountId,
          isEnabled: true,
          sortOrder: mode.sortOrder,
        })
      }

      logAndBroadcast(tenantId, 'account', 'created', settings.id)

      return NextResponse.json({
        message: 'Accounting setup completed successfully',
        accountsCreated: accountNumberToId.size,
        settingsId: settings.id,
      })
    })
  } catch (error) {
    logError('api/accounting/setup', error)
    return NextResponse.json({ error: 'Failed to set up accounting' }, { status: 500 })
  }
}
