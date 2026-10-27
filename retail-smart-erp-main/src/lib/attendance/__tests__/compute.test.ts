// The DB runner is not exercised here: schema / drizzle are mocked so only the pure functions load
jest.mock('@/lib/db/schema', () => ({}))
jest.mock('drizzle-orm', () => ({ and: jest.fn(), eq: jest.fn(), gte: jest.fn(), inArray: jest.fn(), lte: jest.fn(), or: jest.fn(), isNull: jest.fn(), sql: jest.fn() }))

import {
  FALLBACK_SHIFT, computeDay, dedupePunches, payFraction, punchWindow, resolveShift, type ShiftRule,
} from '../compute'
import { summarizeAttendance, attendanceFormulaVariables, type AttendanceDayRow } from '../payroll'
import { localToUtc, parseLocalDateTime, utcToLocal, monthRange, weekdayOf } from '../time'
import { parseAttLog, punchTypeFromStatus, handshakeText, parseOperLogUsers, cleanSerial } from '../iclock'
import { parsePunchRows, stateToPunchType } from '../import-file'
import { countLeaveDays } from '../leave'
import { evaluateFormula } from '@/lib/payroll/formula-engine'

const TZ = 'Asia/Colombo'
const at = (date: string, time: string) => localToUtc(date, time, TZ)

const office: ShiftRule = {
  id: 'office', name: 'Office', startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakMinutes: 60,
  graceLateMinutes: 10, graceEarlyMinutes: 10, halfDayHours: 4, fullDayHours: 8, otStartsAfterMinutes: 30, weeklyOffDays: [0],
}
const night: ShiftRule = { ...office, id: 'night', name: 'Night', startTime: '20:00', endTime: '05:00', crossesMidnight: true }

describe('time helpers', () => {
  test('Colombo local time to UTC (+05:30)', () => {
    expect(localToUtc('2026-10-27', '08:00', TZ).toISOString()).toBe('2026-10-27T02:30:00.000Z')
    expect(utcToLocal(new Date('2026-10-27T02:30:00Z'), TZ)).toEqual({ date: '2026-10-27', minutes: 480, time: '08:00' })
  })
  test('parses device, ISO, day-first and Excel date-times', () => {
    expect(parseLocalDateTime('2026-10-27 08:05:09')).toEqual({ date: '2026-10-27', time: '08:05:09' })
    expect(parseLocalDateTime('2026/10/27 8:05')).toEqual({ date: '2026-10-27', time: '08:05:00' })
    expect(parseLocalDateTime('27/10/2026 05:30 PM')).toEqual({ date: '2026-10-27', time: '17:30:00' })
    expect(parseLocalDateTime('46322.5')).toEqual({ date: '2026-10-27', time: '12:00:00' })
    expect(parseLocalDateTime('not a date')).toBeNull()
  })
  test('month range and weekday', () => {
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(weekdayOf('2026-11-01')).toBe(0) // Sunday
  })
})

describe('resolveShift', () => {
  const shifts = new Map([['office', office], ['night', night]])
  test('assignment > employee default > tenant default > built-in', () => {
    const assignments = [{ shiftId: 'night', fromDate: '2026-10-10', toDate: '2026-10-20' }]
    expect(resolveShift('2026-10-15', { assignments, defaultShiftId: 'office', tenantDefaultShiftId: null, shifts }).id).toBe('night')
    expect(resolveShift('2026-10-21', { assignments, defaultShiftId: 'office', tenantDefaultShiftId: null, shifts }).id).toBe('office')
    expect(resolveShift('2026-10-21', { assignments: [], defaultShiftId: null, tenantDefaultShiftId: 'night', shifts }).id).toBe('night')
    expect(resolveShift('2026-10-21', { assignments: [], defaultShiftId: 'gone', tenantDefaultShiftId: null, shifts })).toBe(FALLBACK_SHIFT)
  })
})

describe('computeDay', () => {
  const base = { shift: office, timezone: TZ, otEligible: true }

  test('on-time day with overtime beyond the OT threshold', () => {
    const r = computeDay({ ...base, date: '2026-10-27', punches: [at('2026-10-27', '08:05'), at('2026-10-27', '17:45')] })
    expect(r.status).toBe('present')
    expect(r.lateMinutes).toBe(0) // within 10 min grace
    expect(r.workedMinutes).toBe(580 - 60) // span minus break
    expect(r.otMinutes).toBe(45)
    expect(r.dayType).toBe('working')
  })

  test('late arrival beyond grace counts from shift start; OT below threshold ignored; not eligible = no OT', () => {
    const r = computeDay({ ...base, date: '2026-10-27', punches: [at('2026-10-27', '08:25'), at('2026-10-27', '17:20')] })
    expect(r.lateMinutes).toBe(25)
    expect(r.otMinutes).toBe(0)
    const r2 = computeDay({ ...base, otEligible: false, date: '2026-10-27', punches: [at('2026-10-27', '08:00'), at('2026-10-27', '19:00')] })
    expect(r2.otMinutes).toBe(0)
  })

  test('early leave and half day (worked less than half-day hours, no break deducted)', () => {
    const r = computeDay({ ...base, date: '2026-10-27', punches: [at('2026-10-27', '08:00'), at('2026-10-27', '11:30')] })
    expect(r.status).toBe('half_day')
    expect(r.workedMinutes).toBe(210)
    expect(r.earlyLeaveMinutes).toBe(330)
  })

  test('duplicates within 2 minutes are ignored; break punches are summed as pairs', () => {
    expect(dedupePunches([at('2026-10-27', '08:00'), at('2026-10-27', '08:01'), at('2026-10-27', '08:03')]).length).toBe(2)
    const r = computeDay({ ...base, date: '2026-10-27', punches: [
      at('2026-10-27', '08:00'), at('2026-10-27', '08:00:30'), at('2026-10-27', '12:00'), at('2026-10-27', '12:30'), at('2026-10-27', '17:00'),
    ] })
    expect(r.punchCount).toBe(4)
    expect(r.workedMinutes).toBe(240 + 270)
  })

  test('single punch = missed check-out', () => {
    const r = computeDay({ ...base, date: '2026-10-27', punches: [at('2026-10-27', '08:02')], missedPunchAs: 'present' })
    expect(r.missedPunch).toBe(true)
    expect(r.status).toBe('present')
    expect(r.workedMinutes).toBe(0)
    expect(computeDay({ ...base, date: '2026-10-27', punches: [at('2026-10-27', '08:02')], missedPunchAs: 'half_day' }).status).toBe('half_day')
  })

  test('no punches: absent on a working day, leave when approved, holiday / weekly off otherwise', () => {
    expect(computeDay({ ...base, date: '2026-10-27', punches: [] }).status).toBe('absent')
    const lv = computeDay({ ...base, date: '2026-10-27', punches: [], leave: { leaveTypeId: 'al', isPaid: true, fraction: 1 } })
    expect(lv.status).toBe('leave')
    expect(payFraction(lv)).toBe(1)
    const unpaid = computeDay({ ...base, date: '2026-10-27', punches: [], leave: { leaveTypeId: 'np', isPaid: false, fraction: 1 } })
    expect(payFraction(unpaid)).toBe(0)
    expect(computeDay({ ...base, date: '2026-10-27', punches: [], holiday: { name: 'Poya', isPaid: true } }).status).toBe('holiday')
    expect(computeDay({ ...base, date: '2026-11-01', punches: [] }).status).toBe('weekly_off')
  })

  test('work on a weekly off / holiday is all overtime', () => {
    const r = computeDay({ ...base, date: '2026-11-01', punches: [at('2026-11-01', '09:00'), at('2026-11-01', '13:00')] })
    expect(r.dayType).toBe('weekly_off')
    expect(r.otMinutes).toBe(240)
    expect(r.lateMinutes).toBe(0)
  })

  test('half-day leave + half-day work = fully paid, no late flag', () => {
    const r = computeDay({ ...base, date: '2026-10-27', punches: [at('2026-10-27', '13:00'), at('2026-10-27', '16:50')], leave: { leaveTypeId: 'cl', isPaid: true, fraction: 0.5 } })
    expect(r.status).toBe('half_day')
    expect(r.lateMinutes).toBe(0)
    expect(payFraction(r)).toBe(1)
  })

  test('night shift crossing midnight', () => {
    const punches = [at('2026-10-27', '19:55'), at('2026-10-28', '05:40')]
    const w = punchWindow('2026-10-27', night, night, TZ)
    expect(punches.every((p) => p >= w.from && p < w.to)).toBe(true)
    // the next work date's window starts after the morning check-out
    const next = punchWindow('2026-10-28', night, night, TZ)
    expect(punches[1] < next.from).toBe(true)
    const r = computeDay({ ...base, shift: night, date: '2026-10-27', punches })
    expect(r.status).toBe('present')
    expect(r.workedMinutes).toBe(585 - 60)
    expect(r.otMinutes).toBe(40)
  })

  test('day-shift windows do not overlap', () => {
    const a = punchWindow('2026-10-27', office, office, TZ)
    const b = punchWindow('2026-10-28', office, office, TZ)
    expect(a.to.getTime()).toBe(b.from.getTime())
    expect(utcToLocal(a.from, TZ).time).toBe('04:00')
  })
})

describe('summarizeAttendance (payroll)', () => {
  // November 2026: 30 days, Sundays 1, 8, 15, 22, 29
  const row = (date: string, status: string, extra: Partial<AttendanceDayRow> = {}): AttendanceDayRow => ({
    attendanceDate: date, dayType: 'working', status, workedMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0, otMinutes: 0, leaveFraction: 0, leavePaid: false, ...extra,
  })
  const sundays = new Set(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'])
  const days: AttendanceDayRow[] = []
  for (let d = 1; d <= 30; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`
    if (sundays.has(date)) { days.push(row(date, 'weekly_off', { dayType: 'weekly_off', workedMinutes: 0 })); continue }
    if (date === '2026-11-24') { days.push(row(date, 'holiday', { dayType: 'holiday', workedMinutes: 0 })); continue }
    if (date === '2026-11-03' || date === '2026-11-04') { days.push(row(date, 'absent', { workedMinutes: 0 })); continue }
    if (date === '2026-11-05') { days.push(row(date, 'half_day', { workedMinutes: 200 })); continue }
    if (date === '2026-11-06') { days.push(row(date, 'leave', { leaveFraction: 1, leavePaid: true, workedMinutes: 0 })); continue }
    days.push(row(date, 'present', { lateMinutes: date === '2026-11-10' ? 20 : 0, otMinutes: date === '2026-11-11' ? 90 : 0 }))
  }
  days[7] = { ...days[7], otMinutes: 240 } // Sunday 8th: worked 4 h on the weekly off
  const input = {
    from: '2026-11-01', to: '2026-11-30', today: '2026-12-15', days,
    isWeeklyOff: (d: string) => sundays.has(d), isHoliday: (d: string) => (d === '2026-11-24' ? { isPaid: true } : null), isEmployed: () => true,
    settings: { workingDaysMode: 'calendar' as const, otMultiplier: 1.5, holidayOtMultiplier: 2, otHourlyDivisor: null },
    baseSalary: 60000, fullDayHours: 8, employeeOtMultiplier: 1.5,
  }

  test('calendar mode: weekly offs and paid holidays are paid days', () => {
    const s = summarizeAttendance(input)
    expect(s.totalWorkingDays).toBe(30)
    expect(s.paymentDays).toBe(27.5) // 30 − 2 absent − 0.5 half day
    expect(s.absentDays).toBe(2.5)
    expect(s.presentDays).toBe(20)
    expect(s.halfDays).toBe(1)
    expect(s.paidLeaveDays).toBe(1)
    expect(s.lateMinutes).toBe(20)
    expect(s.otHours).toBe(5.5)
    expect(s.holidayOtHours).toBe(4)
    // hourly = 60000 / (25 scheduled days × 8 h) = 300; OT = 300 × (1.5 h × 1.5 + 4 h × 2)
    expect(s.hourlyRate).toBe(300)
    expect(s.otAmount).toBe(3075)
    expect(s.dailyRate).toBe(2000)
  })

  test('shift mode: weekly offs are not working days', () => {
    const s = summarizeAttendance({ ...input, settings: { ...input.settings, workingDaysMode: 'shift' } })
    expect(s.totalWorkingDays).toBe(25)
    expect(s.paymentDays).toBe(22.5)
    expect(s.absentDays).toBe(2.5)
  })

  test('days not yet happened are paid; past days without a record are absent', () => {
    const s = summarizeAttendance({ ...input, today: '2026-11-20', days: days.filter((d) => d.attendanceDate <= '2026-11-20' && d.attendanceDate !== '2026-11-19') })
    // 19th missing (past, absent) + 21st..30th not yet happened (paid)
    expect(s.paymentDays).toBe(26.5)
  })

  test('fixed hourly divisor and hourly-rate override', () => {
    expect(summarizeAttendance({ ...input, settings: { ...input.settings, otHourlyDivisor: 240 } }).hourlyRate).toBe(250)
    expect(summarizeAttendance({ ...input, hourlyRateOverride: 400 }).hourlyRate).toBe(400)
  })

  test('attendance variables evaluate in salary formulas', () => {
    const vars = attendanceFormulaVariables(summarizeAttendance(input))
    const ctx = { base: 60000, gross: 0, net: 0, amount: 0, ...vars }
    expect(evaluateFormula('ot_amount', ctx)).toBe(3075)
    expect(evaluateFormula('daily_rate * absent_days', ctx)).toBe(5000)
    expect(evaluateFormula('hourly_rate * late_minutes / 60', ctx)).toBe(100)
    expect(evaluateFormula('base / working_days * payment_days', ctx)).toBe(55000)
  })
})

describe('leave days', () => {
  test('weekly offs / holidays inside a leave are not counted', () => {
    const off = (d: string) => d === '2026-11-01' || d === '2026-11-24'
    expect(countLeaveDays('2026-10-30', '2026-11-02', false, off)).toBe(3)
    expect(countLeaveDays('2026-11-02', '2026-11-02', true, off)).toBe(0.5)
  })
})

describe('ZKTeco iclock protocol', () => {
  test('parses ATTLOG lines (tabs or spaces)', () => {
    const recs = parseAttLog('1\t2026-10-27 08:01:02\t0\t1\t0\t0\n  \n25\t2026-10-27 17:30:00\t1\t15\n7 2026-10-27 09:00:00 0 1\nbad line')
    expect(recs.map((r) => [r.pin, r.local.date, r.local.time, punchTypeFromStatus(r.status)])).toEqual([
      ['1', '2026-10-27', '08:01:02', 'in'],
      ['25', '2026-10-27', '17:30:00', 'out'],
      ['7', '2026-10-27', '09:00:00', 'in'],
    ])
  })
  test('handshake carries the stamps and real-time push', () => {
    const t = handshakeText('CKJ123', { registered: true, attlogStamp: null })
    expect(t).toContain('GET OPTION FROM: CKJ123')
    expect(t).toContain('ATTLOGStamp=None')
    expect(t).toContain('Realtime=1')
    expect(t).toContain('TransInterval=1')
    expect(t).toMatch(/Delay=10/)
  })
  test('user list from OPERLOG and serial validation', () => {
    expect(parseOperLogUsers('USER PIN=12\tName=Nimal Perera\tPri=0\nOPLOG 4\t0\t2026-10-27')).toEqual({ '12': 'Nimal Perera' })
    expect(cleanSerial(' CKJ1234 ')).toBe('CKJ1234')
    expect(cleanSerial("x'; drop")).toBeNull()
  })
})

describe('punch file import', () => {
  test('USB export with AC-No / Date Time / State headers', () => {
    const r = parsePunchRows([
      { 'AC-No.': '12', Name: 'Nimal', 'Date Time': '27/10/2026 08:01', State: 'C/In' },
      { 'AC-No.': '12', Name: 'Nimal', 'Date Time': '27/10/2026 17:15', State: 'C/Out' },
      { 'AC-No.': '13', Name: 'Kamal', 'Date Time': 'garbage', State: '' },
    ])
    expect(r.punches).toEqual([
      { userId: '12', date: '2026-10-27', time: '08:01:00', punchType: 'in', row: 2 },
      { userId: '12', date: '2026-10-27', time: '17:15:00', punchType: 'out', row: 3 },
    ])
    expect(r.errors).toHaveLength(1)
  })
  test('separate Date and Time columns (Excel serials)', () => {
    const r = parsePunchRows([{ 'Employee Code': 'E001', Date: '46322', Time: '0.3375' }])
    expect(r.punches[0]).toMatchObject({ userId: 'E001', date: '2026-10-27', time: '08:06:00' })
  })
  test('state words', () => {
    expect(stateToPunchType('Check Out')).toBe('out')
    expect(stateToPunchType('0')).toBe('in')
    expect(stateToPunchType('?')).toBe('unknown')
  })
})
