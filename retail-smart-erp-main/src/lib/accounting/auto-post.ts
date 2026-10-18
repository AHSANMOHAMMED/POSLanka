// Auto-posting functions for sales, purchases, and payments
// Called from existing API routes to create GL entries automatically

import { createGLEntries, reverseGLEntries, type GLEntryInput } from './gl'
import { accountingSettings, modesOfPayment } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { roundCurrency } from '@/lib/utils/currency'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'

// Accept any drizzle DB instance (PgTransaction or NodePgDatabase)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

interface AccountingConfig {
  defaultReceivableAccountId: string | null
  defaultPayableAccountId: string | null
  defaultIncomeAccountId: string | null
  defaultCashAccountId: string | null
  defaultBankAccountId: string | null
  defaultTaxAccountId: string | null
  defaultCOGSAccountId: string | null
  defaultStockAccountId: string | null
  defaultRoundOffAccountId: string | null
  defaultAdvanceReceivedAccountId: string | null
  defaultCostCenterId: string | null
  defaultStockAdjustmentAccountId: string | null
  defaultWipAccountId: string | null
  defaultGiftCardLiabilityAccountId: string | null
  defaultCashOverShortAccountId: string | null
  autoPostSales: boolean
  autoPostPurchases: boolean
  currentFiscalYearId: string | null
}

/**
 * Fetch accounting settings for a tenant. Returns null if not configured.
 */
async function getAccountingConfig(
  tx: DbOrTx,
  tenantId: string
): Promise<AccountingConfig | null> {
  const [settings] = await tx.select()
    .from(accountingSettings)
    .where(eq(accountingSettings.tenantId, tenantId))
    .limit(1)

  if (!settings) return null

  return {
    defaultReceivableAccountId: settings.defaultReceivableAccountId,
    defaultPayableAccountId: settings.defaultPayableAccountId,
    defaultIncomeAccountId: settings.defaultIncomeAccountId,
    defaultCashAccountId: settings.defaultCashAccountId,
    defaultBankAccountId: settings.defaultBankAccountId,
    defaultTaxAccountId: settings.defaultTaxAccountId,
    defaultCOGSAccountId: settings.defaultCOGSAccountId,
    defaultStockAccountId: settings.defaultStockAccountId,
    defaultRoundOffAccountId: settings.defaultRoundOffAccountId,
    defaultAdvanceReceivedAccountId: settings.defaultAdvanceReceivedAccountId,
    defaultCostCenterId: settings.defaultCostCenterId,
    defaultStockAdjustmentAccountId: settings.defaultStockAdjustmentAccountId,
    defaultWipAccountId: settings.defaultWipAccountId || null,
    defaultGiftCardLiabilityAccountId: settings.defaultGiftCardLiabilityAccountId || null,
    defaultCashOverShortAccountId: settings.defaultCashOverShortAccountId || null,
    autoPostSales: settings.autoPostSales,
    autoPostPurchases: settings.autoPostPurchases,
    currentFiscalYearId: settings.currentFiscalYearId,
  }
}

/**
 * Resolve the GL account for a payment method from the modes_of_payment table.
 * Looks up by method_key matching the POS payment method string.
 * Returns the defaultAccountId or null if not found.
 */
async function resolvePaymentAccountFromMode(
  tx: DbOrTx,
  tenantId: string,
  paymentMethod: string
): Promise<string | null> {
  const [mode] = await tx.select({
    defaultAccountId: modesOfPayment.defaultAccountId,
  })
    .from(modesOfPayment)
    .where(and(
      eq(modesOfPayment.tenantId, tenantId),
      eq(modesOfPayment.methodKey, paymentMethod),
      eq(modesOfPayment.isEnabled, true),
    ))
    .limit(1)

  return mode?.defaultAccountId || null
}

interface SalePostingData {
  saleId: string
  invoiceNumber: string
  saleDate: string // YYYY-MM-DD
  subtotal: number
  tax: number
  discount: number
  total: number
  amountPaid: number
  creditAmount: number
  costOfGoodsSold: number // Total cost of items sold (for COGS entry)
  paymentMethod: string
  customerId?: string | null
  isReturn?: boolean
  refundMethod?: string // For returns: the actual method used for refund
  costCenterId?: string | null
  taxBreakdown?: TaxBreakdownItem[]
}

/**
 * Posts a sale to the General Ledger.
 *
 * Standard sale entries:
 *   Dr Accounts Receivable / Cash    [total]
 *   Cr Sales Revenue                 [subtotal - discount]
 *   Cr Tax Payable                   [tax] (if any)
 *
 * If payment received at time of sale:
 *   Dr Cash/Bank                     [amountPaid]
 *   Cr Accounts Receivable           [amountPaid]
 */
export async function postSaleToGL(
  tx: DbOrTx,
  tenantId: string,
  data: SalePostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  // Require minimum accounts configured
  if (!config.defaultIncomeAccountId || !config.defaultReceivableAccountId || !config.defaultCashAccountId) {
    const missing = [
      !config.defaultIncomeAccountId && 'Sales Revenue',
      !config.defaultReceivableAccountId && 'Accounts Receivable',
      !config.defaultCashAccountId && 'Cash',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post sale — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  const entries: GLEntryInput[] = []

  // Build tax entries — per-account breakdown or single fallback
  const taxEntries: { accountId: string; amount: number; remark: string }[] = []

  if (data.taxBreakdown && data.taxBreakdown.length > 0) {
    // Group breakdown items by accountId (fallback to defaultTaxAccountId)
    const byAccount = new Map<string, number>()
    for (const item of data.taxBreakdown) {
      const acctId = item.accountId || config.defaultTaxAccountId
      if (!acctId || item.amount <= 0) continue
      byAccount.set(acctId, (byAccount.get(acctId) || 0) + item.amount)
    }
    for (const [acctId, amount] of byAccount) {
      taxEntries.push({ accountId: acctId, amount: roundCurrency(amount), remark: 'Tax collected on sale' })
    }
  } else if (data.tax > 0 && config.defaultTaxAccountId) {
    // Legacy single-account fallback
    taxEntries.push({ accountId: config.defaultTaxAccountId, amount: roundCurrency(data.tax), remark: 'Tax collected on sale' })
  }

  const totalTaxPosted = taxEntries.reduce((sum, e) => sum + e.amount, 0)
  // Revenue = total - all tax entries (ensures debits = credits)
  const adjustedNetRevenue = roundCurrency(data.total - totalTaxPosted)

  if (data.isReturn) {
    // Return/refund: reverse the original entries
    // Dr Sales Revenue (reduce revenue)
    entries.push({
      accountId: config.defaultIncomeAccountId,
      debit: adjustedNetRevenue,
      costCenterId,
      remarks: 'Sales return',
    })

    // Dr Tax Payable (reduce tax) — per-account entries
    for (const te of taxEntries) {
      entries.push({
        accountId: te.accountId,
        debit: te.amount,
        costCenterId,
        remarks: 'Tax reversal on return',
      })
    }

    // Cr Accounts Receivable / Cash (refund) — resolve from Modes of Payment
    // Use refundMethod (actual refund method) instead of paymentMethod (original sale method)
    const refundPaymentMethod = data.refundMethod || data.paymentMethod
    const refundModeAccount = await resolvePaymentAccountFromMode(tx, tenantId, refundPaymentMethod)
    let refundAccountId: string
    if (refundModeAccount) {
      refundAccountId = refundModeAccount
    } else if (refundPaymentMethod === 'cash') {
      refundAccountId = config.defaultCashAccountId
    } else if (refundPaymentMethod === 'bank_transfer' || refundPaymentMethod === 'card') {
      refundAccountId = config.defaultBankAccountId || config.defaultCashAccountId
    } else {
      if (refundPaymentMethod !== 'credit') {
        console.warn(`[GL] No Mode of Payment found for method "${refundPaymentMethod}" (tenant: ${tenantId}). Using Accounts Receivable for refund.`)
      }
      refundAccountId = config.defaultReceivableAccountId
    }

    entries.push({
      accountId: refundAccountId,
      credit: data.total,
      partyType: data.customerId ? 'customer' : null,
      partyId: data.customerId || null,
      costCenterId,
      remarks: 'Refund to customer',
    })

    // COGS reversal: Dr Stock/Inventory, Cr COGS (returns goods to stock)
    if (data.costOfGoodsSold > 0 && config.defaultCOGSAccountId && config.defaultStockAccountId
        && config.defaultCOGSAccountId !== config.defaultStockAccountId) {
      entries.push({
        accountId: config.defaultStockAccountId,
        debit: data.costOfGoodsSold,
        costCenterId,
        remarks: 'Inventory restored on return',
      })
      entries.push({
        accountId: config.defaultCOGSAccountId,
        credit: data.costOfGoodsSold,
        costCenterId,
        remarks: 'COGS reversal on return',
      })
    }
  } else {
    // Normal sale
    // Dr Accounts Receivable for full amount
    entries.push({
      accountId: config.defaultReceivableAccountId,
      debit: data.total,
      partyType: data.customerId ? 'customer' : null,
      partyId: data.customerId || null,
      costCenterId,
      remarks: 'Sale receivable',
    })

    // Cr Sales Revenue (adjusted so credits always balance against total)
    entries.push({
      accountId: config.defaultIncomeAccountId,
      credit: adjustedNetRevenue,
      costCenterId,
      remarks: 'Sales revenue',
    })

    // Cr Tax Payable — per-account entries
    for (const te of taxEntries) {
      entries.push({
        accountId: te.accountId,
        credit: te.amount,
        costCenterId,
        remarks: te.remark,
      })
    }

    // If payment received immediately (cash/card/gift_card), settle the receivable
    if (data.amountPaid > 0) {
      let resolvedPaymentAccountId: string

      if (data.paymentMethod === 'gift_card' && config.defaultGiftCardLiabilityAccountId) {
        // Gift card payment: reduce the liability (someone previously bought this card)
        resolvedPaymentAccountId = config.defaultGiftCardLiabilityAccountId
      } else {
        // Resolve from Modes of Payment default account
        const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, data.paymentMethod)
        if (modeAccount) {
          resolvedPaymentAccountId = modeAccount
        } else if (data.paymentMethod === 'cash') {
          resolvedPaymentAccountId = config.defaultCashAccountId
        } else if (data.paymentMethod === 'bank_transfer' || data.paymentMethod === 'card') {
          resolvedPaymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
        } else {
          console.warn(`[GL] No Mode of Payment found for method "${data.paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
          resolvedPaymentAccountId = config.defaultCashAccountId
        }
      }

      // Dr Cash/Bank/Gift Card Liability
      entries.push({
        accountId: resolvedPaymentAccountId,
        debit: data.amountPaid,
        costCenterId,
        remarks: `Payment received (${data.paymentMethod})`,
      })

      // Cr Accounts Receivable
      entries.push({
        accountId: config.defaultReceivableAccountId,
        credit: data.amountPaid,
        partyType: data.customerId ? 'customer' : null,
        partyId: data.customerId || null,
        costCenterId,
        remarks: 'Payment against sale',
      })
    }

    // If customer credit (store credit/advance) used, settle that portion of receivable
    if (data.creditAmount > 0 && config.defaultAdvanceReceivedAccountId) {
      // Dr Customer Advance/Deposit (liability reduction)
      entries.push({
        accountId: config.defaultAdvanceReceivedAccountId,
        debit: data.creditAmount,
        partyType: data.customerId ? 'customer' : null,
        partyId: data.customerId || null,
        costCenterId,
        remarks: 'Customer credit applied to sale',
      })

      // Cr Accounts Receivable
      entries.push({
        accountId: config.defaultReceivableAccountId,
        credit: data.creditAmount,
        partyType: data.customerId ? 'customer' : null,
        partyId: data.customerId || null,
        costCenterId,
        remarks: 'Receivable settled by customer credit',
      })
    }

    // COGS entries: Dr Cost of Goods Sold, Cr Stock/Inventory
    // Only post if both accounts are configured and they are different accounts
    if (data.costOfGoodsSold > 0 && config.defaultCOGSAccountId && config.defaultStockAccountId
        && config.defaultCOGSAccountId !== config.defaultStockAccountId) {
      entries.push({
        accountId: config.defaultCOGSAccountId,
        debit: data.costOfGoodsSold,
        costCenterId,
        remarks: 'Cost of goods sold',
      })
      entries.push({
        accountId: config.defaultStockAccountId,
        credit: data.costOfGoodsSold,
        costCenterId,
        remarks: 'Inventory reduction on sale',
      })
    }
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.saleDate,
    voucherType: data.isReturn ? 'refund' : 'sale',
    voucherId: data.saleId,
    voucherNumber: data.invoiceNumber,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

interface PurchasePostingData {
  purchaseId: string
  invoiceNumber: string
  purchaseDate: string
  subtotal: number
  tax: number
  discount: number
  total: number
  amountPaid: number
  paymentMethod?: string
  supplierId?: string | null
  costCenterId?: string | null
  taxBreakdown?: TaxBreakdownItem[]
  isReturn?: boolean
}

/**
 * Posts a purchase to the General Ledger.
 *
 * Purchase entries:
 *   Dr COGS / Expense           [subtotal - discount]
 *   Dr Tax (input tax)          [tax] (if any)
 *   Cr Accounts Payable         [total]
 *
 * If payment made:
 *   Dr Accounts Payable         [amountPaid]
 *   Cr Cash/Bank                [amountPaid]
 */
export async function postPurchaseToGL(
  tx: DbOrTx,
  tenantId: string,
  data: PurchasePostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostPurchases) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  // Use Stock/Inventory account (asset) for purchases, fallback to COGS if not set
  const purchaseDebitAccountId = config.defaultStockAccountId || config.defaultCOGSAccountId
  if (!purchaseDebitAccountId || !config.defaultPayableAccountId || !config.defaultCashAccountId) {
    const missing = [
      !purchaseDebitAccountId && 'Stock/Inventory or COGS',
      !config.defaultPayableAccountId && 'Accounts Payable',
      !config.defaultCashAccountId && 'Cash',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post purchase — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  const entries: GLEntryInput[] = []

  // Build tax entries — per-account breakdown or single fallback (mirrors postSaleToGL pattern)
  const taxEntries: { accountId: string; amount: number; remark: string }[] = []

  if (data.taxBreakdown && data.taxBreakdown.length > 0) {
    // Group breakdown items by accountId (fallback to defaultTaxAccountId)
    const byAccount = new Map<string, number>()
    for (const item of data.taxBreakdown) {
      const acctId = item.accountId || config.defaultTaxAccountId
      if (!acctId || item.amount <= 0) continue
      byAccount.set(acctId, (byAccount.get(acctId) || 0) + item.amount)
    }
    for (const [acctId, amount] of byAccount) {
      taxEntries.push({ accountId: acctId, amount: roundCurrency(amount), remark: 'Input tax on purchase' })
    }
  } else if (data.tax > 0 && config.defaultTaxAccountId) {
    // Legacy single-account fallback
    taxEntries.push({ accountId: config.defaultTaxAccountId, amount: roundCurrency(data.tax), remark: 'Input tax on purchase' })
  }

  const totalTaxPosted = taxEntries.reduce((sum, e) => sum + e.amount, 0)
  // Net cost = total - all tax entries (ensures debits = credits)
  const adjustedNetCost = roundCurrency(data.total - totalTaxPosted)

  if (data.isReturn) {
    // Purchase return: reverse the original entries
    // Cr Stock/Inventory (reduce inventory)
    entries.push({
      accountId: purchaseDebitAccountId,
      credit: adjustedNetCost,
      costCenterId,
      remarks: 'Purchase return - inventory returned',
    })

    // Cr Tax (reduce input tax) — per-account entries
    for (const taxEntry of taxEntries) {
      entries.push({
        accountId: taxEntry.accountId,
        credit: taxEntry.amount,
        costCenterId,
        remarks: 'Tax reversal on purchase return',
      })
    }

    // Dr Accounts Payable (reduce payable)
    entries.push({
      accountId: config.defaultPayableAccountId,
      debit: data.total,
      partyType: data.supplierId ? 'supplier' : null,
      partyId: data.supplierId || null,
      costCenterId,
      remarks: 'Purchase return - payable reduced',
    })
  } else {
    // Normal purchase
    // Dr Stock/Inventory (asset account for purchased goods)
    entries.push({
      accountId: purchaseDebitAccountId,
      debit: adjustedNetCost,
      costCenterId,
      remarks: 'Purchase - inventory received',
    })

    // Dr Tax (input) — per-account entries
    for (const taxEntry of taxEntries) {
      entries.push({
        accountId: taxEntry.accountId,
        debit: taxEntry.amount,
        costCenterId,
        remarks: taxEntry.remark,
      })
    }

    // Cr Accounts Payable
    entries.push({
      accountId: config.defaultPayableAccountId,
      credit: data.total,
      partyType: data.supplierId ? 'supplier' : null,
      partyId: data.supplierId || null,
      costCenterId,
      remarks: 'Purchase payable',
    })

    // If payment made immediately
    if (data.amountPaid > 0) {
      // M2: Resolve payment account from Modes of Payment, with fallback
      const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, data.paymentMethod || 'cash')
      let paymentAccountId: string
      if (modeAccount) {
        paymentAccountId = modeAccount
      } else if (data.paymentMethod === 'cash') {
        paymentAccountId = config.defaultCashAccountId
      } else if (data.paymentMethod === 'bank_transfer' || data.paymentMethod === 'card') {
        paymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
      } else {
        console.warn(`[GL] No Mode of Payment found for purchase method "${data.paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
        paymentAccountId = config.defaultCashAccountId
      }

      // Dr Accounts Payable
      entries.push({
        accountId: config.defaultPayableAccountId,
        debit: data.amountPaid,
        partyType: data.supplierId ? 'supplier' : null,
        partyId: data.supplierId || null,
        costCenterId,
        remarks: 'Payment against purchase',
      })

      // Cr Cash/Bank
      entries.push({
        accountId: paymentAccountId,
        credit: data.amountPaid,
        costCenterId,
        remarks: `Payment made (${data.paymentMethod || 'cash'})`,
      })
    }
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.purchaseDate,
    voucherType: 'purchase',
    voucherId: data.purchaseId,
    voucherNumber: data.invoiceNumber,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

interface PaymentPostingData {
  paymentId: string
  paymentDate: string
  amount: number
  paymentMethod: string
  partyType: 'customer' | 'supplier'
  partyId?: string | null // Optional for walk-in sales
  referenceNumber?: string
  costCenterId?: string | null
}

/**
 * Posts a standalone payment to the General Ledger.
 *
 * Customer payment (receiving money):
 *   Dr Cash/Bank          [amount]
 *   Cr Accounts Receivable [amount]
 *
 * Supplier payment (paying money):
 *   Dr Accounts Payable   [amount]
 *   Cr Cash/Bank          [amount]
 */
export async function postPaymentToGL(
  tx: DbOrTx,
  tenantId: string,
  data: PaymentPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultCashAccountId || !config.defaultReceivableAccountId || !config.defaultPayableAccountId) {
    const missing = [
      !config.defaultCashAccountId && 'Cash',
      !config.defaultReceivableAccountId && 'Accounts Receivable',
      !config.defaultPayableAccountId && 'Accounts Payable',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post payment — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null

  // Resolve payment account from Modes of Payment, then fall back to accounting settings
  const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, data.paymentMethod)
  let paymentAccountId: string
  if (modeAccount) {
    paymentAccountId = modeAccount
  } else if (data.paymentMethod === 'cash') {
    paymentAccountId = config.defaultCashAccountId
  } else if (data.paymentMethod === 'bank_transfer' || data.paymentMethod === 'card') {
    paymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
  } else if (data.paymentMethod === 'gift_card' && config.defaultGiftCardLiabilityAccountId) {
    paymentAccountId = config.defaultGiftCardLiabilityAccountId
  } else {
    console.warn(`[GL] No Mode of Payment found for method "${data.paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
    paymentAccountId = config.defaultCashAccountId
  }

  const entries: GLEntryInput[] = []

  if (data.partyType === 'customer') {
    // Receiving money from customer
    entries.push({
      accountId: paymentAccountId,
      debit: data.amount,
      costCenterId,
      remarks: `Payment from customer`,
    })
    entries.push({
      accountId: config.defaultReceivableAccountId,
      credit: data.amount,
      ...(data.partyId ? { partyType: 'customer' as const, partyId: data.partyId } : {}),
      costCenterId,
      remarks: 'Customer payment received',
    })
  } else {
    // Paying supplier
    entries.push({
      accountId: config.defaultPayableAccountId,
      debit: data.amount,
      ...(data.partyId ? { partyType: 'supplier' as const, partyId: data.partyId } : {}),
      costCenterId,
      remarks: 'Supplier payment made',
    })
    entries.push({
      accountId: paymentAccountId,
      credit: data.amount,
      costCenterId,
      remarks: `Payment to supplier`,
    })
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.paymentDate,
    voucherType: 'payment',
    voucherId: data.paymentId,
    voucherNumber: data.referenceNumber,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

interface StockAdjustmentPostingData {
  adjustmentId: string       // stock_movement ID
  tenantId: string
  itemName: string
  quantityChange: number     // positive = increase, negative = decrease
  costPrice: number          // item.costPrice (unit cost)
  costCenterId?: string | null
  notes?: string
}

/**
 * Posts a stock adjustment to the General Ledger.
 *
 * Stock decrease (shrinkage, damage, write-off):
 *   Dr Stock Adjustment (5500 - expense ↑)
 *   Cr Stock / Inventory (1140 - asset ↓)
 *
 * Stock increase (found items, corrections):
 *   Dr Stock / Inventory (1140 - asset ↑)
 *   Cr Stock Adjustment (5500 - income ↑)
 *
 * Value = abs(quantityChange) × item.costPrice
 */
export async function postStockAdjustmentToGL(
  tx: DbOrTx,
  tenantId: string,
  data: StockAdjustmentPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  const value = roundCurrency(Math.abs(data.quantityChange) * data.costPrice)

  if (value === 0) return null // no GL entry for zero value

  const stockAccountId = config.defaultStockAccountId
  const adjustmentAccountId = config.defaultStockAdjustmentAccountId

  if (!stockAccountId || !adjustmentAccountId) {
    const missing = [
      !stockAccountId && 'Stock/Inventory',
      !adjustmentAccountId && 'Stock Adjustment',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post stock adjustment — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const entries: GLEntryInput[] = []

  if (data.quantityChange < 0) {
    // Stock DECREASE: Dr Stock Adjustment (expense), Cr Stock (asset)
    entries.push({
      accountId: adjustmentAccountId,
      debit: value,
      costCenterId,
      remarks: `Stock decrease: ${data.itemName}`,
    })
    entries.push({
      accountId: stockAccountId,
      credit: value,
      costCenterId,
      remarks: `Inventory reduction: ${data.itemName}`,
    })
  } else {
    // Stock INCREASE: Dr Stock (asset), Cr Stock Adjustment
    entries.push({
      accountId: stockAccountId,
      debit: value,
      costCenterId,
      remarks: `Inventory increase: ${data.itemName}`,
    })
    entries.push({
      accountId: adjustmentAccountId,
      credit: value,
      costCenterId,
      remarks: `Stock adjustment credit: ${data.itemName}`,
    })
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'stock_adjustment',
    voucherId: data.adjustmentId,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

/**
 * Posts a void/cancellation to the GL by reversing all entries for a voucher.
 */
export async function postVoidToGL(
  tx: DbOrTx,
  tenantId: string,
  voucherType: string,
  voucherId: string,
  voidDate?: string
): Promise<string[] | null> {
  return reverseGLEntries(tx, tenantId, voucherType, voucherId, voidDate)
}

// ==================== WORK ORDER WIP TRACKING ====================

interface WorkOrderPartPostingData {
  workOrderId: string
  workOrderNo: string
  itemName: string
  quantity: number
  costPrice: number // unit cost
  costCenterId?: string | null
  isRemoval?: boolean // true when removing parts from work order
}

/**
 * Posts work order parts to GL as Work In Progress.
 *
 * When parts added:
 *   Dr Work In Progress (WIP asset)
 *   Cr Stock / Inventory (asset)
 *
 * When parts removed:
 *   Dr Stock / Inventory (asset)
 *   Cr Work In Progress (WIP asset)
 */
export async function postWorkOrderPartsToGL(
  tx: DbOrTx,
  tenantId: string,
  data: WorkOrderPartPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  const wipAccountId = config.defaultWipAccountId
  const stockAccountId = config.defaultStockAccountId

  // Both accounts must be configured for WIP tracking
  if (!wipAccountId || !stockAccountId) {
    const missing = [
      !wipAccountId && 'Work In Progress (WIP)',
      !stockAccountId && 'Stock/Inventory',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post work order parts — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const value = roundCurrency(Math.abs(data.quantity) * data.costPrice)
  if (value === 0) return null

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  const entries: GLEntryInput[] = []

  if (data.isRemoval) {
    // Parts removed from work order - reverse WIP
    entries.push({
      accountId: stockAccountId,
      debit: value,
      costCenterId,
      remarks: `WO ${data.workOrderNo} part returned: ${data.itemName}`,
    })
    entries.push({
      accountId: wipAccountId,
      credit: value,
      costCenterId,
      remarks: `WIP reversal: ${data.itemName}`,
    })
  } else {
    // Parts added to work order
    entries.push({
      accountId: wipAccountId,
      debit: value,
      costCenterId,
      remarks: `WO ${data.workOrderNo} part: ${data.itemName}`,
    })
    entries.push({
      accountId: stockAccountId,
      credit: value,
      costCenterId,
      remarks: `Stock to WIP: ${data.itemName}`,
    })
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'work_order_part',
    voucherId: data.workOrderId,
    voucherNumber: data.workOrderNo,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

interface WorkOrderInvoiceWipData {
  workOrderId: string
  workOrderNo: string
  totalPartsCost: number  // Total cost of parts at cost price
  totalLaborCost: number  // Total labor cost
  costCenterId?: string | null
}

/**
 * Transfers WIP to COGS when a work order is invoiced.
 *
 * Dr Cost of Goods Sold
 * Cr Work In Progress
 */
export async function postWorkOrderInvoiceWipToGL(
  tx: DbOrTx,
  tenantId: string,
  data: WorkOrderInvoiceWipData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  const wipAccountId = config.defaultWipAccountId
  const cogsAccountId = config.defaultCOGSAccountId

  if (!wipAccountId || !cogsAccountId) {
    const missing = [
      !wipAccountId && 'Work In Progress (WIP)',
      !cogsAccountId && 'Cost of Goods Sold',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post work order invoice — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const totalWip = roundCurrency(data.totalPartsCost + data.totalLaborCost)
  if (totalWip === 0) return null

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  const entries: GLEntryInput[] = [
    {
      accountId: cogsAccountId,
      debit: totalWip,
      costCenterId,
      remarks: `WO ${data.workOrderNo} cost transfer`,
    },
    {
      accountId: wipAccountId,
      credit: totalWip,
      costCenterId,
      remarks: `WIP closed on invoice: WO ${data.workOrderNo}`,
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'work_order_invoice',
    voucherId: data.workOrderId,
    voucherNumber: data.workOrderNo,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ==================== STOCK TRANSFERS ====================

interface StockTransferPostingData {
  transferId: string
  transferNo?: string
  items: { itemName: string; quantity: number; costPrice: number }[]
  costCenterId?: string | null
}

/**
 * Posts a stock transfer to the General Ledger.
 * Since transfers are between warehouses within the same entity,
 * the accounting entry is neutral (same stock account).
 * However, if per-warehouse accounts were configured, this would debit
 * destination and credit source. For now, we create a nominal entry
 * to document the transfer value.
 *
 * Dr Stock / Inventory (transfer value)
 * Cr Stock / Inventory (transfer value)
 * This creates an audit trail without affecting balances.
 */
export async function postStockTransferToGL(
  tx: DbOrTx,
  tenantId: string,
  data: StockTransferPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  const stockAccountId = config.defaultStockAccountId
  if (!stockAccountId) {
    throw new Error('GL_ACCOUNTS_MISSING: Cannot post stock transfer — missing Stock/Inventory account. Configure in Settings → Accounting.')
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  let totalValue = 0

  for (const item of data.items) {
    totalValue += Math.abs(item.quantity) * item.costPrice
  }
  totalValue = roundCurrency(totalValue)

  if (totalValue === 0) return null

  const entries: GLEntryInput[] = [
    {
      accountId: stockAccountId,
      debit: totalValue,
      costCenterId,
      remarks: `Stock transfer received: ${data.transferNo || data.transferId}`,
    },
    {
      accountId: stockAccountId,
      credit: totalValue,
      costCenterId,
      remarks: `Stock transfer sent: ${data.transferNo || data.transferId}`,
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'stock_transfer',
    voucherId: data.transferId,
    voucherNumber: data.transferNo,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Gift Card Sale GL ─────────────────────────────────────────
// When a gift card is sold as a POS item, the revenue is deferred:
//   Dr Cash/Bank            [amount]  (received payment)
//   Cr Gift Card Liability  [amount]  (created new liability)

interface GiftCardSalePostingData {
  saleId: string
  invoiceNumber: string
  saleDate: string
  amount: number
  paymentMethod: string
  customerId?: string | null
  costCenterId?: string | null
}

export async function postGiftCardSaleToGL(
  tx: DbOrTx,
  tenantId: string,
  data: GiftCardSalePostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultGiftCardLiabilityAccountId || !config.defaultCashAccountId) {
    const missing = [
      !config.defaultGiftCardLiabilityAccountId && 'Gift Card Liability',
      !config.defaultCashAccountId && 'Cash',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post gift card sale — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null
  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null

  // Resolve payment account from Modes of Payment, then fall back to accounting settings
  const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, data.paymentMethod)
  let paymentAccountId: string
  if (data.paymentMethod === 'gift_card') {
    paymentAccountId = modeAccount || config.defaultGiftCardLiabilityAccountId  // Buying gift card with another gift card
  } else if (modeAccount) {
    paymentAccountId = modeAccount
  } else if (data.paymentMethod === 'cash') {
    paymentAccountId = config.defaultCashAccountId
  } else if (data.paymentMethod === 'bank_transfer' || data.paymentMethod === 'card') {
    paymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
  } else {
    console.warn(`[GL] No Mode of Payment found for method "${data.paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
    paymentAccountId = config.defaultCashAccountId
  }

  // When paying with a gift card, both sides hit the same liability account (net zero)
  // Skip GL posting as it's just a liability transfer with no economic impact
  if (paymentAccountId === config.defaultGiftCardLiabilityAccountId) {
    return null
  }

  const entries: GLEntryInput[] = [
    {
      accountId: paymentAccountId,
      debit: amount,
      costCenterId,
      remarks: 'Gift card sale - payment received',
    },
    {
      accountId: config.defaultGiftCardLiabilityAccountId,
      credit: amount,
      costCenterId,
      remarks: 'Gift card liability created',
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.saleDate,
    voucherType: 'gift_card_sale',
    voucherId: data.saleId,
    voucherNumber: data.invoiceNumber,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Gift Card Reload GL ─────────────────────────────────────────
// When a gift card is reloaded (topped up), cash comes in and liability increases:
//   Dr Cash/Bank            [amount]  (received payment for reload)
//   Cr Gift Card Liability  [amount]  (increased deferred revenue)

interface GiftCardReloadPostingData {
  giftCardId: string
  transactionId: string
  amount: number
  paymentMethod?: string
  costCenterId?: string | null
}

export async function postGiftCardReloadToGL(
  tx: DbOrTx,
  tenantId: string,
  data: GiftCardReloadPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultGiftCardLiabilityAccountId || !config.defaultCashAccountId) {
    const missing = [
      !config.defaultGiftCardLiabilityAccountId && 'Gift Card Liability',
      !config.defaultCashAccountId && 'Cash',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post gift card reload — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null

  const paymentMethod = data.paymentMethod || 'cash'
  const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, paymentMethod)
  let paymentAccountId: string
  if (modeAccount) {
    paymentAccountId = modeAccount
  } else if (paymentMethod === 'cash') {
    paymentAccountId = config.defaultCashAccountId
  } else if (paymentMethod === 'bank_transfer' || paymentMethod === 'card') {
    paymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
  } else {
    console.warn(`[GL] No Mode of Payment found for method "${paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
    paymentAccountId = config.defaultCashAccountId
  }

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null

  const entries: GLEntryInput[] = [
    {
      accountId: paymentAccountId,
      debit: amount,
      costCenterId,
      remarks: 'Gift card reload - payment received',
    },
    {
      accountId: config.defaultGiftCardLiabilityAccountId,
      credit: amount,
      costCenterId,
      remarks: 'Gift card liability increased on reload',
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'gift_card_reload',
    voucherId: data.transactionId,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Customer Credit GL ──────────────────────────────────────────
// Manual customer credit operations (add, use, adjustment) need GL posting:
//   Add:        Dr Cash/Bank, Cr Customer Advance (received deposit)
//   Use:        Dr Customer Advance, Cr Accounts Receivable (applied to invoice)
//   Adjustment: Dr/Cr Customer Advance vs Dr/Cr Stock Adjustment account

interface CustomerCreditPostingData {
  transactionId: string
  customerId: string
  type: 'add' | 'refund' | 'overpayment' | 'use' | 'adjustment'
  amount: number
  paymentMethod?: string
  notes?: string
}

export async function postCustomerCreditToGL(
  tx: DbOrTx,
  tenantId: string,
  data: CustomerCreditPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultAdvanceReceivedAccountId) {
    return null // Customer Advance account not configured, skip GL posting
  }

  const amount = roundCurrency(Math.abs(data.amount))
  if (amount <= 0) return null

  const entries: GLEntryInput[] = []
  const costCenterId = config.defaultCostCenterId || null

  if (data.type === 'add' || data.type === 'refund' || data.type === 'overpayment') {
    // Receiving payment as customer deposit/advance
    // Dr Cash/Bank (asset ↑), Cr Customer Advance (liability ↑)
    if (!config.defaultCashAccountId) return null

    // M3: Resolve payment account from Modes of Payment instead of always Cash
    const method = data.paymentMethod || 'cash'
    const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, method)
    let cashAccountId: string
    if (modeAccount) {
      cashAccountId = modeAccount
    } else if (method === 'cash') {
      cashAccountId = config.defaultCashAccountId
    } else if (method === 'bank_transfer' || method === 'card') {
      cashAccountId = config.defaultBankAccountId || config.defaultCashAccountId
    } else {
      console.warn(`[GL] No Mode of Payment found for customer credit method "${method}" (tenant: ${tenantId}). Falling back to default Cash account.`)
      cashAccountId = config.defaultCashAccountId
    }

    entries.push({
      accountId: cashAccountId,
      debit: amount,
      costCenterId,
      remarks: `Customer credit ${data.type} (${method})`,
    })
    entries.push({
      accountId: config.defaultAdvanceReceivedAccountId,
      credit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: data.notes || `Customer advance received (${data.type})`,
    })
  } else if (data.type === 'use') {
    // Applying credit to settle receivable
    // Dr Customer Advance (liability ↓), Cr Accounts Receivable (asset ↓)
    if (!config.defaultReceivableAccountId) return null

    entries.push({
      accountId: config.defaultAdvanceReceivedAccountId,
      debit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: data.notes || 'Customer credit applied',
    })
    entries.push({
      accountId: config.defaultReceivableAccountId,
      credit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: 'Receivable settled by customer credit',
    })
  } else {
    // Adjustment — positive means adding credit, negative means reducing
    if (!config.defaultCashAccountId) return null

    if (data.amount >= 0) {
      entries.push({
        accountId: config.defaultCashAccountId,
        debit: amount,
        costCenterId,
        remarks: 'Customer credit adjustment (increase)',
      })
      entries.push({
        accountId: config.defaultAdvanceReceivedAccountId,
        credit: amount,
        partyType: 'customer',
        partyId: data.customerId,
        costCenterId,
        remarks: data.notes || 'Customer advance adjustment',
      })
    } else {
      entries.push({
        accountId: config.defaultAdvanceReceivedAccountId,
        debit: amount,
        partyType: 'customer',
        partyId: data.customerId,
        costCenterId,
        remarks: data.notes || 'Customer advance adjustment (reduction)',
      })
      entries.push({
        accountId: config.defaultCashAccountId,
        credit: amount,
        costCenterId,
        remarks: 'Customer credit adjustment (decrease)',
      })
    }
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'customer_credit',
    voucherId: data.transactionId,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Gift Card Redemption GL (standalone) ────────────────────────
// When a gift card is redeemed outside a POS sale (e.g., admin cash refund):
//   Dr Gift Card Liability  [amount]  (reduced deferred revenue)
//   Cr Cash/Bank            [amount]  (cash paid out)

interface GiftCardRedemptionPostingData {
  giftCardId: string
  transactionId: string
  amount: number
  saleId?: string | null // If linked to a sale, skip (handled by postSaleToGL)
}

export async function postGiftCardRedemptionToGL(
  tx: DbOrTx,
  tenantId: string,
  data: GiftCardRedemptionPostingData
): Promise<string[] | null> {
  // If linked to a sale, the sale's GL posting handles the gift card liability
  if (data.saleId) return null

  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultGiftCardLiabilityAccountId || !config.defaultCashAccountId) {
    const missing = [
      !config.defaultGiftCardLiabilityAccountId && 'Gift Card Liability',
      !config.defaultCashAccountId && 'Cash',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post gift card redemption — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null

  const entries: GLEntryInput[] = [
    {
      accountId: config.defaultGiftCardLiabilityAccountId,
      debit: amount,
      remarks: 'Gift card redeemed - liability reduced',
    },
    {
      accountId: config.defaultCashAccountId,
      credit: amount,
      remarks: 'Gift card redemption - cash paid out',
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'gift_card_redemption',
    voucherId: data.transactionId,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Credit Payment GL (for partial payments) ────────────────────
// When customer credit is used to pay a partially-paid sale:
//   Dr Customer Advance  [amount]  (liability ↓)
//   Cr Accounts Receivable [amount] (receivable ↓)

interface CreditPaymentPostingData {
  saleId: string
  paymentDate: string
  amount: number
  customerId: string
  referenceNumber?: string
  costCenterId?: string | null
}

export async function postCreditPaymentToGL(
  tx: DbOrTx,
  tenantId: string,
  data: CreditPaymentPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultAdvanceReceivedAccountId || !config.defaultReceivableAccountId) {
    return null // Required accounts not configured, skip
  }

  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null

  const entries: GLEntryInput[] = [
    {
      accountId: config.defaultAdvanceReceivedAccountId,
      debit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: 'Customer credit applied to sale payment',
    },
    {
      accountId: config.defaultReceivableAccountId,
      credit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: 'Receivable settled by customer credit',
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.paymentDate,
    voucherType: 'credit_payment',
    voucherId: data.saleId,
    voucherNumber: data.referenceNumber,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── POS Shift Closing: Cash Over/Short ─────────────────────────

interface PosShiftVarianceData {
  closingEntryId: string
  postingDate: string
  totalVariance: number // positive = over, negative = short
  notes?: string
}

/**
 * Post GL entry for POS shift cash variance (over/short).
 * - Short (variance < 0): Dr Cash Over/Short (expense) / Cr Cash
 * - Over  (variance > 0): Dr Cash / Cr Cash Over/Short (income)
 * Requires: autoPostSales + defaultCashOverShortAccountId + defaultCashAccountId
 */
export async function postPosShiftVarianceToGL(
  tx: DbOrTx,
  tenantId: string,
  data: PosShiftVarianceData
) {
  if (data.totalVariance === 0) return null

  const config = await getAccountingConfig(tx, tenantId)
  if (!config) return null
  if (!config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultCashOverShortAccountId || !config.defaultCashAccountId) {
    const missing = [
      !config.defaultCashOverShortAccountId && 'Cash Over/Short',
      !config.defaultCashAccountId && 'Cash',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post shift variance — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }

  const costCenterId = config.defaultCostCenterId || undefined
  const absVariance = roundCurrency(Math.abs(data.totalVariance))

  const entries: GLEntryInput[] = []

  if (data.totalVariance < 0) {
    // Cash SHORT: expense increased, cash decreased
    entries.push(
      {
        accountId: config.defaultCashOverShortAccountId,
        debit: absVariance,
        costCenterId,
        remarks: data.notes || 'POS shift cash shortage',
      },
      {
        accountId: config.defaultCashAccountId,
        credit: absVariance,
        costCenterId,
        remarks: data.notes || 'POS shift cash shortage',
      }
    )
  } else {
    // Cash OVER: cash increased, income/contra increased
    entries.push(
      {
        accountId: config.defaultCashAccountId,
        debit: absVariance,
        costCenterId,
        remarks: data.notes || 'POS shift cash overage',
      },
      {
        accountId: config.defaultCashOverShortAccountId,
        credit: absVariance,
        costCenterId,
        remarks: data.notes || 'POS shift cash overage',
      }
    )
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.postingDate,
    voucherType: 'pos_shift_closing',
    voucherId: data.closingEntryId,
    voucherNumber: `POS-CLOSE-${data.closingEntryId.slice(0, 8)}`,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Layaway Deposit/Payment GL Posting ─────────────────────────

interface LayawayPaymentPostingData {
  layawayId: string
  layawayNo: string
  paymentDate: string
  amount: number
  paymentMethod: string
  customerId: string
  costCenterId?: string | null
}

/**
 * Posts a layaway deposit/payment to GL.
 *
 * Dr Cash/Bank         [amount] (resolved from Modes of Payment)
 * Cr Advance Received  [amount] (customer deposit liability)
 */
export async function postLayawayPaymentToGL(
  tx: DbOrTx,
  tenantId: string,
  data: LayawayPaymentPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultAdvanceReceivedAccountId || !config.defaultCashAccountId) {
    return null // Required accounts not configured, skip
  }

  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null

  // Resolve payment account from Modes of Payment
  const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, data.paymentMethod)
  let paymentAccountId: string
  if (modeAccount) {
    paymentAccountId = modeAccount
  } else if (data.paymentMethod === 'cash') {
    paymentAccountId = config.defaultCashAccountId
  } else if (data.paymentMethod === 'bank_transfer' || data.paymentMethod === 'card') {
    paymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
  } else {
    console.warn(`[GL] No Mode of Payment found for layaway method "${data.paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
    paymentAccountId = config.defaultCashAccountId
  }

  const entries: GLEntryInput[] = [
    {
      accountId: paymentAccountId,
      debit: amount,
      costCenterId,
      remarks: `Layaway deposit received (${data.paymentMethod})`,
    },
    {
      accountId: config.defaultAdvanceReceivedAccountId,
      credit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: 'Customer layaway deposit',
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.paymentDate,
    voucherType: 'layaway_payment',
    voucherId: data.layawayId,
    voucherNumber: data.layawayNo,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Layaway Forfeit GL ─────────────────────────────────────────
// When a layaway is forfeited, the advance received liability must be reclassified:
//   Forfeited portion: Dr Advance Received (liability ↓), Cr Revenue/Other Income (income ↑)
//   Refund portion:    Handled by customer credit GL (postCustomerCreditToGL)

interface LayawayForfeitPostingData {
  layawayId: string
  layawayNo: string
  forfeitedAmount: number
  customerId: string
  costCenterId?: string | null
}

export async function postLayawayForfeitToGL(
  tx: DbOrTx,
  tenantId: string,
  data: LayawayForfeitPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultAdvanceReceivedAccountId || !config.defaultIncomeAccountId) {
    return null // Required accounts not configured, skip
  }

  const amount = roundCurrency(data.forfeitedAmount)
  if (amount <= 0) return null

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null

  const entries: GLEntryInput[] = [
    {
      accountId: config.defaultAdvanceReceivedAccountId,
      debit: amount,
      partyType: 'customer',
      partyId: data.customerId,
      costCenterId,
      remarks: `Layaway forfeit - advance reclassified as revenue`,
    },
    {
      accountId: config.defaultIncomeAccountId,
      credit: amount,
      costCenterId,
      remarks: `Layaway forfeit income (${data.layawayNo})`,
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'layaway_forfeit',
    voucherId: data.layawayId,
    voucherNumber: data.layawayNo,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Commission Payout GL ───────────────────────────────────────
// When a commission payout is marked as paid:
//   Dr Commission Expense  [amount]
//   Cr Cash/Bank           [amount]

interface CommissionPayoutPostingData {
  payoutId: string
  payoutNo: string
  amount: number
  paymentMethod: string
  costCenterId?: string | null
}

export async function postCommissionPayoutToGL(
  tx: DbOrTx,
  tenantId: string,
  data: CommissionPayoutPostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  // Commission Expense account — use COGS as fallback (commissions are a cost of sales)
  const expenseAccountId = config.defaultCOGSAccountId
  if (!expenseAccountId || !config.defaultCashAccountId) {
    return null // Required accounts not configured, skip
  }

  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null

  const costCenterId = data.costCenterId || config.defaultCostCenterId || null

  // Resolve payment account from Modes of Payment
  const modeAccount = await resolvePaymentAccountFromMode(tx, tenantId, data.paymentMethod)
  let paymentAccountId: string
  if (modeAccount) {
    paymentAccountId = modeAccount
  } else if (data.paymentMethod === 'cash') {
    paymentAccountId = config.defaultCashAccountId
  } else if (data.paymentMethod === 'bank_transfer' || data.paymentMethod === 'card') {
    paymentAccountId = config.defaultBankAccountId || config.defaultCashAccountId
  } else {
    console.warn(`[GL] No Mode of Payment found for commission payout method "${data.paymentMethod}" (tenant: ${tenantId}). Falling back to default Cash account.`)
    paymentAccountId = config.defaultCashAccountId
  }

  const entries: GLEntryInput[] = [
    {
      accountId: expenseAccountId,
      debit: amount,
      costCenterId,
      remarks: `Commission payout (${data.payoutNo})`,
    },
    {
      accountId: paymentAccountId,
      credit: amount,
      costCenterId,
      remarks: `Commission paid via ${data.paymentMethod}`,
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'commission_payout',
    voucherId: data.payoutId,
    voucherNumber: data.payoutNo,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}

// ─── Gift Card Breakage Revenue GL ──────────────────────────────
// When a gift card expires/is blocked with remaining balance:
//   Dr Gift Card Liability  [remainingBalance]
//   Cr Revenue              [remainingBalance]

interface GiftCardBreakagePostingData {
  giftCardId: string
  cardNumber: string
  remainingBalance: number
}

export async function postGiftCardBreakageToGL(
  tx: DbOrTx,
  tenantId: string,
  data: GiftCardBreakagePostingData
): Promise<string[] | null> {
  const config = await getAccountingConfig(tx, tenantId)
  if (!config || !config.autoPostSales) return null

  if (!config.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }

  if (!config.defaultGiftCardLiabilityAccountId || !config.defaultIncomeAccountId) {
    return null // Required accounts not configured, skip
  }

  const amount = roundCurrency(data.remainingBalance)
  if (amount <= 0) return null

  const costCenterId = config.defaultCostCenterId || null

  const entries: GLEntryInput[] = [
    {
      accountId: config.defaultGiftCardLiabilityAccountId,
      debit: amount,
      costCenterId,
      remarks: `Gift card breakage - liability written off (${data.cardNumber})`,
    },
    {
      accountId: config.defaultIncomeAccountId,
      credit: amount,
      costCenterId,
      remarks: `Gift card breakage revenue (${data.cardNumber})`,
    },
  ]

  return createGLEntries(tx, {
    tenantId,
    postingDate: new Date().toISOString().split('T')[0],
    voucherType: 'gift_card_breakage',
    voucherId: data.giftCardId,
    voucherNumber: data.cardNumber,
    fiscalYearId: config.currentFiscalYearId,
    entries,
  })
}
