/**
 * 0187 — money taken outside the POS sale screen that still goes into (or out of) the cashier's
 * drawer: print-job advances (and their refunds on cancel), the balance collected when a print
 * job or work order is invoiced, and layaway deposits / instalments.
 *
 * Each such payment row carries the open shift (pos_opening_entries) of the user who took it, or
 * NULL when that user had no open shift (recorded without a shift, never an error). The shift
 * routes add these totals to the expected amount per tender and to the Z report, by source.
 */
import { and, eq, sql } from 'drizzle-orm'
import { posOpeningEntries } from '@/lib/db/schema'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type OutsideCollectionSource =
  | 'print_job_advance'
  | 'print_job_refund'
  | 'print_job_invoice'
  | 'work_order_invoice'
  | 'layaway_payment'
  | 'invoice_payment'

export const OUTSIDE_COLLECTION_SOURCE_LABELS: Record<OutsideCollectionSource, string> = {
  print_job_advance: 'Print job advance',
  print_job_refund: 'Print job advance refund',
  print_job_invoice: 'Print job invoice',
  work_order_invoice: 'Work order invoice',
  layaway_payment: 'Layaway payment',
  invoice_payment: 'Invoice payment',
}

/** The user's open shift (one open shift per user, see 0157), or null. */
export async function currentOpenShiftId(db: Db, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ id: posOpeningEntries.id })
    .from(posOpeningEntries)
    .where(and(eq(posOpeningEntries.userId, userId), eq(posOpeningEntries.status, 'open')))
    .limit(1)
  return row?.id || null
}

export interface OutsideCollectionItem {
  source: OutsideCollectionSource
  reference: string | null
  method: string
  /** signed: refunds are negative */
  amount: number
  createdAt: string | null
}

export interface ShiftOutsideCollections {
  /** signed total of every tender */
  total: number
  /** signed total per payment method (what each adds to the expected amount) */
  byMethod: Record<string, number>
  /** signed total per source */
  bySource: Record<string, number>
  count: number
  items: OutsideCollectionItem[]
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] })?.rows) || (Array.isArray(res) ? res as T[] : [])
}

/** Collections of a shift outside its own POS sales (POS sales are counted from sales.pos_opening_entry_id). */
export async function shiftOutsideCollections(db: Db, openingEntryId: string): Promise<ShiftOutsideCollections> {
  const rows = rowsOf<{ source: OutsideCollectionSource; reference: string | null; method: string; amount: string; created_at: Date | string | null }>(await db.execute(sql`
    SELECT 'print_job_advance' AS source, j.job_no AS reference, p.payment_method::text AS method, p.amount AS amount, p.created_at
      FROM print_job_payments p JOIN print_jobs j ON j.id = p.print_job_id
     WHERE p.pos_opening_entry_id = ${openingEntryId}
    UNION ALL
    SELECT 'print_job_refund', j.job_no, p.payment_method::text, -p.amount, p.refunded_at
      FROM print_job_payments p JOIN print_jobs j ON j.id = p.print_job_id
     WHERE p.refund_pos_opening_entry_id = ${openingEntryId} AND p.refunded_at IS NOT NULL
    UNION ALL
    SELECT 'layaway_payment', l.layaway_no, lp.payment_method::text, lp.amount, lp.created_at
      FROM layaway_payments lp JOIN layaways l ON l.id = lp.layaway_id
     WHERE lp.pos_opening_entry_id = ${openingEntryId}
    UNION ALL
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM print_jobs pj WHERE pj.sale_id = s.id) THEN 'print_job_invoice'
             WHEN EXISTS (SELECT 1 FROM work_orders wo WHERE wo.sale_id = s.id) THEN 'work_order_invoice'
             ELSE 'invoice_payment'
           END,
           s.invoice_no, py.method::text, py.amount, py.created_at
      FROM payments py JOIN sales s ON s.id = py.sale_id
     WHERE py.pos_opening_entry_id = ${openingEntryId}
       AND py.voided_at IS NULL
       AND s.status <> 'void'
       -- a POS sale of this shift is already counted through its own payments
       AND s.pos_opening_entry_id IS DISTINCT FROM ${openingEntryId}
     ORDER BY 5
  `))

  const byMethod: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  let total = 0
  const items: OutsideCollectionItem[] = rows.map((r) => {
    const amount = roundCurrency(parseCurrency(r.amount))
    byMethod[r.method] = roundCurrency((byMethod[r.method] || 0) + amount)
    bySource[r.source] = roundCurrency((bySource[r.source] || 0) + amount)
    total += amount
    return {
      source: r.source,
      reference: r.reference,
      method: r.method,
      amount,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }
  })
  return { total: roundCurrency(total), byMethod, bySource, count: items.length, items }
}
