/**
 * Warranty captured at sale time (drizzle/0179).
 *
 * A sale line of an item with `items.warranty_months > 0` stores the months and the end date
 * (sale date + months) on `sale_items.warranty_months / warranty_until`, and its sold serial
 * numbers get `warranty_start_date / warranty_end_date` (only when not already set, e.g. by a
 * manufacturer warranty entered at intake). Printed on receipts and A4 invoices.
 */
import { and, inArray, isNull, or, sql } from 'drizzle-orm'
import { itemSerialNumbers } from '@/lib/db/schema'
import type { PgDatabase } from 'drizzle-orm/pg-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TenantDb = PgDatabase<any, any, any>

/** YYYY-MM-DD of `at` in the shop's timezone (Sri Lanka by default). */
export function localDateString(at: Date = new Date(), timeZone = 'Asia/Colombo'): string {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** Add calendar months to a YYYY-MM-DD date (clamped to the month's last day: 31 Jan + 1 = 28/29 Feb). */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const total = (m - 1) + Math.trunc(months)
  const ty = y + Math.floor(total / 12)
  const tm = ((total % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const td = Math.min(d, lastDay)
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`
}

/** sale_items warranty fields for an item, or nulls when it has no warranty. */
export function saleLineWarranty(
  item: { warrantyMonths?: number | null } | null | undefined,
  saleDate: string,
): { warrantyMonths: number | null; warrantyUntil: string | null } {
  const months = Number(item?.warrantyMonths) || 0
  if (months <= 0) return { warrantyMonths: null, warrantyUntil: null }
  return { warrantyMonths: months, warrantyUntil: addMonthsToDate(saleDate, months) }
}

/**
 * Stamp the warranty period on sold serial numbers that have none yet. No-op when the line has
 * no warranty or no serials. Runs inside the sale transaction (RLS scopes it to the tenant).
 */
export async function applySerialWarranty(
  tx: TenantDb,
  serialNumberIds: string[] | null | undefined,
  saleDate: string,
  warrantyUntil: string | null,
) {
  if (!serialNumberIds?.length || !warrantyUntil) return
  await tx.update(itemSerialNumbers)
    .set({
      warrantyStartDate: sql`COALESCE(${itemSerialNumbers.warrantyStartDate}, ${saleDate}::date)`,
      warrantyEndDate: sql`COALESCE(${itemSerialNumbers.warrantyEndDate}, ${warrantyUntil}::date)`,
      updatedAt: new Date(),
    })
    .where(and(
      inArray(itemSerialNumbers.id, serialNumberIds),
      or(isNull(itemSerialNumbers.warrantyStartDate), isNull(itemSerialNumbers.warrantyEndDate)),
    ))
}
