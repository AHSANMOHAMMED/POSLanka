/**
 * Split payment arithmetic shared by the POS payment screen and the sale it saves.
 *
 * A bill is paid by several lines (cash, card, transfer, cheque, mobile, credit = left on the
 * customer's account). Only cash can be more than what is owed (the extra is change); the saved
 * splits are exact (the server refuses splits above the amount due), so change is taken off the
 * cash lines. Pure module.
 */
import { roundCurrency } from '@/lib/utils/currency'

export interface TenderLine { method: string; amount: number }

export interface TenderResult {
  /** Received + on account, capped at the amount due */
  paid: number
  /** Cash handed back */
  change: number
  /** Still owed after these lines (no credit line covers it) */
  balance: number
  /** Exact splits to save (amounts > 0) */
  splits: TenderLine[]
  /** Money received (non-credit splits) */
  received: number
  /** Left on the customer's account (credit lines) */
  onAccount: number
  error: string | null
}

export function settleTenders(due: number, lines: TenderLine[]): TenderResult {
  const owed = roundCurrency(Math.max(0, due))
  const clean = lines.map((l) => ({ method: l.method, amount: roundCurrency(Math.max(0, Number(l.amount) || 0)) }))
  const sum = roundCurrency(clean.reduce((s, l) => s + l.amount, 0))
  const cash = roundCurrency(clean.filter((l) => l.method === 'cash').reduce((s, l) => s + l.amount, 0))
  const over = roundCurrency(Math.max(0, sum - owed))
  let error: string | null = null
  if (clean.filter((l) => l.method === 'cheque' && l.amount > 0).length > 1) error = 'Only one cheque per bill'
  else if (over > 0 && over > cash) error = 'Card, cheque, transfer and credit cannot be more than the bill. Only cash gives change.'

  // Take the change off the cash lines, last first
  let toRemove = error ? 0 : over
  const splits = clean.map((l) => ({ ...l }))
  for (let i = splits.length - 1; i >= 0 && toRemove > 0; i--) {
    if (splits[i].method !== 'cash') continue
    const take = Math.min(splits[i].amount, toRemove)
    splits[i].amount = roundCurrency(splits[i].amount - take)
    toRemove = roundCurrency(toRemove - take)
  }
  const exact = splits.filter((l) => l.amount > 0)
  const onAccount = roundCurrency(exact.filter((l) => l.method === 'credit').reduce((s, l) => s + l.amount, 0))
  const received = roundCurrency(exact.filter((l) => l.method !== 'credit').reduce((s, l) => s + l.amount, 0))
  return {
    paid: roundCurrency(Math.min(owed, sum)),
    change: error ? 0 : over,
    balance: roundCurrency(Math.max(0, owed - sum)),
    splits: exact,
    received,
    onAccount,
    error,
  }
}
