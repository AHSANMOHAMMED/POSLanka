/**
 * Hire purchase plans in the database (drizzle/0181, 0186): late-fee assessment, receipts,
 * settlement, void / bounced cheques, repossession and the link to the credit sale. Server-only.
 * Arithmetic lives in ./schedule (client-safe); ledger postings in ./posting (the accounting
 * approach is described there).
 *
 * Every function runs inside the caller's transaction: the receipt, the schedule, the sale's
 * payment row, the cheque and the journal entry commit or roll back together.
 *
 * Cheques: a receipt by cheque registers the cheque in the cheques register (insertCheque) with
 * the plan's customer, sale and branch. It is not linked to a sale payment row (the register's
 * own bounce logic would otherwise re-open the sale for the full cheque amount, interest
 * included). A bounce is handled here instead:
 *   - "Mark cheque bounced" on the receipt (bounceReceiptCheque) bounces it in the register and
 *     reverses the receipt in the same transaction;
 *   - a cheque bounced / cancelled straight in the register is picked up by
 *     syncBouncedCheques (run whenever a plan is opened, paid or listed) and the receipt reversed
 *     with the bounce date.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  cheques, installmentPlans, installmentSchedule, installmentPayments, itemSerialNumbers, items as itemsTable,
  payments, saleItems, sales, type InstallmentAllocation, type InstallmentRepossession,
} from '@/lib/db/schema'
import type { DbTx } from '@/lib/inventory/db-types'
import { nextDocNo } from '@/lib/documents/numbering'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { allocateSerials, transferSerials } from '@/lib/inventory/serial-numbers'
import { chequeAmountFor, insertCheque, transitionCheque } from '@/lib/cheques/cheques'
import type { ChequeDetailsInput } from '@/lib/validation/schemas/cheques'
import { getTenantTimezone, localParts } from '@/lib/notifications/alert-settings'
import {
  allocatePayment, lateFeeFor, outstandingOf, payRow, round2, rowDue, rowFeeDue, rowInterestPaid, rowPrincipalDue,
  rowPrincipalPaid, settlementQuote, type LiveRow, type LateFeeRule,
} from './schedule'
import { postPlanReceivable, postReceiptToGL, postRepossessionToGL, reversePlanReceivable, reverseReceiptGL } from './posting'

export class InstallmentError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code?: string) {
    super(message)
    this.name = 'InstallmentError'
  }
}

type Plan = typeof installmentPlans.$inferSelect
type ScheduleDbRow = typeof installmentSchedule.$inferSelect
type Receipt = typeof installmentPayments.$inferSelect
export type InstallmentMethod = 'cash' | 'card' | 'bank_transfer' | 'cheque'

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0

export function toLiveRow(r: ScheduleDbRow): LiveRow {
  return {
    installmentNo: r.installmentNo,
    dueDate: String(r.dueDate),
    amount: num(r.amount),
    principal: num(r.principal),
    interest: num(r.interest),
    paidAmount: num(r.paidAmount),
    lateFee: num(r.lateFee),
    lateFeePaid: num(r.lateFeePaid),
    interestPaid: num(r.interestPaid),
    principalPaid: num(r.principalPaid),
    status: r.status,
  }
}

export function lateFeeRuleOf(plan: Pick<Plan, 'lateFeeType' | 'lateFeeValue' | 'graceDays'>): LateFeeRule {
  return { lateFeeType: plan.lateFeeType, lateFeeValue: num(plan.lateFeeValue), graceDays: plan.graceDays }
}

export async function loadSchedule(db: DbTx, planId: string): Promise<ScheduleDbRow[]> {
  return db.select().from(installmentSchedule).where(eq(installmentSchedule.planId, planId)).orderBy(asc(installmentSchedule.installmentNo))
}

/**
 * Charge the late fee on installments that passed the grace period (once per installment; a fee
 * already charged is never changed). Only active / defaulted plans accrue fees. `today` is the
 * tenant's date (tenantToday: Asia/Colombo by default), never the server's UTC date.
 */
export async function assessLateFees(db: DbTx, plan: Plan, rows: ScheduleDbRow[], today: string): Promise<ScheduleDbRow[]> {
  if (plan.lateFeeType === 'none' || !['active', 'defaulted'].includes(plan.status)) return rows
  const rule = lateFeeRuleOf(plan)
  const out: ScheduleDbRow[] = []
  for (const r of rows) {
    const live = toLiveRow(r)
    const fee = live.lateFee > 0 ? live.lateFee : lateFeeFor(live, rule, today)
    if (fee > 0 && live.lateFee === 0) {
      await db.update(installmentSchedule).set({ lateFee: String(fee) }).where(eq(installmentSchedule.id, r.id))
      out.push({ ...r, lateFee: String(fee) })
    } else {
      out.push(r)
    }
  }
  return out
}

/** Summary figures of a plan's schedule on `today` */
export function planFigures(rows: LiveRow[], today: string) {
  const open = rows.filter((r) => r.status === 'pending' || r.status === 'partial')
  const overdue = open.filter((r) => r.dueDate < today)
  const next = open.find((r) => r.dueDate >= today) ?? open[0] ?? null
  const oldestOverdue = overdue[0]
  return {
    outstanding: outstandingOf(rows),
    principalOutstanding: round2(rows.reduce((s, r) => s + rowPrincipalDue(r), 0)),
    lateFeesDue: round2(rows.reduce((s, r) => s + (r.status === 'waived' ? 0 : rowFeeDue(r)), 0)),
    overdueAmount: round2(overdue.reduce((s, r) => s + rowDue(r), 0)),
    overdueCount: overdue.length,
    daysOverdue: oldestOverdue ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldestOverdue.dueDate}T00:00:00Z`)) / 86_400_000)) : 0,
    nextDue: next ? { installmentNo: next.installmentNo, dueDate: next.dueDate, amount: round2(rowDue(next) + rowFeeDue(next)) } : null,
    principalPaid: round2(rows.reduce((s, r) => s + rowPrincipalPaid(r), 0)),
    interestPaid: round2(rows.reduce((s, r) => s + rowInterestPaid(r), 0)),
  }
}

const rowStatus = (r: LiveRow): LiveRow['status'] => (rowDue(r) <= 0.004 ? 'paid' : r.paidAmount > 0.004 ? 'partial' : 'pending')

/** Write changed schedule rows back */
async function writeRows(tx: DbTx, dbRows: ScheduleDbRow[], updated: LiveRow[]) {
  const byNo = new Map(dbRows.map((r) => [r.installmentNo, r]))
  const now = new Date()
  for (const r of updated) {
    const before = byNo.get(r.installmentNo)
    if (!before) continue
    const b = toLiveRow(before)
    if (b.paidAmount === r.paidAmount && b.lateFeePaid === r.lateFeePaid && b.lateFee === r.lateFee && b.status === r.status
      && b.amount === r.amount && b.interest === r.interest && b.interestPaid === r.interestPaid && b.principalPaid === r.principalPaid) continue
    await tx.update(installmentSchedule).set({
      amount: String(r.amount),
      interest: String(r.interest),
      principal: String(round2(r.amount - r.interest)),
      paidAmount: String(r.paidAmount),
      interestPaid: String(round2(r.interestPaid ?? 0)),
      principalPaid: String(round2(r.principalPaid ?? 0)),
      lateFee: String(r.lateFee),
      lateFeePaid: String(r.lateFeePaid),
      status: r.status,
      paidAt: r.status === 'paid' ? (before.paidAt ?? now) : null,
    }).where(eq(installmentSchedule.id, before.id))
  }
}

/**
 * Apply `principal` to the plan's credit sale: a payments row and sales.paid_amount / status.
 * Capped at the sale's open balance. The ledger side is the receipt's own voucher (./posting).
 */
async function applyPrincipalToSale(
  tx: DbTx, tenantId: string, plan: Plan, principal: number, method: InstallmentMethod, receiptNo: string, userId: string,
): Promise<{ paymentId: string; amount: number; sale: typeof sales.$inferSelect } | null> {
  if (!plan.saleId || principal <= 0) return null
  const [sale] = await tx.select().from(sales).where(eq(sales.id, plan.saleId)).for('update')
  if (!sale || sale.status === 'void' || sale.isReturn) return null
  const total = num(sale.total)
  const paid = num(sale.paidAmount)
  const amount = round2(Math.min(principal, Math.max(0, total - paid)))
  if (amount <= 0) return null
  const [row] = await tx.insert(payments).values({
    tenantId,
    saleId: sale.id,
    amount: String(amount),
    method,
    reference: `Installment ${receiptNo} (${plan.planNo})`,
    receivedBy: userId,
  }).returning({ id: payments.id })
  const newPaid = round2(paid + amount)
  await tx.update(sales).set({
    paidAmount: String(Math.min(newPaid, total)),
    status: newPaid >= total - 0.004 ? 'completed' : 'partial',
  }).where(eq(sales.id, sale.id))
  return { paymentId: row.id, amount, sale }
}

/** Register a received cheque for a receipt (the cheques register's own create function) */
async function registerCheque(tx: DbTx, tenantId: string, plan: Plan, details: ChequeDetailsInput, amount: number, receiptNo: string, userId: string) {
  const chequeAmount = chequeAmountFor(details, amount)
  const note = `Hire purchase ${plan.planNo} receipt ${receiptNo}`
  const cheque = await insertCheque(tx, {
    tenantId,
    direction: 'received',
    details: { ...details, notes: [note, details.notes].filter(Boolean).join(' — ').slice(0, 1000) },
    amount: chequeAmount,
    userId,
    customerId: plan.customerId,
    saleId: plan.saleId,
    warehouseId: plan.warehouseId,
    partyName: plan.customerName,
  })
  return cheque
}

export interface RecordPaymentInput {
  amount: number
  paymentMethod: InstallmentMethod
  reference?: string | null
  paymentDate: string
  notes?: string | null
  waiveLateFees?: boolean
  settle?: boolean
  rebatePercent?: number
  cheque?: ChequeDetailsInput | null
}

/**
 * Take a payment on a plan (inside the caller's transaction; the plan row is locked here).
 * Normal payment: oldest installment first, late fee first. Settlement: `amount` must be the
 * settlement quote; every open installment is closed and the waived interest recorded as rebate.
 */
export async function recordInstallmentPayment(tx: DbTx, tenantId: string, planId: string, input: RecordPaymentInput, userId: string, today: string) {
  if (input.paymentMethod === 'cheque' && !input.cheque) {
    throw new InstallmentError('Enter the cheque details (number, bank, date)', 400, 'CHEQUE_DETAILS_REQUIRED')
  }
  await syncBouncedCheques(tx, tenantId, planId)
  const [plan] = await tx.select().from(installmentPlans).where(eq(installmentPlans.id, planId)).for('update')
  if (!plan) throw new InstallmentError('Plan not found', 404)
  if (!['active', 'defaulted'].includes(plan.status)) {
    throw new InstallmentError(`This plan is ${plan.status}; payments are only taken on active or defaulted plans`)
  }
  const dbRows = await assessLateFees(tx, plan, await loadSchedule(tx, planId), today)
  const live = dbRows.map(toLiveRow)
  const amount = round2(input.amount)

  let allocations: InstallmentAllocation[] = []
  let updated: LiveRow[] = live
  let rebate = 0

  if (input.settle) {
    const quote = settlementQuote(live, input.paymentDate, input.rebatePercent ?? 50, { waiveLateFees: input.waiveLateFees })
    if (amount + 0.001 < quote.total) {
      throw new InstallmentError(`Settlement amount is ${quote.total.toFixed(2)}`, 400, 'SETTLEMENT_SHORT')
    }
    if (amount - quote.total > 0.009) {
      throw new InstallmentError(`Settlement amount is ${quote.total.toFixed(2)}; take exactly that amount`, 400, 'OVERPAYMENT')
    }
    const ratio = quote.futureInterest > 0 ? quote.rebate / quote.futureInterest : 0
    updated = live.map((r) => ({ ...r }))
    const touched: Array<{ row: LiveRow; alloc: InstallmentAllocation }> = []
    for (const r of updated) {
      if (r.status === 'paid' || r.status === 'waived') continue
      const fee = input.waiveLateFees ? 0 : rowFeeDue(r)
      const feeWaived = input.waiveLateFees ? rowFeeDue(r) : 0
      let waived = 0
      if (r.dueDate > input.paymentDate) {
        // future installment: part of its unpaid interest is waived (never posted: interest is
        // recognised only when received)
        waived = round2(Math.max(0, r.interest - rowInterestPaid(r)) * ratio)
        r.interest = round2(r.interest - waived)
        r.amount = round2(r.amount - waived)
      }
      const pay = rowDue(r)
      const split = payRow(r, pay)
      r.lateFeePaid = round2(r.lateFeePaid + fee)
      if (input.waiveLateFees) r.lateFee = r.lateFeePaid
      r.status = 'paid'
      const alloc: InstallmentAllocation = {
        installmentNo: r.installmentNo, amount: pay, lateFee: fee, interest: split.interest, principal: split.principal,
        ...(waived > 0 ? { waived } : {}), ...(feeWaived > 0 ? { feeWaived } : {}),
      }
      allocations.push(alloc)
      touched.push({ row: r, alloc })
    }
    // per-row rounding of the waived shares: the cent(s) between the quote and the rows go on the
    // last row that had interest waived, so the receipt adds up exactly
    const allocated = round2(allocations.reduce((s, a) => s + a.amount + a.lateFee, 0))
    const diff = round2(amount - allocated)
    if (diff !== 0) {
      const t = [...touched].reverse().find((x) => (x.alloc.waived ?? 0) >= diff)
      if (!t || Math.abs(diff) >= 1) throw new InstallmentError(`Settlement amount is ${allocated.toFixed(2)}`, 400, 'SETTLEMENT_SHORT')
      t.row.amount = round2(t.row.amount + diff)
      t.row.interest = round2(t.row.interest + diff)
      t.row.paidAmount = round2(t.row.paidAmount + diff)
      t.row.interestPaid = round2((t.row.interestPaid ?? 0) + diff)
      t.alloc.amount = round2(t.alloc.amount + diff)
      t.alloc.interest = round2((t.alloc.interest ?? 0) + diff)
      t.alloc.waived = round2((t.alloc.waived ?? 0) - diff)
    }
    rebate = round2(allocations.reduce((s, a) => s + (a.waived ?? 0), 0))
  } else {
    const result = allocatePayment(live, amount, { waiveLateFees: input.waiveLateFees })
    if (result.leftover > 0.009) {
      const max = round2(amount - result.leftover)
      throw new InstallmentError(`Payment exceeds the outstanding amount (${max.toFixed(2)})`, 400, 'OVERPAYMENT')
    }
    allocations = result.allocations
    updated = result.rows
  }

  await writeRows(tx, dbRows, updated)

  const principalPart = round2(allocations.reduce((s, a) => s + (a.principal ?? 0), 0))
  const interestPart = round2(allocations.reduce((s, a) => s + (a.interest ?? 0), 0))
  const feePart = round2(allocations.reduce((s, a) => s + a.lateFee, 0))
  const receiptNo = await nextDocNo(tx, tenantId, 'installment_receipt')

  const onSale = await applyPrincipalToSale(tx, tenantId, plan, principalPart, input.paymentMethod, receiptNo, userId)
  const cheque = input.paymentMethod === 'cheque' && input.cheque
    ? await registerCheque(tx, tenantId, plan, input.cheque, amount, receiptNo, userId)
    : null

  const [inserted] = await tx.insert(installmentPayments).values({
    tenantId,
    planId,
    warehouseId: plan.warehouseId,
    receiptNo,
    kind: input.settle ? 'settlement' : 'installment',
    paymentDate: input.paymentDate,
    amount: String(amount),
    principalAmount: String(principalPart),
    interestAmount: String(interestPart),
    lateFeeAmount: String(feePart),
    rebateAmount: String(rebate),
    paymentMethod: input.paymentMethod,
    reference: input.reference || (cheque ? `Cheque ${cheque.chequeNo} (${cheque.bankName})` : null),
    allocations,
    salePaymentId: onSale?.paymentId ?? null,
    chequeId: cheque?.id ?? null,
    notes: input.notes || null,
    receivedBy: userId,
  }).returning()

  const posted = await postReceiptToGL(tx, tenantId, plan, {
    receiptId: inserted.id, receiptNo, kind: inserted.kind, paymentDate: input.paymentDate, method: input.paymentMethod,
    amount, principal: principalPart, interest: interestPart, lateFee: feePart,
    saleId: plan.saleId, costCenterId: onSale?.sale.costCenterId ?? null,
  })
  let receipt = inserted
  if (posted) {
    [receipt] = await tx.update(installmentPayments).set({ glMode: 'voucher' }).where(eq(installmentPayments.id, inserted.id)).returning()
  }

  const balance = outstandingOf(updated)
  const completed = balance <= 0.004
  const now = new Date()
  await tx.update(installmentPlans).set({
    paidAmount: sql`${installmentPlans.paidAmount} + ${String(round2(amount - feePart))}::numeric`,
    lateFeesPaid: sql`${installmentPlans.lateFeesPaid} + ${String(feePart)}::numeric`,
    rebateAmount: sql`${installmentPlans.rebateAmount} + ${String(rebate)}::numeric`,
    balance: String(balance),
    status: completed ? 'completed' : plan.status,
    closedAt: completed ? now : plan.closedAt,
    updatedAt: now,
  }).where(eq(installmentPlans.id, planId))

  return { receipt, cheque, plan: { ...plan, balance: String(balance), status: completed ? 'completed' as const : plan.status } }
}

/**
 * Down payment receipt of a hand-registered plan (taken when the plan is created) and the plan's
 * receivable posting. A sale's down payment was taken at the till.
 */
export async function recordManualPlanOpening(tx: DbTx, tenantId: string, plan: Plan, opts: {
  today: string; userId: string; downPayment?: { amount: number; method: InstallmentMethod; reference?: string | null; cheque?: ChequeDetailsInput | null } | null
}) {
  await postPlanReceivable(tx, tenantId, plan, opts.today)
  const dp = opts.downPayment
  if (!dp || !(dp.amount > 0)) return null
  if (dp.method === 'cheque' && !dp.cheque && !plan.openingAgreement) {
    throw new InstallmentError('Enter the cheque details for the down payment', 400, 'CHEQUE_DETAILS_REQUIRED')
  }
  const receiptNo = await nextDocNo(tx, tenantId, 'installment_receipt')
  const cheque = dp.method === 'cheque' && dp.cheque ? await registerCheque(tx, tenantId, plan, dp.cheque, dp.amount, receiptNo, opts.userId) : null
  const [inserted] = await tx.insert(installmentPayments).values({
    tenantId,
    planId: plan.id,
    warehouseId: plan.warehouseId,
    receiptNo,
    kind: 'down_payment',
    paymentDate: opts.today,
    amount: String(round2(dp.amount)),
    principalAmount: String(round2(dp.amount)),
    paymentMethod: dp.method,
    reference: dp.reference || (cheque ? `Cheque ${cheque.chequeNo} (${cheque.bankName})` : null),
    chequeId: cheque?.id ?? null,
    receivedBy: opts.userId,
  }).returning()
  const posted = await postReceiptToGL(tx, tenantId, plan, {
    receiptId: inserted.id, receiptNo, kind: 'down_payment', paymentDate: opts.today, method: dp.method,
    amount: round2(dp.amount), principal: round2(dp.amount), interest: 0, lateFee: 0,
  })
  if (posted) await tx.update(installmentPayments).set({ glMode: 'voucher' }).where(eq(installmentPayments.id, inserted.id))
  return inserted
}

export interface ReverseInput {
  userId: string | null
  reason: string
  /** posting date of the reversal (YYYY-MM-DD, tenant date) */
  date: string
  cause: 'void' | 'cheque_bounced'
}

/**
 * Undo a receipt: the schedule rows get back exactly what it paid (stored interest / principal
 * split, waived interest and late fees restored), the plan totals and status (completed →
 * active), the sale's payment row is voided and the sale re-opened by that amount, and its
 * journal entry is reversed. A pending cheque of a voided receipt is cancelled in the register.
 * Idempotent: a receipt already voided is returned unchanged.
 */
export async function reverseInstallmentPayment(tx: DbTx, tenantId: string, receiptId: string, input: ReverseInput) {
  const [receipt] = await tx.select().from(installmentPayments).where(eq(installmentPayments.id, receiptId)).for('update')
  if (!receipt) throw new InstallmentError('Receipt not found', 404)
  const [plan] = await tx.select().from(installmentPlans).where(eq(installmentPlans.id, receipt.planId)).for('update')
  if (!plan) throw new InstallmentError('Plan not found', 404)
  if (receipt.voidedAt) return { receipt, plan, already: true }
  // a cancelled plan's receipts can still be voided (needed before its sale can be voided)
  if (input.cause === 'void' && plan.status === 'repossessed') {
    throw new InstallmentError(`This plan is ${plan.status}; its receipts can no longer be voided`)
  }

  const amount = num(receipt.amount)
  const fee = num(receipt.lateFeeAmount)
  const rebate = num(receipt.rebateAmount)
  let balance = num(plan.balance)
  let status = plan.status

  if (receipt.kind !== 'down_payment') {
    const dbRows = await loadSchedule(tx, plan.id)
    const live = dbRows.map(toLiveRow)
    const byNo = new Map(live.map((r) => [r.installmentNo, r]))
    for (const a of (receipt.allocations as InstallmentAllocation[]) || []) {
      const r = byNo.get(a.installmentNo)
      if (!r) continue
      const interest = a.interest ?? Math.min(a.amount, r.interestPaid ?? 0)
      const principal = a.principal ?? round2(a.amount - interest)
      r.paidAmount = round2(Math.max(0, r.paidAmount - a.amount))
      r.interestPaid = round2(Math.max(0, (r.interestPaid ?? 0) - interest))
      r.principalPaid = round2(Math.max(0, (r.principalPaid ?? 0) - principal))
      r.lateFeePaid = round2(Math.max(0, r.lateFeePaid - a.lateFee))
      if (a.feeWaived) r.lateFee = round2(r.lateFee + a.feeWaived)
      if (a.waived) {
        r.amount = round2(r.amount + a.waived)
        r.interest = round2(r.interest + a.waived)
      }
      if (r.status !== 'waived') r.status = rowStatus(r)
    }
    await writeRows(tx, dbRows, live)
    // a repossessed plan's balance is the receivable left after the goods / write-off: the
    // principal of a receipt that bounced afterwards is owed again
    balance = plan.status === 'repossessed'
      ? round2(num(plan.balance) + num(receipt.principalAmount))
      : outstandingOf(live)
    if (plan.status === 'completed' && balance > 0.004) status = 'active'
    await tx.update(installmentPlans).set({
      paidAmount: sql`GREATEST(0, ${installmentPlans.paidAmount} - ${String(round2(amount - fee))}::numeric)`,
      lateFeesPaid: sql`GREATEST(0, ${installmentPlans.lateFeesPaid} - ${String(fee)}::numeric)`,
      rebateAmount: sql`GREATEST(0, ${installmentPlans.rebateAmount} - ${String(rebate)}::numeric)`,
      balance: String(balance),
      status,
      closedAt: status === 'active' ? null : plan.closedAt,
      updatedAt: new Date(),
    }).where(eq(installmentPlans.id, plan.id))
  }

  // the sale side
  let salePrincipal = 0
  if (receipt.salePaymentId) {
    const [pay] = await tx.select().from(payments).where(eq(payments.id, receipt.salePaymentId)).for('update')
    if (pay && !pay.voidedAt) {
      salePrincipal = num(pay.amount)
      await tx.update(payments).set({ voidedAt: new Date(), voidedBy: input.userId, voidReason: input.reason.slice(0, 1000) })
        .where(eq(payments.id, pay.id))
      const [sale] = await tx.select().from(sales).where(eq(sales.id, pay.saleId)).for('update')
      if (sale && sale.status !== 'void') {
        const total = num(sale.total)
        const paid = round2(Math.max(0, num(sale.paidAmount) - salePrincipal))
        await tx.update(sales).set({ paidAmount: String(paid), status: paid >= total - 0.004 ? 'completed' : paid > 0 ? 'partial' : 'pending' })
          .where(eq(sales.id, sale.id))
      }
    }
  }

  await reverseReceiptGL(tx, tenantId, plan, {
    id: receipt.id, receiptNo: receipt.receiptNo, glMode: receipt.glMode ?? null, paymentMethod: receipt.paymentMethod,
    salePrincipal, saleId: plan.saleId,
  }, input.date)

  // a receipt voided by mistake: its cheque (still in hand / banked) goes back too
  if (input.cause === 'void' && receipt.chequeId && input.userId) {
    const [c] = await tx.select({ status: cheques.status }).from(cheques).where(eq(cheques.id, receipt.chequeId))
    if (c?.status === 'pending') {
      await transitionCheque(tx, { tenantId, chequeId: receipt.chequeId, action: 'cancel', userId: input.userId, reason: `Receipt ${receipt.receiptNo} voided: ${input.reason}`.slice(0, 1000) })
    }
  }

  const [voided] = await tx.update(installmentPayments).set({
    voidedAt: new Date(), voidedBy: input.userId, voidReason: input.reason.slice(0, 1000),
  }).where(eq(installmentPayments.id, receipt.id)).returning()
  return { receipt: voided, plan: { ...plan, balance: String(balance), status }, already: false }
}

/**
 * "Mark cheque bounced" on a receipt: bounce the cheque in the register and reverse the receipt
 * (the installments are unpaid again).
 */
export async function bounceReceiptCheque(tx: DbTx, tenantId: string, receiptId: string, input: { userId: string; reason: string; date: string }) {
  const [receipt] = await tx.select().from(installmentPayments).where(eq(installmentPayments.id, receiptId))
  if (!receipt) throw new InstallmentError('Receipt not found', 404)
  if (!receipt.chequeId) throw new InstallmentError('This receipt was not paid by a registered cheque')
  if (receipt.voidedAt) throw new InstallmentError('This receipt is already reversed')
  const [c] = await tx.select().from(cheques).where(eq(cheques.id, receipt.chequeId))
  if (c && (c.status === 'pending' || c.status === 'deposited')) {
    await transitionCheque(tx, { tenantId, chequeId: c.id, action: 'bounce', userId: input.userId, reason: input.reason, date: input.date })
  } else if (!c || !['bounced', 'cancelled', 'returned'].includes(c.status)) {
    throw new InstallmentError(`The cheque is ${c?.status ?? 'missing'}; only a cheque in hand or deposited can bounce`)
  }
  return reverseInstallmentPayment(tx, tenantId, receiptId, {
    userId: input.userId, reason: `Cheque ${c?.chequeNo ?? ''} bounced: ${input.reason}`, date: input.date, cause: 'cheque_bounced',
  })
}

/**
 * Receipts whose cheque was bounced / cancelled in the cheques register: reverse them (with the
 * bounce date). planId null = every plan of the tenant. Returns the plans that changed.
 */
export async function syncBouncedCheques(tx: DbTx, tenantId: string, planId: string | null): Promise<string[]> {
  const rows = await tx.select({
    id: installmentPayments.id, planId: installmentPayments.planId, chequeNo: cheques.chequeNo, status: cheques.status,
    bouncedAt: cheques.bouncedAt, cancelledAt: cheques.cancelledAt, reason: cheques.bounceReason, by: cheques.updatedBy,
  })
    .from(installmentPayments)
    .innerJoin(cheques, eq(cheques.id, installmentPayments.chequeId))
    .where(and(
      eq(installmentPayments.tenantId, tenantId),
      planId ? eq(installmentPayments.planId, planId) : undefined,
      isNull(installmentPayments.voidedAt),
      inArray(cheques.status, ['bounced', 'cancelled', 'returned']),
    ))
  if (rows.length === 0) return []
  const tz = await getTenantTimezone(tenantId)
  const changed = new Set<string>()
  for (const r of rows) {
    const at = r.bouncedAt || r.cancelledAt || new Date()
    await reverseInstallmentPayment(tx, tenantId, r.id, {
      userId: r.by ?? null,
      reason: `Cheque ${r.chequeNo} ${r.status === 'cancelled' ? 'cancelled' : 'bounced'}${r.reason ? `: ${r.reason}` : ''}`,
      date: localParts(at, tz).date,
      cause: 'cheque_bounced',
    })
    changed.add(r.planId)
  }
  return [...changed]
}

export type RepossessCondition = 'good' | 'used' | 'damaged'
const SERIAL_STATUS: Record<RepossessCondition, 'available' | 'returned' | 'defective'> = {
  good: 'available', used: 'returned', damaged: 'defective',
}

export interface RepossessInput {
  reason: string
  date: string
  userId: string
  returnToStock: boolean
  warehouseId?: string | null
  condition?: RepossessCondition
  /** value the goods go back into stock at; default their cost (sale line unit cost / item cost) */
  recoveredValue?: number | null
  /** write the balance not covered by the goods off to Bad Debts */
  writeOff: boolean
}

/**
 * Plan repossessed (locked plan row, active / defaulted): goods optionally back into stock
 * (applyStockChange, serials back to available / returned / defective with movements), the
 * principal outstanding cleared by the goods' value and (optionally) a write-off, open
 * installments waived. Whatever is neither recovered nor written off stays on the customer's
 * receivable (plan.balance) to be recovered otherwise.
 */
export async function repossessPlan(tx: DbTx, tenantId: string, plan: Plan, input: RepossessInput) {
  const dbRows = await loadSchedule(tx, plan.id)
  const live = dbRows.map(toLiveRow)
  const principalOutstanding = round2(live.reduce((s, r) => s + rowPrincipalDue(r), 0))
  const lines: InstallmentRepossession['lines'] = []
  let costValue = 0
  const warehouseId = input.returnToStock ? (input.warehouseId || plan.warehouseId) : null
  const condition = input.condition || 'good'

  if (input.returnToStock) {
    if (!warehouseId) throw new InstallmentError('Choose the branch / warehouse the goods go back to')
    const goods = plan.items.map((l, i) => ({ l, i })).filter(({ l }) => !!l.itemId)
    if (goods.length === 0) throw new InstallmentError('None of the goods on this plan is a stock item; record them with a stock adjustment')
    for (const { l, i } of goods) {
      const itemId = l.itemId!
      const qty = Number(l.quantity) || 0
      if (qty <= 0) continue
      const [item] = await tx.select({ costPrice: itemsTable.costPrice, name: itemsTable.name }).from(itemsTable).where(eq(itemsTable.id, itemId))
      if (!item) throw new InstallmentError(`Item ${l.itemName} no longer exists`)
      let unitCost = num(item.costPrice)
      let serialIds: string[] = []
      if (l.saleItemId) {
        const [si] = await tx.select({ unitCost: saleItems.unitCost, serialNumberIds: saleItems.serialNumberIds }).from(saleItems).where(eq(saleItems.id, l.saleItemId))
        if (si?.unitCost != null) unitCost = num(si.unitCost)
        serialIds = Array.isArray(si?.serialNumberIds) ? si!.serialNumberIds! : []
      }
      const typed = (l.serialNumbers || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
      if (typed.length) {
        const found = await tx.select({ id: itemSerialNumbers.id }).from(itemSerialNumbers).where(and(
          eq(itemSerialNumbers.itemId, itemId),
          sql`lower(${itemSerialNumbers.serialNumber}) IN (${sql.join(typed.map((s) => sql`${s}`), sql`, `)})`,
        ))
        serialIds = [...new Set([...serialIds, ...found.map((f) => f.id)])]
      }
      const res = await applyStockChange(tx, {
        tenantId, warehouseId, itemId, mode: 'delta', qty, type: 'in',
        referenceType: 'installment_repossession', referenceId: plan.id,
        notes: `Repossessed on hire purchase ${plan.planNo} (${condition})`,
        userId: input.userId, source: 'installment', idempotencyKey: `hp-repo:${plan.id}:${i}`,
      })
      if (serialIds.length) {
        await allocateSerials(tx, {
          tenantId, serialNumberIds: serialIds, newStatus: SERIAL_STATUS[condition],
          referenceType: 'installment_repossession', referenceId: plan.id, changedBy: input.userId,
          notes: `Repossessed on ${plan.planNo} (${condition})`,
        })
        const current = await tx.select({ id: itemSerialNumbers.id, warehouseId: itemSerialNumbers.warehouseId }).from(itemSerialNumbers)
          .where(inArray(itemSerialNumbers.id, serialIds))
        const elsewhere = current.filter((s) => s.warehouseId !== warehouseId).map((s) => s.id)
        if (elsewhere.length) {
          await transferSerials(tx, {
            tenantId, serialNumberIds: elsewhere, toWarehouseId: warehouseId,
            referenceType: 'installment_repossession', referenceId: plan.id, changedBy: input.userId,
          })
        }
      }
      costValue = round2(costValue + unitCost * qty)
      lines.push({ itemId, itemName: l.itemName, quantity: qty, serialNumberIds: serialIds, movementId: res.movementId })
    }
  }

  const recoveredValue = input.returnToStock ? round2(Math.max(0, input.recoveredValue ?? costValue)) : 0
  const writtenOff = input.writeOff ? round2(Math.max(0, principalOutstanding - recoveredValue)) : 0
  await postRepossessionToGL(tx, tenantId, plan, { date: input.date, principalOutstanding, recoveredValue, writeOff: writtenOff })
  await settleSaleOnRepossession(tx, plan, {
    date: input.date, cleared: round2(Math.min(principalOutstanding, recoveredValue + writtenOff)), recoveredValue, writtenOff,
  })

  // open installments are closed; what is still owed is the receivable left
  for (const r of live) if (r.status === 'pending' || r.status === 'partial') r.status = 'waived'
  await writeRows(tx, dbRows, live)
  const balance = round2(Math.max(0, principalOutstanding - recoveredValue - writtenOff))
  const repossession: InstallmentRepossession = {
    date: input.date, returnedToStock: input.returnToStock, warehouseId, condition: input.returnToStock ? condition : null,
    principalOutstanding, recoveredValue, writtenOff, lines,
  }
  const now = new Date()
  const [row] = await tx.update(installmentPlans).set({
    status: 'repossessed',
    statusReason: input.reason,
    closedAt: now,
    balance: String(balance),
    writtenOffAmount: String(writtenOff),
    recoveredValue: String(recoveredValue),
    repossession,
    updatedAt: now,
  }).where(eq(installmentPlans.id, plan.id)).returning()
  return { plan: row, repossession }
}

/**
 * Sale-backed plan repossessed: the part of the receivable cleared by the goods and the write-off
 * is a non-cash settlement of the sale, recorded the way payment entries settle invoices (and
 * their write-offs): sales.paid_amount goes up (no payments row, so cash / tender reports are
 * untouched) and the status follows (completed when nothing is left). The details go in
 * sales.flags.hirePurchaseSettlement { planId, planNo, date, cleared, recoveredValue, writtenOff }.
 * So the sale's balance due equals what the ledger still has on Accounts Receivable for it.
 */
async function settleSaleOnRepossession(tx: DbTx, plan: Plan, d: { date: string; cleared: number; recoveredValue: number; writtenOff: number }) {
  if (!plan.saleId || !(d.cleared > 0)) return
  const [sale] = await tx.select().from(sales).where(eq(sales.id, plan.saleId)).for('update')
  if (!sale || sale.status === 'void' || sale.isReturn) return
  const total = num(sale.total)
  const paid = num(sale.paidAmount)
  const amount = round2(Math.min(d.cleared, Math.max(0, total - paid)))
  if (!(amount > 0)) return
  const newPaid = round2(paid + amount)
  const flag = { planId: plan.id, planNo: plan.planNo, date: d.date, cleared: amount, recoveredValue: d.recoveredValue, writtenOff: d.writtenOff }
  await tx.update(sales).set({
    paidAmount: String(Math.min(newPaid, total)),
    status: newPaid >= total - 0.004 ? 'completed' : 'partial',
    flags: sql`${sales.flags} || ${JSON.stringify({ hirePurchaseSettlement: flag })}::jsonb`,
  }).where(eq(sales.id, sale.id))
}

/**
 * Cancel a plan (locked row). From a credit sale: the sale stays a credit sale (its receivable
 * is untouched; receipts already taken stay). Hand-registered: only an agreement with no
 * installment receipts can be cancelled (entered in error) — its down payment receipts are
 * voided and its receivable reversed; one with receipts is closed by repossession / write-off.
 */
export async function cancelPlan(tx: DbTx, tenantId: string, plan: Plan, input: { reason: string; date: string; userId: string }) {
  if (!plan.saleId) {
    const receipts: Receipt[] = await tx.select().from(installmentPayments)
      .where(and(eq(installmentPayments.planId, plan.id), isNull(installmentPayments.voidedAt)))
    if (receipts.some((r) => r.kind !== 'down_payment')) {
      throw new InstallmentError('This agreement has installment receipts: void them first, or mark the goods repossessed (with or without writing the balance off)', 400, 'HAS_RECEIPTS')
    }
    for (const r of receipts) {
      await reverseInstallmentPayment(tx, tenantId, r.id, { userId: input.userId, reason: `Plan cancelled: ${input.reason}`, date: input.date, cause: 'void' })
    }
    await reversePlanReceivable(tx, tenantId, plan.id, input.date)
  }
  const now = new Date()
  const [row] = await tx.update(installmentPlans).set({
    status: 'cancelled', statusReason: input.reason, closedAt: now, updatedAt: now,
  }).where(eq(installmentPlans.id, plan.id)).returning()
  return row
}

/** Plans of a sale (one live plan per sale) */
export async function activePlanForSale(db: DbTx, saleId: string) {
  const [row] = await db.select({ id: installmentPlans.id, planNo: installmentPlans.planNo })
    .from(installmentPlans)
    .where(and(eq(installmentPlans.saleId, saleId), sql`${installmentPlans.status} IN ('active', 'defaulted')`))
    .limit(1)
  return row ?? null
}
