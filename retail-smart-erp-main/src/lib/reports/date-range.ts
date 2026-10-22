/**
 * Business-day boundaries for reports.
 *
 * `created_at` columns are `timestamp without time zone` holding UTC wall-clock time (drizzle
 * writes Date#toISOString(), the DB defaults to now() in UTC). A shop's "21 October" is the
 * local day in the tenant's timezone (Asia/Colombo, UTC+05:30), i.e. 20 Oct 18:30 → 21 Oct
 * 18:30 UTC. Filtering with `new Date('2026-10-21')` (UTC midnight) and
 * `new Date('2026-10-21T23:59:59')` (server-local time) put every sale made between midnight
 * and 05:30 on the previous day and made the range depend on the server's TZ.
 */
import { sql, type SQL, type AnyColumn } from 'drizzle-orm'
import { getTenantTimezone, isValidTimezone } from '@/lib/notifications/alert-settings'

function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** UTC instant at which local day `date` (YYYY-MM-DD) starts in `tz`. */
export function localDayStart(date: string, tz: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Two passes handle DST transitions; Asia/Colombo has a fixed +05:30
  let instant = guess - offsetMinutes(tz, new Date(guess)) * 60000
  instant = guess - offsetMinutes(tz, new Date(instant)) * 60000
  return new Date(instant)
}

/** Last millisecond of local day `date` in `tz` (inclusive upper bound). */
export function localDayEnd(date: string, tz: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return new Date(localDayStart(next, tz).getTime() - 1)
}

export interface ReportRange {
  tz: string
  from: Date
  to: Date
}

/** Inclusive [fromDate, toDate] business-day range for a tenant. */
export async function tenantDayRange(tenantId: string, fromDate: string, toDate: string): Promise<ReportRange> {
  const raw = await getTenantTimezone(tenantId)
  const tz = isValidTimezone(raw) ? raw : 'Asia/Colombo'
  return { tz, from: localDayStart(fromDate, tz), to: localDayEnd(toDate, tz) }
}

/** SQL expression: a UTC wall-clock timestamp column as local wall-clock time in `tz`. */
export function localTs(col: AnyColumn | SQL, tz: string): SQL {
  // Inlined (validated IANA name, quotes escaped) rather than bound: the same expression is
  // used in SELECT and GROUP BY, and two different $n parameters would not match.
  const zone = isValidTimezone(tz) ? tz : 'Asia/Colombo'
  return sql`((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${sql.raw(`'${zone.replace(/'/g, "''")}'`)}`
}
