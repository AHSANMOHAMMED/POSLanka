import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { bankAccounts, chartOfAccounts, accountingSettings } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { bankAccountsListSchema, createBankAccountSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, bankAccountsListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // All mode: return flat list (for dropdowns)
      if (all) {
        const accounts = await db
          .select()
          .from(bankAccounts)
          .orderBy(desc(bankAccounts.createdAt))
          .limit(1000)

        return NextResponse.json(accounts)
      }

      // Build search conditions
      const conditions: ReturnType<typeof eq>[] = []
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(bankAccounts.accountName, `%${escaped}%`),
            ilike(bankAccounts.bankName, `%${escaped}%`),
            ilike(bankAccounts.accountNumber, `%${escaped}%`)
          )!
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bankAccounts)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const accounts = await db.query.bankAccounts.findMany({
        where: whereClause,
        with: { coaAccount: true },
        orderBy: desc(bankAccounts.createdAt),
        limit: Math.min(pageSize, 100),
        offset,
      })

      return NextResponse.json({
        data: accounts,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts', error)
    return NextResponse.json({ error: 'Failed to fetch bank accounts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createBankAccountSchema)
    if (!parsed.success) return parsed.response
    const {
      accountName,
      bankName,
      accountNumber,
      branchCode,
      iban,
      swiftCode,
      isDefault,
    } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      return await db.transaction(async (tx) => {
        // If isDefault is true, unset any existing default bank account
        if (isDefault) {
          await tx
            .update(bankAccounts)
            .set({ isDefault: false })
            .where(eq(bankAccounts.isDefault, true))
        }

        // Find the "Bank Accounts" parent group (#1120)
        const bankGroup = await tx.query.chartOfAccounts.findFirst({
          where: and(
            eq(chartOfAccounts.accountNumber, '1120'),
            eq(chartOfAccounts.isGroup, true)
          ),
        })

        let coaAccountId: string | null = null

        if (bankGroup) {
          // Generate next account number under #1120 (1121, 1122, 1123...)
          const [maxResult] = await tx
            .select({ maxNum: sql<string>`MAX(${chartOfAccounts.accountNumber})` })
            .from(chartOfAccounts)
            .where(eq(chartOfAccounts.parentId, bankGroup.id))

          const maxNum = maxResult?.maxNum ? parseInt(maxResult.maxNum, 10) : 1120
          const nextNum = String(maxNum + 1)

          // Create COA leaf entry for this bank account
          const [coaEntry] = await tx.insert(chartOfAccounts).values({
            tenantId,
            name: accountName,
            accountNumber: nextNum,
            rootType: 'asset',
            accountType: 'bank',
            isGroup: false,
            isSystemAccount: false,
            parentId: bankGroup.id,
          }).returning()

          coaAccountId = coaEntry.id

          // Update defaultBankAccountId if this is the first bank or is default
          const existingBankCount = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(bankAccounts)

          const isFirstBank = Number(existingBankCount[0].count) === 0

          if (isFirstBank || isDefault) {
            await tx
              .update(accountingSettings)
              .set({ defaultBankAccountId: coaEntry.id })
              .where(eq(accountingSettings.tenantId, tenantId))
          }
        }

        const [newAccount] = await tx.insert(bankAccounts).values({
          tenantId,
          accountName,
          bankName: bankName || null,
          accountNumber: accountNumber || null,
          branchCode: branchCode || null,
          iban: iban || null,
          swiftCode: swiftCode || null,
          accountId: coaAccountId,
          isDefault: isDefault ?? false,
        }).returning()

        logAndBroadcast(tenantId, 'bank-account', 'created', newAccount.id)
        logAndBroadcast(tenantId, 'account', 'created', coaAccountId || newAccount.id)
        return NextResponse.json(newAccount)
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts', error)
    return NextResponse.json({ error: 'Failed to create bank account' }, { status: 500 })
  }
}
