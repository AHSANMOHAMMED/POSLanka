// Core General Ledger functions
// Creates, validates, and reverses GL entries using double-entry bookkeeping

import { eq, and, sql, lte, gte, inArray } from 'drizzle-orm'
import { glEntries, chartOfAccounts, fiscalYears } from '@/lib/db/schema'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { getTenantTimezone, localParts } from '@/lib/notifications/alert-settings'

/**
 * Thrown for postings that are invalid as requested (unbalanced, closed period, bad account).
 * Routes map it to a 400 with the message instead of a generic 500.
 */
export class GLValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GLValidationError'
  }
}

/** Today's date (YYYY-MM-DD) in the tenant's timezone (Asia/Colombo by default), not UTC. */
export async function tenantToday(tenantId: string, now: Date = new Date()): Promise<string> {
  const tz = await getTenantTimezone(tenantId)
  return localParts(now, tz).date
}

/** Round to cents (half away from zero), avoiding binary float artefacts like 1.005 -> 1.00. */
function cents(value: number): number {
  const n = Number(value) || 0
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100
}

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

  // Compare the amounts exactly as they will be stored (numeric(15,2)): summing unrounded
  // values let e.g. 3 x 33.333 "balance" 100.00 and then persist as 99.99 vs 100.00.
  for (const entry of entries) {
    totalDebit += Math.round(cents(Number(entry.debit || 0)) * 100)
    totalCredit += Math.round(cents(Number(entry.credit || 0)) * 100)
  }

  const difference = (totalDebit - totalCredit) / 100

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
  const { tenantId, postingDate, voucherType, voucherId, voucherNumber, fiscalYearId: requestedFiscalYearId, isOpening, skipFiscalYearValidation, entries } = input

  if (entries.length === 0) {
    throw new GLValidationError('At least one GL entry is required')
  }

  for (const entry of entries) {
    const d = Number(entry.debit || 0)
    const c = Number(entry.credit || 0)
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) {
      throw new GLValidationError(`GL entry for account ${entry.accountId} has an invalid amount (debit ${entry.debit}, credit ${entry.credit}). Amounts must be zero or positive.`)
    }
  }

  // Validate double-entry
  const validation = validateDoubleEntry(entries)
  if (!validation.valid) {
    throw new GLValidationError(`Double-entry validation failed: debits and credits differ by ${validation.difference}`)
  }

  // Resolve the fiscal year from the POSTING DATE (fiscal years never overlap), so a posting
  // can never land in a closed year, and the year rollover does not halt posting just because
  // Accounting Settings still points at last year.
  let fiscalYearId: string | null = requestedFiscalYearId || null
  if (!skipFiscalYearValidation) {
    const [byDate] = await tx.select().from(fiscalYears)
      .where(and(
        eq(fiscalYears.tenantId, tenantId),
        lte(fiscalYears.startDate, postingDate),
        gte(fiscalYears.endDate, postingDate),
      ))
      .limit(1)

    if (byDate) {
      if (byDate.isClosed) {
        throw new GLValidationError(`Cannot post to closed fiscal year "${byDate.name}". Reopen the fiscal year first.`)
      }
      fiscalYearId = byDate.id
    } else if (requestedFiscalYearId) {
      const [fy] = await tx.select().from(fiscalYears)
        .where(eq(fiscalYears.id, requestedFiscalYearId))
      if (!fy) {
        throw new GLValidationError('Fiscal year not found')
      }
      throw new GLValidationError(`Posting date ${postingDate} is outside fiscal year "${fy.name}" (${fy.startDate} to ${fy.endDate}) and no fiscal year covers it. Create the fiscal year first.`)
    }
  }

  // Validate all target accounts exist for this tenant, are ledger (non-group) and active
  const uniqueAccountIds = [...new Set(entries.map(e => e.accountId))]
  const accountStatuses = await tx.select({
    id: chartOfAccounts.id,
    name: chartOfAccounts.name,
    isActive: chartOfAccounts.isActive,
    isGroup: chartOfAccounts.isGroup,
  })
    .from(chartOfAccounts)
    .where(and(
      eq(chartOfAccounts.tenantId, tenantId),
      inArray(chartOfAccounts.id, uniqueAccountIds),
    ))

  if (accountStatuses.length !== uniqueAccountIds.length) {
    const found = new Set(accountStatuses.map((a: { id: string }) => a.id))
    const missing = uniqueAccountIds.filter(id => !found.has(id))
    throw new GLValidationError(`Account(s) not found: ${missing.join(', ')}`)
  }

  const groupAccounts = accountStatuses.filter((a: { isGroup: boolean }) => a.isGroup)
  if (groupAccounts.length > 0) {
    const names = groupAccounts.map((a: { name: string }) => a.name).join(', ')
    throw new GLValidationError(`Cannot post to group account(s): ${names}. Choose a ledger account.`)
  }

  const inactiveAccounts = accountStatuses.filter((a: { isActive: boolean }) => !a.isActive)
  if (inactiveAccounts.length > 0) {
    const names = inactiveAccounts.map((a: { name: string }) => a.name).join(', ')
    throw new GLValidationError(`Cannot post to inactive account(s): ${names}`)
  }

  const insertedIds: string[] = []

  for (const entry of entries) {
    const debit = cents(Number(entry.debit || 0))
    const credit = cents(Number(entry.credit || 0))

    // Skip zero entries
    if (debit === 0 && credit === 0) continue

    // Validate debit XOR credit (not both on same entry)
    if (debit > 0 && credit > 0) {
      throw new GLValidationError(`GL entry for account ${entry.accountId} has both debit (${debit}) and credit (${credit}). Each entry must have only one.`)
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
    const balanceChange = cents(debit - credit)
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
 *
 * The reversal is computed from the voucher's NET position per (account, party, cost center,
 * against-voucher): whatever is still on the books for this voucher is taken off. This makes it
 * idempotent (a second call finds a zero net and posts nothing) and still correct when the same
 * voucher id was posted again after an earlier reversal (e.g. a work order re-invoiced after
 * its invoice was voided) — the old "any reversal exists → skip" guard left that re-posting on
 * the ledger forever.
 */
export async function reverseGLEntries(
  tx: DbOrTx,
  tenantId: string,
  voucherType: string,
  voucherId: string,
  reversalDate?: string
): Promise<string[]> {
  const allEntries = await tx.select()
    .from(glEntries)
    .where(and(
      eq(glEntries.tenantId, tenantId),
      eq(glEntries.voucherType, voucherType),
      eq(glEntries.voucherId, voucherId),
    ))
    .orderBy(glEntries.createdAt)

  if (allEntries.length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isReversal = (e: any) => !!(e.remarks?.startsWith('Reversal:') || e.voucherNumber?.startsWith('REV-'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originals = allEntries.filter((e: any) => !isReversal(e))
  if (originals.length === 0) return []

  // Net (in cents) per key
  const nets = new Map<string, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sample: any
    netCents: number
  }>()
  for (const e of allEntries) {
    const key = [e.accountId, e.partyType || '', e.partyId || '', e.costCenterId || '', e.againstVoucherType || '', e.againstVoucherId || ''].join('|')
    const delta = Math.round(Number(e.debit || 0) * 100) - Math.round(Number(e.credit || 0) * 100)
    const cur = nets.get(key)
    if (cur) {
      cur.netCents += delta
      if (isReversal(cur.sample) && !isReversal(e)) cur.sample = e
    } else {
      nets.set(key, { sample: e, netCents: delta })
    }
  }

  const reversalEntries: GLEntryInput[] = []
  if (!allEntries.some(isReversal)) {
    // First reversal: mirror every original line (keeps the per-line audit detail)
    for (const e of originals) {
      reversalEntries.push({
        accountId: e.accountId,
        debit: Number(e.credit),
        credit: Number(e.debit),
        partyType: e.partyType,
        partyId: e.partyId,
        costCenterId: e.costCenterId,
        againstVoucherType: e.againstVoucherType,
        againstVoucherId: e.againstVoucherId,
        remarks: `Reversal: ${e.remarks || ''}`.trim(),
      })
    }
  } else for (const { sample, netCents } of nets.values()) {
    if (netCents === 0) continue
    const amount = Math.abs(netCents) / 100
    const originalRemark = isReversal(sample) ? '' : (sample.remarks || '')
    reversalEntries.push({
      accountId: sample.accountId,
      debit: netCents < 0 ? amount : 0, // net credit on the books → debit it back
      credit: netCents > 0 ? amount : 0, // net debit on the books → credit it back
      partyType: sample.partyType,
      partyId: sample.partyId,
      costCenterId: sample.costCenterId,
      againstVoucherType: sample.againstVoucherType,
      againstVoucherId: sample.againstVoucherId,
      remarks: `Reversal: ${originalRemark}`.trim(),
    })
  }

  if (reversalEntries.length === 0) {
    return [] // Already fully reversed
  }

  const first = originals[0]
  const baseNumber = first.voucherNumber ? String(first.voucherNumber).replace(/^REV-/, '') : null
  return createGLEntries(tx, {
    tenantId,
    postingDate: reversalDate || first.postingDate,
    voucherType: voucherType,
    voucherId: voucherId,
    voucherNumber: baseNumber ? `REV-${baseNumber}` : undefined,
    fiscalYearId: first.fiscalYearId,
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
