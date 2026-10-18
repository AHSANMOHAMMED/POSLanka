// Payment Entry business logic
// Handles GL posting, outstanding calculations, allocation, and submission

import { createGLEntries, type GLEntryInput } from './gl'
import { accountingSettings, paymentEntries, paymentLedger, paymentSchedules, sales, purchases } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

interface AccountingConfig {
  defaultReceivableAccountId: string | null
  defaultPayableAccountId: string | null
  defaultCashAccountId: string | null
  defaultBankAccountId: string | null
  defaultWriteOffAccountId: string | null
  defaultAdvanceReceivedAccountId: string | null
  defaultAdvancePaidAccountId: string | null
  currentFiscalYearId: string | null
}

async function getPaymentAccountingConfig(tx: DbOrTx, tenantId: string): Promise<AccountingConfig | null> {
  const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  if (!settings) return null
  return {
    defaultReceivableAccountId: settings.defaultReceivableAccountId,
    defaultPayableAccountId: settings.defaultPayableAccountId,
    defaultCashAccountId: settings.defaultCashAccountId,
    defaultBankAccountId: settings.defaultBankAccountId,
    defaultWriteOffAccountId: settings.defaultWriteOffAccountId,
    defaultAdvanceReceivedAccountId: settings.defaultAdvanceReceivedAccountId,
    defaultAdvancePaidAccountId: settings.defaultAdvancePaidAccountId,
    currentFiscalYearId: settings.currentFiscalYearId,
  }
}

interface PaymentEntryData {
  id: string
  tenantId: string
  entryNumber: string
  paymentType: 'receive' | 'pay' | 'internal_transfer'
  postingDate: string
  partyType?: 'customer' | 'supplier' | null
  partyId?: string | null
  paidFromAccountId: string
  paidToAccountId: string
  paidAmount: number
  receivedAmount: number
  totalAllocatedAmount: number
  unallocatedAmount: number
  writeOffAmount: number
  references: Array<{
    referenceType: string
    referenceId: string
    referenceNumber?: string | null
    totalAmount: number
    outstandingAmount: number
    allocatedAmount: number
    paymentScheduleId?: string | null
  }>
  costCenterId?: string | null
  deductions: Array<{
    accountId: string
    costCenterId?: string | null
    amount: number
    description?: string | null
  }>
}

/**
 * Posts a submitted PaymentEntry to the General Ledger.
 *
 * Receive (customer pays):
 *   Dr: paid_to (Bank/Cash)        [receivedAmount]
 *   Cr: paid_from (Receivable)     [paidAmount] party=customer
 *
 * Pay (to supplier):
 *   Dr: paid_to (Payable)          [paidAmount] party=supplier
 *   Cr: paid_from (Bank/Cash)      [paidAmount]
 *
 * Internal Transfer:
 *   Dr: paid_to (Bank B)           [receivedAmount]
 *   Cr: paid_from (Bank A)         [paidAmount]
 *
 * Deductions create additional GL entries for write-offs/exchange differences.
 */
export async function postPaymentEntryToGL(
  tx: DbOrTx,
  data: PaymentEntryData
): Promise<string[]> {
  const config = await getPaymentAccountingConfig(tx, data.tenantId)
  const entries: GLEntryInput[] = []

  if (data.paymentType === 'receive') {
    // Dr: Bank/Cash (paid_to)
    entries.push({
      accountId: data.paidToAccountId,
      debit: data.receivedAmount,
      costCenterId: data.costCenterId || null,
      remarks: `Payment received - ${data.entryNumber}`,
    })

    // For each reference, create a separate Cr entry with against_voucher
    if (data.references.length > 0) {
      for (const ref of data.references) {
        entries.push({
          accountId: data.paidFromAccountId,
          credit: ref.allocatedAmount,
          partyType: data.partyType || null,
          partyId: data.partyId || null,
          costCenterId: data.costCenterId || null,
          againstVoucherType: ref.referenceType,
          againstVoucherId: ref.referenceId,
          remarks: `Payment against ${ref.referenceNumber || ref.referenceType}`,
        })
      }
    }

    // Unallocated amount (advance)
    if (data.unallocatedAmount > 0) {
      entries.push({
        accountId: data.paidFromAccountId,
        credit: data.unallocatedAmount,
        partyType: data.partyType || null,
        partyId: data.partyId || null,
        costCenterId: data.costCenterId || null,
        remarks: 'Advance payment (unallocated)',
      })
    }
  } else if (data.paymentType === 'pay') {
    // Dr: Payable (paid_to) - for each reference with against_voucher
    if (data.references.length > 0) {
      for (const ref of data.references) {
        entries.push({
          accountId: data.paidToAccountId,
          debit: ref.allocatedAmount,
          partyType: data.partyType || null,
          partyId: data.partyId || null,
          costCenterId: data.costCenterId || null,
          againstVoucherType: ref.referenceType,
          againstVoucherId: ref.referenceId,
          remarks: `Payment against ${ref.referenceNumber || ref.referenceType}`,
        })
      }
    }

    // Unallocated amount (advance to supplier)
    if (data.unallocatedAmount > 0) {
      entries.push({
        accountId: data.paidToAccountId,
        debit: data.unallocatedAmount,
        partyType: data.partyType || null,
        partyId: data.partyId || null,
        costCenterId: data.costCenterId || null,
        remarks: 'Advance payment (unallocated)',
      })
    }

    // Cr: Bank/Cash (paid_from)
    entries.push({
      accountId: data.paidFromAccountId,
      credit: data.paidAmount,
      costCenterId: data.costCenterId || null,
      remarks: `Payment made - ${data.entryNumber}`,
    })
  } else {
    // Internal Transfer
    entries.push({
      accountId: data.paidToAccountId,
      debit: data.receivedAmount,
      costCenterId: data.costCenterId || null,
      remarks: `Internal transfer in - ${data.entryNumber}`,
    })
    entries.push({
      accountId: data.paidFromAccountId,
      credit: data.paidAmount,
      costCenterId: data.costCenterId || null,
      remarks: `Internal transfer out - ${data.entryNumber}`,
    })
  }

  // Deductions (write-off, exchange gain/loss)
  for (const deduction of data.deductions) {
    entries.push({
      accountId: deduction.accountId,
      debit: deduction.amount > 0 ? Math.round(deduction.amount * 100) / 100 : 0,
      credit: deduction.amount < 0 ? Math.round(Math.abs(deduction.amount) * 100) / 100 : 0,
      costCenterId: deduction.costCenterId || null,
      remarks: deduction.description || 'Payment deduction',
    })
  }

  // Fix #11: Verify entries balance before posting (defense-in-depth)
  const totalDebit = entries.reduce((sum, e) => sum + (e.debit || 0), 0)
  const totalCredit = entries.reduce((sum, e) => sum + (e.credit || 0), 0)
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100
  if (diff !== 0) {
    throw new Error(`Payment entry GL imbalance: debits=${totalDebit}, credits=${totalCredit}, diff=${diff}`)
  }

  return createGLEntries(tx, {
    tenantId: data.tenantId,
    postingDate: data.postingDate,
    voucherType: 'payment_entry',
    voucherId: data.id,
    voucherNumber: data.entryNumber,
    fiscalYearId: config?.currentFiscalYearId || null,
    entries,
  })
}

/**
 * Updates invoice outstanding amounts after payment allocation.
 * Updates paidAmount on sales/purchases and payment schedule statuses.
 */
export async function updateInvoiceOutstanding(
  tx: DbOrTx,
  references: PaymentEntryData['references']
): Promise<void> {
  for (const ref of references) {
    if (ref.referenceType === 'sale') {
      // Update sale paidAmount
      await tx.update(sales).set({
        paidAmount: sql`CAST(CAST(${sales.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(12,2))`,
        status: sql`CASE
          WHEN CAST(CAST(${sales.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(12,2)) >= CAST(${sales.total} AS numeric) THEN 'completed'
          WHEN CAST(CAST(${sales.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(12,2)) > 0 THEN 'partial'
          ELSE ${sales.status}
        END`,
      }).where(eq(sales.id, ref.referenceId))
    } else if (ref.referenceType === 'purchase') {
      // Update purchase paidAmount
      await tx.update(purchases).set({
        paidAmount: sql`CAST(CAST(${purchases.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(12,2))`,
        status: sql`CASE
          WHEN CAST(CAST(${purchases.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(12,2)) >= CAST(${purchases.total} AS numeric) THEN 'paid'
          WHEN CAST(CAST(${purchases.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(12,2)) > 0 THEN 'partial'
          ELSE ${purchases.status}
        END`,
      }).where(eq(purchases.id, ref.referenceId))
    }

    // Update payment schedule if linked
    if (ref.paymentScheduleId) {
      await tx.update(paymentSchedules).set({
        paidAmount: sql`CAST(CAST(${paymentSchedules.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(15,2))`,
        outstanding: sql`CAST(CAST(${paymentSchedules.outstanding} AS numeric) - ${ref.allocatedAmount} AS numeric(15,2))`,
        status: sql`CASE
          WHEN CAST(CAST(${paymentSchedules.outstanding} AS numeric) - ${ref.allocatedAmount} AS numeric(15,2)) <= 0 THEN 'paid'
          WHEN CAST(CAST(${paymentSchedules.paidAmount} AS numeric) + ${ref.allocatedAmount} AS numeric(15,2)) > 0 THEN 'partly_paid'
          ELSE ${paymentSchedules.status}
        END`,
      }).where(eq(paymentSchedules.id, ref.paymentScheduleId))
    }
  }
}

/**
 * Creates payment ledger entries for fast outstanding queries.
 */
export async function createPaymentLedgerEntries(
  tx: DbOrTx,
  data: PaymentEntryData,
  config: AccountingConfig | null
): Promise<void> {
  if (!data.partyType || !data.partyId) return

  const accountType = data.partyType === 'customer' ? 'receivable' : 'payable'
  const accountId = data.partyType === 'customer'
    ? (config?.defaultReceivableAccountId || data.paidFromAccountId)
    : (config?.defaultPayableAccountId || data.paidToAccountId)

  // For each reference, create a negative entry (reduces outstanding)
  for (const ref of data.references) {
    await tx.insert(paymentLedger).values({
      tenantId: data.tenantId,
      postingDate: data.postingDate,
      accountType,
      accountId,
      partyType: data.partyType,
      partyId: data.partyId,
      voucherType: 'payment_entry',
      voucherId: data.id,
      againstVoucherType: ref.referenceType,
      againstVoucherId: ref.referenceId,
      amount: String(-ref.allocatedAmount), // negative = reduces outstanding
      dueDate: null,
    })
  }

  // Unallocated (advance) entry
  if (data.unallocatedAmount > 0) {
    await tx.insert(paymentLedger).values({
      tenantId: data.tenantId,
      postingDate: data.postingDate,
      accountType,
      accountId,
      partyType: data.partyType,
      partyId: data.partyId,
      voucherType: 'payment_entry',
      voucherId: data.id,
      amount: String(-data.unallocatedAmount),
      dueDate: null,
    })
  }
}

/**
 * Calculate payment schedule due dates from a template
 */
export function calculatePaymentSchedule(
  invoiceDate: string, // YYYY-MM-DD
  total: number,
  templateItems: Array<{
    paymentTermId: string
    invoicePortion: number
    dueDateBasedOn: string
    creditDays: number
    discountType?: string | null
    discount?: number | null
    discountValidityDays?: number | null
  }>
): Array<{
  paymentTermId: string
  dueDate: string
  invoicePortion: number
  paymentAmount: number
  outstanding: number
  discountType?: string | null
  discount?: number | null
  discountDate?: string | null
}> {
  const baseDate = new Date(invoiceDate)
  return templateItems.map(item => {
    let dueDate: Date

    switch (item.dueDateBasedOn) {
      case 'days_after_invoice':
        dueDate = new Date(baseDate)
        dueDate.setDate(dueDate.getDate() + item.creditDays)
        break
      case 'days_after_month_end': {
        dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0) // last day of month
        dueDate.setDate(dueDate.getDate() + item.creditDays)
        break
      }
      case 'months_after_month_end': {
        dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1 + item.creditDays, 0) // last day of month + N months
        break
      }
      default:
        dueDate = new Date(baseDate)
        dueDate.setDate(dueDate.getDate() + item.creditDays)
    }

    const paymentAmount = Math.round((total * item.invoicePortion / 100) * 100) / 100

    let discountDate: string | null = null
    if (item.discountValidityDays && item.discountValidityDays > 0) {
      const dd = new Date(baseDate)
      dd.setDate(dd.getDate() + item.discountValidityDays)
      discountDate = dd.toISOString().split('T')[0]
    }

    return {
      paymentTermId: item.paymentTermId,
      dueDate: dueDate.toISOString().split('T')[0],
      invoicePortion: item.invoicePortion,
      paymentAmount,
      outstanding: paymentAmount,
      discountType: item.discountType || null,
      discount: item.discount || null,
      discountDate,
    }
  })
}

/**
 * Generate a unique entry number for payment entries
 */
export async function generateEntryNumber(tx: DbOrTx, tenantId: string): Promise<string> {
  // Use advisory lock to prevent duplicate numbers
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payment_entry_' || ${tenantId}))`)

  const [result] = await tx.select({
    maxNum: sql<string>`COALESCE(MAX(CAST(SUBSTRING(${paymentEntries.entryNumber} FROM 4) AS integer)), 0)`,
  }).from(paymentEntries)

  const nextNum = Number(result?.maxNum || 0) + 1
  return `PE-${String(nextNum).padStart(4, '0')}`
}
