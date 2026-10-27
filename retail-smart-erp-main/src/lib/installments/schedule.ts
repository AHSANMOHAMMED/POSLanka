/**
 * Hire purchase arithmetic (drizzle/0181). Pure and client-safe: the plan form previews with the
 * same functions the API uses to store the plan.
 *
 *  financed      = cash price − down payment
 *  interest      = flat: financed × annual rate % × term months / 12   |  fixed: the amount given
 *  total payable = financed + interest (excludes the down payment)
 *  installments  = term months (monthly) or ≈ weeks in the term (weekly); equal amounts, the last
 *                  one absorbs rounding; interest is spread evenly (flat-rate convention)
 *
 * Payments are applied oldest installment first; within an installment the late fee is paid
 * first, then interest, then principal. Since 0186 the interest / principal each row received is
 * stored (interestPaid / principalPaid, see payRow) so a receipt reversed out of order (bounced
 * cheque, void) takes off exactly what it posted to the ledger. Early settlement pays the remaining principal, the
 * interest of installments already due, outstanding late fees, and `100 − rebate %` of the
 * interest not yet due.
 */

export type InstallmentFrequency = 'monthly' | 'weekly'
export type InterestType = 'flat' | 'fixed'
export type LateFeeType = 'none' | 'fixed' | 'percent'

export interface PlanTerms {
  cashPrice: number
  downPayment: number
  interestType: InterestType
  interestRate: number
  interestAmount: number
  termMonths: number
  frequency: InstallmentFrequency
  startDate: string
}

export interface ScheduleRow {
  installmentNo: number
  dueDate: string
  amount: number
  principal: number
  interest: number
}

export interface PlanCalculation {
  financedAmount: number
  interestAmount: number
  totalPayable: number
  installmentCount: number
  installmentAmount: number
  rows: ScheduleRow[]
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function installmentCountFor(termMonths: number, frequency: InstallmentFrequency): number {
  return frequency === 'weekly' ? Math.max(1, Math.round((termMonths * 52) / 12)) : Math.max(1, termMonths)
}

/** YYYY-MM-DD + n months, clamped to the month's last day (31 Jan + 1 → 28/29 Feb) */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** Split `total` into `count` equal parts (2 dp); the last part absorbs the rounding. */
function split(total: number, count: number): number[] {
  const each = round2(total / count)
  const parts = Array.from({ length: count }, () => each)
  parts[count - 1] = round2(total - each * (count - 1))
  return parts
}

export function calculatePlan(t: PlanTerms): PlanCalculation {
  const financedAmount = round2(Math.max(0, t.cashPrice - t.downPayment))
  const interestAmount = round2(t.interestType === 'fixed'
    ? Math.max(0, t.interestAmount)
    : (financedAmount * Math.max(0, t.interestRate) * t.termMonths) / 1200)
  const totalPayable = round2(financedAmount + interestAmount)
  const installmentCount = installmentCountFor(t.termMonths, t.frequency)
  const amounts = split(totalPayable, installmentCount)
  const interests = split(interestAmount, installmentCount)
  const rows: ScheduleRow[] = amounts.map((amount, i) => {
    const interest = Math.min(interests[i], amount)
    return {
      installmentNo: i + 1,
      dueDate: t.frequency === 'weekly' ? addDays(t.startDate, 7 * i) : addMonths(t.startDate, i),
      amount,
      interest: round2(interest),
      principal: round2(amount - interest),
    }
  })
  // keep the principal column summing exactly to the financed amount
  const principalSum = round2(rows.reduce((s, r) => s + r.principal, 0))
  const drift = round2(financedAmount - principalSum)
  if (drift !== 0 && rows.length > 0) {
    const last = rows[rows.length - 1]
    last.principal = round2(last.principal + drift)
    last.interest = round2(last.amount - last.principal)
  }
  return { financedAmount, interestAmount, totalPayable, installmentCount, installmentAmount: amounts[0] ?? 0, rows }
}

// ==================== LATE FEES / PAYMENT ALLOCATION ====================

export interface LiveRow {
  installmentNo: number
  dueDate: string
  amount: number
  principal: number
  interest: number
  paidAmount: number
  lateFee: number
  lateFeePaid: number
  /** what paidAmount covered (stored since 0186; derived interest-first when absent) */
  interestPaid?: number
  principalPaid?: number
  status: 'pending' | 'partial' | 'paid' | 'waived'
}

export interface LateFeeRule { lateFeeType: LateFeeType; lateFeeValue: number; graceDays: number }

/** The late fee an unpaid installment has earned by `today` (charged once per installment). */
export function lateFeeFor(row: Pick<LiveRow, 'dueDate' | 'amount' | 'status'>, rule: LateFeeRule, today: string): number {
  if (rule.lateFeeType === 'none' || rule.lateFeeValue <= 0) return 0
  if (row.status === 'paid' || row.status === 'waived') return 0
  if (daysBetween(row.dueDate, today) <= rule.graceDays) return 0
  return round2(rule.lateFeeType === 'fixed' ? rule.lateFeeValue : (row.amount * rule.lateFeeValue) / 100)
}

export const rowDue = (r: LiveRow) => round2(Math.max(0, r.amount - r.paidAmount))
export const rowFeeDue = (r: LiveRow) => round2(Math.max(0, r.lateFee - r.lateFeePaid))
/** Interest already covered by what was paid on the row (interest is paid before principal) */
export const rowInterestPaid = (r: Pick<LiveRow, 'interest' | 'paidAmount' | 'interestPaid' | 'principalPaid'>) =>
  r.interestPaid !== undefined && r.principalPaid !== undefined ? round2(r.interestPaid) : round2(Math.min(r.interest, r.paidAmount))
export const rowPrincipalPaid = (r: Pick<LiveRow, 'interest' | 'paidAmount' | 'interestPaid' | 'principalPaid'>) =>
  r.interestPaid !== undefined && r.principalPaid !== undefined ? round2(r.principalPaid) : round2(Math.max(0, r.paidAmount - r.interest))
/** Principal not yet received on a row (0 for paid / waived rows) */
export const rowPrincipalDue = (r: LiveRow) =>
  r.status === 'paid' || r.status === 'waived' ? 0 : round2(Math.max(0, r.principal - rowPrincipalPaid(r)))

/**
 * Put `pay` on a row: the row's unpaid interest first, then principal. Keeps the stored
 * interestPaid / principalPaid in step with paidAmount. Returns the split.
 */
export function payRow(r: LiveRow, pay: number): { interest: number; principal: number } {
  const intBefore = rowInterestPaid(r)
  const prinBefore = rowPrincipalPaid(r)
  const interest = round2(Math.min(pay, Math.max(0, r.interest - intBefore)))
  const principal = round2(pay - interest)
  r.paidAmount = round2(r.paidAmount + pay)
  r.interestPaid = round2(intBefore + interest)
  r.principalPaid = round2(prinBefore + principal)
  return { interest, principal }
}

export interface Allocation {
  installmentNo: number
  amount: number
  lateFee: number
  principal: number
  interest: number
  /** settlement: interest rebated on the row */
  waived?: number
  /** late fee waived on the row */
  feeWaived?: number
}

/**
 * Apply `amount` to the rows, oldest first (late fee, then the installment). Returns the updated
 * rows, the allocations and any amount left over (more than everything outstanding).
 */
export function allocatePayment(rows: LiveRow[], amount: number, opts?: { waiveLateFees?: boolean }) {
  let left = round2(amount)
  const next = rows.map((r) => ({ ...r }))
  const allocations: Allocation[] = []
  for (const r of next.sort((a, b) => a.installmentNo - b.installmentNo)) {
    if (left <= 0) break
    if (r.status === 'paid' || r.status === 'waived') continue
    let fee = 0
    if (!opts?.waiveLateFees) {
      fee = Math.min(left, rowFeeDue(r))
      r.lateFeePaid = round2(r.lateFeePaid + fee)
      left = round2(left - fee)
    }
    const pay = Math.min(left, rowDue(r))
    const split = payRow(r, pay)
    left = round2(left - pay)
    let feeWaived = 0
    if (opts?.waiveLateFees && rowDue(r) === 0) {
      feeWaived = round2(r.lateFee - r.lateFeePaid)
      r.lateFee = r.lateFeePaid
    }
    r.status = rowDue(r) === 0 ? 'paid' : r.paidAmount > 0 ? 'partial' : r.status
    if (fee > 0 || pay > 0) {
      allocations.push({
        installmentNo: r.installmentNo,
        amount: round2(pay),
        lateFee: round2(fee),
        interest: split.interest,
        principal: split.principal,
        ...(feeWaived > 0 ? { feeWaived } : {}),
      })
    }
  }
  return { rows: next, allocations, leftover: left }
}

export interface SettlementQuote {
  principalOutstanding: number
  interestDue: number
  futureInterest: number
  rebate: number
  lateFees: number
  total: number
}

/** Early payoff amount on `today` with `rebatePercent` of the not-yet-due interest waived. */
export function settlementQuote(rows: LiveRow[], today: string, rebatePercent: number, opts?: { waiveLateFees?: boolean }): SettlementQuote {
  let principalOutstanding = 0
  let interestDue = 0
  let futureInterest = 0
  let lateFees = 0
  for (const r of rows) {
    if (r.status === 'paid' || r.status === 'waived') continue
    principalOutstanding += Math.max(0, r.principal - rowPrincipalPaid(r))
    const interestLeft = Math.max(0, r.interest - rowInterestPaid(r))
    if (r.dueDate <= today) interestDue += interestLeft
    else futureInterest += interestLeft
    if (!opts?.waiveLateFees) lateFees += rowFeeDue(r)
  }
  const rebate = round2((futureInterest * Math.min(100, Math.max(0, rebatePercent))) / 100)
  const total = round2(principalOutstanding + interestDue + futureInterest - rebate + lateFees)
  return {
    principalOutstanding: round2(principalOutstanding),
    interestDue: round2(interestDue),
    futureInterest: round2(futureInterest),
    rebate,
    lateFees: round2(lateFees),
    total,
  }
}

/** Plan balance (installments only, excluding late fees) */
export const outstandingOf = (rows: LiveRow[]) =>
  round2(rows.filter((r) => r.status !== 'waived').reduce((s, r) => s + rowDue(r), 0))
