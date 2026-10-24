/**
 * K1 — money out: expenses, petty cash and staff reimbursement claims.
 *
 *  expense        recorded already paid (status 'paid'):
 *                   paidFrom 'drawer'  → a POS paid-out (pos_cash_movement, petty_expense) on an
 *                                        open shift; posts Dr expense / Cr cash via the movement.
 *                                        Cashiers may record up to the counter's expense limit
 *                                        (pos_profiles.expense_limit), above it a supervisor approves.
 *                   paidFrom 'cash'    → office cash:  Dr expense / Cr cash        (voucher 'expense')
 *                   paidFrom 'bank'    → bank / card / cheque: Dr expense / Cr bank (a cheque is
 *                                        also registered as an issued cheque)
 *  reimbursement  a staff member spent their own money: pending → approved → paid | rejected.
 *                 Paying works like an expense (drawer / cash / bank / cheque).
 * Void: reverses the posting (a drawer expense only while its shift is open).
 */
import { and, asc, eq } from 'drizzle-orm'
import { cheques, expenseCategories, expenses, posCashMovements, posOpeningEntries, posProfiles } from '@/lib/db/schema'
import { getDefaultExpenseAccount, postExpenseToGL } from '@/lib/accounting/auto-post'
import { reverseGLEntries, tenantToday } from '@/lib/accounting/gl'
import { nextDocNo } from '@/lib/documents/numbering'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import { recordCashMovement, type CashMovementFailure } from '@/lib/pos/cash-movement'
import { insertCheque, ChequeError } from '@/lib/cheques/cheques'
import type { ApprovalScope } from '@/lib/auth/approval-token'
import type { ChequeDetailsInput } from '@/lib/validation/schemas/cheques'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export type Expense = typeof expenses.$inferSelect

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Tea & refreshments',
  'Transport & fuel',
  'Electricity & water',
  'Telephone & internet',
  'Stationery & printing',
  'Cleaning & sanitation',
  'Repairs & maintenance',
  'Staff welfare',
  'Postage & courier',
  'Rent',
  'Other',
]

export class ExpenseError extends Error {
  constructor(public code: string, message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ExpenseError'
  }
}

function fromFailure(f: CashMovementFailure): ExpenseError {
  const { error, code, ...extra } = f.body
  return new ExpenseError(code || 'CASH_MOVEMENT_FAILED', error, f.status, extra)
}

/** The tenant's categories; the defaults are created the first time a tenant asks for them. */
export async function ensureExpenseCategories(tx: Tx, tenantId: string) {
  const existing = await tx.select().from(expenseCategories).where(eq(expenseCategories.tenantId, tenantId))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))
  if (existing.length > 0) return existing
  await tx.insert(expenseCategories).values(DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({ tenantId, name, sortOrder: i })))
    .onConflictDoNothing()
  return tx.select().from(expenseCategories).where(eq(expenseCategories.tenantId, tenantId))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))
}

/** GL account of an expense: chosen account → category account → default expense account. */
export async function resolveExpenseAccount(tx: Tx, tenantId: string, e: { accountId?: string | null; categoryId?: string | null }) {
  if (e.accountId) return e.accountId
  if (e.categoryId) {
    const [cat] = await tx.select({ accountId: expenseCategories.accountId }).from(expenseCategories).where(eq(expenseCategories.id, e.categoryId))
    if (cat?.accountId) return cat.accountId
  }
  return (await getDefaultExpenseAccount(tx, tenantId)).accountId
}

export async function nextExpenseNo(tx: Tx, tenantId: string, kind: 'expense' | 'reimbursement') {
  return nextDocNo(tx, tenantId, kind === 'reimbursement' ? 'expense_claim' : 'expense')
}

/** The caller's open shift (most recent). */
export async function openShiftOf(tx: Tx, userId: string) {
  const [shift] = await tx.select().from(posOpeningEntries)
    .where(and(eq(posOpeningEntries.userId, userId), eq(posOpeningEntries.status, 'open')))
    .orderBy(asc(posOpeningEntries.createdAt)).limit(1)
  return shift || null
}

export interface PayInput {
  tenantId: string
  userId: string
  /** manageSales: pays from any open drawer without approval */
  isSupervisor: boolean
  paidFrom: 'drawer' | 'cash' | 'bank'
  paymentMethod?: 'cash' | 'card' | 'bank_transfer' | 'cheque'
  openingEntryId?: string | null
  cheque?: ChequeDetailsInput
  /** drawer: the cashier's counter limit applies (new expenses); approved claims skip it */
  applyCounterLimit: boolean
  approvalToken?: string | null
}

export interface PaidFields {
  paidFrom: 'drawer' | 'cash' | 'bank'
  paymentMethod: string
  posOpeningEntryId: string | null
  cashMovementId: string | null
  warehouseId: string | null
  chequeId: string | null
}

/**
 * Pay `expense` (already inserted, amount and accounts set) — creates the drawer movement / GL
 * posting / issued cheque. Returns the fields to store on the expense.
 */
export async function payExpense(tx: Tx, expense: Expense, input: PayInput): Promise<PaidFields> {
  const amount = roundCurrency(parseCurrency(expense.amount))
  const accountId = await resolveExpenseAccount(tx, input.tenantId, expense)
  const label = [expense.description, expense.payee].filter(Boolean).join(' — ')

  if (input.paidFrom === 'drawer') {
    let shiftId = input.openingEntryId || null
    if (!shiftId) shiftId = (await openShiftOf(tx, input.userId))?.id || null
    if (!shiftId) throw new ExpenseError('SHIFT_REQUIRED', 'Open a POS shift to pay from the drawer')
    const [shiftRow] = await tx.select({ posProfileId: posOpeningEntries.posProfileId, warehouseId: posOpeningEntries.warehouseId }).from(posOpeningEntries).where(eq(posOpeningEntries.id, shiftId))
    if (!shiftRow) throw new ExpenseError('NOT_FOUND', 'Shift not found', 404)
    const [profile] = await tx.select({ expenseLimit: posProfiles.expenseLimit })
      .from(posProfiles).where(eq(posProfiles.id, shiftRow.posProfileId))
    const limit = profile?.expenseLimit != null ? parseCurrency(profile.expenseLimit) : 0
    const needed: ApprovalScope[] = input.applyCounterLimit && amount > limit + 0.001 ? ['cash_paid_out'] : []
    const r = await recordCashMovement(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      isSupervisor: input.isSupervisor,
      openingEntryId: shiftId,
      type: 'paid_out',
      category: 'petty_expense',
      amount,
      accountId,
      note: `${expense.expenseNo}${label ? ` ${label}` : ''}`.slice(0, 1000),
      needed,
      approvalToken: input.approvalToken,
      approvalMessage: limit > 0
        ? `Expenses above ${limit.toFixed(2)} from the drawer need a supervisor's approval`
        : 'A supervisor must approve expenses paid from the drawer',
      approvalEntity: { type: 'expense', id: expense.id },
    })
    if ('failure' in r) throw fromFailure(r.failure)
    return {
      paidFrom: 'drawer', paymentMethod: 'cash', posOpeningEntryId: r.shift.id, cashMovementId: r.movement.id,
      warehouseId: expense.warehouseId || shiftRow.warehouseId || null, chequeId: null,
    }
  }

  const method = input.paidFrom === 'cash' ? 'cash' : (input.paymentMethod || 'bank_transfer')
  if (method === 'cash' && input.paidFrom === 'bank') throw new ExpenseError('INVALID_METHOD', 'Choose bank transfer, card or cheque for a bank payment')
  let chequeId: string | null = null
  if (method === 'cheque') {
    if (!input.cheque) throw new ExpenseError('CHEQUE_REQUIRED', 'Enter the cheque details')
    if (input.cheque.amount !== undefined && Math.abs(roundCurrency(input.cheque.amount) - amount) > 0.004) {
      throw new ChequeError('CHEQUE_AMOUNT_MISMATCH', `Cheque amount ${roundCurrency(input.cheque.amount).toFixed(2)} does not match the expense ${amount.toFixed(2)}`)
    }
    const cheque = await insertCheque(tx, {
      tenantId: input.tenantId, direction: 'issued', details: input.cheque, amount, userId: input.userId,
      expenseId: expense.id, warehouseId: expense.warehouseId, partyName: expense.payee || null,
    })
    chequeId = cheque.id
  }
  const { configured } = await getDefaultExpenseAccount(tx, input.tenantId)
  if (configured) {
    await postExpenseToGL(tx, input.tenantId, {
      expenseId: expense.id,
      expenseNo: expense.expenseNo,
      postingDate: await tenantToday(input.tenantId),
      amount,
      expenseAccountId: accountId,
      paymentMethod: method,
      remarks: `${expense.expenseNo}${label ? ` ${label}` : ''}`.slice(0, 500),
    })
  }
  return { paidFrom: input.paidFrom, paymentMethod: method, posOpeningEntryId: null, cashMovementId: null, warehouseId: expense.warehouseId, chequeId }
}

/** Undo the payment of a paid expense (void). */
export async function reverseExpensePayment(tx: Tx, expense: Expense, input: { tenantId: string; userId: string; reason: string }) {
  if (expense.cashMovementId) {
    const [movement] = await tx.select().from(posCashMovements).where(eq(posCashMovements.id, expense.cashMovementId)).for('update')
    if (movement && movement.status !== 'voided') {
      const [shift] = await tx.select().from(posOpeningEntries).where(eq(posOpeningEntries.id, movement.openingEntryId)).for('update')
      if (!shift || shift.status !== 'open') {
        throw new ExpenseError('SHIFT_NOT_OPEN', 'This expense was paid from a drawer whose shift is closed; record a correcting entry instead')
      }
      await reverseGLEntries(tx, input.tenantId, 'pos_cash_movement', movement.id)
      await tx.update(posCashMovements).set({ status: 'voided', voidedAt: new Date(), voidedBy: input.userId, voidReason: input.reason })
        .where(eq(posCashMovements.id, movement.id))
    }
    return
  }
  const [cheque] = await tx.select().from(cheques).where(eq(cheques.expenseId, expense.id)).for('update')
  if (cheque && !['cancelled', 'bounced', 'returned'].includes(cheque.status)) {
    if (cheque.status !== 'pending') {
      throw new ExpenseError('CHEQUE_PRESENTED', `Cheque ${cheque.chequeNo} has already been ${cheque.status}; it cannot be voided`)
    }
    const now = new Date()
    await tx.update(cheques).set({
      status: 'cancelled', cancelledAt: now, settlementReversed: true, bounceReason: input.reason, updatedAt: now, updatedBy: input.userId,
      statusHistory: [...((cheque.statusHistory as unknown[]) || []), { status: 'cancelled', at: now.toISOString(), by: input.userId, note: `Expense voided: ${input.reason}` }],
    }).where(eq(cheques.id, cheque.id))
  }
  await reverseGLEntries(tx, input.tenantId, 'expense', expense.id)
}
