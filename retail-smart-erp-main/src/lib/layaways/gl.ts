/**
 * Layaway GL helpers that are specific to the layaway routes.
 *
 * Layaway deposits are posted Dr Cash / Cr Customer Advance (party = customer). The same
 * Customer Advance account backs customer store credit, so moving a deposit into store credit
 * (cancel / forfeit-with-refund-to-credit) needs no GL entry; only money that actually leaves
 * the drawer does.
 */
import { eq } from 'drizzle-orm'
import { accountingSettings } from '@/lib/db/schema'
import { createGLEntries } from '@/lib/accounting/gl'
import { getTenantTimezone, localParts } from '@/lib/notifications/alert-settings'
import { roundCurrency } from '@/lib/utils/currency'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

/** Cash refund of (part of) a layaway deposit: Dr Customer Advance, Cr Cash. */
export async function postLayawayCashRefundToGL(
  tx: DbOrTx,
  tenantId: string,
  data: { layawayId: string; layawayNo: string; amount: number; customerId: string },
): Promise<string[] | null> {
  const amount = roundCurrency(data.amount)
  if (amount <= 0) return null
  const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.tenantId, tenantId)).limit(1)
  if (!settings || !settings.autoPostSales) return null
  if (!settings.defaultAdvanceReceivedAccountId || !settings.defaultCashAccountId) return null
  const postingDate = localParts(new Date(), await getTenantTimezone(tenantId)).date
  return createGLEntries(tx, {
    tenantId,
    postingDate,
    voucherType: 'layaway_refund',
    voucherId: data.layawayId,
    voucherNumber: data.layawayNo,
    fiscalYearId: settings.currentFiscalYearId,
    entries: [
      {
        accountId: settings.defaultAdvanceReceivedAccountId,
        debit: amount,
        partyType: 'customer',
        partyId: data.customerId,
        remarks: `Layaway deposit refunded in cash (${data.layawayNo})`,
      },
      {
        accountId: settings.defaultCashAccountId,
        credit: amount,
        remarks: `Layaway refund paid out (${data.layawayNo})`,
      },
    ],
  })
}
