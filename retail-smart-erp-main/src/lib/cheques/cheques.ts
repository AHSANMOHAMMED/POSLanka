/**
 * K1 — cheques register (Sri Lanka: post-dated cheques are common).
 *
 * A cheque is either RECEIVED (from a customer: POS sale, receipt against a credit sale, or a
 * stand-alone register entry) or ISSUED (to a supplier against a purchase, or to a payee for an
 * expense / reimbursement).
 *
 * Accounting: the payment a cheque makes is posted when it is taken (method 'cheque' → the
 * 'cheque' Mode of Payment account, the bank by default) exactly like a bank transfer. The
 * cheque's own life cycle then only moves money when it has to:
 *   received  pending ─deposit→ deposited ─clear→ cleared
 *                 │                  └─bounce→ bounced ─return→ returned
 *                 ├─clear→ cleared (deposited and cleared at once)
 *                 ├─bounce→ bounced
 *                 └─cancel→ cancelled (handed back / replaced before banking)
 *   issued    pending ─clear→ cleared | ─bounce→ bounced ─return→ returned | ─cancel→ cancelled
 *
 *  - clear into a bank account other than the cheque account: Dr bank / Cr cheque account
 *  - bounce / cancel of a cheque that settled something re-opens it:
 *      sale payment     → payment row voided, sale paid amount / status reduced,
 *                         Dr Receivable (customer) / Cr cheque account
 *      purchase payment → purchase paid amount / status reduced, supplier balance back up,
 *                         Dr cheque account / Cr Payable (supplier)
 *      expense          → its GL reversed, the expense / claim is unpaid again (approved)
 *  - a stand-alone register cheque never posts.
 * A post-dated cheque cannot be deposited or cleared before its date.
 */
import { and, eq, sql } from 'drizzle-orm'
import {
  cheques, expenses, payments, purchasePayments, purchases, sales, supplierBalanceAudit, suppliers,
  type ChequeStatus, type ChequeStatusEvent,
} from '@/lib/db/schema'
import { postChequeReversalToGL, postChequeTransferToGL, resolveChequeAccount } from '@/lib/accounting/auto-post'
import { reverseGLEntries, tenantToday } from '@/lib/accounting/gl'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import type { ChequeDetailsInput } from '@/lib/validation/schemas/cheques'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export type Cheque = typeof cheques.$inferSelect
export type ChequeDirection = 'received' | 'issued'
export type ChequeAction = 'deposit' | 'clear' | 'bounce' | 'cancel' | 'return'

export class ChequeError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message)
    this.name = 'ChequeError'
  }
}

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  pending: 'In hand',
  deposited: 'Deposited',
  cleared: 'Cleared',
  bounced: 'Bounced',
  cancelled: 'Cancelled',
  returned: 'Returned',
}

/** Open = still to be banked / presented. */
export const OPEN_CHEQUE_STATUSES: ChequeStatus[] = ['pending', 'deposited']

const TRANSITIONS: Record<ChequeDirection, Partial<Record<ChequeStatus, Partial<Record<ChequeAction, ChequeStatus>>>>> = {
  received: {
    pending: { deposit: 'deposited', clear: 'cleared', bounce: 'bounced', cancel: 'cancelled' },
    deposited: { clear: 'cleared', bounce: 'bounced' },
    bounced: { return: 'returned' },
  },
  issued: {
    pending: { clear: 'cleared', bounce: 'bounced', cancel: 'cancelled' },
    bounced: { return: 'returned' },
  },
}

/** Allowed actions for a cheque in its current state (UI buttons). */
export function allowedChequeActions(direction: ChequeDirection, status: ChequeStatus): ChequeAction[] {
  return Object.keys(TRANSITIONS[direction][status] || {}) as ChequeAction[]
}

export function chequeVoucherNo(c: Pick<Cheque, 'chequeNo' | 'direction'>): string {
  return `CHQ-${c.direction === 'received' ? 'R' : 'I'}-${c.chequeNo}`.slice(0, 50)
}

export interface InsertChequeInput {
  tenantId: string
  direction: ChequeDirection
  details: ChequeDetailsInput
  amount: number
  userId: string | null
  customerId?: string | null
  supplierId?: string | null
  saleId?: string | null
  paymentId?: string | null
  purchaseId?: string | null
  purchasePaymentId?: string | null
  expenseId?: string | null
  warehouseId?: string | null
  partyName?: string | null
}

/** Insert a cheque (status pending) inside the caller's transaction. */
export async function insertCheque(tx: Tx, input: InsertChequeInput): Promise<Cheque> {
  const amount = roundCurrency(input.amount)
  if (!(amount > 0)) throw new ChequeError('CHEQUE_AMOUNT_INVALID', 'Cheque amount must be greater than zero')
  const history: ChequeStatusEvent[] = [{ status: 'pending', at: new Date().toISOString(), by: input.userId }]
  const [row] = await tx.insert(cheques).values({
    tenantId: input.tenantId,
    direction: input.direction,
    chequeNo: input.details.chequeNo.trim(),
    bankName: input.details.bankName.trim(),
    branchName: input.details.branchName?.trim() || null,
    chequeDate: input.details.chequeDate,
    amount: String(amount),
    partyName: input.details.partyName?.trim() || input.partyName || null,
    customerId: input.customerId || null,
    supplierId: input.supplierId || null,
    saleId: input.saleId || null,
    paymentId: input.paymentId || null,
    purchaseId: input.purchaseId || null,
    purchasePaymentId: input.purchasePaymentId || null,
    expenseId: input.expenseId || null,
    warehouseId: input.warehouseId || null,
    status: 'pending',
    statusHistory: history,
    notes: input.details.notes?.trim() || null,
    createdBy: input.userId,
    updatedBy: input.userId,
  }).returning()
  return row
}

/**
 * The cheque amount a payment carries must match the cheque tender (cheques give no change).
 * Returns the amount to record.
 */
export function chequeAmountFor(details: ChequeDetailsInput, tender: number): number {
  const t = roundCurrency(tender)
  if (details.amount !== undefined && Math.abs(roundCurrency(details.amount) - t) > 0.004) {
    throw new ChequeError('CHEQUE_AMOUNT_MISMATCH', `Cheque amount ${roundCurrency(details.amount).toFixed(2)} does not match the cheque payment ${t.toFixed(2)}`)
  }
  return t
}

export interface TransitionInput {
  tenantId: string
  chequeId: string
  action: ChequeAction
  userId: string
  depositAccountId?: string | null
  reason?: string | null
  /** YYYY-MM-DD, default tenant today */
  date?: string
}

export interface TransitionResult {
  before: Cheque
  cheque: Cheque
  reopened: { saleId?: string; purchaseId?: string; expenseId?: string } | null
}

/** Apply a status action under a row lock; throws ChequeError for invalid moves. */
export async function transitionCheque(tx: Tx, input: TransitionInput): Promise<TransitionResult> {
  const [before] = await tx.select().from(cheques).where(eq(cheques.id, input.chequeId)).for('update') as Cheque[]
  if (!before) throw new ChequeError('NOT_FOUND', 'Cheque not found', 404)
  const next = TRANSITIONS[before.direction as ChequeDirection][before.status as ChequeStatus]?.[input.action]
  if (!next) {
    throw new ChequeError('INVALID_TRANSITION',
      `A ${CHEQUE_STATUS_LABELS[before.status as ChequeStatus].toLowerCase()} ${before.direction} cheque cannot be ${pastTense(input.action)}`)
  }
  const today = await tenantToday(input.tenantId)
  const date = input.date || today
  if (date > today) throw new ChequeError('DATE_IN_FUTURE', 'The date cannot be in the future')
  if ((input.action === 'deposit' || input.action === 'clear') && date < before.chequeDate) {
    throw new ChequeError('CHEQUE_NOT_DUE', `This cheque is dated ${before.chequeDate}; it cannot be ${pastTense(input.action)} before then`)
  }

  const now = new Date()
  const amount = parseCurrency(before.amount)
  const set: Partial<typeof cheques.$inferInsert> = { status: next, updatedAt: now, updatedBy: input.userId }
  let reopened: TransitionResult['reopened'] = null

  switch (input.action) {
    case 'deposit':
      set.depositedAt = now
      if (input.depositAccountId) set.depositAccountId = input.depositAccountId
      break
    case 'clear': {
      set.clearedAt = now
      if (!before.depositedAt && before.direction === 'received') set.depositedAt = now
      const depositAccountId = input.depositAccountId || before.depositAccountId || null
      if (depositAccountId) set.depositAccountId = depositAccountId
      // Money moves only for a received cheque that settled something and lands in a bank account
      // other than the one the payment was posted to
      if (before.direction === 'received' && depositAccountId && settlesSomething(before)) {
        const chequeAccount = await resolveChequeAccount(tx, input.tenantId)
        if (chequeAccount && chequeAccount !== depositAccountId) {
          await postChequeTransferToGL(tx, input.tenantId, {
            chequeId: before.id, voucherNumber: chequeVoucherNo(before), postingDate: date, amount,
            fromAccountId: chequeAccount, toAccountId: depositAccountId,
            remarks: `Cheque ${before.chequeNo} (${before.bankName}) cleared`,
          })
        }
      }
      break
    }
    case 'bounce':
    case 'cancel':
      if (input.action === 'bounce') set.bouncedAt = now
      else set.cancelledAt = now
      set.bounceReason = input.reason || null
      if (settlesSomething(before) && !before.settlementReversed) {
        reopened = await reverseSettlement(tx, input, before, amount, date)
        set.settlementReversed = true
      }
      break
    case 'return':
      set.returnedAt = now
      break
  }

  const history = [...((before.statusHistory as ChequeStatusEvent[]) || []), {
    status: next, at: now.toISOString(), by: input.userId, note: input.reason || null,
  }]
  set.statusHistory = history
  const [cheque] = await tx.update(cheques).set(set).where(eq(cheques.id, before.id)).returning()
  return { before, cheque, reopened }
}

function pastTense(a: ChequeAction): string {
  return { deposit: 'deposited', clear: 'cleared', bounce: 'marked bounced', cancel: 'cancelled', return: 'marked returned' }[a]
}

function settlesSomething(c: Cheque): boolean {
  return !!(c.paymentId || c.purchasePaymentId || c.expenseId)
}

async function reverseSettlement(tx: Tx, input: TransitionInput, c: Cheque, amount: number, date: string): Promise<TransitionResult['reopened']> {
  const label = input.action === 'bounce' ? 'bounced' : 'cancelled'
  const note = `Cheque ${c.chequeNo} ${label}${input.reason ? `: ${input.reason}` : ''}`
  const chequeAccount = await resolveChequeAccount(tx, input.tenantId)
  // A cheque that already cleared into another account would sit there; bounce is only allowed
  // before clearing, so the money is in the cheque account.

  if (c.direction === 'received' && c.paymentId) {
    const [pay] = await tx.select().from(payments).where(eq(payments.id, c.paymentId)).for('update')
    const saleId = pay?.saleId || c.saleId
    const [sale] = saleId ? await tx.select().from(sales).where(eq(sales.id, saleId)).for('update') : []
    if (pay && !pay.voidedAt) {
      await tx.update(payments).set({ voidedAt: new Date(), voidedBy: input.userId, voidReason: note.slice(0, 1000) })
        .where(eq(payments.id, pay.id))
    }
    // A voided sale already reversed its payments in the ledger
    if (sale && sale.status !== 'void') {
      const total = parseCurrency(sale.total)
      const paid = roundCurrency(Math.max(0, parseCurrency(sale.paidAmount) - amount))
      const status = paid >= total - 0.004 ? 'completed' : paid > 0 ? 'partial' : 'pending'
      await tx.update(sales).set({ paidAmount: String(paid), status }).where(eq(sales.id, sale.id))
      if (chequeAccount) {
        await postChequeReversalToGL(tx, input.tenantId, {
          chequeId: c.id, voucherNumber: chequeVoucherNo(c), postingDate: date, direction: 'received', amount,
          accountId: chequeAccount, partyId: sale.customerId || c.customerId, costCenterId: sale.costCenterId,
          remarks: `${note} (${sale.invoiceNo})`,
        })
      }
      return { saleId: sale.id }
    }
    return null
  }

  if (c.direction === 'issued' && c.purchasePaymentId) {
    const [pp] = await tx.select().from(purchasePayments).where(eq(purchasePayments.id, c.purchasePaymentId)).for('update')
    const purchaseId = pp?.purchaseId || c.purchaseId
    const [purchase] = purchaseId ? await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for('update') : []
    if (pp) {
      await tx.update(purchasePayments).set({ notes: [pp.notes, `[${note}]`].filter(Boolean).join(' ').slice(0, 2000) })
        .where(eq(purchasePayments.id, pp.id))
    }
    if (purchase && purchase.status !== 'cancelled') {
      const total = parseCurrency(purchase.total)
      const paid = roundCurrency(Math.max(0, parseCurrency(purchase.paidAmount) - amount))
      const status = paid >= total - 0.004 ? 'paid' : paid > 0 ? 'partial' : 'pending'
      await tx.update(purchases).set({ paidAmount: String(paid), status, updatedAt: new Date() }).where(eq(purchases.id, purchase.id))
      if (purchase.supplierId) {
        const [sup] = await tx.select({ balance: suppliers.balance }).from(suppliers).where(eq(suppliers.id, purchase.supplierId)).for('update')
        const prev = parseCurrency(sup?.balance)
        const nextBal = roundCurrency(prev + amount)
        await tx.update(suppliers).set({ balance: String(nextBal) }).where(eq(suppliers.id, purchase.supplierId))
        await tx.insert(supplierBalanceAudit).values({
          tenantId: input.tenantId,
          supplierId: purchase.supplierId,
          type: 'adjustment',
          amount: String(amount),
          previousBalance: String(prev),
          newBalance: String(nextBal),
          referenceType: 'cheque',
          referenceId: c.id,
          notes: `${note} — payment for ${purchase.purchaseNo} re-opened`,
          createdBy: input.userId,
        })
      }
      if (chequeAccount) {
        await postChequeReversalToGL(tx, input.tenantId, {
          chequeId: c.id, voucherNumber: chequeVoucherNo(c), postingDate: date, direction: 'issued', amount,
          accountId: chequeAccount, partyId: purchase.supplierId || c.supplierId, costCenterId: purchase.costCenterId,
          remarks: `${note} (${purchase.purchaseNo})`,
        })
      }
      return { purchaseId: purchase.id }
    }
    return null
  }

  if (c.direction === 'issued' && c.expenseId) {
    const [exp] = await tx.select().from(expenses).where(eq(expenses.id, c.expenseId)).for('update')
    if (exp && exp.status === 'paid') {
      await reverseGLEntries(tx, input.tenantId, 'expense', exp.id, date)
      await tx.update(expenses).set({
        status: 'approved', paidAt: null, paidBy: null, paymentMethod: null, paidFrom: null,
        notes: [exp.notes, `[${note}]`].filter(Boolean).join(' ').slice(0, 2000), updatedAt: new Date(),
      }).where(eq(expenses.id, exp.id))
      return { expenseId: exp.id }
    }
  }
  return null
}

/** Cheques due on / before a date (open), for reminders and the dashboard. */
export async function openChequesDue(tx: Tx, tenantId: string, untilDate: string, warehouseId?: string | null) {
  return tx.select().from(cheques).where(and(
    eq(cheques.tenantId, tenantId),
    sql`${cheques.status} IN ('pending', 'deposited')`,
    sql`${cheques.chequeDate} <= ${untilDate}::date`,
    warehouseId ? eq(cheques.warehouseId, warehouseId) : undefined,
  ))
}
