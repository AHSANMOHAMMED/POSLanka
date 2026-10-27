'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormCheckbox } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { AttendanceNav, WEEKDAYS, localToday } from '@/components/hr/AttendanceNav'
import { AlertTriangle, CalendarDays, Download, Edit2, Loader2, Plus, Trash2 } from 'lucide-react'

interface Holiday { id: string; holidayDate: string; name: string; isPaid: boolean }

const btn = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'

async function jsonOrError(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.details?.[0]?.message || 'Request failed')
  return data
}

export default function HolidaysPage() {
  const { tenantSlug } = useCompany()
  const [year, setYear] = useState(() => Number(localToday().slice(0, 4)))
  const [rows, setRows] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await jsonOrError(await fetch(`/api/hr/holidays?year=${year}`)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load holidays')
    } finally {
      setLoading(false)
    }
  }, [year])
  useEffect(() => { load() }, [load])
  useRealtimeData(load, { entityType: 'holiday', refreshOnMount: false })

  async function importLk() {
    if (!window.confirm(`Import Sri Lanka public, bank and Poya holidays for ${year}?\n\nThe list is prepared in advance from the expected calendar. Check every date against the official Government Gazette and correct any that differ. Dates you already have are left unchanged.`)) return
    setImporting(true)
    try {
      const r = await jsonOrError(await fetch('/api/hr/holidays/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, includePoya: true }) }))
      toast.success(`${r.imported} holidays imported${r.skipped ? `, ${r.skipped} already present` : ''}. Please verify the dates.`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function remove(h: Holiday) {
    if (!window.confirm(`Delete ${h.name} (${h.holidayDate})?`)) return
    try {
      await jsonOrError(await fetch(`/api/hr/holidays/${h.id}`, { method: 'DELETE' }))
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  return (
    <PermissionGuard permission="manageEmployees">
      <div className="p-4 lg:p-6 space-y-4">
        <Breadcrumb items={[{ label: 'HR', href: `/c/${tenantSlug}/hr` }, { label: 'Holidays' }]} />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 rounded flex items-center justify-center"><CalendarDays size={20} className="text-teal-600 dark:text-teal-400" /></div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Holidays</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Not counted as absence; work on a holiday is overtime at the holiday rate</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800">
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className={btn} onClick={importLk} disabled={importing || (year !== 2026 && year !== 2027)} title={year !== 2026 && year !== 2027 ? 'Holiday lists are available for 2026 and 2027' : undefined}>
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}Import Sri Lanka holidays
            </button>
            <button className={btnPrimary} onClick={() => setEditing('new')}><Plus size={16} />Add holiday</button>
          </div>
        </div>
        <AttendanceNav />

        <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>The Sri Lanka list (2026, 2027) follows the expected lunar calendar. Poya, Ramazan, Hajji, Milad-un-Nabi, Mahasivarathri and Deepavali dates are confirmed by the Government Gazette each year — verify and edit before running payroll.</span>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Day</th><th className="px-3 py-2 text-left">Holiday</th><th className="px-3 py-2 text-center">Paid</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-500">No holidays for {year}</td></tr>}
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="px-3 py-2 font-mono">{h.holidayDate}</td>
                  <td className="px-3 py-2">{WEEKDAYS[new Date(`${h.holidayDate}T00:00:00Z`).getUTCDay()]}</td>
                  <td className="px-3 py-2">{h.name}</td>
                  <td className="px-3 py-2 text-center">{h.isPaid ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(h)} className="p-1.5 text-gray-500 hover:text-blue-600"><Edit2 size={15} /></button>
                    <button onClick={() => remove(h)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <HolidayModal holiday={editing === 'new' ? null : editing} year={year} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </PermissionGuard>
  )
}

function HolidayModal({ holiday, year, onClose, onSaved }: { holiday: Holiday | null; year: number; onClose: () => void; onSaved: () => void }) {
  const [holidayDate, setDate] = useState(holiday?.holidayDate ?? `${year}-01-01`)
  const [name, setName] = useState(holiday?.name ?? '')
  const [isPaid, setPaid] = useState(holiday?.isPaid ?? true)
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!name.trim()) { toast.error('Enter the holiday name'); return }
    setSaving(true)
    try {
      await jsonOrError(await fetch(holiday ? `/api/hr/holidays/${holiday.id}` : '/api/hr/holidays', { method: holiday ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holidayDate, name, isPaid }) }))
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save holiday')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal isOpen onClose={onClose} title={holiday ? 'Edit holiday' : 'Add holiday'} size="sm" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <FormField label="Date"><FormInput type="date" value={holidayDate} onChange={(e) => setDate(e.target.value)} /></FormField>
        <FormField label="Name" required><FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Company anniversary" /></FormField>
        <FormCheckbox checked={isPaid} onChange={(e) => setPaid(e.target.checked)} label="Paid holiday" />
      </div>
    </Modal>
  )
}
