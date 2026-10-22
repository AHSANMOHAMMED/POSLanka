/**
 * H1 — server-side POS sale controls: shift validation, the POS profile that governs a sale
 * (discount / rate-change / negative-stock rules) and customer credit exposure.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { posOpeningEntries, posProfiles, posProfileUsers, sales } from '@/lib/db/schema'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type ShiftIssue = 'SHIFT_NOT_FOUND' | 'SHIFT_NOT_OPEN' | 'SHIFT_NOT_YOURS'

export const SHIFT_ISSUE_MESSAGES: Record<ShiftIssue | 'SHIFT_REQUIRED', string> = {
  SHIFT_NOT_FOUND: 'The POS shift of this sale was not found',
  SHIFT_NOT_OPEN: 'The POS shift is closed. Open a new shift to keep selling.',
  SHIFT_NOT_YOURS: 'This POS shift belongs to another cashier',
  SHIFT_REQUIRED: 'Open a POS shift before selling',
}

type ShiftRow = typeof posOpeningEntries.$inferSelect
type ProfileRow = typeof posProfiles.$inferSelect

export interface SaleShiftCheck {
  shift: ShiftRow | null
  profile: ProfileRow | null
  issue: ShiftIssue | null
}

/**
 * A sale's shift must exist (RLS: same tenant), be open and belong to the selling user —
 * unless the user may sell on anyone's shift (manageSales).
 */
export async function checkSaleShift(db: Db, input: {
  posOpeningEntryId: string | null | undefined
  userIds: string[]
  canUseAnyShift: boolean
}): Promise<SaleShiftCheck> {
  if (!input.posOpeningEntryId) return { shift: null, profile: null, issue: null }
  const shift: ShiftRow | undefined = await db.query.posOpeningEntries.findFirst({
    where: eq(posOpeningEntries.id, input.posOpeningEntryId),
  })
  if (!shift) return { shift: null, profile: null, issue: 'SHIFT_NOT_FOUND' }
  const profile: ProfileRow | null = (await db.query.posProfiles.findFirst({ where: eq(posProfiles.id, shift.posProfileId) })) || null
  if (shift.status !== 'open') return { shift, profile, issue: 'SHIFT_NOT_OPEN' }
  if (!input.userIds.includes(shift.userId) && !input.canUseAnyShift) return { shift, profile, issue: 'SHIFT_NOT_YOURS' }
  return { shift, profile, issue: null }
}

/** POS profiles the user is assigned to, default first (empty = not a POS user). */
export async function assignedPosProfiles(db: Db, userIds: string[]): Promise<ProfileRow[]> {
  if (userIds.length === 0) return []
  const rows = await db.select({ profile: posProfiles })
    .from(posProfileUsers)
    .innerJoin(posProfiles, eq(posProfiles.id, posProfileUsers.posProfileId))
    .where(and(inArray(posProfileUsers.userId, userIds), eq(posProfiles.status, 'active')))
    .orderBy(desc(posProfileUsers.isDefault), desc(posProfiles.isDefault))
  return rows.map((r: { profile: ProfileRow }) => r.profile)
}

/**
 * What the customer already owes on account: unpaid parts of their non-void invoices
 * (pending / partial). Store credit (customers.balance) is a separate liability.
 */
export async function customerOutstanding(db: Db, customerId: string): Promise<number> {
  const [row] = await db.select({
    due: sql<string>`COALESCE(SUM(GREATEST(${sales.total} - ${sales.paidAmount}, 0)), 0)`,
  })
    .from(sales)
    .where(and(
      eq(sales.customerId, customerId),
      eq(sales.isReturn, false),
      inArray(sales.status, ['pending', 'partial']),
    ))
  return roundCurrency(parseCurrency(row?.due))
}

export interface DiscountCheckLine {
  name: string
  quantity: number
  unitPrice: number
  discount: number
  catalogPrice: number
  isWeighable: boolean
}

export interface SaleControlFindings {
  discountPercent: number
  manualDiscount: number
  /** lines sold below the catalog price */
  priceOverrides: Array<{ name: string; unitPrice: number; catalogPrice: number }>
  needsDiscountApproval: boolean
  needsPriceApproval: boolean
}

/**
 * Discount and rate-change rules of the governing POS profile.
 *  - allowDiscountChange = false: any manual discount needs approval
 *  - discount above maxDiscountPercent of the gross needs approval
 *  - allowRateChange = false: a line below the catalog price needs approval (weighed lines get a
 *    few cents of tolerance: the POS derives their per-unit price from the label amount)
 */
export function evaluateSaleControls(profile: Pick<ProfileRow, 'allowDiscountChange' | 'allowRateChange' | 'maxDiscountPercent'> | null, input: {
  lines: DiscountCheckLine[]
  cartDiscount: number
}): SaleControlFindings {
  const gross = input.lines.reduce((sum, l) => sum + roundCurrency(l.unitPrice * l.quantity), 0)
  // Weighed lines carry a sub-cent remainder as a line discount (not a cashier discount)
  const lineDiscount = input.lines.reduce((sum, l) => sum + (l.isWeighable && l.discount <= 0.05 ? 0 : l.discount), 0)
  const manualDiscount = roundCurrency(input.cartDiscount + lineDiscount)
  const discountPercent = gross > 0 ? Math.round((manualDiscount / gross) * 10000) / 100 : 0
  const priceOverrides = input.lines
    .filter((l) => l.unitPrice < l.catalogPrice - (l.isWeighable ? 0.06 : 0.005))
    .map((l) => ({ name: l.name, unitPrice: l.unitPrice, catalogPrice: l.catalogPrice }))
  if (!profile) {
    return { discountPercent, manualDiscount, priceOverrides, needsDiscountApproval: false, needsPriceApproval: false }
  }
  const maxPct = parseFloat(String(profile.maxDiscountPercent ?? '100'))
  const needsDiscountApproval = manualDiscount > 0.004 && (
    profile.allowDiscountChange === false || (Number.isFinite(maxPct) && discountPercent > maxPct + 0.0001)
  )
  const needsPriceApproval = profile.allowRateChange === false && priceOverrides.length > 0
  return { discountPercent, manualDiscount, priceOverrides, needsDiscountApproval, needsPriceApproval }
}
