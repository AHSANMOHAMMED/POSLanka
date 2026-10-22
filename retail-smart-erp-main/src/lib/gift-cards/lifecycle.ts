/**
 * Gift card lifecycle helpers shared by the gift-card routes.
 *
 * - Expiry is a calendar date: a card "valid until 2026-10-21" can be used for the whole of
 *   21 October in the tenant's timezone (Asia/Colombo by default), not only until 00:00 UTC.
 * - Breakage (recognising the unused balance of a blocked / expired card as income) must be
 *   posted once per block/expire and reversed when the card is reactivated, otherwise a card
 *   blocked, unblocked and blocked again posts the same balance as income repeatedly while the
 *   customer can still spend it.
 */
import { and, eq } from 'drizzle-orm'
import { accountingSettings, glEntries } from '@/lib/db/schema'
import { createGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
import { getTenantTimezone, localParts } from '@/lib/notifications/alert-settings'
import { roundCurrency } from '@/lib/utils/currency'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

/** Today's date (YYYY-MM-DD) in the tenant's timezone. */
export async function tenantTodayDate(tenantId: string, now: Date = new Date()): Promise<string> {
  return localParts(now, await getTenantTimezone(tenantId)).date
}

/** True when a card with this expiry date can no longer be used on `today` (YYYY-MM-DD). */
export function isExpiredOn(expiryDate: string | Date | null | undefined, today: string): boolean {
  if (!expiryDate) return false
  const exp = typeof expiryDate === 'string' ? expiryDate.slice(0, 10) : expiryDate.toISOString().slice(0, 10)
  return exp < today
}

export const BREAKAGE_VOUCHER = 'gift_card_breakage'

/** Net (debit - credit) per account of the breakage currently recognised for a card. */
export async function netBreakageByAccount(tx: DbOrTx, tenantId: string, giftCardId: string): Promise<Map<string, number>> {
  const rows: Array<{ accountId: string; debit: string; credit: string; costCenterId: string | null }> = await tx
    .select({ accountId: glEntries.accountId, debit: glEntries.debit, credit: glEntries.credit, costCenterId: glEntries.costCenterId })
    .from(glEntries)
    .where(and(eq(glEntries.tenantId, tenantId), eq(glEntries.voucherType, BREAKAGE_VOUCHER), eq(glEntries.voucherId, giftCardId)))
  const net = new Map<string, number>()
  for (const r of rows) {
    net.set(r.accountId, roundCurrency((net.get(r.accountId) || 0) + Number(r.debit) - Number(r.credit)))
  }
  for (const [k, v] of net) if (Math.abs(v) < 0.005) net.delete(k)
  return net
}

/** Reverse whatever breakage is still recognised for the card (no-op when none). */
export async function reverseOutstandingBreakage(
  tx: DbOrTx,
  tenantId: string,
  giftCardId: string,
  cardNumber: string,
): Promise<boolean> {
  const net = await netBreakageByAccount(tx, tenantId, giftCardId)
  if (net.size === 0) return false
  const [settings] = await tx.select({ fy: accountingSettings.currentFiscalYearId })
    .from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  const entries: GLEntryInput[] = []
  for (const [accountId, amount] of net) {
    entries.push(amount > 0
      ? { accountId, credit: amount, remarks: `Gift card reactivated - breakage reversed (${cardNumber})` }
      : { accountId, debit: -amount, remarks: `Gift card reactivated - breakage reversed (${cardNumber})` })
  }
  await createGLEntries(tx, {
    tenantId,
    postingDate: await tenantTodayDate(tenantId),
    voucherType: BREAKAGE_VOUCHER,
    voucherId: giftCardId,
    voucherNumber: cardNumber,
    fiscalYearId: settings?.fy || null,
    entries,
  })
  return true
}
