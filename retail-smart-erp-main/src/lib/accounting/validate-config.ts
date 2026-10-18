// Pre-validation helper for accounting configuration
// Call BEFORE starting a transaction to give the user a clear 400 error
// instead of a cryptic 500 after the transaction rolls back.

import { accountingSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

type OperationType =
  | 'sale'
  | 'purchase'
  | 'payment'
  | 'stock_adjustment'
  | 'stock_transfer'
  | 'gift_card_sale'
  | 'pos_shift_close'
  | 'work_order_invoice'

// Maps each operation to the accounts it requires and the auto-post flag it checks
const OPERATION_REQUIREMENTS: Record<OperationType, {
  autoPostFlag: 'autoPostSales' | 'autoPostPurchases'
  accounts: { field: string; label: string }[]
}> = {
  sale: {
    autoPostFlag: 'autoPostSales',
    accounts: [
      { field: 'defaultIncomeAccountId', label: 'Sales Revenue' },
      { field: 'defaultReceivableAccountId', label: 'Accounts Receivable' },
      { field: 'defaultCashAccountId', label: 'Cash' },
    ],
  },
  purchase: {
    autoPostFlag: 'autoPostPurchases',
    accounts: [
      { field: 'defaultPayableAccountId', label: 'Accounts Payable' },
      { field: 'defaultCashAccountId', label: 'Cash' },
      // Stock OR COGS — at least one must exist (checked separately)
    ],
  },
  payment: {
    autoPostFlag: 'autoPostSales', // payments follow sales auto-post flag
    accounts: [
      { field: 'defaultCashAccountId', label: 'Cash' },
      { field: 'defaultReceivableAccountId', label: 'Accounts Receivable' },
      { field: 'defaultPayableAccountId', label: 'Accounts Payable' },
    ],
  },
  stock_adjustment: {
    autoPostFlag: 'autoPostSales',
    accounts: [
      { field: 'defaultStockAccountId', label: 'Stock / Inventory' },
      { field: 'defaultStockAdjustmentAccountId', label: 'Stock Adjustment' },
    ],
  },
  stock_transfer: {
    autoPostFlag: 'autoPostSales',
    accounts: [
      { field: 'defaultStockAccountId', label: 'Stock / Inventory' },
    ],
  },
  gift_card_sale: {
    autoPostFlag: 'autoPostSales',
    accounts: [
      { field: 'defaultGiftCardLiabilityAccountId', label: 'Gift Card Liability' },
      { field: 'defaultCashAccountId', label: 'Cash' },
    ],
  },
  pos_shift_close: {
    autoPostFlag: 'autoPostSales',
    accounts: [
      { field: 'defaultCashOverShortAccountId', label: 'Cash Over/Short' },
      { field: 'defaultCashAccountId', label: 'Cash' },
    ],
  },
  work_order_invoice: {
    autoPostFlag: 'autoPostSales',
    accounts: [
      { field: 'defaultIncomeAccountId', label: 'Sales Revenue' },
      { field: 'defaultReceivableAccountId', label: 'Accounts Receivable' },
      { field: 'defaultCashAccountId', label: 'Cash' },
    ],
  },
}

/**
 * Pre-validates that the accounting configuration has the required accounts
 * for a given operation type. Returns a NextResponse (400 error) if accounts
 * are missing, or null if everything is configured correctly.
 *
 * If auto-posting is disabled for this operation type, returns null (no error)
 * since GL entries won't be created anyway.
 */
export async function requireAccountingConfig(
  _db: DbOrTx,
  tenantId: string,
  operation: OperationType
): Promise<NextResponse | null> {
  // Use withTenant to ensure proper RLS context instead of raw db,
  // which can pick up leaked app_user role from the shared connection pool.
  const settings = await withTenant(tenantId, async (tdb) => {
    const [row] = await tdb.select()
      .from(accountingSettings)
      .limit(1)
    return row || null
  })

  // No accounting settings at all — auto-posting won't happen, so no error
  if (!settings) return null

  const requirements = OPERATION_REQUIREMENTS[operation]

  // If auto-posting is disabled for this operation type, skip validation
  if (!settings[requirements.autoPostFlag]) return null

  // Check for purchase special case: needs Stock OR COGS
  if (operation === 'purchase') {
    if (!settings.defaultStockAccountId && !settings.defaultCOGSAccountId) {
      return NextResponse.json({
        error: 'Accounting not configured: missing Stock/Inventory or Cost of Goods Sold account. Go to Settings → Accounting to configure default accounts.',
        code: 'GL_ACCOUNTS_MISSING',
      }, { status: 400 })
    }
  }

  // Check all required accounts
  const missing: string[] = []
  for (const account of requirements.accounts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(settings as any)[account.field]) {
      missing.push(account.label)
    }
  }

  if (missing.length > 0) {
    return NextResponse.json({
      error: `Accounting not configured: missing ${missing.join(', ')} account${missing.length > 1 ? 's' : ''}. Go to Settings → Accounting to configure default accounts.`,
      code: 'GL_ACCOUNTS_MISSING',
    }, { status: 400 })
  }

  return null
}
