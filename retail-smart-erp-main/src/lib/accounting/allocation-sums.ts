import { and, eq, inArray, sql } from 'drizzle-orm'
import { paymentEntryReferences } from '@/lib/db/schema'

/**
 * Batched replacements for the per-row "SUM(allocated_amount) FROM payment_entry_references"
 * lookups the AR/AP/outstanding/reconciliation reports used to run once per document (N+1).
 * One grouped query per chunk of ids; callers read the result with `map.get(id) ?? 0`, which
 * matches the old `COALESCE(SUM(...), 0)` per row. Pass the same tenant-scoped db/tx handle the
 * caller already uses (RLS applies exactly as before).
 */

const CHUNK = 1000

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

/** Sum of allocated_amount per reference_id for one reference_type ('sale' | 'purchase' | 'journal_entry'). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sumAllocatedByReference(db: any, referenceType: string, referenceIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const ids = [...new Set(referenceIds.filter(Boolean))]
  for (const part of chunks(ids)) {
    const rows: { id: string; total: string | null }[] = await db.select({
      id: paymentEntryReferences.referenceId,
      total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
    })
      .from(paymentEntryReferences)
      .where(and(
        eq(paymentEntryReferences.referenceType, referenceType),
        inArray(paymentEntryReferences.referenceId, part),
      ))
      .groupBy(paymentEntryReferences.referenceId)
    for (const r of rows) result.set(r.id, Number(r.total || 0))
  }
  return result
}

/** Sum of allocated_amount per source_je_item_id (JE lines used as the payment side). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sumAllocatedBySourceJeItem(db: any, jeItemIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const ids = [...new Set(jeItemIds.filter(Boolean))]
  for (const part of chunks(ids)) {
    const rows: { id: string | null; total: string | null }[] = await db.select({
      id: paymentEntryReferences.sourceJeItemId,
      total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
    })
      .from(paymentEntryReferences)
      .where(inArray(paymentEntryReferences.sourceJeItemId, part))
      .groupBy(paymentEntryReferences.sourceJeItemId)
    for (const r of rows) if (r.id) result.set(r.id, Number(r.total || 0))
  }
  return result
}

/** Fetch id -> name for the ids not already in `into` (chunked IN list). Mutates and returns `into`. */
export async function loadNamesInto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  ids: (string | null | undefined)[],
  into: Record<string, string>,
): Promise<Record<string, string>> {
  const missing = [...new Set(ids.filter((id): id is string => !!id && !into[id]))]
  for (const part of chunks(missing)) {
    const rows: { id: string; name: string }[] = await db.select({ id: table.id, name: table.name })
      .from(table)
      .where(inArray(table.id, part))
    for (const r of rows) into[r.id] = r.name
  }
  return into
}
