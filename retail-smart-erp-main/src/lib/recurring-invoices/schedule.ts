/**
 * Recurring invoice schedule math (drizzle/0185). Pure and client-safe: the form previews the
 * upcoming dates with the same functions the generator uses.
 *
 * Dates are local calendar dates 'YYYY-MM-DD' (Asia/Colombo — the caller supplies "today").
 * Occurrence k (0-based) is computed from the START date, never from the previous run, so a
 * month-end anchor does not drift: 31 Jan → 28/29 Feb → 31 Mar → 30 Apr …
 */

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly'
export type RecurringEndType = 'never' | 'after' | 'on_date'

export interface RecurringSchedule {
  frequency: RecurringFrequency
  /** every N weeks / months / years (1 = every period) */
  intervalCount: number
  startDate: string
  endType: RecurringEndType
  endAfterCount?: number | null
  endDate?: string | null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid date ${date}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** date + n months, the day clamped to the target month's length (anchor = the date's own day) */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parts(date)
  const idx = (y * 12 + (m - 1)) + months
  const ty = Math.floor(idx / 12)
  const tm = (idx % 12) + 1
  return fmt(ty, tm, Math.min(anchorDay ?? d, daysInMonth(ty, tm)))
}

/** Date of occurrence k (0 = the start date) */
export function occurrenceDate(s: Pick<RecurringSchedule, 'frequency' | 'intervalCount' | 'startDate'>, k: number): string {
  const n = Math.max(1, Math.floor(s.intervalCount || 1))
  if (s.frequency === 'weekly') return addDays(s.startDate, 7 * n * k)
  const [, , day] = parts(s.startDate)
  if (s.frequency === 'yearly') return addMonths(s.startDate, 12 * n * k, day)
  return addMonths(s.startDate, n * k, day)
}

/** Has the schedule ended before occurrence k? */
export function isFinished(s: RecurringSchedule, k: number): boolean {
  if (s.endType === 'after') return k >= Math.max(0, s.endAfterCount ?? 0)
  if (s.endType === 'on_date' && s.endDate) return occurrenceDate(s, k) > s.endDate
  return false
}

/** Next run date for occurrence k, or null when the schedule has ended. */
export function nextRunDate(s: RecurringSchedule, k: number): string | null {
  return isFinished(s, k) ? null : occurrenceDate(s, k)
}

/** Up to `count` upcoming dates from occurrence k (form preview). */
export function upcomingDates(s: RecurringSchedule, k: number, count: number): string[] {
  const out: string[] = []
  for (let i = k; out.length < count && i < k + count; i++) {
    const d = nextRunDate(s, i)
    if (!d) break
    out.push(d)
  }
  return out
}

/** Occurrences whose date is on or before `today`, from k (at most `limit`), for catch-up runs. */
export function dueOccurrences(s: RecurringSchedule, k: number, today: string, limit: number): Array<{ occurrence: number; date: string }> {
  const out: Array<{ occurrence: number; date: string }> = []
  for (let i = k; out.length < limit; i++) {
    const d = nextRunDate(s, i)
    if (!d || d > today) break
    out.push({ occurrence: i, date: d })
  }
  return out
}

export function frequencyLabel(frequency: RecurringFrequency, intervalCount: number): string {
  const n = Math.max(1, intervalCount || 1)
  if (frequency === 'weekly') return n === 1 ? 'Weekly' : `Every ${n} weeks`
  if (frequency === 'yearly') return n === 1 ? 'Yearly' : `Every ${n} years`
  return n === 1 ? 'Monthly' : `Every ${n} months`
}

/**
 * Index of the first occurrence on or after `date` (strictly after when `strict`). Used when a
 * schedule is edited after invoices were raised (never re-run a date already invoiced) and when
 * a paused profile resumes (missed periods are skipped, not invoiced in a burst).
 */
export function firstOccurrenceFrom(s: Pick<RecurringSchedule, 'frequency' | 'intervalCount' | 'startDate'>, date: string, strict = false): number {
  if (date < s.startDate || (!strict && date === s.startDate)) return 0
  // rough jump, then step (dates grow monotonically with k)
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${s.startDate}T00:00:00Z`)) / 86_400_000
  const n = Math.max(1, Math.floor(s.intervalCount || 1))
  const periodDays = s.frequency === 'weekly' ? 7 * n : s.frequency === 'yearly' ? 365 * n : 28 * n
  let k = Math.max(0, Math.floor(days / periodDays) - 2)
  while (k > 0 && occurrenceDate(s, k) >= date) k--
  const passes = (d: string) => (strict ? d > date : d >= date)
  while (!passes(occurrenceDate(s, k))) k++
  return k
}
