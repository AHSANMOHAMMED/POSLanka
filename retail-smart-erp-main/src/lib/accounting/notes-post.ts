// GL posting for customer credit notes and debit notes (H2).
//
// Credit note (price correction / allowance after an invoice, no goods movement — goods coming
// back are a sales return, see POST /api/sales with isReturn):
//   Dr Sales Revenue        [net]
//   Dr Output VAT           [tax, per tax account]
//   Cr Accounts Receivable  [total]   (settlement 'receivable': reduces what the customer owes)
//   or Cr Cash/Bank         [total]   (settlement 'refund': money paid back)
//
// Debit note (additional charge against an invoice):
//   Dr Accounts Receivable  [total]
//   Cr Sales Revenue        [net]
//   Cr Output VAT           [tax, per tax account]

import { createGLEntries, reverseGLEntries, type GLEntryInput } from './gl'
import { accountingSettings, modesOfPayment } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { roundCurrency } from '@/lib/utils/currency'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

export const CREDIT_NOTE_VOUCHER = 'credit_note'
export const DEBIT_NOTE_VOUCHER = 'debit_note'

export interface NotePostingData {
  noteId: string
  noteNo: string
  postingDate: string // YYYY-MM-DD
  total: number
  tax: number
  taxBreakdown?: TaxBreakdownItem[] | null
  customerId?: string | null
  /** Original invoice the note adjusts (gl against-voucher link). */
  saleId?: string | null
  costCenterId?: string | null
}

async function loadSettings(tx: DbOrTx, tenantId: string) {
  const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  return settings || null
}

function requireAccounts(settings: { defaultIncomeAccountId: string | null; defaultReceivableAccountId: string | null; currentFiscalYearId: string | null }, what: string) {
  if (!settings.currentFiscalYearId) {
    throw new Error('No active fiscal year configured. Please set a current fiscal year in Accounting Settings.')
  }
  if (!settings.defaultIncomeAccountId || !settings.defaultReceivableAccountId) {
    const missing = [
      !settings.defaultIncomeAccountId && 'Sales Revenue',
      !settings.defaultReceivableAccountId && 'Accounts Receivable',
    ].filter(Boolean).join(', ')
    throw new Error(`GL_ACCOUNTS_MISSING: Cannot post ${what} — missing ${missing} account(s). Configure in Settings → Accounting.`)
  }
}

/** Per-account output VAT lines (falls back to the default tax account, like postSaleToGL). */
function taxLines(data: NotePostingData, defaultTaxAccountId: string | null): Array<{ accountId: string; amount: number }> {
  const byAccount = new Map<string, number>()
  if (data.taxBreakdown && data.taxBreakdown.length > 0) {
    for (const b of data.taxBreakdown) {
      const acct = b.accountId || defaultTaxAccountId
      if (!acct || !(b.amount > 0)) continue
      byAccount.set(acct, (byAccount.get(acct) || 0) + b.amount)
    }
  } else if (data.tax > 0 && defaultTaxAccountId) {
    byAccount.set(defaultTaxAccountId, data.tax)
  }
  if (data.tax > 0 && byAccount.size === 0) {
    throw new Error('GL_ACCOUNTS_MISSING: Cannot post output VAT — no tax account on the tax template and no default Tax account. Configure in Settings → Accounting.')
  }
  return [...byAccount].map(([accountId, amount]) => ({ accountId, amount: roundCurrency(amount) }))
}

async function refundAccount(tx: DbOrTx, tenantId: string, settings: Record<string, string | null>, method: string): Promise<string> {
  const [mode] = await tx.select({ defaultAccountId: modesOfPayment.defaultAccountId })
    .from(modesOfPayment)
    .where(and(eq(modesOfPayment.tenantId, tenantId), eq(modesOfPayment.methodKey, method), eq(modesOfPayment.isEnabled, true)))
    .limit(1)
  if (mode?.defaultAccountId) return mode.defaultAccountId
  if (method === 'bank_transfer' || method === 'card') {
    const acct = settings.defaultBankAccountId || settings.defaultCashAccountId
    if (acct) return acct
  }
  if (settings.defaultCashAccountId) return settings.defaultCashAccountId
  throw new Error('GL_ACCOUNTS_MISSING: Cannot post the refund — no Cash account configured.')
}

/**
 * Post an issued credit note. Returns null when the tenant has no accounting settings or has
 * sales auto-posting switched off (same contract as postSaleToGL).
 */
export async function postCreditNoteToGL(
  tx: DbOrTx,
  tenantId: string,
  data: NotePostingData & { settlement: 'receivable' | 'refund'; refundMethod?: string | null }
): Promise<string[] | null> {
  const settings = await loadSettings(tx, tenantId)
  if (!settings || !settings.autoPostSales) return null
  requireAccounts(settings, 'credit note')
  const costCenterId = data.costCenterId || settings.defaultCostCenterId || null
  const vat = taxLines(data, settings.defaultTaxAccountId)
  const vatTotal = roundCurrency(vat.reduce((s, v) => s + v.amount, 0))
  const total = roundCurrency(data.total)
  const net = roundCurrency(total - vatTotal)
  const party = { partyType: data.customerId ? 'customer' as const : null, partyId: data.customerId || null }
  const against = data.saleId ? { againstVoucherType: 'sale', againstVoucherId: data.saleId } : {}

  const entries: GLEntryInput[] = []
  if (net > 0) entries.push({ accountId: settings.defaultIncomeAccountId!, debit: net, costCenterId, remarks: `Credit note ${data.noteNo}` })
  for (const v of vat) entries.push({ accountId: v.accountId, debit: v.amount, costCenterId, remarks: `Output VAT reversed — credit note ${data.noteNo}` })
  if (data.settlement === 'refund') {
    entries.push({
      accountId: await refundAccount(tx, tenantId, settings, data.refundMethod || 'cash'),
      credit: total, ...party, costCenterId, remarks: `Refund — credit note ${data.noteNo}`,
    })
  } else {
    entries.push({ accountId: settings.defaultReceivableAccountId!, credit: total, ...party, ...against, costCenterId, remarks: `Credit note ${data.noteNo}` })
  }

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.postingDate,
    voucherType: CREDIT_NOTE_VOUCHER,
    voucherId: data.noteId,
    voucherNumber: data.noteNo,
    fiscalYearId: settings.currentFiscalYearId,
    entries,
  })
}

/** Post an issued customer debit note (null when auto-posting is off / not configured). */
export async function postDebitNoteToGL(tx: DbOrTx, tenantId: string, data: NotePostingData): Promise<string[] | null> {
  const settings = await loadSettings(tx, tenantId)
  if (!settings || !settings.autoPostSales) return null
  requireAccounts(settings, 'debit note')
  const costCenterId = data.costCenterId || settings.defaultCostCenterId || null
  const vat = taxLines(data, settings.defaultTaxAccountId)
  const vatTotal = roundCurrency(vat.reduce((s, v) => s + v.amount, 0))
  const total = roundCurrency(data.total)
  const net = roundCurrency(total - vatTotal)
  const party = { partyType: data.customerId ? 'customer' as const : null, partyId: data.customerId || null }
  const against = data.saleId ? { againstVoucherType: 'sale', againstVoucherId: data.saleId } : {}

  const entries: GLEntryInput[] = [
    { accountId: settings.defaultReceivableAccountId!, debit: total, ...party, ...against, costCenterId, remarks: `Debit note ${data.noteNo}` },
  ]
  if (net > 0) entries.push({ accountId: settings.defaultIncomeAccountId!, credit: net, costCenterId, remarks: `Debit note ${data.noteNo}` })
  for (const v of vat) entries.push({ accountId: v.accountId, credit: v.amount, costCenterId, remarks: `Output VAT — debit note ${data.noteNo}` })

  return createGLEntries(tx, {
    tenantId,
    postingDate: data.postingDate,
    voucherType: DEBIT_NOTE_VOUCHER,
    voucherId: data.noteId,
    voucherNumber: data.noteNo,
    fiscalYearId: settings.currentFiscalYearId,
    entries,
  })
}

/** Reverse a note's postings on cancellation (no-op when nothing was posted). */
export async function reverseNoteGL(tx: DbOrTx, tenantId: string, kind: 'credit_note' | 'debit_note', noteId: string, reversalDate: string): Promise<string[]> {
  return reverseGLEntries(tx, tenantId, kind === 'credit_note' ? CREDIT_NOTE_VOUCHER : DEBIT_NOTE_VOUCHER, noteId, reversalDate)
}
