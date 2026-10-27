'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormCheckbox, FormSelect } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { AttendanceNav, WEEKDAYS, localToday } from '@/components/hr/AttendanceNav'
import { Calculator, Clock, Edit2, Loader2, Plus, Trash2, Users } from 'lucide-react'

interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  crossesMidnight: boolean
  breakMinutes: number
  graceLateMinutes: number
  graceEarlyMinutes: number
  halfDayHours: string
  fullDayHours: string
  otStartsAfterMinutes: number
  weeklyOffDays: number[]
  isDefault: boolean
  isActive: boolean
  employees: number
}

interface Assignment {
  id: string
  employeeProfileId: string
  shiftId: string
  fromDate: string
  toDate: string | null
  shiftName: string
  employeeName: string | null
  employeeCode: string | null
}

interface EmployeeOption { id: string; fullName: string | null; employeeCode: string | null; department: string | null }

const btn = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'

const emptyShift = {
  name: '', startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakMinutes: '60', graceLateMinutes: '10', graceEarlyMinutes: '10',
  halfDayHours: '4', fullDayHours: '8', otStartsAfterMinutes: '30', weeklyOffDays: [0] as number[], isDefault: false, isActive: true,
}

async function jsonOrError(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.details?.[0]?.message || 'Request failed')
  return data
}

export default function ShiftsPage() {
  const { tenantSlug } = useCompany()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Shift | 'new' | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        fetch('/api/hr/shifts').then(jsonOrError),
        fetch('/api/hr/shift-assignments').then(jsonOrError),
      ])
      setShifts(s)
      setAssignments(a)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load shifts')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])
  useRealtimeData(load, { entityType: 'work-shift', refreshOnMount: false })
  useEffect(() => {
    fetch('/api/employee-profiles?all=true&status=active').then((r) => (r.ok ? r.json() : [])).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => undefined)
  }, [])

  async function remove(s: Shift) {
    if (!window.confirm(`Delete shift "${s.name}"? Employees on it fall back to the default shift.`)) return
    try {
      await jsonOrError(await fetch(`/api/hr/shifts/${s.id}`, { method: 'DELETE' }))
      toast.success('Shift deleted')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  async function removeAssignment(a: Assignment) {
    if (!window.confirm(`Remove ${a.shiftName} for ${a.employeeName}?`)) return
    try {
      await jsonOrError(await fetch(`/api/hr/shift-assignments/${a.id}`, { method: 'DELETE' }))
      toast.success('Assignment removed')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove')
    }
  }

  async function seedComponents() {
    setSeeding(true)
    try {
      const add = window.confirm('Add the Overtime component to every active salary structure as well?\n\nOK = yes, Cancel = only create the components')
      const r = await jsonOrError(await fetch('/api/hr/salary-components/standard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addOvertimeToStructures: add }) }))
      toast.success(r.created.length ? `Created ${r.created.join(', ')}${r.structuresUpdated ? `; Overtime added to ${r.structuresUpdated} structure(s)` : ''}` : `Components already exist${r.structuresUpdated ? `; Overtime added to ${r.structuresUpdated} structure(s)` : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add components')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <PermissionGuard permission="manageEmployees">
      <div className="p-4 lg:p-6 space-y-4">
        <Breadcrumb items={[{ label: 'HR', href: `/c/${tenantSlug}/hr` }, { label: 'Work Shifts' }]} />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded flex items-center justify-center"><Clock size={20} className="text-indigo-600 dark:text-indigo-400" /></div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Work Shifts</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Shift times, grace periods, half day, overtime and weekly off days</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={seedComponents} disabled={seeding} title="Overtime (ot_amount), Late deduction, No-pay deduction salary components">{seeding ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}Add OT / late / no-pay components</button>
            <button className={btn} onClick={() => setAssigning(true)} disabled={shifts.length === 0}><Users size={16} />Assign shift</button>
            <button className={btnPrimary} onClick={() => setEditing('new')}><Plus size={16} />New shift</button>
          </div>
        </div>
        <AttendanceNav />

        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-center">Break</th>
                <th className="px-3 py-2 text-center">Grace late / early</th>
                <th className="px-3 py-2 text-center">Half day below</th>
                <th className="px-3 py-2 text-center">OT after</th>
                <th className="px-3 py-2 text-left">Weekly off</th>
                <th className="px-3 py-2 text-center">Employees</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</td></tr>}
              {!loading && shifts.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">No shifts yet. Without one, attendance uses 08:00–17:00 with a 60 minute break and Sunday off.</td></tr>
              )}
              {shifts.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-white">{s.name}</div>
                    <div className="flex gap-1 mt-0.5">
                      {s.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Default</span>}
                      {s.crossesMidnight && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-white">Night</span>}
                      {!s.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">Inactive</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">{s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)}</td>
                  <td className="px-3 py-2 text-center">{s.breakMinutes} min</td>
                  <td className="px-3 py-2 text-center">{s.graceLateMinutes} / {s.graceEarlyMinutes} min</td>
                  <td className="px-3 py-2 text-center">{Number(s.halfDayHours)} h</td>
                  <td className="px-3 py-2 text-center">{s.otStartsAfterMinutes} min</td>
                  <td className="px-3 py-2">{(s.weeklyOffDays || []).map((d) => WEEKDAYS[d]).join(', ') || 'None'}</td>
                  <td className="px-3 py-2 text-center">{s.employees}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(s)} className="p-1.5 text-gray-500 hover:text-blue-600" title="Edit"><Edit2 size={15} /></button>
                    <button onClick={() => remove(s)} className="p-1.5 text-gray-500 hover:text-red-600" title="Delete"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Shift assignments (date ranges)</h2>
          <p className="text-xs text-gray-500 mb-2">An assignment wins over the employee&apos;s default shift for its dates (rosters, temporary night shift …). The employee&apos;s default shift is set on the employee form.</p>
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Shift</th><th className="px-3 py-2 text-left">From</th><th className="px-3 py-2 text-left">To</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {assignments.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No assignments</td></tr>}
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">{a.employeeName}<span className="text-xs text-gray-500"> {a.employeeCode || ''}</span></td>
                    <td className="px-3 py-2">{a.shiftName}</td>
                    <td className="px-3 py-2">{a.fromDate}</td>
                    <td className="px-3 py-2">{a.toDate || 'Open'}</td>
                    <td className="px-3 py-2 text-right"><button onClick={() => removeAssignment(a)} className="p-1.5 text-gray-500 hover:text-red-600" title="Remove"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editing && <ShiftModal shift={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {assigning && <AssignModal shifts={shifts.filter((s) => s.isActive)} employees={employees} onClose={() => setAssigning(false)} onSaved={() => { setAssigning(false); load() }} />}
    </PermissionGuard>
  )
}

function ShiftModal({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() => shift ? {
    name: shift.name, startTime: shift.startTime.slice(0, 5), endTime: shift.endTime.slice(0, 5), crossesMidnight: shift.crossesMidnight,
    breakMinutes: String(shift.breakMinutes), graceLateMinutes: String(shift.graceLateMinutes), graceEarlyMinutes: String(shift.graceEarlyMinutes),
    halfDayHours: String(Number(shift.halfDayHours)), fullDayHours: String(Number(shift.fullDayHours)), otStartsAfterMinutes: String(shift.otStartsAfterMinutes),
    weeklyOffDays: shift.weeklyOffDays || [], isDefault: shift.isDefault, isActive: shift.isActive,
  } : emptyShift)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }))
  const night = f.endTime <= f.startTime

  async function save() {
    if (!f.name.trim()) { toast.error('Enter a shift name'); return }
    setSaving(true)
    try {
      const body = {
        ...f,
        crossesMidnight: f.crossesMidnight || night,
        breakMinutes: Number(f.breakMinutes) || 0,
        graceLateMinutes: Number(f.graceLateMinutes) || 0,
        graceEarlyMinutes: Number(f.graceEarlyMinutes) || 0,
        halfDayHours: Number(f.halfDayHours) || 0,
        fullDayHours: Number(f.fullDayHours) || 8,
        otStartsAfterMinutes: Number(f.otStartsAfterMinutes) || 0,
      }
      await jsonOrError(await fetch(shift ? `/api/hr/shifts/${shift.id}` : '/api/hr/shifts', { method: shift ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      toast.success(shift ? 'Shift updated. Use Attendance → Recalculate to apply it to past days.' : 'Shift created')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save shift')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={shift ? `Edit ${shift.name}` : 'New shift'} size="lg" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-3"><FormField label="Name" required><FormInput value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Office 8:30–5:00" /></FormField></div>
        <FormField label="Start"><FormInput type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} /></FormField>
        <FormField label="End" hint={night ? 'Ends the next day (night shift)' : undefined}><FormInput type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></FormField>
        <FormField label="Break (minutes)" hint="Deducted from worked time"><FormInput type="number" min="0" value={f.breakMinutes} onChange={(e) => set({ breakMinutes: e.target.value })} /></FormField>
        <FormField label="Late grace (minutes)" hint="Arriving later than this = late"><FormInput type="number" min="0" value={f.graceLateMinutes} onChange={(e) => set({ graceLateMinutes: e.target.value })} /></FormField>
        <FormField label="Early leave grace (minutes)"><FormInput type="number" min="0" value={f.graceEarlyMinutes} onChange={(e) => set({ graceEarlyMinutes: e.target.value })} /></FormField>
        <FormField label="OT starts after (minutes)" hint="Minutes after shift end before OT counts"><FormInput type="number" min="0" value={f.otStartsAfterMinutes} onChange={(e) => set({ otStartsAfterMinutes: e.target.value })} /></FormField>
        <FormField label="Half day if worked less than (hours)"><FormInput type="number" step="0.25" min="0" value={f.halfDayHours} onChange={(e) => set({ halfDayHours: e.target.value })} /></FormField>
        <FormField label="Full day hours" hint="For the hourly (OT) rate"><FormInput type="number" step="0.25" min="0.5" value={f.fullDayHours} onChange={(e) => set({ fullDayHours: e.target.value })} /></FormField>
        <div />
        <div className="md:col-span-3">
          <FormField label="Weekly off days">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className={`px-3 py-1.5 rounded border text-sm cursor-pointer ${f.weeklyOffDays.includes(i) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'}`}>
                  <input type="checkbox" className="sr-only" checked={f.weeklyOffDays.includes(i)} onChange={(e) => set({ weeklyOffDays: e.target.checked ? [...f.weeklyOffDays, i] : f.weeklyOffDays.filter((x) => x !== i) })} />
                  {d}
                </label>
              ))}
            </div>
          </FormField>
        </div>
        <FormCheckbox checked={f.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} label="Company default shift" />
        <FormCheckbox checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} label="Active" />
      </div>
    </Modal>
  )
}

function AssignModal({ shifts, employees, onClose, onSaved }: { shifts: Shift[]; employees: EmployeeOption[]; onClose: () => void; onSaved: () => void }) {
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '')
  const [fromDate, setFrom] = useState(localToday())
  const [toDate, setTo] = useState('')
  const [setAsDefault, setDefault] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const visible = useMemo(() => employees.filter((e) => !filter || (e.fullName || '').toLowerCase().includes(filter.toLowerCase()) || (e.department || '').toLowerCase().includes(filter.toLowerCase())), [employees, filter])

  async function save() {
    if (!shiftId || selected.size === 0) { toast.error('Pick a shift and at least one employee'); return }
    setSaving(true)
    try {
      const r = await jsonOrError(await fetch('/api/hr/shift-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shiftId, fromDate, toDate: toDate || undefined, setAsDefault, employeeProfileIds: [...selected] }) }))
      toast.success(`Shift assigned to ${r.created} employee(s)`)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Assign shift" size="lg" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Assign</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormField label="Shift"><FormSelect value={shiftId} onChange={(e) => setShiftId(e.target.value)}>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</FormSelect></FormField>
          <FormField label="From"><FormInput type="date" value={fromDate} onChange={(e) => setFrom(e.target.value)} /></FormField>
          <FormField label="To" hint="Blank = open-ended"><FormInput type="date" value={toDate} onChange={(e) => setTo(e.target.value)} /></FormField>
        </div>
        <FormCheckbox checked={setAsDefault} onChange={(e) => setDefault(e.target.checked)} label="Also make it these employees' default shift" />
        <div className="flex items-center gap-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or department" className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
          <button className={btn} onClick={() => setSelected(new Set(visible.map((e) => e.id)))}>Select all</button>
          <button className={btn} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
        <div className="max-h-64 overflow-y-auto border dark:border-gray-700 rounded divide-y dark:divide-gray-700">
          {visible.map((e) => (
            <label key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40">
              <input type="checkbox" checked={selected.has(e.id)} onChange={(ev) => { const n = new Set(selected); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setSelected(n) }} />
              <span>{e.fullName}</span>
              <span className="text-xs text-gray-500">{[e.employeeCode, e.department].filter(Boolean).join(' · ')}</span>
            </label>
          ))}
          {visible.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">No employees</p>}
        </div>
      </div>
    </Modal>
  )
}
