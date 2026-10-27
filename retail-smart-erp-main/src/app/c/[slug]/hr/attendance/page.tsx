'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormCheckbox, FormTextarea } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import {
  AttendanceNav, STATUS_STYLES, StatusChip, clockValue, downloadCsv, formatClock, localToday, minutesToHm,
} from '@/components/hr/AttendanceNav'
import {
  CalendarCheck, ChevronLeft, ChevronRight, Download, Loader2, Plus, RefreshCw, Search, Settings, Trash2, Upload, UserCheck,
} from 'lucide-react'

// ============================================
// TYPES
// ============================================

interface Employee {
  id: string
  fullName: string | null
  employeeCode: string | null
  department: string | null
  designation: string | null
  warehouseId: string | null
  warehouseName: string | null
  biometricUserId: string | null
  otEligible: boolean
  shiftName: string | null
  hireDate: string | null
}

interface Day {
  id: string
  employeeProfileId: string
  attendanceDate: string
  status: string
  dayType: string
  firstIn: string | null
  lastOut: string | null
  punchCount: number
  workedMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  otMinutes: number
  missedPunch: boolean
  isManual: boolean
  notes: string | null
  leaveFraction: string
  leavePaid: boolean
}

interface AttendanceData {
  from: string
  to: string
  today: string
  timezone: string
  employees: Employee[]
  days: Day[]
  holidays: Array<{ date: string; name: string; isPaid: boolean }>
}

interface Punch {
  id: string
  employeeProfileId: string | null
  biometricUserId: string | null
  punchTime: string
  punchType: string
  verifyMode: string | null
  source: string
  note: string | null
  isDeleted: boolean
  deviceName: string | null
  employeeName: string | null
}

interface HrSettings {
  attendancePayroll?: boolean
  workingDaysMode: 'calendar' | 'shift'
  absenceMode: 'prorate' | 'nopay'
  otMultiplier: number
  holidayOtMultiplier: number
  defaultShiftId?: string | null
  missedPunchAs: 'present' | 'half_day' | 'absent'
  otHourlyDivisor?: number | null
  duplicatePunchSeconds: number
}

type View = 'daily' | 'register' | 'punches'

const btn = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
const inputCls = 'px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white'

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}
function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}
function datesOf(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

async function jsonOrError(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.details?.[0]?.message || 'Request failed')
  return data
}

// ============================================
// PAGE
// ============================================

export default function AttendancePage() {
  const { tenantSlug } = useCompany()
  const [view, setView] = useState<View>('daily')
  const [date, setDate] = useState(() => localToday())
  const [month, setMonth] = useState(() => localToday().slice(0, 7))
  const [branch, setBranch] = useState('')
  const [department, setDepartment] = useState('')
  const [search, setSearch] = useState('')
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [data, setData] = useState<AttendanceData | null>(null)
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState<{ employee: Employee; date: string; day: Day | null } | null>(null)
  const [punchFor, setPunchFor] = useState<{ employee: Employee; date: string } | null>(null)
  const [showMark, setShowMark] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRecalc, setShowRecalc] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const range = useMemo(() => (view === 'register' ? monthBounds(month) : { from: date, to: date }), [view, month, date])

  const load = useCallback(async () => {
    if (view === 'punches') return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to })
      if (branch) params.set('warehouseId', branch)
      const res = await fetch(`/api/hr/attendance?${params}`)
      setData(await jsonOrError(res))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load attendance')
    } finally {
      setLoading(false)
    }
  }, [view, range.from, range.to, branch])

  useEffect(() => { load() }, [load])
  useRealtimeData(load, { entityType: 'attendance', refreshOnMount: false })

  useEffect(() => {
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches((Array.isArray(d) ? d : d.data || []).map((w: { id: string; name: string }) => ({ id: w.id, name: w.name })))).catch(() => undefined)
  }, [])

  const tz = data?.timezone || 'Asia/Colombo'
  const departments = useMemo(() => [...new Set((data?.employees ?? []).map((e) => e.department).filter(Boolean) as string[])].sort(), [data])
  const employees = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.employees ?? []).filter((e) =>
      (!department || e.department === department) &&
      (!q || (e.fullName || '').toLowerCase().includes(q) || (e.employeeCode || '').toLowerCase().includes(q) || (e.biometricUserId || '') === q))
  }, [data, department, search])
  const dayMap = useMemo(() => {
    const m = new Map<string, Day>()
    for (const d of data?.days ?? []) m.set(`${d.employeeProfileId}|${d.attendanceDate}`, d)
    return m
  }, [data])

  return (
    <PermissionGuard permission="manageEmployees">
      <div className="p-4 lg:p-6 space-y-4">
        <Breadcrumb items={[{ label: 'HR', href: `/c/${tenantSlug}/hr` }, { label: 'Attendance' }]} />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded flex items-center justify-center">
              <CalendarCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Attendance</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Check-in / check-out from fingerprint devices, imports and manual entries</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => setShowMark(true)}><UserCheck size={16} />Mark attendance</button>
            <button className={btn} onClick={() => setShowImport(true)}><Upload size={16} />Import</button>
            <button className={btn} onClick={() => setShowRecalc(true)}><RefreshCw size={16} />Recalculate</button>
            <button className={btn} onClick={() => setShowSettings(true)} title="Attendance & payroll settings"><Settings size={16} /></button>
          </div>
        </div>

        <AttendanceNav />

        {/* View switch + filters */}
        <div className="flex flex-col xl:flex-row xl:items-center gap-3 justify-between">
          <div className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
            {([['daily', 'Daily board'], ['register', 'Monthly register'], ['punches', 'Punches']] as Array<[View, string]>).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-2 text-sm ${view === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view === 'daily' && (
              <div className="flex items-center gap-1">
                <button className={btn} onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
                <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
                <button className={btn} onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><ChevronRight size={16} /></button>
              </div>
            )}
            {view === 'register' && (
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={inputCls} />
            )}
            {view !== 'punches' && (
              <>
                <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>
                  <option value="">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {departments.length > 0 && (
                  <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls}>
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                <div className="relative">
                  <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or user id" className={`${inputCls} pl-8 w-48`} />
                </div>
                <button className={btn} onClick={() => exportCsv(view, data, employees, dayMap, range, tz)}><Download size={16} />Export</button>
              </>
            )}
          </div>
        </div>

        {view === 'punches' ? (
          <PunchesView employees={data?.employees ?? []} timezone={tz} />
        ) : loading && !data ? (
          <div className="p-10 text-center text-gray-500"><Loader2 className="animate-spin mx-auto mb-2" />Loading attendance…</div>
        ) : view === 'daily' ? (
          <DailyBoard
            date={date}
            employees={employees}
            dayMap={dayMap}
            data={data}
            onEdit={(employee, day) => setEditing({ employee, date, day })}
            onPunch={(employee) => setPunchFor({ employee, date })}
          />
        ) : (
          <Register
            from={range.from}
            to={range.to}
            employees={employees}
            dayMap={dayMap}
            data={data}
            onEdit={(employee, d, day) => setEditing({ employee, date: d, day })}
          />
        )}
      </div>

      {editing && (
        <DayEditModal
          employee={editing.employee}
          date={editing.date}
          day={editing.day}
          timezone={tz}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
      {punchFor && (
        <PunchModal employee={punchFor.employee} date={punchFor.date} onClose={() => setPunchFor(null)} onSaved={() => { setPunchFor(null); load() }} />
      )}
      {showMark && (
        <MarkModal employees={employees} date={view === 'daily' ? date : localToday(tz)} onClose={() => setShowMark(false)} onSaved={() => { setShowMark(false); load() }} />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={load} />}
      {showRecalc && <RecalcModal from={view === 'register' ? range.from : `${date.slice(0, 7)}-01`} to={view === 'register' ? range.to : date} onClose={() => setShowRecalc(false)} onDone={() => { setShowRecalc(false); load() }} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </PermissionGuard>
  )
}

// ============================================
// DAILY BOARD
// ============================================

function DailyBoard({ date, employees, dayMap, data, onEdit, onPunch }: {
  date: string
  employees: Employee[]
  dayMap: Map<string, Day>
  data: AttendanceData | null
  onEdit: (e: Employee, day: Day | null) => void
  onPunch: (e: Employee) => void
}) {
  const tz = data?.timezone || 'Asia/Colombo'
  const holiday = data?.holidays.find((h) => h.date === date)
  const stats = useMemo(() => {
    const s = { present: 0, absent: 0, half_day: 0, leave: 0, late: 0, ot: 0, notMarked: 0 }
    for (const e of employees) {
      const d = dayMap.get(`${e.id}|${date}`)
      if (!d) { s.notMarked++; continue }
      if (d.status in s) (s as Record<string, number>)[d.status]++
      if (d.lateMinutes > 0) s.late++
      s.ot += d.otMinutes
    }
    return s
  }, [employees, dayMap, date])

  return (
    <div className="space-y-3">
      {holiday && <div className="px-3 py-2 rounded bg-sky-50 dark:bg-sky-900/30 text-sm text-sky-800 dark:text-sky-300">Holiday: {holiday.name}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          ['Present', stats.present, 'text-green-600'],
          ['Absent', stats.absent, 'text-red-600'],
          ['Half day', stats.half_day, 'text-amber-600'],
          ['On leave', stats.leave, 'text-purple-600'],
          ['Late', stats.late, 'text-orange-600'],
          ['Overtime', minutesToHm(stats.ot), 'text-blue-600'],
          ['Not recorded', stats.notMarked, 'text-gray-500'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className={`text-lg font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Branch / Shift</th>
              <th className="px-3 py-2 text-center">In</th>
              <th className="px-3 py-2 text-center">Out</th>
              <th className="px-3 py-2 text-center">Worked</th>
              <th className="px-3 py-2 text-center">Late</th>
              <th className="px-3 py-2 text-center">Early</th>
              <th className="px-3 py-2 text-center">OT</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {employees.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">No employees. Add employee profiles under HR → Employees.</td></tr>
            )}
            {employees.map((e) => {
              const d = dayMap.get(`${e.id}|${date}`) ?? null
              return (
                <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-white">{e.fullName || '—'}</div>
                    <div className="text-xs text-gray-500">{[e.employeeCode, e.biometricUserId ? `FP ${e.biometricUserId}` : null].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                    <div>{e.warehouseName || '—'}</div>
                    <div>{e.shiftName || 'Default shift'}</div>
                  </td>
                  <td className="px-3 py-2 text-center font-mono">{formatClock(d?.firstIn, tz)}</td>
                  <td className="px-3 py-2 text-center font-mono">{formatClock(d?.lastOut, tz)}</td>
                  <td className="px-3 py-2 text-center font-mono">{minutesToHm(d?.workedMinutes)}</td>
                  <td className={`px-3 py-2 text-center font-mono ${d?.lateMinutes ? 'text-orange-600' : ''}`}>{minutesToHm(d?.lateMinutes)}</td>
                  <td className={`px-3 py-2 text-center font-mono ${d?.earlyLeaveMinutes ? 'text-orange-600' : ''}`}>{minutesToHm(d?.earlyLeaveMinutes)}</td>
                  <td className={`px-3 py-2 text-center font-mono ${d?.otMinutes ? 'text-blue-600 font-medium' : ''}`}>{minutesToHm(d?.otMinutes)}</td>
                  <td className="px-3 py-2">{d ? <StatusChip status={d.status} manual={d.isManual} missed={d.missedPunch} /> : <span className="text-xs text-gray-400">Not recorded</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="text-xs px-2 py-1 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30" onClick={() => onPunch(e)}>+ Punch</button>
                    <button className="text-xs px-2 py-1 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => onEdit(e, d)}>Edit</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================
// MONTHLY REGISTER
// ============================================

function Register({ from, to, employees, dayMap, data, onEdit }: {
  from: string
  to: string
  employees: Employee[]
  dayMap: Map<string, Day>
  data: AttendanceData | null
  onEdit: (e: Employee, date: string, day: Day | null) => void
}) {
  const dates = useMemo(() => datesOf(from, to), [from, to])
  const holidays = new Set((data?.holidays ?? []).map((h) => h.date))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(STATUS_STYLES).map(([k, s]) => (
          <span key={k} className={`px-2 py-0.5 rounded ${s.cell}`}><b>{s.code}</b> {s.label}</span>
        ))}
        <span className="px-2 py-0.5 rounded bg-white dark:bg-gray-800 border dark:border-gray-700">* edited · ! no check-out · click a cell to edit</span>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 px-2 py-2 text-left min-w-[160px] border-b dark:border-gray-700">Employee</th>
              {dates.map((d) => {
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
                return (
                  <th key={d} className={`px-1 py-1 text-center border-b dark:border-gray-700 min-w-[30px] ${holidays.has(d) ? 'text-sky-600' : wd === 0 ? 'text-red-500' : ''}`}>
                    <div>{Number(d.slice(8))}</div>
                    <div className="font-normal">{'SMTWTFS'[wd]}</div>
                  </th>
                )
              })}
              {['P', 'A', 'HD', 'L', 'Late', 'OT h'].map((h) => <th key={h} className="px-2 py-2 text-center border-b dark:border-gray-700 bg-gray-100 dark:bg-gray-800">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              let p = 0, a = 0, hd = 0, l = 0, late = 0, ot = 0
              const cells = dates.map((d) => {
                const day = dayMap.get(`${e.id}|${d}`) ?? null
                if (day) {
                  if (day.status === 'present') p++
                  else if (day.status === 'absent') a++
                  else if (day.status === 'half_day') hd++
                  else if (day.status === 'leave') l++
                  late += day.lateMinutes
                  ot += day.otMinutes
                }
                const s = day ? STATUS_STYLES[day.status] : null
                const beforeHire = e.hireDate && d < e.hireDate
                return (
                  <td key={d} className="p-0 border dark:border-gray-700">
                    <button
                      onClick={() => onEdit(e, d, day)}
                      disabled={!!beforeHire}
                      title={day ? `${s?.label}${day.workedMinutes ? ` · worked ${minutesToHm(day.workedMinutes)}` : ''}${day.lateMinutes ? ` · late ${day.lateMinutes} min` : ''}${day.otMinutes ? ` · OT ${minutesToHm(day.otMinutes)}` : ''}${day.notes ? ` · ${day.notes}` : ''}` : 'No record'}
                      className={`w-full h-7 text-[11px] font-semibold ${s?.cell ?? 'text-gray-300 dark:text-gray-600'} hover:ring-2 hover:ring-blue-400 hover:ring-inset`}
                    >
                      {beforeHire ? '' : s ? `${s.code}${day!.isManual ? '*' : ''}${day!.missedPunch ? '!' : ''}` : '·'}
                    </button>
                  </td>
                )
              })
              return (
                <tr key={e.id}>
                  <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-2 py-1 border dark:border-gray-700">
                    <div className="font-medium text-gray-900 dark:text-white truncate max-w-[180px]">{e.fullName}</div>
                    <div className="text-[10px] text-gray-500">{e.employeeCode || ''}</div>
                  </td>
                  {cells}
                  <td className="px-2 text-center border dark:border-gray-700 font-semibold text-green-700 dark:text-green-400">{p}</td>
                  <td className="px-2 text-center border dark:border-gray-700 font-semibold text-red-600">{a}</td>
                  <td className="px-2 text-center border dark:border-gray-700 font-semibold text-amber-600">{hd}</td>
                  <td className="px-2 text-center border dark:border-gray-700 font-semibold text-purple-600">{l}</td>
                  <td className="px-2 text-center border dark:border-gray-700">{late || ''}</td>
                  <td className="px-2 text-center border dark:border-gray-700 font-semibold text-blue-600">{ot ? (ot / 60).toFixed(1) : ''}</td>
                </tr>
              )
            })}
            {employees.length === 0 && <tr><td className="px-3 py-8 text-center text-gray-500" colSpan={dates.length + 7}>No employees</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function exportCsv(view: View, data: AttendanceData | null, employees: Employee[], dayMap: Map<string, Day>, range: { from: string; to: string }, tz: string) {
  if (!data) return
  if (view === 'daily') {
    const rows: Array<Array<string | number>> = [['Employee', 'Code', 'Fingerprint ID', 'Branch', 'Date', 'In', 'Out', 'Worked (min)', 'Late (min)', 'Early (min)', 'OT (min)', 'Status', 'Edited', 'Notes']]
    for (const e of employees) {
      const d = dayMap.get(`${e.id}|${range.from}`)
      rows.push([e.fullName || '', e.employeeCode || '', e.biometricUserId || '', e.warehouseName || '', range.from,
        clockValue(d?.firstIn, tz), clockValue(d?.lastOut, tz), d?.workedMinutes ?? '', d?.lateMinutes ?? '', d?.earlyLeaveMinutes ?? '', d?.otMinutes ?? '',
        d ? STATUS_STYLES[d.status]?.label ?? d.status : 'Not recorded', d?.isManual ? 'yes' : '', d?.notes || ''])
    }
    downloadCsv(`attendance-${range.from}.csv`, rows)
    return
  }
  const dates = datesOf(range.from, range.to)
  const rows: Array<Array<string | number>> = [['Employee', 'Code', ...dates.map((d) => d.slice(8)), 'Present', 'Absent', 'Half days', 'Leave', 'Late (min)', 'OT (hours)']]
  for (const e of employees) {
    let p = 0, a = 0, hd = 0, l = 0, late = 0, ot = 0
    const codes = dates.map((d) => {
      const day = dayMap.get(`${e.id}|${d}`)
      if (!day) return ''
      if (day.status === 'present') p++
      else if (day.status === 'absent') a++
      else if (day.status === 'half_day') hd++
      else if (day.status === 'leave') l++
      late += day.lateMinutes
      ot += day.otMinutes
      return STATUS_STYLES[day.status]?.code ?? day.status
    })
    rows.push([e.fullName || '', e.employeeCode || '', ...codes, p, a, hd, l, late, (ot / 60).toFixed(2)])
  }
  downloadCsv(`attendance-register-${range.from.slice(0, 7)}.csv`, rows)
}

// ============================================
// PUNCHES
// ============================================

function PunchesView({ employees, timezone }: { employees: Employee[]; timezone: string }) {
  const [from, setFrom] = useState(() => addDays(localToday(timezone), -6))
  const [to, setTo] = useState(() => localToday(timezone))
  const [employeeId, setEmployeeId] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [rows, setRows] = useState<Punch[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ from, to })
      if (employeeId) p.set('employeeProfileId', employeeId)
      if (includeDeleted) p.set('includeDeleted', 'true')
      const data = await jsonOrError(await fetch(`/api/hr/attendance/punches?${p}`))
      setRows(data.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load punches')
    } finally {
      setLoading(false)
    }
  }, [from, to, employeeId, includeDeleted])
  useEffect(() => { load() }, [load])

  async function remove(p: Punch) {
    const note = window.prompt('Reason for removing this punch (kept in the audit log):')
    if (!note) return
    try {
      await jsonOrError(await fetch(`/api/hr/attendance/punches/${p.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) }))
      toast.success('Punch removed and the day recalculated')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove punch')
    }
  }

  const fmt = (v: string) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(v))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <span className="text-gray-500 text-sm">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
          <option value="">All employees</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300"><input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />Show removed</label>
        <button className={btn} onClick={() => downloadCsv(`punches-${from}-${to}.csv`, [['Time', 'Employee', 'Device user id', 'Type', 'Verify', 'Source', 'Device', 'Note', 'Removed'], ...rows.map((r) => [fmt(r.punchTime), r.employeeName || '', r.biometricUserId || '', r.punchType, r.verifyMode || '', r.source, r.deviceName || '', r.note || '', r.isDeleted ? 'yes' : ''])])}><Download size={16} />Export</button>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-left">Note</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No punches in this period</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={r.isDeleted ? 'opacity-50 line-through' : ''}>
                <td className="px-3 py-2 font-mono text-xs">{fmt(r.punchTime)}</td>
                <td className="px-3 py-2">{r.employeeName || <span className="text-orange-600">Unmapped id {r.biometricUserId}</span>}</td>
                <td className="px-3 py-2 capitalize">{r.punchType}{r.verifyMode ? <span className="text-xs text-gray-500"> · {r.verifyMode}</span> : null}</td>
                <td className="px-3 py-2 text-xs">{r.source === 'device' ? r.deviceName || 'Device' : r.source}</td>
                <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{r.note || ''}</td>
                <td className="px-3 py-2 text-right">{!r.isDeleted && <button onClick={() => remove(r)} className="p-1 text-gray-400 hover:text-red-600" title="Remove punch"><Trash2 size={15} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================
// MODALS
// ============================================

function DayEditModal({ employee, date, day, timezone, onClose, onSaved }: {
  employee: Employee; date: string; day: Day | null; timezone: string; onClose: () => void; onSaved: () => void
}) {
  const [status, setStatus] = useState(day?.status ?? 'present')
  const [inTime, setInTime] = useState(clockValue(day?.firstIn, timezone))
  const [outTime, setOutTime] = useState(clockValue(day?.lastOut, timezone))
  const [lateMinutes, setLate] = useState(String(day?.lateMinutes ?? ''))
  const [otMinutes, setOt] = useState(String(day?.otMinutes ?? ''))
  const [leavePaid, setLeavePaid] = useState(day?.leavePaid ?? true)
  const [notes, setNotes] = useState(day?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [recomputeTimes, setRecomputeTimes] = useState(true)

  async function save(revert = false) {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { employeeProfileId: employee.id, date }
      if (revert) body.revert = true
      else {
        body.status = status
        if (inTime) body.inTime = inTime
        if (outTime) body.outTime = outTime
        if (!recomputeTimes) {
          if (lateMinutes !== '') body.lateMinutes = Number(lateMinutes)
          if (otMinutes !== '') body.otMinutes = Number(otMinutes)
        }
        if (status === 'leave') body.leavePaid = leavePaid
        body.notes = notes || 'Corrected by manager'
      }
      await jsonOrError(await fetch('/api/hr/attendance/day', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      toast.success(revert ? 'Correction removed' : 'Attendance saved')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`${employee.fullName} · ${date}`} size="md" footer={
      <ModalFooter>
        {day?.isManual && <button className={`${btn} mr-auto`} disabled={saving} onClick={() => save(true)}>Remove correction</button>}
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={() => save(false)}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        {day && (
          <p className="text-xs text-gray-500">
            Currently: {STATUS_STYLES[day.status]?.label ?? day.status} · {day.punchCount} punch(es) · worked {minutesToHm(day.workedMinutes)}{day.isManual ? ' · manually corrected' : ''}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Status">
            <FormSelect value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS_STYLES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </FormSelect>
          </FormField>
          {status === 'leave' && (
            <FormField label="Leave">
              <FormCheckbox checked={leavePaid} onChange={(e) => setLeavePaid(e.target.checked)} label="Paid leave" />
            </FormField>
          )}
          <FormField label="Check-in"><FormInput type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} /></FormField>
          <FormField label="Check-out" hint="Earlier than check-in = next day"><FormInput type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} /></FormField>
        </div>
        <FormCheckbox checked={recomputeTimes} onChange={(e) => setRecomputeTimes(e.target.checked)} label="Work out late / OT minutes from the times and the shift" />
        {!recomputeTimes && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Late (minutes)"><FormInput type="number" min="0" value={lateMinutes} onChange={(e) => setLate(e.target.value)} /></FormField>
            <FormField label="Overtime (minutes)"><FormInput type="number" min="0" value={otMinutes} onChange={(e) => setOt(e.target.value)} /></FormField>
          </div>
        )}
        <FormField label="Reason / notes"><FormTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. forgot to punch out, approved by manager" /></FormField>
        <p className="text-xs text-gray-500">A corrected day is kept as entered: new punches and recalculations do not change it until the correction is removed. Every change is recorded in the activity log.</p>
      </div>
    </Modal>
  )
}

function PunchModal({ employee, date, onClose, onSaved }: { employee: Employee; date: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(date)
  const [time, setTime] = useState('')
  const [type, setType] = useState('in')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!time || !note.trim()) { toast.error('Enter the time and a reason'); return }
    setSaving(true)
    try {
      await jsonOrError(await fetch('/api/hr/attendance/punches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeProfileId: employee.id, date: d, time, punchType: type, note }) }))
      toast.success('Punch added')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add punch')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title={`Add punch · ${employee.fullName}`} size="sm" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Add punch</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date"><FormInput type="date" value={d} onChange={(e) => setD(e.target.value)} /></FormField>
          <FormField label="Time"><FormInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></FormField>
        </div>
        <FormField label="Type">
          <FormSelect value={type} onChange={(e) => setType(e.target.value)}>
            <option value="in">Check-in</option>
            <option value="out">Check-out</option>
            <option value="unknown">Not specified</option>
          </FormSelect>
        </FormField>
        <FormField label="Reason" required><FormInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. machine was offline" /></FormField>
      </div>
    </Modal>
  )
}

function MarkModal({ employees, date, onClose, onSaved }: { employees: Employee[]; date: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(date)
  const [entries, setEntries] = useState<Record<string, { status: string; inTime: string; outTime: string }>>({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (id: string, patch: Partial<{ status: string; inTime: string; outTime: string }>) =>
    setEntries((prev) => ({ ...prev, [id]: Object.assign({ status: '', inTime: '', outTime: '' }, prev[id], patch) }))

  async function save() {
    const list = Object.entries(entries)
      .filter(([, v]) => v.status || v.inTime || v.outTime)
      .map(([employeeProfileId, v]) => ({ employeeProfileId, ...(v.inTime || v.outTime ? { inTime: v.inTime || undefined, outTime: v.outTime || undefined } : { status: v.status }) }))
    if (list.length === 0) { toast.error('Set a status or times for at least one employee'); return }
    setSaving(true)
    try {
      const r = await jsonOrError(await fetch('/api/hr/attendance/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d, entries: list, note: note || undefined }) }))
      toast.success(`Saved (${r.punches} punches, ${r.days} days)`)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark attendance')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Mark attendance (staff without a fingerprint machine)" size="3xl" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Date"><FormInput type="date" value={d} onChange={(e) => setD(e.target.value)} /></FormField>
          <button className={btn} onClick={() => setEntries(Object.fromEntries(employees.map((e) => [e.id, { status: 'present', inTime: '', outTime: '' }])))}>Everyone present</button>
          <div className="flex-1 min-w-[200px]"><FormField label="Note"><FormInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></FormField></div>
        </div>
        <p className="text-xs text-gray-500">Enter check-in / check-out times to calculate late and overtime from the shift, or just pick a status.</p>
        <div className="max-h-[50vh] overflow-y-auto border dark:border-gray-700 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 sticky top-0"><tr><th className="px-2 py-2 text-left">Employee</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">In</th><th className="px-2 py-2">Out</th></tr></thead>
            <tbody className="divide-y dark:divide-gray-700">
              {employees.map((e) => {
                const v = entries[e.id] ?? { status: '', inTime: '', outTime: '' }
                return (
                  <tr key={e.id}>
                    <td className="px-2 py-1">{e.fullName}{e.biometricUserId ? <span className="text-xs text-gray-400"> · FP {e.biometricUserId}</span> : null}</td>
                    <td className="px-2 py-1">
                      <select value={v.status} onChange={(ev) => set(e.id, { status: ev.target.value })} className={`${inputCls} py-1`}>
                        <option value="">—</option>
                        <option value="present">Present</option>
                        <option value="half_day">Half day</option>
                        <option value="absent">Absent</option>
                        <option value="leave">Leave (paid)</option>
                      </select>
                    </td>
                    <td className="px-2 py-1"><input type="time" value={v.inTime} onChange={(ev) => set(e.id, { inTime: ev.target.value })} className={`${inputCls} py-1`} /></td>
                    <td className="px-2 py-1"><input type="time" value={v.outTime} onChange={(ev) => set(e.id, { outTime: ev.target.value })} className={`${inputCls} py-1`} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ received: number; inserted: number; duplicates: number; unmapped: number; skippedOtherBranch?: number; errors: Array<{ row: number; message: string }> } | null>(null)
  async function upload() {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await jsonOrError(await fetch('/api/hr/attendance/import', { method: 'POST', body: fd }))
      setResult(r)
      toast.success(`${r.inserted} punches imported`)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title="Import punches" size="lg" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Close</button>
        <button className={btnPrimary} disabled={!file || busy} onClick={upload}>{busy && <Loader2 size={14} className="animate-spin" />}Import</button>
      </ModalFooter>
    }>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600 dark:text-gray-300">Upload the attendance log downloaded from the fingerprint machine by USB (<code>attlog.dat</code> / <code>.txt</code>) or exported from its PC software as CSV or Excel.</p>
        <ul className="list-disc pl-5 text-xs text-gray-500 space-y-1">
          <li>Columns: <b>User ID</b> (AC-No / Enroll No / PIN — or the employee code), <b>Date Time</b> (or separate <b>Date</b> and <b>Time</b>), optional <b>State</b> (C/In, C/Out, 0, 1).</li>
          <li>Dates are read as day/month/year when written with slashes (e.g. 27/10/2026 08:05).</li>
          <li>Importing the same file twice is safe: duplicates are skipped. Unknown user ids are kept — map them on the Fingerprint Devices page.</li>
        </ul>
        <input type="file" accept=".csv,.txt,.dat,.xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }} className="block text-sm" />
        {result && (
          <div className="rounded border dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900 space-y-1">
            <p>Rows read: <b>{result.received}</b> · imported: <b className="text-green-700">{result.inserted}</b> · duplicates skipped: {result.duplicates} · unmapped user ids: <span className={result.unmapped ? 'text-orange-600 font-medium' : ''}>{result.unmapped}</span>{result.skippedOtherBranch ? ` · other branches skipped: ${result.skippedOtherBranch}` : ''}</p>
            {result.errors.length > 0 && (
              <details><summary className="cursor-pointer text-red-600">{result.errors.length} row(s) could not be read</summary>
                <ul className="text-xs mt-1 max-h-32 overflow-y-auto">{result.errors.map((er, i) => <li key={i}>Row {er.row}: {er.message}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function RecalcModal({ from: f, to: t, onClose, onDone }: { from: string; to: string; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(f)
  const [to, setTo] = useState(t)
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const r = await jsonOrError(await fetch('/api/hr/attendance/recalculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) }))
      toast.success(`${r.days} employee-days recalculated`)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recalculation failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title="Recalculate attendance" size="sm" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy} onClick={run}>{busy && <Loader2 size={14} className="animate-spin" />}Recalculate</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="From"><FormInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
          <FormField label="To"><FormInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
        </div>
        <p className="text-xs text-gray-500">Rebuilds the days from the punches with the current shifts, holidays and approved leave (after changing a shift, for example). Manually corrected days are kept. Up to 93 days at a time.</p>
      </div>
    </Modal>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<HrSettings | null>(null)
  const [mode, setMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [shifts, setShifts] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    fetch('/api/hr/settings').then((r) => r.json()).then((d) => {
      setS(d.settings)
      setMode(d.settings.attendancePayroll === true ? 'on' : d.settings.attendancePayroll === false ? 'off' : 'auto')
    }).catch(() => toast.error('Failed to load settings'))
    fetch('/api/hr/shifts').then((r) => (r.ok ? r.json() : [])).then((d) => setShifts(Array.isArray(d) ? d : [])).catch(() => undefined)
  }, [])
  async function save() {
    if (!s) return
    setSaving(true)
    try {
      const body = { ...s, attendancePayroll: mode === 'auto' ? 'auto' : mode === 'on', defaultShiftId: s.defaultShiftId || '', otHourlyDivisor: s.otHourlyDivisor || 0 }
      await jsonOrError(await fetch('/api/hr/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      toast.success('Settings saved')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title="Attendance & payroll settings" size="lg" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving || !s} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      {!s ? <div className="p-6 text-center"><Loader2 className="animate-spin mx-auto" /></div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Payroll from attendance" hint="Auto: employees with a fingerprint id, punches or marked days are paid by attendance; others by the days entered on the payroll run">
            <FormSelect value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'on' | 'off')}>
              <option value="auto">Auto (tracked employees)</option>
              <option value="on">Always (every employee)</option>
              <option value="off">Never</option>
            </FormSelect>
          </FormField>
          <FormField label="Working days" hint="Calendar: salary ÷ days in month (weekly offs paid). Shift: weekly offs not counted">
            <FormSelect value={s.workingDaysMode} onChange={(e) => setS({ ...s, workingDaysMode: e.target.value as HrSettings['workingDaysMode'] })}>
              <option value="calendar">Calendar days</option>
              <option value="shift">Shift working days</option>
            </FormSelect>
          </FormField>
          <FormField label="Absence" hint="Pro-rate: absence lowers paid days. No-pay: full days + a No-pay deduction component">
            <FormSelect value={s.absenceMode} onChange={(e) => setS({ ...s, absenceMode: e.target.value as HrSettings['absenceMode'] })}>
              <option value="prorate">Pro-rate salary by paid days</option>
              <option value="nopay">No-pay deduction component</option>
            </FormSelect>
          </FormField>
          <FormField label="Default shift">
            <FormSelect value={s.defaultShiftId || ''} onChange={(e) => setS({ ...s, defaultShiftId: e.target.value || null })}>
              <option value="">Shift marked default (else 08:00–17:00, Sunday off)</option>
              {shifts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Normal OT multiplier" hint="When the employee has none">
            <FormInput type="number" step="0.05" min="0" value={s.otMultiplier} onChange={(e) => setS({ ...s, otMultiplier: Number(e.target.value) })} />
          </FormField>
          <FormField label="Holiday / off-day OT multiplier">
            <FormInput type="number" step="0.05" min="0" value={s.holidayOtMultiplier} onChange={(e) => setS({ ...s, holidayOtMultiplier: Number(e.target.value) })} />
          </FormField>
          <FormField label="Hourly rate divisor" hint="Blank = working days × shift hours (e.g. 240 = 30 × 8)">
            <FormInput type="number" min="0" value={s.otHourlyDivisor ?? ''} onChange={(e) => setS({ ...s, otHourlyDivisor: e.target.value ? Number(e.target.value) : null })} />
          </FormField>
          <FormField label="Day with only a check-in counts as">
            <FormSelect value={s.missedPunchAs} onChange={(e) => setS({ ...s, missedPunchAs: e.target.value as HrSettings['missedPunchAs'] })}>
              <option value="present">Present (flagged &ldquo;No out&rdquo;)</option>
              <option value="half_day">Half day</option>
              <option value="absent">Absent</option>
            </FormSelect>
          </FormField>
          <FormField label="Ignore repeat punches within (seconds)">
            <FormInput type="number" min="0" max="3600" value={s.duplicatePunchSeconds} onChange={(e) => setS({ ...s, duplicatePunchSeconds: Number(e.target.value) })} />
          </FormField>
        </div>
      )}
      <p className="mt-4 text-xs text-gray-500 flex items-start gap-1"><Plus size={12} className="mt-0.5" />Salary formulas can use: payment_days, working_days, absent_days, late_minutes, ot_hours, holiday_ot_hours, ot_amount, hourly_rate, daily_rate. Add the ready-made Overtime / Late / No-pay components from HR → Work Shifts.</p>
    </Modal>
  )
}
