'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormCheckbox, FormTextarea } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { AttendanceNav, localToday } from '@/components/hr/AttendanceNav'
import { CalendarX, Check, Edit2, Loader2, Plus, Trash2, X } from 'lucide-react'

interface LeaveType { id: string; name: string; code: string | null; daysPerYear: string; isPaid: boolean; isActive: boolean }
interface LeaveRequest {
  id: string; employeeProfileId: string; leaveTypeId: string; fromDate: string; toDate: string; halfDay: boolean; days: string
  reason: string | null; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; rejectionReason: string | null
  leaveTypeName: string; isPaid: boolean; employeeName: string | null; employeeCode: string | null
}
interface Balance { employeeProfileId: string; leaveTypeId: string; leaveTypeName: string; entitled: number; taken: number; pending: number; remaining: number }
interface EmployeeOption { id: string; fullName: string | null; employeeCode: string | null }

type Tab = 'requests' | 'balances' | 'types'

const btn = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
const inputCls = 'px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
const statusChip: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

async function jsonOrError(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.details?.[0]?.message || 'Request failed')
  return data
}

export default function LeavePage() {
  const { tenantSlug } = useCompany()
  const [tab, setTab] = useState<Tab>('requests')
  const [year, setYear] = useState(() => Number(localToday().slice(0, 4)))
  const [status, setStatus] = useState('')
  const [types, setTypes] = useState<LeaveType[]>([])
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [editType, setEditType] = useState<LeaveType | 'new' | null>(null)

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ year: String(year) })
      if (status) p.set('status', status)
      const [t, r, b] = await Promise.all([
        fetch('/api/hr/leave-types').then(jsonOrError),
        fetch(`/api/hr/leave-requests?${p}`).then(jsonOrError),
        fetch(`/api/hr/leave-balances?year=${year}`).then(jsonOrError),
      ])
      setTypes(t); setRequests(r); setBalances(b)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load leave')
    } finally {
      setLoading(false)
    }
  }, [year, status])
  useEffect(() => { load() }, [load])
  useRealtimeData(load, { entityType: 'leave-request', refreshOnMount: false })
  useEffect(() => {
    fetch('/api/employee-profiles?all=true&status=active').then((r) => (r.ok ? r.json() : [])).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => undefined)
  }, [])

  async function act(r: LeaveRequest, action: 'approve' | 'reject' | 'cancel') {
    let rejectionReason: string | undefined
    if (action === 'reject') {
      const v = window.prompt('Reason for rejecting (optional):')
      if (v === null) return
      rejectionReason = v || undefined
    } else if (action === 'cancel' && !window.confirm('Cancel this leave? Attendance for those days is recalculated.')) return
    try {
      await jsonOrError(await fetch(`/api/hr/leave-requests/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, rejectionReason }) }))
      toast.success(`Leave ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'}`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function deleteType(t: LeaveType) {
    if (!window.confirm(`Delete leave type "${t.name}"?`)) return
    try {
      await jsonOrError(await fetch(`/api/hr/leave-types/${t.id}`, { method: 'DELETE' }))
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const balanceGrid = useMemo(() => {
    const byEmp = new Map<string, Map<string, Balance>>()
    for (const b of balances) {
      if (!byEmp.has(b.employeeProfileId)) byEmp.set(b.employeeProfileId, new Map())
      byEmp.get(b.employeeProfileId)!.set(b.leaveTypeId, b)
    }
    return byEmp
  }, [balances])
  const activeTypes = types.filter((t) => t.isActive)

  return (
    <PermissionGuard permission="manageEmployees">
      <div className="p-4 lg:p-6 space-y-4">
        <Breadcrumb items={[{ label: 'HR', href: `/c/${tenantSlug}/hr` }, { label: 'Leave' }]} />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded flex items-center justify-center"><CalendarX size={20} className="text-yellow-600 dark:text-yellow-400" /></div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Leave</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Approved leave shows on the attendance register and counts as paid days for paid leave types</p>
            </div>
          </div>
          <div className="flex gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className={btnPrimary} onClick={() => setShowNew(true)}><Plus size={16} />New leave</button>
          </div>
        </div>
        <AttendanceNav />

        <div className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
          {([['requests', 'Requests'], ['balances', 'Balances'], ['types', 'Leave types']] as Array<[Tab, string]>).map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)} className={`px-3 py-2 text-sm ${tab === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{label}</button>
          ))}
        </div>

        {loading ? <div className="p-8 text-center text-gray-500"><Loader2 className="animate-spin mx-auto" /></div> : tab === 'requests' ? (
          <div className="space-y-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Dates</th><th className="px-3 py-2 text-center">Days</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2 text-left">Status</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {requests.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No leave requests</td></tr>}
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">{r.employeeName}<span className="text-xs text-gray-500"> {r.employeeCode || ''}</span></td>
                      <td className="px-3 py-2">{r.leaveTypeName}{!r.isPaid && <span className="text-xs text-red-600"> (unpaid)</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.fromDate}{r.toDate !== r.fromDate ? ` → ${r.toDate}` : ''}{r.halfDay ? ' (half day)' : ''}</td>
                      <td className="px-3 py-2 text-center">{Number(r.days)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{r.reason || ''}{r.rejectionReason ? <div className="text-red-600">Rejected: {r.rejectionReason}</div> : null}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusChip[r.status]}`}>{r.status}</span></td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.status === 'pending' && (
                          <>
                            <button onClick={() => act(r, 'approve')} className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded" title="Approve"><Check size={16} /></button>
                            <button onClick={() => act(r, 'reject')} className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="Reject"><X size={16} /></button>
                          </>
                        )}
                        {(r.status === 'pending' || r.status === 'approved') && <button onClick={() => act(r, 'cancel')} className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : tab === 'balances' ? (
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr><th className="px-3 py-2 text-left">Employee</th>{activeTypes.map((t) => <th key={t.id} className="px-3 py-2 text-center">{t.name}<div className="font-normal normal-case">{Number(t.daysPerYear)} / year</div></th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">{e.fullName}</td>
                    {activeTypes.map((t) => {
                      const b = balanceGrid.get(e.id)?.get(t.id)
                      return (
                        <td key={t.id} className="px-3 py-2 text-center">
                          {b ? (
                            <span title={`Taken ${b.taken}, pending ${b.pending}`}>
                              <b className={b.remaining < 0 ? 'text-red-600' : ''}>{b.entitled ? b.remaining : '—'}</b>
                              <span className="text-xs text-gray-500"> ({b.taken} taken{b.pending ? `, ${b.pending} pending` : ''})</span>
                            </span>
                          ) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">
            <button className={btn} onClick={() => setEditType('new')}><Plus size={16} />Add leave type</button>
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Code</th><th className="px-3 py-2 text-center">Days / year</th><th className="px-3 py-2 text-center">Paid</th><th className="px-3 py-2 text-center">Active</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {types.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2">{t.name}</td>
                      <td className="px-3 py-2">{t.code || ''}</td>
                      <td className="px-3 py-2 text-center">{Number(t.daysPerYear)}</td>
                      <td className="px-3 py-2 text-center">{t.isPaid ? 'Yes' : 'No-pay'}</td>
                      <td className="px-3 py-2 text-center">{t.isActive ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditType(t)} className="p-1.5 text-gray-500 hover:text-blue-600"><Edit2 size={15} /></button>
                        <button onClick={() => deleteType(t)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showNew && <NewLeaveModal employees={employees} types={activeTypes} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />}
      {editType && <LeaveTypeModal type={editType === 'new' ? null : editType} onClose={() => setEditType(null)} onSaved={() => { setEditType(null); load() }} />}
    </PermissionGuard>
  )
}

function NewLeaveModal({ employees, types, onClose, onSaved }: { employees: EmployeeOption[]; types: LeaveType[]; onClose: () => void; onSaved: () => void }) {
  const [employeeProfileId, setEmp] = useState('')
  const [leaveTypeId, setType] = useState(types[0]?.id ?? '')
  const [fromDate, setFrom] = useState(localToday())
  const [toDate, setTo] = useState(localToday())
  const [halfDay, setHalf] = useState(false)
  const [reason, setReason] = useState('')
  const [approve, setApprove] = useState(true)
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!employeeProfileId || !leaveTypeId) { toast.error('Choose the employee and leave type'); return }
    setSaving(true)
    try {
      await jsonOrError(await fetch('/api/hr/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeProfileId, leaveTypeId, fromDate, toDate: halfDay ? fromDate : toDate, halfDay, reason: reason || undefined, approve }) }))
      toast.success(approve ? 'Leave recorded and approved' : 'Leave request created')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save leave')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title="New leave" size="md" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <FormField label="Employee" required>
          <FormSelect value={employeeProfileId} onChange={(e) => setEmp(e.target.value)}>
            <option value="">Choose…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Leave type" required>
          <FormSelect value={leaveTypeId} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? '' : ' (no-pay)'}</option>)}
          </FormSelect>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="From"><FormInput type="date" value={fromDate} onChange={(e) => { setFrom(e.target.value); if (e.target.value > toDate) setTo(e.target.value) }} /></FormField>
          <FormField label="To"><FormInput type="date" value={halfDay ? fromDate : toDate} disabled={halfDay} onChange={(e) => setTo(e.target.value)} /></FormField>
        </div>
        <FormCheckbox checked={halfDay} onChange={(e) => setHalf(e.target.checked)} label="Half day" />
        <FormField label="Reason"><FormTextarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        <FormCheckbox checked={approve} onChange={(e) => setApprove(e.target.checked)} label="Approve now" description="Otherwise it waits as a pending request" />
        <p className="text-xs text-gray-500">Weekly off days and holidays inside the dates are not counted as leave days.</p>
      </div>
    </Modal>
  )
}

function LeaveTypeModal({ type, onClose, onSaved }: { type: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(type?.name ?? '')
  const [code, setCode] = useState(type?.code ?? '')
  const [daysPerYear, setDays] = useState(type ? String(Number(type.daysPerYear)) : '0')
  const [isPaid, setPaid] = useState(type?.isPaid ?? true)
  const [isActive, setActive] = useState(type?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await jsonOrError(await fetch(type ? `/api/hr/leave-types/${type.id}` : '/api/hr/leave-types', { method: type ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code: code || undefined, daysPerYear: Number(daysPerYear) || 0, isPaid, isActive }) }))
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title={type ? 'Edit leave type' : 'New leave type'} size="sm" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving || !name.trim()} onClick={save}>Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <FormField label="Name" required><FormInput value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code"><FormInput value={code} onChange={(e) => setCode(e.target.value)} /></FormField>
          <FormField label="Days per year"><FormInput type="number" step="0.5" min="0" value={daysPerYear} onChange={(e) => setDays(e.target.value)} /></FormField>
        </div>
        <FormCheckbox checked={isPaid} onChange={(e) => setPaid(e.target.checked)} label="Paid leave" description="Unpaid leave days reduce the salary like absence" />
        <FormCheckbox checked={isActive} onChange={(e) => setActive(e.target.checked)} label="Active" />
      </div>
    </Modal>
  )
}
