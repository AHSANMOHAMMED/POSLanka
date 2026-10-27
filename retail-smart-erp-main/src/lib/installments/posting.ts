/**
 * Hire purchase ledger postings (drizzle/0186). Server-only; every function runs inside the
 * caller's transaction (the one that writes the plan / receipt), so a failed posting rolls the
 * business change back too.
 *
 * Approach (simple SME hire purchase, interest recognised when received):
 *  - The receivable holds the financed PRINCIPAL only. Interest is not booked up front (no
 *    unearned-interest liability): each receipt credits the interest it covers to
 *    "Hire Purchase Interest Income". An early-settlement rebate is interest never received, so
 *    it is simply never posted; a write-off only ever concerns principal.
 *  - Plan from a credit sale: the sale already booked Dr Accounts Receivable / Cr Sales (and the
 *    counter down payment). The plan finances that open receivable, so receipts credit Accounts
 *    Receivable (customer party, against the sale) — the customer ledger and the sale agree.
 *  - Hand-registered plan (no sale in the system): on creation
 *        Dr Installment Receivable (financed)  /  Cr Sales Revenue (financed)
 *    and its down payment taken now Dr Cash / Cr Sales Revenue, so revenue = the cash price.
 *    An "opening agreement" (carried over from paper books / an old system, the sale was booked
 *    there) credits Retained Earnings instead and its historical down payment posts nothing.
 *  - Receipt (voucher installment_payment, one per receipt):
 *        Dr Cash / Bank / Card / Cheque account (Modes of Payment, like every receipt)  amount
 *        Cr receivable                principal part
 *        Cr HP Interest Income        interest part
 *        Cr Installment Late Fee Income  late fee part
 *  - Void / bounced cheque: the receipt's voucher is reversed (reverseGLEntries).
 *  - Repossession (voucher installment_repossession): goods back Dr Inventory (recovered value),
 *    write-off Dr Bad Debts, Cr receivable; recovered value above the balance → Cr Other Income.
 * Idempotent: a voucher is never posted twice (checked before posting).
 */
import { and, eq, sql } from 'drizzle-orm'
import { glEntries, installmentPlans } from '@/lib/db/schema'
import type { DbTx } from '@/lib/inventory/db-types'
import { createGLEntries, reverseGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
import { resolvePosTenderAccount } from '@/lib/accounting/auto-post'
import { hpAccount, hpLedger, type HpLedger } from './accounts'
import { round2 } from './schedule'

type Plan = typeof installmentPlans.$inferSelect

export const HP_VOUCHER = {
  plan: 'installment_plan',
  receipt: 'installment_payment',
  repossession: 'installment_repossession',
} as const

/** true when the voucher has entries and was never reversed */
export async function voucherPosted(tx: DbTx, tenantId: string, voucherType: string, voucherId: string): Promise<boolean> {
  const [r] = await tx.select({
    n: sql<number>`count(*)::int`,
    rev: sql<number>`count(*) FILTER (WHERE coalesce(${glEntries.remarks}, '') LIKE 'Reversal:%' OR coalesce(${glEntries.voucherNumber}, '') LIKE 'REV-%')::int`,
  }).from(glEntries).where(and(eq(glEntries.tenantId, tenantId), eq(glEntries.voucherType, voucherType), eq(glEntries.voucherId, voucherId)))
  return (r?.n ?? 0) > 0 && (r?.rev ?? 0) === 0
}

const party = (plan: Pick<Plan, 'customerId'>) => (plan.customerId ? { partyType: 'customer' as const, partyId: plan.customerId } : {})

async function tenderAccount(tx: DbTx, tenantId: string, method: string): Promise<string> {
  const acc = await resolvePosTenderAccount(tx, tenantId, method)
  if (!acc) throw new Error('GL_ACCOUNTS_MISSING: Cannot post installment receipt — missing Cash account. Configure in Settings → Accounting.')
  return acc
}

/**
 * Account the plan's principal sits in (stored on the plan the first time): Accounts Receivable
 * for a plan from a credit sale, Installment Receivable for a hand-registered one.
 */
export async function planReceivableAccount(tx: DbTx, tenantId: string, plan: Plan, ledger: HpLedger): Promise<string> {
  if (plan.receivableAccountId) return plan.receivableAccountId
  let id: string | null
  if (plan.saleId) {
    id = ledger.receivableId
    if (!id) throw new Error('GL_ACCOUNTS_MISSING: Cannot post installment receipt — missing Accounts Receivable account. Configure in Settings → Accounting.')
  } else {
    id = await hpAccount(tx, tenantId, 'installment_receivable')
  }
  await tx.update(installmentPlans).set({ receivableAccountId: id }).where(eq(installmentPlans.id, plan.id))
  plan.receivableAccountId = id
  return id
}

/**
 * Hand-registered plan: book the financed amount as Installment Receivable (once). Called at
 * creation and again (no-op when done) before every receipt, so a plan made before accounting
 * was set up gets its receivable before the first receipt credits it.
 */
export async function postPlanReceivable(tx: DbTx, tenantId: string, plan: Plan, postingDate: string): Promise<boolean> {
  if (plan.saleId) return false
  const financed = round2(Number(plan.financedAmount))
  if (!(financed > 0)) return false
  const ledger = await hpLedger(tx, tenantId)
  if (!ledger) return false
  // posted already, or posted and reversed (cancelled plan): never post again
  const [any] = await tx.select({ id: glEntries.id }).from(glEntries)
    .where(and(eq(glEntries.tenantId, tenantId), eq(glEntries.voucherType, HP_VOUCHER.plan), eq(glEntries.voucherId, plan.id))).limit(1)
  if (any) return false
  const receivable = await planReceivableAccount(tx, tenantId, plan, ledger)
  const credit = plan.openingAgreement ? await hpAccount(tx, tenantId, 'retained_earnings') : ledger.incomeId
  if (!credit) throw new Error('GL_ACCOUNTS_MISSING: Cannot post hire purchase plan — missing default Income account. Configure in Settings → Accounting.')
  const remarks = plan.openingAgreement
    ? `Hire purchase ${plan.planNo}: opening agreement balance`
    : `Hire purchase ${plan.planNo}: goods sold on hire purchase`
  await createGLEntries(tx, {
    tenantId,
    postingDate,
    voucherType: HP_VOUCHER.plan,
    voucherId: plan.id,
    voucherNumber: plan.planNo,
    fiscalYearId: ledger.fiscalYearId,
    entries: [
      { accountId: receivable, debit: financed, ...party(plan), costCenterId: ledger.costCenterId, remarks },
      { accountId: credit, credit: financed, costCenterId: ledger.costCenterId, remarks },
    ],
  })
  return true
}

/** Cancel a hand-registered plan: take its receivable off again. */
export async function reversePlanReceivable(tx: DbTx, tenantId: string, planId: string, date: string) {
  return reverseGLEntries(tx, tenantId, HP_VOUCHER.plan, planId, date)
}

export interface ReceiptPosting {
  receiptId: string
  receiptNo: string
  kind: 'down_payment' | 'installment' | 'settlement'
  paymentDate: string
  method: string
  amount: number
  principal: number
  interest: number
  lateFee: number
  saleId?: string | null
  costCenterId?: string | null
}

/**
 * Post a receipt (voucher installment_payment). Returns true when posted, false when there is
 * nothing to post (accounting not set up, opening agreement's historical down payment).
 */
export async function postReceiptToGL(tx: DbTx, tenantId: string, plan: Plan, r: ReceiptPosting): Promise<boolean> {
  const ledger = await hpLedger(tx, tenantId)
  if (!ledger) return false
  if (await voucherPosted(tx, tenantId, HP_VOUCHER.receipt, r.receiptId)) return true
  const amount = round2(r.amount)
  const costCenterId = r.costCenterId || ledger.costCenterId
  const remarks = `${r.kind === 'settlement' ? 'Settlement' : r.kind === 'down_payment' ? 'Down payment' : 'Installment'} ${r.receiptNo} (${plan.planNo})`
  const cash = await tenderAccount(tx, tenantId, r.method)
  const entries: GLEntryInput[] = [{ accountId: cash, debit: amount, costCenterId, remarks: `${remarks} — ${r.method}` }]

  if (r.kind === 'down_payment') {
    // only hand-registered plans record a down payment receipt (a sale's was taken at the till)
    if (plan.openingAgreement) return false
    if (!ledger.incomeId) throw new Error('GL_ACCOUNTS_MISSING: Cannot post down payment — missing default Income account. Configure in Settings → Accounting.')
    entries.push({ accountId: ledger.incomeId, credit: amount, costCenterId, remarks })
  } else {
    if (!plan.saleId) await postPlanReceivable(tx, tenantId, plan, r.paymentDate)
    const principal = round2(r.principal)
    const interest = round2(r.interest)
    const fee = round2(r.lateFee)
    if (Math.abs(round2(principal + interest + fee) - amount) > 0.001) {
      throw new Error(`Installment receipt ${r.receiptNo} does not add up: ${principal} + ${interest} + ${fee} ≠ ${amount}`)
    }
    if (principal > 0) {
      entries.push({
        accountId: await planReceivableAccount(tx, tenantId, plan, ledger), credit: principal, ...party(plan), costCenterId,
        ...(r.saleId ? { againstVoucherType: 'sale', againstVoucherId: r.saleId } : {}),
        remarks: `${remarks}: principal`,
      })
    }
    if (interest > 0) entries.push({ accountId: await hpAccount(tx, tenantId, 'interest_income'), credit: interest, costCenterId, remarks: `${remarks}: interest` })
    if (fee > 0) entries.push({ accountId: await hpAccount(tx, tenantId, 'late_fee_income'), credit: fee, costCenterId, remarks: `${remarks}: late fee` })
  }
  await createGLEntries(tx, {
    tenantId,
    postingDate: r.paymentDate,
    voucherType: HP_VOUCHER.receipt,
    voucherId: r.receiptId,
    voucherNumber: r.receiptNo,
    fiscalYearId: ledger.fiscalYearId,
    entries,
  })
  return true
}

/**
 * Take a receipt off the ledger. 'voucher' receipts: reverse their voucher. 'legacy' (before
 * 0186 the principal was posted on the sale's payment voucher, Dr Cash / Cr Receivable): post the
 * opposite under the receipt's own voucher number.
 */
export async function reverseReceiptGL(tx: DbTx, tenantId: string, plan: Plan, r: {
  id: string; receiptNo: string; glMode: 'voucher' | 'legacy' | null; paymentMethod: string; salePrincipal: number; saleId?: string | null
}, date: string): Promise<void> {
  if (r.glMode === 'voucher') {
    await reverseGLEntries(tx, tenantId, HP_VOUCHER.receipt, r.id, date)
    return
  }
  if (r.glMode === 'legacy' && r.salePrincipal > 0) {
    const ledger = await hpLedger(tx, tenantId)
    if (!ledger?.receivableId) return
    const remarks = `Reversal: installment ${r.receiptNo} (${plan.planNo})`
    await createGLEntries(tx, {
      tenantId,
      postingDate: date,
      voucherType: HP_VOUCHER.receipt,
      voucherId: r.id,
      voucherNumber: `REV-${r.receiptNo}`,
      fiscalYearId: ledger.fiscalYearId,
      entries: [
        { accountId: ledger.receivableId, debit: r.salePrincipal, ...party(plan), costCenterId: ledger.costCenterId, remarks },
        { accountId: await tenderAccount(tx, tenantId, r.paymentMethod), credit: r.salePrincipal, costCenterId: ledger.costCenterId, remarks },
      ],
    })
  }
}

/**
 * Repossession: Dr Inventory (goods back, at `recoveredValue`), Dr Bad Debts (`writeOff`),
 * Cr receivable (what they clear, at most the principal outstanding), Cr Other Income (goods
 * worth more than the balance). Returns false when nothing posts.
 */
export async function postRepossessionToGL(tx: DbTx, tenantId: string, plan: Plan, d: {
  date: string; principalOutstanding: number; recoveredValue: number; writeOff: number
}): Promise<boolean> {
  const ledger = await hpLedger(tx, tenantId)
  if (!ledger) return false
  if (await voucherPosted(tx, tenantId, HP_VOUCHER.repossession, plan.id)) return true
  const recovered = round2(Math.max(0, d.recoveredValue))
  const writeOff = round2(Math.max(0, d.writeOff))
  const cleared = round2(Math.min(d.principalOutstanding, recovered + writeOff))
  const gain = round2(recovered + writeOff - cleared)
  if (recovered <= 0 && writeOff <= 0) return false
  if (!plan.saleId) await postPlanReceivable(tx, tenantId, plan, d.date)
  const costCenterId = ledger.costCenterId
  const remarks = `Hire purchase ${plan.planNo} repossessed`
  const entries: GLEntryInput[] = []
  if (recovered > 0) {
    if (!ledger.stockId) throw new Error('GL_ACCOUNTS_MISSING: Cannot post repossessed goods — missing Stock / Inventory account. Configure in Settings → Accounting.')
    entries.push({ accountId: ledger.stockId, debit: recovered, costCenterId, remarks: `${remarks}: goods back in stock` })
  }
  if (writeOff > 0) entries.push({ accountId: await hpAccount(tx, tenantId, 'bad_debts'), debit: writeOff, costCenterId, remarks: `${remarks}: balance written off` })
  if (cleared > 0) {
    entries.push({
      accountId: await planReceivableAccount(tx, tenantId, plan, ledger), credit: cleared, ...party(plan), costCenterId,
      ...(plan.saleId ? { againstVoucherType: 'sale', againstVoucherId: plan.saleId } : {}),
      remarks: `${remarks}: receivable cleared`,
    })
  }
  if (gain > 0) entries.push({ accountId: await hpAccount(tx, tenantId, 'other_income'), credit: gain, costCenterId, remarks: `${remarks}: goods recovered above the balance` })
  await createGLEntries(tx, {
    tenantId,
    postingDate: d.date,
    voucherType: HP_VOUCHER.repossession,
    voucherId: plan.id,
    voucherNumber: `${plan.planNo}-REPO`,
    fiscalYearId: ledger.fiscalYearId,
    entries,
  })
  return true
}
