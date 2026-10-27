/**
 * Time-zone helpers for attendance (no dependencies; Intl only).
 *
 * Attendance works in the business's local wall-clock time (tenant / device timezone, Asia/Colombo
 * by default) while punches are stored as instants (timestamptz). Dates are 'YYYY-MM-DD' strings.
 */

export const DEFAULT_TIMEZONE = 'Asia/Colombo'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** A valid IANA zone, else the default. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE
  try {
    formatter(tz)
    return tz
  } catch {
    return DEFAULT_TIMEZONE
  }
}

function zonedParts(instant: Date, tz: string) {
  const parts = formatter(safeTimezone(tz)).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

/** Minutes the zone is ahead of UTC at that instant (Asia/Colombo = 330). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000)
}

/** The instant of a local wall-clock date + time ('HH:MM' or 'HH:MM:SS') in the zone. */
export function localToUtc(date: string, timeOfDay: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm, ss] = timeOfDay.split(':').map((v) => Number(v) || 0)
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss || 0)
  const off1 = tzOffsetMinutes(new Date(guess), tz)
  let t = guess - off1 * 60000
  const off2 = tzOffsetMinutes(new Date(t), tz)
  if (off2 !== off1) t = guess - off2 * 60000
  return new Date(t)
}

/** Local date ('YYYY-MM-DD') and minutes after local midnight of an instant. */
export function utcToLocal(instant: Date, tz: string): { date: string; minutes: number; time: string } {
  const p = zonedParts(instant, tz)
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`
  return { date, minutes: p.hour * 60 + p.minute, time: `${pad(p.hour)}:${pad(p.minute)}` }
}

/** Today's local date in the zone. */
export function todayLocal(tz: string, now: Date = new Date()): string {
  return utcToLocal(now, tz).date
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/** 0 = Sunday .. 6 = Saturday */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

/** 'HH:MM[:SS]' → minutes after midnight */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((v) => Number(v) || 0)
  return h * 60 + m
}

/**
 * Parse a local date-time as written by devices, USB exports and spreadsheets:
 * 'YYYY-MM-DD HH:MM[:SS]', 'YYYY/MM/DD HH:MM', ISO 'YYYY-MM-DDTHH:MM', 'DD/MM/YYYY HH:MM[:SS]'
 * (day first, as in Sri Lanka), optionally with AM/PM, or an Excel serial number.
 * Returns the local date and time, or null.
 */
export function parseLocalDateTime(input: string): { date: string; time: string } | null {
  const s = String(input || '').trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (serial > 20000 && serial < 80000) {
      // Excel serial (1900 date system): days since 1899-12-30, fraction = time of day
      const ms = Math.round((serial - 25569) * 86400000)
      const d = new Date(ms)
      return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) }
    }
    return null
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?/i)
  let y: number, mo: number, d: number
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3])
  } else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i)
    if (!m) return null
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3])
    if (mo > 12 && d <= 12) [d, mo] = [mo, d] // clearly month-first
  }
  let hh = Number(m[4])
  const mm = Number(m[5])
  const ss = Number(m[6] || 0)
  const ampm = m[7]?.toUpperCase()
  if (ampm === 'PM' && hh < 12) hh += 12
  if (ampm === 'AM' && hh === 12) hh = 0
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null
  const date = `${y}-${pad(mo)}-${pad(d)}`
  if (!isDateString(date)) return null
  return { date, time: `${pad(hh)}:${pad(mm)}:${pad(ss)}` }
}
