// Pure: which tender buttons a POS counter (profile) offers. Shift close only asks the cashier to
// count the methods the shift was opened with (the profile's methods + cash), so selling with a
// method the profile does not list leaves it uncounted and shows up as a variance on close.

export type TenderOption = 'cash' | 'card' | 'lankaqr' | 'credit' | 'cheque'

/** Server payment method each tender button records. */
export const TENDER_METHOD: Record<TenderOption, string> = {
  cash: 'cash',
  card: 'card',
  lankaqr: 'bank_transfer',
  credit: 'credit',
  cheque: 'cheque',
}

export function allowedTenders(profile: { paymentMethods?: Array<string | { paymentMethod?: string | null }> | null } | null | undefined): Set<TenderOption> {
  const listed = (profile?.paymentMethods || [])
    .map((pm) => (typeof pm === 'string' ? pm : pm?.paymentMethod))
    .filter((m): m is string => typeof m === 'string' && m.length > 0)
  const all: TenderOption[] = ['cash', 'card', 'lankaqr', 'credit', 'cheque']
  // No list configured (older profiles): everything is allowed, as before, except cheques, which
  // a counter takes only when its profile lists them (shift close then counts them).
  if (listed.length === 0) return new Set(all.filter((t) => t !== 'cheque'))
  // Cash is always opened with a float, so it is always counted on close. Credit stays governed
  // by the profile's allowCreditSale flag (no money changes hands).
  return new Set(all.filter((t) => t === 'cash' || t === 'credit' || listed.includes(TENDER_METHOD[t])))
}
