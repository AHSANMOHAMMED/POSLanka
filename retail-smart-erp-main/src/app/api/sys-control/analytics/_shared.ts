import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { sales } from '@/lib/db/schema'

export const analyticsRangeSchema = z.enum(['today', '7d', '30d'])
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>

/** Start-of-range timestamp for the given range key. */
export function rangeSince(range: AnalyticsRange, now: Date = new Date()): Date {
  const start = new Date(now)
  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
    return start
  }
  const days = range === '7d' ? 7 : 30
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return start
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(n) ? n : 0
}

export function toInt(value: unknown): number {
  return Math.trunc(toNumber(value))
}

/**
 * Shared SQL aggregate fragments for the `sales` table.
 * - void rows must be excluded by the caller's WHERE clause
 * - rows with is_return = true are treated as returns (subtracted from net)
 */
export const salesAgg = {
  netSales: (): SQL<string> =>
    sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} THEN -ABS(${sales.total}) ELSE ${sales.total} END), 0)`,
  grossSales: (): SQL<string> =>
    sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} THEN 0 ELSE ${sales.total} END), 0)`,
  returns: (): SQL<string> =>
    sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} THEN ABS(${sales.total}) ELSE 0 END), 0)`,
  receipts: (): SQL<number> =>
    sql<number>`COUNT(*) FILTER (WHERE NOT ${sales.isReturn})::int`,
}
