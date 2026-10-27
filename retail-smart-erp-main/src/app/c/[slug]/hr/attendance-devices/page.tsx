'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormCheckbox } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { AttendanceNav } from '@/components/hr/AttendanceNav'
import { Copy, Edit2, Fingerprint, Link2, Loader2, Plus, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react'

interface Device {
  id: string
  name: string
  serialNumber: string
  warehouseId: string | null
  warehouseName: string | null
  model: string | null
  timezone: string
  lastSeenAt: string | null
  lastIp: string | null
  isActive: boolean
  hasCommKey: boolean
  punches: number
  unmapped: number
  lastPunchAt: string | null
  online: boolean
  attlogStamp: string | null
}

interface Unmapped {
  biometricUserId: string
  deviceId: string | null
  deviceName: string | null
  nameOnDevice: string | null
  punches: number
  firstPunch: string
  lastPunch: string
}

interface EmployeeOption { id: string; fullName: string | null; employeeCode: string | null; biometricUserId?: string | null }

const btn = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'

async function jsonOrError(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.details?.[0]?.message || 'Request failed')
  return data
}

function ago(v: string | null) {
  if (!v) return 'Never'
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(v).toLocaleString()
}

export default function AttendanceDevicesPage() {
  const { tenantSlug } = useCompany()
  const [devices, setDevices] = useState<Device[]>([])
  const [unmapped, setUnmapped] = useState<Unmapped[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Device | 'new' | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [server, setServer] = useState({ host: '', port: '80', origin: '' })

  const load = useCallback(async () => {
    try {
      const [d, u] = await Promise.all([fetch('/api/hr/attendance-devices').then(jsonOrError), fetch('/api/hr/attendance-devices/unmapped').then(jsonOrError)])
      setDevices(d)
      setUnmapped(u)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load devices')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])
  useRealtimeData(load, { entityType: 'attendance', refreshOnMount: false })
  useEffect(() => {
    setServer({ host: window.location.hostname, port: '80', origin: window.location.origin })
    fetch('/api/employee-profiles?all=true&status=active').then((r) => (r.ok ? r.json() : [])).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => undefined)
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches((Array.isArray(d) ? d : d.data || []).map((w: { id: string; name: string }) => ({ id: w.id, name: w.name })))).catch(() => undefined)
  }, [])

  async function remove(d: Device) {
    if (!window.confirm(`Remove device "${d.name}" (${d.serialNumber})? Punches already received are kept; the device stops sending.`)) return
    try {
      await jsonOrError(await fetch(`/api/hr/attendance-devices/${d.id}`, { method: 'DELETE' }))
      toast.success('Device removed')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove device')
    }
  }

  async function resync(d: Device) {
    if (!window.confirm('Ask the device to send its whole attendance log again on its next connection? Punches already received are not duplicated.')) return
    try {
      await jsonOrError(await fetch(`/api/hr/attendance-devices/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resync: true }) }))
      toast.success('Re-sync requested. Restart the device or wait for its next connection.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function map(u: Unmapped) {
    const employeeProfileId = mapping[u.biometricUserId]
    if (!employeeProfileId) { toast.error('Choose the employee'); return }
    try {
      const r = await jsonOrError(await fetch('/api/hr/attendance-devices/map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ biometricUserId: u.biometricUserId, employeeProfileId }) }))
      toast.success(`Mapped: ${r.attached} punch(es) attached and attendance recalculated`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to map')
    }
  }

  const copy = (v: string) => { navigator.clipboard?.writeText(v).then(() => toast.success('Copied')).catch(() => undefined) }

  return (
    <PermissionGuard permission="manageEmployees">
      <div className="p-4 lg:p-6 space-y-4">
        <Breadcrumb items={[{ label: 'HR', href: `/c/${tenantSlug}/hr` }, { label: 'Fingerprint Devices' }]} />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-rose-100 dark:bg-rose-900/30 rounded flex items-center justify-center"><Fingerprint size={20} className="text-rose-600 dark:text-rose-400" /></div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Fingerprint Devices</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">ZKTeco, eSSL and compatible machines with “Cloud server / ADMS” push</p>
            </div>
          </div>
          <button className={btnPrimary} onClick={() => setEditing('new')}><Plus size={16} />Register device</button>
        </div>
        <AttendanceNav />

        {/* Setup instructions */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-4 text-sm space-y-2">
          <p className="font-medium text-blue-900 dark:text-blue-200">Connect a fingerprint machine over the internet</p>
          <ol className="list-decimal pl-5 space-y-1 text-blue-900/90 dark:text-blue-200/90">
            <li>Register the device here with the <b>serial number</b> printed on its label (also under Menu → System Info → Device Info).</li>
            <li>On the device open <b>Menu → Comm. → Cloud Server Setting</b> (or ADMS / Web Server) and enter:</li>
          </ol>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-5">
            {[
              ['Server address', server.host],
              ['Server port', server.port],
              ['HTTPS / Proxy', 'Off'],
            ].map(([k, v]) => (
              <div key={k} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 px-3 py-2 flex items-center justify-between gap-2">
                <div><p className="text-xs text-gray-500">{k}</p><p className="font-mono text-gray-900 dark:text-white break-all">{v || '…'}</p></div>
                {k !== 'HTTPS / Proxy' && v && <button onClick={() => copy(v)} className="p-1 text-gray-400 hover:text-blue-600" title="Copy"><Copy size={14} /></button>}
              </div>
            ))}
          </div>
          <ul className="list-disc pl-10 text-xs text-blue-900/80 dark:text-blue-200/80 space-y-0.5">
            <li>Turn on “Enable domain name” if the device asks. The device pushes to <span className="font-mono">http://{server.host || 'your-domain'}/iclock/cdata</span> — no username or password is needed; the registered serial number identifies it.</li>
            <li>Devices that support HTTPS may use port 443. The device clock should be correct and set to the device time zone below (Sri Lanka: GMT+5:30).</li>
            <li>Enrol each employee on the device and put the device <b>User ID / PIN</b> into the employee&apos;s “Fingerprint User ID” (HR → Employees), or map it below after the first punch.</li>
            <li>No internet at the site? Download the log by USB (attlog.dat) and use Attendance → Import.</li>
          </ul>
        </div>

        {/* Devices */}
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr><th className="px-3 py-2 text-left">Device</th><th className="px-3 py-2 text-left">Serial</th><th className="px-3 py-2 text-left">Branch</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-center">Punches</th><th className="px-3 py-2 text-center">Unmapped</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</td></tr>}
              {!loading && devices.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No devices registered yet</td></tr>}
              {devices.map((d) => (
                <tr key={d.id} className={d.isActive ? '' : 'opacity-60'}>
                  <td className="px-3 py-2"><div className="font-medium text-gray-900 dark:text-white">{d.name}</div><div className="text-xs text-gray-500">{[d.model, d.timezone].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-3 py-2 font-mono text-xs">{d.serialNumber}</td>
                  <td className="px-3 py-2">{d.warehouseName || '—'}</td>
                  <td className="px-3 py-2">
                    <div className={`flex items-center gap-1 text-xs font-medium ${d.online ? 'text-green-600' : 'text-gray-500'}`}>{d.online ? <Wifi size={14} /> : <WifiOff size={14} />}{!d.isActive ? 'Disabled' : d.online ? 'Online' : d.lastSeenAt ? 'Offline' : 'Waiting for first connection'}</div>
                    <div className="text-xs text-gray-500">Last seen {ago(d.lastSeenAt)}{d.lastIp ? ` · ${d.lastIp}` : ''}</div>
                    {d.lastPunchAt && <div className="text-xs text-gray-500">Last punch {ago(d.lastPunchAt)}</div>}
                  </td>
                  <td className="px-3 py-2 text-center">{d.punches}</td>
                  <td className={`px-3 py-2 text-center ${d.unmapped ? 'text-orange-600 font-medium' : ''}`}>{d.unmapped}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => resync(d)} className="p-1.5 text-gray-500 hover:text-blue-600" title="Re-send full log"><RefreshCw size={15} /></button>
                    <button onClick={() => setEditing(d)} className="p-1.5 text-gray-500 hover:text-blue-600" title="Edit"><Edit2 size={15} /></button>
                    <button onClick={() => remove(d)} className="p-1.5 text-gray-500 hover:text-red-600" title="Remove"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Unmapped device users */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Device users not linked to an employee</h2>
          <p className="text-xs text-gray-500 mb-2">Punches from these device user ids are kept. Link each id to its employee: past punches are attached and the attendance is recalculated.</p>
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr><th className="px-3 py-2 text-left">Device user id</th><th className="px-3 py-2 text-left">Name on device</th><th className="px-3 py-2 text-left">Device</th><th className="px-3 py-2 text-center">Punches</th><th className="px-3 py-2 text-left">Last punch</th><th className="px-3 py-2 text-left">Employee</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {unmapped.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">All device users are linked</td></tr>}
                {unmapped.map((u) => (
                  <tr key={u.biometricUserId}>
                    <td className="px-3 py-2 font-mono">{u.biometricUserId}</td>
                    <td className="px-3 py-2">{u.nameOnDevice || '—'}</td>
                    <td className="px-3 py-2 text-xs">{u.deviceName || 'Import'}</td>
                    <td className="px-3 py-2 text-center">{u.punches}</td>
                    <td className="px-3 py-2 text-xs">{ago(u.lastPunch)}</td>
                    <td className="px-3 py-2">
                      <select value={mapping[u.biometricUserId] ?? ''} onChange={(e) => setMapping({ ...mapping, [u.biometricUserId]: e.target.value })} className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 max-w-[220px]">
                        <option value="">Choose employee…</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}{e.employeeCode ? ` (${e.employeeCode})` : ''}{e.biometricUserId ? ` · FP ${e.biometricUserId}` : ''}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right"><button onClick={() => map(u)} className={btn}><Link2 size={14} />Link</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editing && <DeviceModal device={editing === 'new' ? null : editing} branches={branches} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </PermissionGuard>
  )
}

const TIMEZONES = ['Asia/Colombo', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Riyadh', 'Asia/Qatar', 'Indian/Maldives', 'Europe/London', 'UTC']

function DeviceModal({ device, branches, onClose, onSaved }: { device: Device | null; branches: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(device?.name ?? '')
  const [serialNumber, setSerial] = useState(device?.serialNumber ?? '')
  const [warehouseId, setWarehouse] = useState(device?.warehouseId ?? '')
  const [model, setModel] = useState(device?.model ?? '')
  const [timezone, setTz] = useState(device?.timezone ?? 'Asia/Colombo')
  const [isActive, setActive] = useState(device?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [seen, setSeen] = useState<string | null>(null)

  async function check() {
    if (!serialNumber.trim()) return
    try {
      const r = await jsonOrError(await fetch(`/api/hr/attendance-devices/check?serial=${encodeURIComponent(serialNumber.trim())}`))
      setSeen(r.seen ? `This device contacted the server ${ago(r.lastSeenAt)} (${r.hits} times). It will start sending punches once registered.` : 'This serial number has not contacted the server yet (it can be registered first).')
    } catch (e) {
      setSeen(e instanceof Error ? e.message : 'Check failed')
    }
  }

  async function save() {
    if (!name.trim() || !serialNumber.trim()) { toast.error('Enter a name and the serial number'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name, serialNumber: serialNumber.trim(), model: model || undefined, timezone, isActive }
      if (warehouseId) body.warehouseId = warehouseId
      await jsonOrError(await fetch(device ? `/api/hr/attendance-devices/${device.id}` : '/api/hr/attendance-devices', { method: device ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      toast.success(device ? 'Device updated' : 'Device registered')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save device')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={device ? `Edit ${device.name}` : 'Register fingerprint device'} size="md" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <FormField label="Name" required><FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head office entrance" /></FormField>
        <FormField label="Serial number" required hint="Exactly as on the device label / Device Info (e.g. CKJ1234567890)">
          <div className="flex gap-2">
            <FormInput value={serialNumber} onChange={(e) => { setSerial(e.target.value.toUpperCase()); setSeen(null) }} className="font-mono" />
            <button type="button" className={btn} onClick={check}>Check</button>
          </div>
        </FormField>
        {seen && <p className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded p-2">{seen}</p>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Branch">
            <FormSelect value={warehouseId} onChange={(e) => setWarehouse(e.target.value)}>
              <option value="">{branches.length ? 'Default branch' : 'Not set'}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Model"><FormInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. ZKTeco K40" /></FormField>
        </div>
        <FormField label="Device time zone" hint="The clock the device stamps punches with">
          <FormSelect value={timezone} onChange={(e) => setTz(e.target.value)}>
            {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
        </FormField>
        <FormCheckbox checked={isActive} onChange={(e) => setActive(e.target.checked)} label="Active (accept punches from this device)" />
      </div>
    </Modal>
  )
}
