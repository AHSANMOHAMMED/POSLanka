/**
 * Punch files exported from fingerprint machines over USB or from their PC software:
 *  - attlog.dat / *.txt: the device's own tab-separated log ("PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify…")
 *  - CSV / Excel with a header row: a user id column (User ID, AC-No, Enroll No, PIN, Emp No,
 *    Employee Code …), a date-time column (or separate Date + Time columns) and optionally a
 *    state column (C/In, C/Out, Check In, Check Out, I, O, 0, 1 …).
 */
import { parseAttLog, punchTypeFromStatus } from './iclock'
import { parseLocalDateTime } from './time'

export interface ImportedPunch {
  userId: string
  date: string
  time: string
  punchType: 'in' | 'out' | 'unknown'
  row: number
}

export interface ParsedPunchFile {
  punches: ImportedPunch[]
  errors: Array<{ row: number; message: string }>
  columns?: { userId: string; dateTime?: string; date?: string; time?: string; state?: string }
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

const USER_COLS = ['userid', 'acno', 'enrollno', 'enrollnumber', 'enrollmentno', 'pin', 'empno', 'employeeno', 'employeeid', 'empid', 'badgenumber', 'badgeno', 'employeecode', 'empcode', 'code', 'no', 'id', 'user', 'personid', 'staffid']
const DATETIME_COLS = ['datetime', 'checktime', 'punchtime', 'timestamp', 'attendancetime', 'logtime', 'recordtime', 'clocktime', 'verifytime', 'time']
const DATE_COLS = ['date', 'attendancedate', 'logdate', 'punchdate']
const TIME_COLS = ['time', 'logtime', 'punchtime', 'clock']
const STATE_COLS = ['state', 'status', 'type', 'punchtype', 'checktype', 'inout', 'attstate', 'direction', 'event']

function pick(headers: string[], candidates: string[], exclude: string[] = []): string | undefined {
  const byNorm = new Map(headers.filter((h) => !exclude.includes(h)).map((h) => [norm(h), h]))
  for (const c of candidates) if (byNorm.has(c)) return byNorm.get(c)
  return undefined
}

export function stateToPunchType(v: string): 'in' | 'out' | 'unknown' {
  const s = v.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return 'unknown'
  if (/^\d+$/.test(s)) return punchTypeFromStatus(s)
  if (['i', 'in', 'c/in', 'checkin', 'clockin', 'breakin', 'otin', 'overtimein', 'entry', 'enter'].includes(s)) return 'in'
  if (['o', 'out', 'c/out', 'checkout', 'clockout', 'breakout', 'otout', 'overtimeout', 'exit'].includes(s)) return 'out'
  return 'unknown'
}

/** Raw attlog text (no header): parse as the device log. */
export function parseAttLogText(text: string): ParsedPunchFile {
  const recs = parseAttLog(text, 200000)
  return {
    punches: recs.map((r, i) => ({ userId: r.pin, date: r.local.date, time: r.local.time, punchType: punchTypeFromStatus(r.status), row: i + 1 })),
    errors: [],
  }
}

/** Rows of a spreadsheet / CSV with a header row (cells as strings or Excel serial numbers). */
export function parsePunchRows(rows: Array<Record<string, unknown>>): ParsedPunchFile {
  const errors: ParsedPunchFile['errors'] = []
  if (rows.length === 0) return { punches: [], errors: [{ row: 0, message: 'The file has no rows' }] }
  const headers = Object.keys(rows[0])
  const userId = pick(headers, USER_COLS)
  const dateTimeCol = pick(headers, DATETIME_COLS.filter((c) => c !== 'time'), userId ? [userId] : [])
  const dateCol = dateTimeCol ? undefined : pick(headers, DATE_COLS, userId ? [userId] : [])
  const timeCol = dateTimeCol ? undefined : pick(headers, TIME_COLS, [userId, dateCol].filter(Boolean) as string[])
  const singleCol = !dateTimeCol && !timeCol ? pick(headers, ['time', 'date'], userId ? [userId] : []) : undefined
  const stateCol = pick(headers, STATE_COLS, [userId, dateTimeCol, dateCol, timeCol].filter(Boolean) as string[])
  if (!userId) return { punches: [], errors: [{ row: 1, message: `No user id column found (expected one of: User ID, AC-No, Enroll No, PIN, Employee Code). Columns: ${headers.join(', ')}` }] }
  if (!dateTimeCol && !(dateCol && timeCol) && !singleCol) {
    return { punches: [], errors: [{ row: 1, message: `No date-time column found (expected "Date Time", or "Date" and "Time"). Columns: ${headers.join(', ')}` }] }
  }

  const punches: ImportedPunch[] = []
  rows.forEach((r, i) => {
    const rowNo = i + 2
    const uid = String(r[userId] ?? '').trim()
    if (!uid) return
    let text: string
    if (dateTimeCol || singleCol) text = cellText(r[(dateTimeCol || singleCol)!])
    else {
      const dv = cellText(r[dateCol!])
      const tv = cellText(r[timeCol!])
      text = joinDateTime(dv, tv)
    }
    const local = parseLocalDateTime(text)
    if (!local) { if (errors.length < 50) errors.push({ row: rowNo, message: `Unreadable date/time "${text}"` }); return }
    punches.push({ userId: uid.slice(0, 50), date: local.date, time: local.time, punchType: stateCol ? stateToPunchType(String(r[stateCol] ?? '')) : 'unknown', row: rowNo })
  })
  return { punches, errors, columns: { userId, dateTime: dateTimeCol || singleCol, date: dateCol, time: timeCol, state: stateCol } }
}

function cellText(v: unknown): string {
  if (v instanceof Date) {
    // SheetJS / ExcelJS dates carry the wall-clock time in UTC fields
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 19).replace('T', ' ')
  }
  return String(v ?? '').trim()
}

/** Date cell + time cell (either may be an Excel serial: date = whole, time = fraction). */
function joinDateTime(d: string, t: string): string {
  const dNum = /^\d+(\.\d+)?$/.test(d) ? Number(d) : null
  const tNum = /^\d*\.\d+$|^0$/.test(t) ? Number(t) : null
  if (dNum !== null && dNum > 20000) {
    const frac = tNum !== null ? tNum : 0
    if (tNum !== null || !t) return String(Math.floor(dNum) + frac)
    const day = parseLocalDateTime(String(Math.floor(dNum)))
    return day ? `${day.date} ${t}` : `${d} ${t}`
  }
  if (tNum !== null) {
    const mins = Math.round(tNum * 1440)
    return `${d} ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  }
  return `${d} ${t}`
}

/** Parse an uploaded file (by name / content) into punches. */
export async function parsePunchFile(name: string, buffer: ArrayBuffer): Promise<ParsedPunchFile> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buffer, { type: 'array', sheetRows: 200005 })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return { punches: [], errors: [{ row: 0, message: 'The workbook has no sheets' }] }
    const rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' }) as Array<Record<string, unknown>>
    return parsePunchRows(rows)
  }
  const text = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  // attlog.dat: first cell is a user id and second a date-time, tab separated, no header
  if (/^\s*\S+\t\s*\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(firstLine)) return parseAttLogText(text)
  const Papa = (await import('papaparse')).default
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() })
  return parsePunchRows(res.data.slice(0, 200000))
}
