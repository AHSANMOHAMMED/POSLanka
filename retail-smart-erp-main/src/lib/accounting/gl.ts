// Core General Ledger functions
// Creates, validates, and reverses GL entries using double-entry bookkeeping

import { eq, and, sql, lte, inArray } from 'drizzle-orm'
import { glEntries, chartOfAccounts, fiscalYears } from '@/lib/db/schema'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// Accept any drizzle DB instance (PgTransaction or NodePgDatabase)
// Both support insert/select/update which is all we need
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

export interface GLEntryInput {
  accountId: string
  debit?: number
  credit?: number
  partyType?: 'customer' | 'supplier' | 'employee' | null
  partyId?: string | null
  costCenterId?: string | null
  againstVoucherType?: string | null
  againstVoucherId?: string | null
  remarks?: string | null
}

export interface GLPostingInput {
  tenantId: string
  postingDate: string // YYYY-MM-DD
  voucherType: string
  voucherId: string
  voucherNumber?: string
  fiscalYearId?: string | null
  isOpening?: boolean
  skipFiscalYearValidation?: boolean // Only for period-closing entries
  entries: GLEntryInput[]
}

/**
 * Validates that total debits equal total credits (fundamental double-entry rule)
 */
export function validateDoubleEntry(entries: GLEntryInput[]): { valid: boolean; difference: number } {
  let totalDebit = 0
  let totalCredit = 0

  for (const entry of entries) {
    totalDebit += Number(entry.debit || 0)
    totalCredit += Number(entry.credit || 0)
  }

  // Round to 2 decimal places to avoid floating point issues
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100

  return {
    valid: difference === 0,
    difference,
  }
}

/**
 * Creates GL entries within a transaction. Validates double-entry before inserting.
 * Also updates account running balances.
 */
export async function createGLEntries(
  tx: DbOrTx,
  input: GLPostingInput
): Promise<string[]> {
  const { tenantId, postingDate, voucherType, voucherId, voucherNumber, fiscalYearId, isOpening, skipFiscalYearValidation, entries } = input

  if (entries.length === 0) {
    throw new Error('At least one GL entry is required')
  }

  // Validate double-entry
  const validation = validateDoubleEntry(entries)
  if (!validation.valid) {
    throw new Error(`Double-entry validation failed: debits and credits differ by ${validation.difference}`)
  }

  // Validate fiscal year is open and posting date falls within it
  if (fiscalYearId && !skipFiscalYearValidation) {
    const [fy] = await tx.select().from(fiscalYears)
      .where(eq(fiscalYears.id, fiscalYearId))

    if (!fy) {
      throw new Error('Fiscal year not found')
    }
    if (fy.isClosed) {
      throw new Error(`Cannot post to closed fiscal year "${fy.name}". Reopen the fiscal year first.`)
    }
    if (postingDate < fy.startDate || postingDate > fy.endDate) {
      throw new Error(`Posting date ${postingDate} is outside fiscal year "${fy.name}" (${fy.startDate} to ${fy.endDate})`)
    }
  }

  // Validate all target accounts are active before posting
  const uniqueAccountIds = [...new Set(entries.map(e => e.accountId))]
  const accountStatuses = await tx.select({
    id: chartOfAccounts.id,
    name: chartOfAccounts.name,
    isActive: chartOfAccounts.isActive,
  })
    .from(chartOfAccounts)
    .where(inArray(chartOfAccounts.id, uniqueAccountIds))

  const inactiveAccounts = accountStatuses.filter((a: { isActive: boolean }) => !a.isActive)
  if (inactiveAccounts.length > 0) {
    const names = inactiveAccounts.map((a: { name: string }) => a.name).join(', ')
    throw new Error(`Cannot post to inactive account(s): ${names}`)
  }

  const insertedIds: string[] = []

  for (const entry of entries) {
    const debit = Number(entry.debit || 0)
    const credit = Number(entry.credit || 0)

    // Skip zero entries
    if (debit === 0 && credit === 0) continue

    // Validate debit XOR credit (not both on same entry)
    if (debit > 0 && credit > 0) {
      throw new Error(`GL entry for account ${entry.accountId} has both debit (${debit}) and credit (${credit}). Each entry must have only one.`)
    }

    const [inserted] = await tx.insert(glEntries).values({
      tenantId,
      postingDate,
      accountId: entry.accountId,
      debit: String(debit),
      credit: String(credit),
      partyType: entry.partyType || null,
      partyId: entry.partyId || null,
      costCenterId: entry.costCenterId || null,
      voucherType,
      voucherId,
      voucherNumber: voucherNumber || null,
      againstVoucherType: entry.againstVoucherType || null,
      againstVoucherId: entry.againstVoucherId || null,
      remarks: entry.remarks || null,
      isOpening: isOpening || false,
      fiscalYearId: fiscalYearId || null,
    }).returning({ id: glEntries.id })

    insertedIds.push(inserted.id)

    // Update account running balance
    // Convention: balance is stored as (total debits - total credits) for ALL account types.
    // For asset/expense accounts, a positive stored balance = normal (debit) balance.
    // For liability/income/equity, a negative stored balance = normal (credit) balance.
    // Reports interpret the sign based on rootType (see reports.ts).
    // Fix #16: Round the balanceChange to avoid floating-point drift
    const balanceChange = Math.round((debit - credit) * 100) / 100
    await tx.update(chartOfAccounts)
      .set({
        balance: sql`CAST(CAST(${chartOfAccounts.balance} AS numeric) + ${balanceChange} AS numeric(15,2))`,
        updatedAt: new Date(),
      })
      .where(eq(chartOfAccounts.id, entry.accountId))
  }

  // Broadcast GL entry creation and affected account updates for real-time UI refresh
  if (insertedIds.length > 0) {
    logAndBroadcast(tenantId, 'gl-entry', 'created', voucherId)
    // Notify account updates so COA balances refresh
    const affectedAccountIds = new Set(entries.filter(e => (Number(e.debit || 0) + Number(e.credit || 0)) > 0).map(e => e.accountId))
    for (const accountId of affectedAccountIds) {
      logAndBroadcast(tenantId, 'account', 'updated', accountId)
    }
  }

  return insertedIds
}

/**
 * Reverses all GL entries for a given voucher by creating opposite entries.
 * Used for voids, cancellations, and corrections.
 */
export async function reverseGLEntries(
  tx: DbOrTx,
  tenantId: string,
  voucherType: string,
  voucherId: string,
  reversalDate?: string
): Promise<string[]> {
  // Find all existing entries for this voucher, excluding any prior reversal entries
  const allEntries = await tx.select()
    .from(glEntries)
    .where(and(
      eq(glEntries.tenantId, tenantId),
      eq(glEntries.voucherType, voucherType),
      eq(glEntries.voucherId, voucherId),
    ))

  // Filter out reversal entries to prevent double-reversal
  const existingEntries = allEntries.filter((e: { remarks?: string | null; voucherNumber?: string | null }) =>
    !e.remarks?.startsWith('Reversal:') &&
    !e.voucherNumber?.startsWith('REV-')
  )

  if (existingEntries.length === 0) {
    return [] // No entries to reverse (or already reversed)
  }

  // Check if reversal already exists (guard against double-reversal)
  const hasReversal = allEntries.some((e: { remarks?: string | null; voucherNumber?: string | null }) =>
    e.remarks?.startsWith('Reversal:') || e.voucherNumber?.startsWith('REV-')
  )
  if (hasReversal) {
    return [] // Already reversed, skip
  }

  // Create reversal entries (swap debits and credits)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reversalEntries: GLEntryInput[] = existingEntries.map((entry: any) => ({
    accountId: entry.accountId,
    debit: Number(entry.credit), // Swap
    credit: Number(entry.debit), // Swap
    partyType: entry.partyType,
    partyId: entry.partyId,
    costCenterId: entry.costCenterId,
    remarks: `Reversal: ${entry.remarks || ''}`.trim(),
  }))

  return createGLEntries(tx, {
    tenantId,
    postingDate: reversalDate || existingEntries[0].postingDate,
    voucherType: voucherType,
    voucherId: voucherId,
    voucherNumber: existingEntries[0].voucherNumber ? `REV-${existingEntries[0].voucherNumber}` : undefined,
    fiscalYearId: existingEntries[0].fiscalYearId,
    entries: reversalEntries,
  })
}

/**
 * Gets the balance of an account as of a specific date.
 * Returns the sum of (debits - credits) for the account.
 */
export async function getAccountBalance(
  db: DbOrTx,
  tenantId: string,
  accountId: string,
  asOfDate?: string
): Promise<number> {
  const conditions = [
    eq(glEntries.tenantId, tenantId),
    eq(glEntries.accountId, accountId),
  ]

  if (asOfDate) {
    conditions.push(lte(glEntries.postingDate, asOfDate))
  }

  const result = await db.select({
    totalDebit: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
    totalCredit: sql<string>`COALESCE(SUM(CAST(${glEntries.credit} AS numeric)), 0)`,
  })
    .from(glEntries)
    .where(and(...conditions))

  const totalDebit = Number(result[0]?.totalDebit || 0)
  const totalCredit = Number(result[0]?.totalCredit || 0)

  return Math.round((totalDebit - totalCredit) * 100) / 100
}
