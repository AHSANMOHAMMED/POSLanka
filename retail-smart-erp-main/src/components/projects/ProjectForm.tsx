'use client'

/** Project editor (new + edit): details, billing method & budget, tasks, members with rates. */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { btnPrimary, btnSecondary, card, input, label, readJson } from '@/components/recurring-invoices/ui'

interface Option { id: string; name: string }
interface UserOption { id: string; fullName: string; isActive?: boolean }
type Billing = 'fixed' | 'project_hourly' | 'staff_hourly' | 'task_hourly'

export interface ProjectInitial {
  id?: string
  name: string; customerId: string; warehouseId: string | null; description: string | null
  billingMethod: Billing; fixedAmount: string | number; projectRate: string | number
  budgetType: 'none' | 'hours' | 'amount'; budgetHours: string | number | null; budgetAmount: string | number | null
  serviceItemId: string | null; startDate: string | null; endDate: string | null
  status: 'active' | 'on_hold' | 'completed' | 'cancelled'
  tasks: Array<{ id?: string; name: string; description?: string | null; rate: string | number; billable: boolean; isActive: boolean }>
  members: Array<{ userId: string; rate: string | number }>
}

export const BILLING_LABELS: Record<Billing, string> = {
  fixed: 'Fixed cost for project', project_hourly: 'Based on project hours', staff_hourly: 'Based on staff hours', task_hourly: 'Based on task hours',
}

let seq = 0
const k = () => `t${++seq}`

export function ProjectForm({ slug, initial }: { slug: string; initial?: ProjectInitial }) {
  const router = useRouter()
  const [customers, setCustomers] = useState<Option[]>([])
  const [branches, setBranches] = useState<Option[]>([])
  const [staff, setStaff] = useState<UserOption[]>([])
  const [items, setItems] = useState<Option[]>([])
  const [f, setF] = useState({
    name: initial?.name || '', customerId: initial?.customerId || '', warehouseId: initial?.warehouseId || '', description: initial?.description || '',
    billingMethod: (initial?.billingMethod || 'project_hourly') as Billing, fixedAmount: Number(initial?.fixedAmount) || 0, projectRate: Number(initial?.projectRate) || 0,
    budgetType: initial?.budgetType || 'none', budgetHours: Number(initial?.budgetHours) || 0, budgetAmount: Number(initial?.budgetAmount) || 0,
    serviceItemId: initial?.serviceItemId || '', startDate: initial?.startDate || '', endDate: initial?.endDate || '', status: initial?.status || 'active',
  })
  const [tasks, setTasks] = useState(() => (initial?.tasks || []).map((t) => ({ key: k(), id: t.id, name: t.name, rate: Number(t.rate) || 0, billable: t.billable, isActive: t.isActive })))
  const [members, setMembers] = useState(() => (initial?.members || []).map((m) => ({ key: k(), userId: m.userId, rate: Number(m.rate) || 0 })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const list = (d: unknown) => (Array.isArray(d) ? d : (d as { data?: unknown[] })?.data || []) as never[]
    fetch('/api/customers?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setCustomers(list(d))).catch(() => undefined)
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches(list(d))).catch(() => undefined)
    fetch('/api/users?activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setStaff(list(d))).catch(() => undefined)
    fetch('/api/items?all=true&activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setItems(list(d))).catch(() => undefined)
  }, [])
  const set = <K extends keyof typeof f>(key: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [key]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const body = {
        ...f, warehouseId: f.warehouseId || null, serviceItemId: f.serviceItemId || null, description: f.description || null,
        startDate: f.startDate || null, endDate: f.endDate || null,
        budgetHours: f.budgetType === 'hours' ? f.budgetHours : null, budgetAmount: f.budgetType === 'amount' ? f.budgetAmount : null,
        tasks: tasks.filter((t) => t.name.trim()).map(({ id, name, rate, billable, isActive }) => ({ id, name, rate, billable, isActive })),
        members: members.filter((m) => m.userId).map(({ userId, rate }) => ({ userId, rate })),
      }
      const res = await fetch(initial?.id ? `/api/projects/${initial.id}` : '/api/projects', {
        method: initial?.id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await readJson(res)
      if (!res.ok) { setError(String(d.error || 'Could not save')); return }
      router.push(`/c/${slug}/projects/${initial?.id || d.id}`)
    } finally { setSaving(false) }
  }

  const hourly = f.billingMethod !== 'fixed'
  return (
    <form onSubmit={save} className="space-y-4">
      {error && <div role="alert" className="px-3 py-2 text-sm rounded bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-200">{error}</div>}
      <div className={`${card} p-4 grid gap-4 md:grid-cols-3`}>
        <div><label className={label} htmlFor="pj-name">Project name *</label><input id="pj-name" className={input} value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} /></div>
        <div>
          <label className={label} htmlFor="pj-cust">Customer *</label>
          <select id="pj-cust" className={input} value={f.customerId} onChange={(e) => set('customerId', e.target.value)} required>
            <option value="">Select customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="pj-branch">Branch</label>
          <select id="pj-branch" className={input} value={f.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
            <option value="">Default branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-3"><label className={label} htmlFor="pj-desc">Description</label><textarea id="pj-desc" rows={2} className={input} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div><label className={label} htmlFor="pj-start">Start date</label><input id="pj-start" type="date" className={input} value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div><label className={label} htmlFor="pj-end">End date</label><input id="pj-end" type="date" className={input} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
        <div>
          <label className={label} htmlFor="pj-status">Status</label>
          <select id="pj-status" className={input} value={f.status} onChange={(e) => set('status', e.target.value as typeof f.status)}>
            <option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className={`${card} p-4 grid gap-4 md:grid-cols-3`}>
        <div>
          <label className={label} htmlFor="pj-billing">Billing method</label>
          <select id="pj-billing" className={input} value={f.billingMethod} onChange={(e) => set('billingMethod', e.target.value as Billing)}>
            {Object.entries(BILLING_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {f.billingMethod === 'fixed' && <div><label className={label} htmlFor="pj-fixed">Fixed price *</label><input id="pj-fixed" type="number" min={0} step="0.01" className={input} value={f.fixedAmount || ''} onChange={(e) => set('fixedAmount', Number(e.target.value) || 0)} required /></div>}
        {f.billingMethod === 'project_hourly' && <div><label className={label} htmlFor="pj-rate">Rate per hour</label><input id="pj-rate" type="number" min={0} step="0.01" className={input} value={f.projectRate || ''} onChange={(e) => set('projectRate', Number(e.target.value) || 0)} /></div>}
        <div>
          <label className={label} htmlFor="pj-item">Invoice line item</label>
          <select id="pj-item" className={input} value={f.serviceItemId} onChange={(e) => set('serviceItemId', e.target.value)}>
            <option value="">Professional services (created automatically, no stock)</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="pj-budget">Budget</label>
          <select id="pj-budget" className={input} value={f.budgetType} onChange={(e) => set('budgetType', e.target.value as typeof f.budgetType)}>
            <option value="none">No budget</option><option value="hours">Total project hours</option><option value="amount">Total project cost</option>
          </select>
        </div>
        {f.budgetType === 'hours' && <div><label className={label} htmlFor="pj-bh">Budget hours</label><input id="pj-bh" type="number" min={0} step="0.25" className={input} value={f.budgetHours || ''} onChange={(e) => set('budgetHours', Number(e.target.value) || 0)} /></div>}
        {f.budgetType === 'amount' && <div><label className={label} htmlFor="pj-ba">Budget amount</label><input id="pj-ba" type="number" min={0} step="0.01" className={input} value={f.budgetAmount || ''} onChange={(e) => set('budgetAmount', Number(e.target.value) || 0)} /></div>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${card} p-4 space-y-2`}>
          <h2 className="text-sm font-semibold dark:text-white">Tasks</h2>
          {tasks.map((t) => (
            <div key={t.key} className="flex flex-wrap items-center gap-2">
              <input aria-label="Task name" className={`${input} flex-1 min-w-[10rem]`} value={t.name} placeholder="Task name" onChange={(e) => setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, name: e.target.value } : x)))} />
              {f.billingMethod === 'task_hourly' && <input aria-label="Task rate per hour" type="number" min={0} step="0.01" className={`${input} w-28`} value={t.rate || ''} placeholder="Rate/h" onChange={(e) => setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, rate: Number(e.target.value) || 0 } : x)))} />}
              <label className="text-xs flex items-center gap-1 dark:text-gray-300"><input type="checkbox" checked={t.billable} onChange={(e) => setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, billable: e.target.checked } : x)))} /> Billable</label>
              <button type="button" className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove task" onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className={btnSecondary} onClick={() => setTasks((ts) => [...ts, { key: k(), id: undefined, name: '', rate: 0, billable: true, isActive: true }])}><Plus size={14} /> Add task</button>
        </div>
        <div className={`${card} p-4 space-y-2`}>
          <h2 className="text-sm font-semibold dark:text-white">Users</h2>
          <p className="text-xs text-gray-500">Members can log time on this project{f.billingMethod === 'staff_hourly' ? '; their rate bills their hours' : ''}.</p>
          {members.map((m) => (
            <div key={m.key} className="flex items-center gap-2">
              <select aria-label="Staff member" className={`${input} flex-1`} value={m.userId} onChange={(e) => setMembers((ms) => ms.map((x) => (x.key === m.key ? { ...x, userId: e.target.value } : x)))}>
                <option value="">Select user…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
              {(hourly && f.billingMethod === 'staff_hourly') && <input aria-label="Rate per hour" type="number" min={0} step="0.01" className={`${input} w-28`} value={m.rate || ''} placeholder="Rate/h" onChange={(e) => setMembers((ms) => ms.map((x) => (x.key === m.key ? { ...x, rate: Number(e.target.value) || 0 } : x)))} />}
              <button type="button" className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove user" onClick={() => setMembers((ms) => ms.filter((x) => x.key !== m.key))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className={btnSecondary} onClick={() => setMembers((ms) => [...ms, { key: k(), userId: '', rate: 0 }])}><Plus size={14} /> Add user</button>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Save project'}</button>
        <button type="button" className={btnSecondary} onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  )
}
