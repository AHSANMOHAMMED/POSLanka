/**
 * Table double-booking check for reservations.
 *
 * Two live reservations (pending / confirmed / seated) on the same table overlap when their
 * [date + time, date + time + duration) windows intersect. The comparison is done on
 * timestamps (reservation_date + reservation_time) so a late booking that runs past midnight
 * still blocks an early booking on the next day.
 */
import { sql } from 'drizzle-orm'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

export interface ReservationSlot {
  tableId: string
  reservationDate: string // YYYY-MM-DD
  reservationTime: string // HH:MM[:SS]
  estimatedDuration: number // minutes
  excludeId?: string
}

/** Returns the first conflicting live reservation on the table, or null. */
export async function findTableReservationConflict(
  tx: DbOrTx,
  slot: ReservationSlot,
): Promise<{ id: string; reservationTime: string; customerName: string | null } | null> {
  const res = await tx.execute(sql`
    SELECT id, reservation_time::text AS "reservationTime", customer_name AS "customerName"
    FROM reservations
    WHERE table_id = ${slot.tableId}
      AND status IN ('pending', 'confirmed', 'seated')
      AND (${slot.excludeId ?? null}::uuid IS NULL OR id <> ${slot.excludeId ?? null}::uuid)
      AND (reservation_date + reservation_time) <
          (${slot.reservationDate}::date + ${slot.reservationTime}::time) + make_interval(mins => ${slot.estimatedDuration}::int)
      AND (reservation_date + reservation_time) + make_interval(mins => COALESCE(estimated_duration, 60)) >
          (${slot.reservationDate}::date + ${slot.reservationTime}::time)
    ORDER BY reservation_date, reservation_time
    LIMIT 1
    FOR UPDATE
  `)
  const rows = (res as { rows?: Array<{ id: string; reservationTime: string; customerName: string | null }> }).rows || []
  return rows[0] || null
}
