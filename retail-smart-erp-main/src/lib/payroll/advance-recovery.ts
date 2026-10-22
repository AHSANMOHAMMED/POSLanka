/**
 * Employee-advance recovery through salary slips.
 *
 * A slip's `advanceDeduction` (computed by computeSalarySlip from the open advances) must actually
 * reduce those advances when the slip is submitted, otherwise the same installment is deducted
 * from every month's pay forever. Each piece is recorded in salary_slip_advance_recoveries so a
 * slip cancellation restores exactly what it took.
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { employeeAdvances, salarySlipAdvanceRecoveries } from '@/lib/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

const toCents = (v: unknown) => Math.round((Number(v) || 0) * 100)

export class AdvanceRecoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdvanceRecoveryError'
  }
}

/** Apply a submitted slip's advance deduction to the employee's open advances (oldest first). */
export async function applyAdvanceRecovery(
  tx: DbOrTx,
  tenantId: string,
  slip: { id: string; slipNo?: string | null; employeeProfileId: string; advanceDeduction: string | number | null }
): Promise<number> {
  let remaining = toCents(slip.advanceDeduction)
  if (remaining <= 0) return 0

  const open = await tx.select().from(employeeAdvances)
    .where(and(
      eq(employeeAdvances.employeeProfileId, slip.employeeProfileId),
      inArray(employeeAdvances.status, ['disbursed', 'partially_recovered']),
    ))
    .orderBy(asc(employeeAdvances.disbursedAt), asc(employeeAdvances.createdAt))
    .for('update')

  // Same per-advance cap as computeSalarySlip (one installment each), then any rest oldest-first
  const plan = new Map<string, number>()
  for (const pass of ['installment', 'balance'] as const) {
    for (const adv of open) {
      if (remaining <= 0) break
      const balance = toCents(adv.balanceAmount) - (plan.get(adv.id) || 0)
      if (balance <= 0) continue
      const cap = pass === 'installment' ? (toCents(adv.recoveryAmountPerInstallment) || balance) : balance
      const take = Math.min(cap, balance, remaining)
      if (take <= 0) continue
      plan.set(adv.id, (plan.get(adv.id) || 0) + take)
      remaining -= take
    }
  }

  if (remaining > 0) {
    throw new AdvanceRecoveryError(
      `Salary slip ${slip.slipNo || slip.id} deducts ${(toCents(slip.advanceDeduction) / 100).toFixed(2)} for advances, but the employee's open advances no longer cover it. Recalculate the slip before submitting.`)
  }

  let applied = 0
  for (const adv of open) {
    const take = plan.get(adv.id)
    if (!take) continue
    const newBalance = toCents(adv.balanceAmount) - take
    const newRecovered = toCents(adv.recoveredAmount) + take
    await tx.update(employeeAdvances).set({
      balanceAmount: (newBalance / 100).toFixed(2),
      recoveredAmount: (newRecovered / 100).toFixed(2),
      status: newBalance <= 0 ? 'fully_recovered' : 'partially_recovered',
      updatedAt: new Date(),
    }).where(eq(employeeAdvances.id, adv.id))
    await tx.insert(salarySlipAdvanceRecoveries).values({
      tenantId,
      salarySlipId: slip.id,
      employeeAdvanceId: adv.id,
      amount: (take / 100).toFixed(2),
    })
    applied += take
  }
  return applied / 100
}

/** Put back whatever a (now cancelled) slip recovered from advances. */
export async function reverseAdvanceRecovery(tx: DbOrTx, slipId: string): Promise<number> {
  const rows = await tx.select().from(salarySlipAdvanceRecoveries)
    .where(eq(salarySlipAdvanceRecoveries.salarySlipId, slipId))
  if (rows.length === 0) return 0

  let restored = 0
  for (const r of rows) {
    const [adv] = await tx.select().from(employeeAdvances)
      .where(eq(employeeAdvances.id, r.employeeAdvanceId))
      .for('update')
    if (!adv) continue
    const amount = toCents(r.amount)
    const newBalance = toCents(adv.balanceAmount) + amount
    const newRecovered = Math.max(0, toCents(adv.recoveredAmount) - amount)
    const update: Record<string, unknown> = {
      balanceAmount: (newBalance / 100).toFixed(2),
      recoveredAmount: (newRecovered / 100).toFixed(2),
      updatedAt: new Date(),
    }
    if (adv.status !== 'cancelled') {
      update.status = newRecovered <= 0 ? 'disbursed' : 'partially_recovered'
    }
    await tx.update(employeeAdvances).set(update).where(eq(employeeAdvances.id, adv.id))
    restored += amount
  }
  await tx.delete(salarySlipAdvanceRecoveries).where(eq(salarySlipAdvanceRecoveries.salarySlipId, slipId))
  return restored / 100
}
