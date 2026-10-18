import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { glEntries, chartOfAccounts, customers, suppliers, items, accountingSettings, warehouseStock, fiscalYears } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { createGLEntries, validateDoubleEntry, type GLEntryInput } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { createOpeningBalancesSchema } from '@/lib/validation/schemas/accounting'

export async function GET(_request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Check if any opening balance GL entries exist
      const [openingCheck] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(glEntries)
        .where(eq(glEntries.isOpening, true))

      const hasOpeningBalances = Number(openingCheck.count) > 0

      // Get existing opening balance entries with account details
      let openingEntries: {
        id: string
        accountId: string
        accountNumber: string
        accountName: string
        rootType: string
        debit: string
        credit: string
        postingDate: string
      }[] = []
      if (hasOpeningBalances) {
        openingEntries = await db
          .select({
            id: glEntries.id,
            accountId: glEntries.accountId,
            accountNumber: chartOfAccounts.accountNumber,
            accountName: chartOfAccounts.name,
            rootType: chartOfAccounts.rootType,
            debit: glEntries.debit,
            credit: glEntries.credit,
            postingDate: glEntries.postingDate,
          })
          .from(glEntries)
          .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
          .where(eq(glEntries.isOpening, true))
          .orderBy(chartOfAccounts.accountNumber)
      }

      // Calculate suggestions from existing data
      // Customer balances (Accounts Receivable)
      const [customerBalances] = await db
        .select({
          totalBalance: sql<string>`COALESCE(SUM(CAST(${customers.balance} AS numeric)), 0)`,
        })
        .from(customers)

      // Supplier balances (Accounts Payable)
      const [supplierBalances] = await db
        .select({
          totalBalance: sql<string>`COALESCE(SUM(CAST(${suppliers.balance} AS numeric)), 0)`,
        })
        .from(suppliers)

      // Inventory value (sum of costPrice * currentStock across all warehouses)
      const [inventoryValue] = await db
        .select({
          totalValue: sql<string>`COALESCE(SUM(CAST(${items.costPrice} AS numeric) * CAST(${warehouseStock.currentStock} AS numeric)), 0)`,
        })
        .from(warehouseStock)
        .innerJoin(items, eq(warehouseStock.itemId, items.id))

      // Get accounting settings for default account IDs
      const [settings] = await db
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, tenantId))
        .limit(1)

      return NextResponse.json({
        hasOpeningBalances,
        openingEntries,
        suggestions: {
          customerBalance: Number(customerBalances.totalBalance),
          supplierBalance: Number(supplierBalances.totalBalance),
          inventoryValue: Number(inventoryValue.totalValue),
        },
        defaultAccounts: {
          receivableAccountId: settings?.defaultReceivableAccountId || null,
          payableAccountId: settings?.defaultPayableAccountId || null,
          stockAccountId: settings?.defaultStockAccountId || null,
        },
      })
    })
  } catch (error) {
    logError('api/accounting/opening-balances', error)
    return NextResponse.json({ error: 'Failed to fetch opening balances' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createOpeningBalancesSchema)
    if (!parsed.success) return parsed.response
    const { entries, postingDate, importFromExisting } = parsed.data

    const tenantId = session!.user.tenantId

    // Prevent duplicate opening balance postings
    const existingCheck = await withTenant(tenantId, async (db) => {
      const [check] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(glEntries)
        .where(eq(glEntries.isOpening, true))
      return Number(check.count) > 0
    })

    if (existingCheck) {
      return NextResponse.json({
        error: 'Opening balances have already been posted. Please delete existing opening entries before re-importing.',
      }, { status: 400 })
    }

    // Validate posting date against configured fiscal year
    const fyValidation = await withTenant(tenantId, async (db) => {
      const [settings] = await db.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
      if (settings?.currentFiscalYearId) {
        const [fy] = await db.select({ startDate: fiscalYears.startDate, endDate: fiscalYears.endDate })
          .from(fiscalYears).where(eq(fiscalYears.id, settings.currentFiscalYearId)).limit(1)
        if (fy && (postingDate < fy.startDate || postingDate > fy.endDate)) {
          return `Posting date ${postingDate} is outside the current fiscal year (${fy.startDate} to ${fy.endDate})`
        }
      }
      return null
    })

    if (fyValidation) {
      return NextResponse.json({ error: fyValidation }, { status: 400 })
    }

    // Import from existing data (shortcut mode)
    if (importFromExisting) {
      const result = await withTenantTransaction(tenantId, async (db) => {
        // Get accounting settings for default account IDs
        const [settings] = await db
          .select()
          .from(accountingSettings)
          .where(eq(accountingSettings.tenantId, tenantId))
          .limit(1)

        if (!settings) {
          throw new Error('SETTINGS_NOT_FOUND')
        }

        const openingEntries: GLEntryInput[] = []

        // Customer balances -> Dr Accounts Receivable
        if (settings.defaultReceivableAccountId) {
          const [customerBalances] = await db
            .select({
              totalBalance: sql<string>`COALESCE(SUM(CAST(${customers.balance} AS numeric)), 0)`,
            })
            .from(customers)

          const customerTotal = Number(customerBalances.totalBalance)
          if (customerTotal > 0) {
            openingEntries.push({
              accountId: settings.defaultReceivableAccountId,
              debit: customerTotal,
              credit: 0,
              remarks: 'Opening balance - Accounts Receivable from customer balances',
            })
          } else if (customerTotal < 0) {
            openingEntries.push({
              accountId: settings.defaultReceivableAccountId,
              debit: 0,
              credit: Math.abs(customerTotal),
              remarks: 'Opening balance - Accounts Receivable from customer balances (credit)',
            })
          }
        }

        // Supplier balances -> Cr Accounts Payable
        if (settings.defaultPayableAccountId) {
          const [supplierBalances] = await db
            .select({
              totalBalance: sql<string>`COALESCE(SUM(CAST(${suppliers.balance} AS numeric)), 0)`,
            })
            .from(suppliers)

          const supplierTotal = Number(supplierBalances.totalBalance)
          if (supplierTotal > 0) {
            openingEntries.push({
              accountId: settings.defaultPayableAccountId,
              debit: 0,
              credit: supplierTotal,
              remarks: 'Opening balance - Accounts Payable from supplier balances',
            })
          } else if (supplierTotal < 0) {
            openingEntries.push({
              accountId: settings.defaultPayableAccountId,
              debit: Math.abs(supplierTotal),
              credit: 0,
              remarks: 'Opening balance - Accounts Payable from supplier balances (debit)',
            })
          }
        }

        // Inventory value -> Dr Inventory/Stock account
        if (settings.defaultStockAccountId) {
          const [inventoryValue] = await db
            .select({
              totalValue: sql<string>`COALESCE(SUM(CAST(${items.costPrice} AS numeric) * CAST(${warehouseStock.currentStock} AS numeric)), 0)`,
            })
            .from(warehouseStock)
            .innerJoin(items, eq(warehouseStock.itemId, items.id))

          const inventoryTotal = Number(inventoryValue.totalValue)
          if (inventoryTotal > 0) {
            openingEntries.push({
              accountId: settings.defaultStockAccountId,
              debit: Math.round(inventoryTotal * 100) / 100,
              credit: 0,
              remarks: 'Opening balance - Inventory/Stock from current stock values',
            })
          }
        }

        if (openingEntries.length === 0) {
          throw new Error('NO_BALANCES')
        }

        // Calculate the balancing entry for Owner's Capital / Equity
        // Find an equity account to balance against
        const [equityAccount] = await db
          .select()
          .from(chartOfAccounts)
          .where(and(
            eq(chartOfAccounts.rootType, 'equity'),
            eq(chartOfAccounts.isGroup, false),
            eq(chartOfAccounts.isActive, true),
          ))
          .orderBy(chartOfAccounts.accountNumber)
          .limit(1)

        if (!equityAccount) {
          throw new Error('NO_EQUITY_ACCOUNT')
        }

        // Calculate the difference: total debits - total credits
        let totalDebit = 0
        let totalCredit = 0
        for (const entry of openingEntries) {
          totalDebit += Number(entry.debit || 0)
          totalCredit += Number(entry.credit || 0)
        }

        const difference = Math.round((totalDebit - totalCredit) * 100) / 100

        if (difference > 0) {
          // More debits than credits -> Cr equity account
          openingEntries.push({
            accountId: equityAccount.id,
            debit: 0,
            credit: difference,
            remarks: 'Opening balance - Owner\'s Capital / Equity (balancing entry)',
          })
        } else if (difference < 0) {
          // More credits than debits -> Dr equity account
          openingEntries.push({
            accountId: equityAccount.id,
            debit: Math.abs(difference),
            credit: 0,
            remarks: 'Opening balance - Owner\'s Capital / Equity (balancing entry)',
          })
        }

        // Get fiscal year from settings
        const fiscalYearId = settings.currentFiscalYearId || null

        // Create opening GL entries
        const insertedIds = await createGLEntries(db, {
          tenantId,
          postingDate,
          voucherType: 'opening',
          voucherId: tenantId, // Use tenantId as voucherId since there's no specific voucher
          voucherNumber: 'OB-AUTO',
          fiscalYearId,
          isOpening: true,
          entries: openingEntries,
        })

        return { insertedIds, entriesCount: openingEntries.length }
      })

      logAndBroadcast(tenantId, 'gl-entry', 'created', tenantId)
      return NextResponse.json({
        success: true,
        message: `Created ${result.entriesCount} opening balance entries`,
        glEntryIds: result.insertedIds,
      })
    }

    // Manual entries mode
    if (!entries || entries.length === 0) {
      return NextResponse.json(
        { error: 'At least one opening balance entry is required' },
        { status: 400 }
      )
    }

    // Build GL entry inputs
    const glEntryInputs: GLEntryInput[] = entries.map((entry) => ({
      accountId: entry.accountId,
      debit: entry.debit,
      credit: entry.credit,
      remarks: entry.remarks || 'Opening balance',
    }))

    // Validate double entry (debits must equal credits)
    const validation = validateDoubleEntry(glEntryInputs)
    if (!validation.valid) {
      return NextResponse.json({
        error: `Debits and credits must be equal. Difference: ${validation.difference}`,
      }, { status: 400 })
    }

    const result = await withTenantTransaction(tenantId, async (db) => {
      // Get fiscal year from settings
      const [settings] = await db
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.tenantId, tenantId))
        .limit(1)

      const fiscalYearId = settings?.currentFiscalYearId || null

      // Create opening GL entries
      const insertedIds = await createGLEntries(db, {
        tenantId,
        postingDate,
        voucherType: 'opening',
        voucherId: tenantId, // Use tenantId as voucherId since there's no specific voucher
        voucherNumber: 'OB-MANUAL',
        fiscalYearId,
        isOpening: true,
        entries: glEntryInputs,
      })

      return insertedIds
    })

    logAndBroadcast(tenantId, 'gl-entry', 'created', tenantId)
    return NextResponse.json({
      success: true,
      message: `Created ${result.length} opening balance entries`,
      glEntryIds: result,
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'SETTINGS_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Accounting settings not found. Please set up accounting first.' },
        { status: 400 }
      )
    }
    if (err.message === 'NO_BALANCES') {
      return NextResponse.json(
        { error: 'No existing balances found to import. Customer, supplier, and inventory balances are all zero.' },
        { status: 400 }
      )
    }
    if (err.message === 'NO_EQUITY_ACCOUNT') {
      return NextResponse.json(
        { error: 'No equity account found to balance the opening entries. Please create an equity account (e.g., Owner\'s Capital) first.' },
        { status: 400 }
      )
    }
    if (err.message?.includes('Double-entry validation failed')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    logError('api/accounting/opening-balances', error)
    return NextResponse.json({ error: 'Failed to create opening balances' }, { status: 500 })
  }
}
