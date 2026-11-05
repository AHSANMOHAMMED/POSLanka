'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, X, Zap, ShieldCheck, ShieldAlert, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { BranchSelect } from '@/components/ui/branch-select'
import { useCurrency, usePermission } from '@/hooks'
import { useBusinessScope, serviceJobBusinessType, serviceJobTypesOf } from '@/hooks/useBusinessScope'
import {
  DEFAULT_ACCESSORIES, DEFAULT_CONDITION_CHECKLIST, DEVICE_TYPES, MEASUREMENT_PRESETS, jobKindForBusinessType, serviceJobTerms,
  type ServiceJobKind,
} from '@/lib/service-jobs/constants'
import { imeiWarning } from '@/lib/utils/imei'

const inputCls = 'w-full h-8 px-2.5 text-sm rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
const areaCls = 'w-full px-2.5 py-1.5 text-sm rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1'
const sectionCls = 'bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3'

interface ItemOption { id: string; name: string; sku?: string | null; sellingPrice: string; unit?: string | null }

interface LineState {
  key: string
  lineType: 'part' | 'labour' | 'other'
  itemId: string | null
  itemName: string | null
  description: string
  quantity: string
  unitPrice: string
  notes: string
}

export interface ServiceJobFormInitial {
  id: string
  updatedAt: string
  jobType: ServiceJobKind
  customerId: string | null
  customerName: string
  customerPhone: string | null
  title: string
  warehouseId: string | null
  receivedAt: string | null
  promisedAt: string | null
  isUrgent: boolean
  assignedTo: string | null
  deviceType: string | null
  brand: string | null
  model: string | null
  serialNumber: string | null
  imei: string | null
  imei2: string | null
  hasPasscode: boolean
  passcode: string | null
  faultReported: string | null
  accessoriesReceived: string | null
  conditionChecklist: Array<{ label: string; ok: boolean | null; note?: string | null }>
  conditionNotes: string | null
  diagnosis: string | null
  workDone: string | null
  garment: string | null
  measurements: Record<string, string>
  fabricSupplied: boolean
  fittingDate: string | null
  estimateAmount: string | null
  repairWarrantyDays: number | null
  discountAmount: string
  notes: string | null
  lines: Array<{ lineType: 'part' | 'labour' | 'other'; itemId: string | null; itemName?: string | null; description: string; quantity: string; unitPrice: string; notes: string | null }>
}

let keySeq = 0
const newKey = () => `l${Date.now().toString(36)}${(keySeq++).toString(36)}`
const emptyLine = (lineType: LineState['lineType'] = 'labour'): LineState => ({ key: newKey(), lineType, itemId: null, itemName: null, description: '', quantity: '1', unitPrice: '', notes: '' })

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
const num = (v: string) => (v === '' ? 0 : parseFloat(v) || 0)

function ItemPicker({ onPick }: { onPick: (item: ItemOption) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ItemOption[]>([])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items?search=${encodeURIComponent(q)}&pageSize=12`)
        if (!res.ok) return
        const data = await res.json()
        setOptions(Array.isArray(data) ? data : data.data || [])
      } catch { /* free text still works */ }
    }, 250)
    return () => clearTimeout(t)
  }, [q, open])
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2 top-2 text-gray-400" />
      <input
        className={`${inputCls} pl-7`}
        placeholder="Search part / item"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-white dark:bg-gray-800 dark:border-gray-600 shadow-lg">
          {options.map((o) => (
            <button key={o.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(o); setQ(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-gray-700 flex justify-between gap-2">
              <span className="truncate">{o.name}{o.sku ? <span className="text-gray-400"> · {o.sku}</span> : null}</span>
              <span className="text-xs text-gray-500 whitespace-nowrap">{parseFloat(o.sellingPrice || '0').toFixed(2)}{o.unit ? ` / ${o.unit}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CustomerFields({ customerId, name, phone, onChange }: {
  customerId: string | null; name: string; phone: string
  onChange: (v: { customerId: string | null; name: string; phone: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [found, setFound] = useState<Array<{ id: string; name: string; phone: string | null; mobilePhone?: string | null }>>([])
  const query = (name || phone).trim()
  const searching = open && !customerId && query.length >= 2
  const options = searching ? found : []
  useEffect(() => {
    if (!searching) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}&pageSize=8`)
        if (!res.ok) return
        const data = await res.json()
        setFound(Array.isArray(data) ? data : data.data || [])
      } catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(t)
  }, [query, searching])
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
      <div>
        <label className={labelCls}>Customer name *</label>
        <div className="relative">
          <input className={inputCls} value={name} placeholder="Walk-in or saved customer"
            onChange={(e) => onChange({ customerId: null, name: e.target.value, phone })}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
          {customerId && <span className="absolute right-2 top-1.5 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200">saved</span>}
        </div>
      </div>
      <div>
        <label className={labelCls}>Mobile</label>
        <input className={inputCls} value={phone} inputMode="tel" placeholder="07X XXX XXXX"
          onChange={(e) => onChange({ customerId, name, phone: e.target.value })}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-30 top-full mt-1 w-full max-h-56 overflow-auto rounded-md border bg-white dark:bg-gray-800 dark:border-gray-600 shadow-lg">
          {options.map((c) => (
            <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange({ customerId: c.id, name: c.name, phone: c.mobilePhone || c.phone || phone }); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-gray-700 flex justify-between">
              <span>{c.name}</span><span className="text-gray-500 text-xs">{c.mobilePhone || c.phone || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface WarrantyResult {
  found: boolean; inWarranty: boolean; warrantyUntil: string | null; itemName: string | null; invoiceNo: string | null; saleDate: string | null
  customerId: string | null; customerName: string | null; customerPhone: string | null; serialNumber: string | null; imeiWarning?: string | null
}

export function ServiceJobForm({ slug, initial }: { slug: string; initial?: ServiceJobFormInitial }) {
  const router = useRouter()
  const { fCurrency } = useCurrency()
  const scope = useBusinessScope()
  // A mall uses its service-job department's words and may run several job kinds
  const businessType = serviceJobBusinessType(scope)
  const kindChoices = scope.isMall && !initial
    ? Array.from(new Set(serviceJobTypesOf(scope).map((t) => jobKindForBusinessType(t))))
    : []
  const [chosenKind, setChosenKind] = useState<ServiceJobKind>(jobKindForBusinessType(businessType))
  const canCreateSales = usePermission('createSales')
  const canManageSales = usePermission('manageSales')
  const canWorkOrders = usePermission('manageWorkOrders')
  const canTakeMoney = canCreateSales || canManageSales
  const canPasscode = canWorkOrders || canManageSales
  const editing = !!initial
  const kind: ServiceJobKind = initial?.jobType || (kindChoices.length > 1 ? chosenKind : jobKindForBusinessType(businessType))
  const terms = serviceJobTerms(businessType)

  const [saving, setSaving] = useState(false)
  const [customer, setCustomer] = useState({ customerId: initial?.customerId || null, name: initial?.customerName || '', phone: initial?.customerPhone || '' })
  const [saveCustomer, setSaveCustomer] = useState(true)
  const [title, setTitle] = useState(initial?.title || '')
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || '')
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo || '')
  const [receivedAt, setReceivedAt] = useState(toLocalInput(initial?.receivedAt || new Date().toISOString()))
  const [promisedAt, setPromisedAt] = useState(toLocalInput(initial?.promisedAt))
  const [isUrgent, setIsUrgent] = useState(initial?.isUrgent || false)
  // repairs
  const [device, setDevice] = useState({
    deviceType: initial?.deviceType || '', brand: initial?.brand || '', model: initial?.model || '', serialNumber: initial?.serialNumber || '',
    imei: initial?.imei || '', imei2: initial?.imei2 || '',
  })
  const [passcode, setPasscode] = useState(initial?.passcode || '')
  const [showPass, setShowPass] = useState(false)
  const [clearPasscode, setClearPasscode] = useState(false)
  const [fault, setFault] = useState(initial?.faultReported || '')
  const [accessories, setAccessories] = useState(initial?.accessoriesReceived || '')
  const [checklist, setChecklist] = useState<Array<{ label: string; ok: boolean | null; note?: string | null }>>(
    initial?.conditionChecklist?.length ? initial.conditionChecklist : (kind === 'repair' ? DEFAULT_CONDITION_CHECKLIST.map((label) => ({ label, ok: null })) : []),
  )
  const [conditionNotes, setConditionNotes] = useState(initial?.conditionNotes || '')
  const [diagnosis, setDiagnosis] = useState(initial?.diagnosis || '')
  const [workDone, setWorkDone] = useState(initial?.workDone || '')
  const [warranty, setWarranty] = useState<WarrantyResult | null>(null)
  const [checking, setChecking] = useState(false)
  // tailoring
  const [garment, setGarment] = useState(initial?.garment || '')
  const [measurements, setMeasurements] = useState<Array<{ key: string; value: string }>>(
    Object.entries(initial?.measurements || {}).map(([key, value]) => ({ key, value })),
  )
  const [fabricSupplied, setFabricSupplied] = useState(initial?.fabricSupplied || false)
  const [fittingDate, setFittingDate] = useState(initial?.fittingDate || '')
  // money
  const [estimate, setEstimate] = useState(initial?.estimateAmount ? String(parseFloat(initial.estimateAmount)) : '')
  const [warrantyDays, setWarrantyDays] = useState(initial?.repairWarrantyDays != null ? String(initial.repairWarrantyDays) : (kind === 'repair' && !editing ? '30' : ''))
  const [discount, setDiscount] = useState(initial ? String(parseFloat(initial.discountAmount) || '') : '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [lines, setLines] = useState<LineState[]>(initial?.lines?.length
    ? initial.lines.map((l) => ({ key: newKey(), lineType: l.lineType, itemId: l.itemId, itemName: l.itemName || null, description: l.description, quantity: String(parseFloat(l.quantity)), unitPrice: String(parseFloat(l.unitPrice)), notes: l.notes || '' }))
    : [])
  const [advance, setAdvance] = useState({ amount: '', method: 'cash', reference: '' })
  const [staff, setStaff] = useState<Array<{ id: string; fullName: string; role: string }>>([])

  useEffect(() => {
    fetch('/api/users?activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setStaff(Array.isArray(d) ? d : d.data || [])).catch(() => {})
  }, [])

  const subtotal = useMemo(() => lines.reduce((s, l) => s + Math.round(num(l.quantity) * num(l.unitPrice) * 100) / 100, 0), [lines])
  const net = Math.max(0, subtotal - Math.min(num(discount), subtotal))
  const setLine = (key: string, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const imeiWarn = imeiWarning(device.imei)
  const imei2Warn = imeiWarning(device.imei2)

  function quickPromise(hours: number | 'tomorrow' | 'week') {
    const d = new Date()
    if (hours === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0) } else if (hours === 'week') { d.setDate(d.getDate() + 7); d.setHours(17, 0, 0, 0) } else d.setTime(d.getTime() + hours * 3600_000)
    setPromisedAt(toLocalInput(d.toISOString()))
  }

  async function checkWarranty() {
    const q = (device.imei || device.serialNumber || device.imei2).trim()
    if (q.length < 3) { toast.error('Enter the serial number or IMEI first'); return }
    setChecking(true)
    try {
      const res = await fetch(`/api/service-jobs/warranty-check?q=${encodeURIComponent(q)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Warranty check failed'); return }
      setWarranty(data)
      // sold here: fill the customer and model when they are still empty
      if (data.found) {
        if (!customer.name && data.customerName) setCustomer({ customerId: data.customerId || null, name: data.customerName, phone: data.customerPhone || customer.phone })
        if (!device.model && data.itemName) setDevice((dv) => ({ ...dv, model: data.itemName }))
      }
    } finally {
      setChecking(false)
    }
  }

  function toggleAccessory(a: string) {
    const list = accessories.split(',').map((x) => x.trim()).filter(Boolean)
    const next = list.includes(a) ? list.filter((x) => x !== a) : [...list, a]
    setAccessories(next.join(', '))
  }

  function applyPreset(name: string) {
    const keys = MEASUREMENT_PRESETS[name] || []
    setMeasurements((m) => {
      const have = new Set(m.map((x) => x.key))
      return [...m, ...keys.filter((k) => !have.has(k)).map((key) => ({ key, value: '' }))]
    })
    if (!garment) setGarment(name)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!customer.name.trim()) return toast.error('Enter the customer name')
    if (!title.trim()) return toast.error(kind === 'tailoring' ? 'Describe the order' : kind === 'service' ? 'Describe the task' : 'Describe the fault / job')
    const valid = lines.filter((l) => l.description.trim())
    for (const l of valid) if (!(num(l.quantity) > 0)) return toast.error(`Quantity must be more than 0 for "${l.description}"`)
    const m: Record<string, string> = {}
    for (const x of measurements) if (x.key.trim() && x.value.trim()) m[x.key.trim().slice(0, 60)] = x.value.trim().slice(0, 60)
    const payload = {
      jobType: kind,
      customerId: customer.customerId || undefined,
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim() || undefined,
      title: title.trim(),
      warehouseId: warehouseId || undefined,
      receivedAt: fromLocalInput(receivedAt) || undefined,
      promisedAt: fromLocalInput(promisedAt) || undefined,
      isUrgent,
      assignedTo: assignedTo || undefined,
      ...(kind === 'repair' ? {
        deviceType: device.deviceType || undefined,
        brand: device.brand.trim() || undefined,
        model: device.model.trim() || undefined,
        serialNumber: device.serialNumber.trim() || undefined,
        imei: device.imei.trim() || undefined,
        imei2: device.imei2.trim() || undefined,
        passcode: passcode || undefined,
        clearPasscode: editing && clearPasscode ? true : undefined,
        faultReported: fault.trim() || undefined,
        accessoriesReceived: accessories.trim() || undefined,
        conditionChecklist: checklist.filter((c) => c.ok !== null || c.note).map((c) => ({ label: c.label, ok: c.ok ?? undefined, note: c.note || undefined })),
        conditionNotes: conditionNotes.trim() || undefined,
        repairWarrantyDays: warrantyDays === '' ? undefined : parseInt(warrantyDays, 10),
      } : {}),
      ...(kind === 'tailoring' ? {
        garment: garment.trim() || undefined,
        measurements: m,
        fabricSupplied,
        fittingDate: fittingDate || undefined,
      } : {}),
      diagnosis: diagnosis.trim() || undefined,
      workDone: workDone.trim() || undefined,
      estimateAmount: estimate === '' ? undefined : num(estimate),
      discountAmount: num(discount),
      notes: notes.trim() || undefined,
      lines: valid.map((l) => ({
        lineType: l.lineType,
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
        notes: l.notes.trim() || undefined,
      })),
      ...(editing ? { expectedUpdatedAt: initial!.updatedAt } : { saveCustomer }),
      ...(!editing && num(advance.amount) > 0
        ? { advance: { amount: num(advance.amount), paymentMethod: advance.method, reference: advance.reference.trim() || undefined } }
        : {}),
    }
    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/service-jobs/${initial!.id}` : '/api/service-jobs', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? data.details.map((d: { message?: string }) => d.message).filter(Boolean).join(', ') : ''
        toast.error(detail || data.error || 'Could not save the job')
        return
      }
      toast.success(editing ? 'Job updated' : `${terms.one} ${data.jobNo} booked`)
      router.push(`/c/${slug}/service-jobs/${data.id}`)
    } catch {
      toast.error('Could not save the job')
    } finally {
      setSaving(false)
    }
  }

  const titlePlaceholder = kind === 'tailoring' ? 'e.g. Saree blouse stitching, trouser shortening' : kind === 'service' ? 'e.g. Annual maintenance visit, tax filing' : 'e.g. Screen broken, not charging'
  const assigneeLabel = kind === 'tailoring' ? 'Tailor' : kind === 'service' ? 'Assigned to' : 'Technician'

  return (
    <form onSubmit={submit} className="space-y-4 pb-24">
      <section className={sectionCls}>
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Customer &amp; {terms.one.toLowerCase()}</h2>
        {kindChoices.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600 dark:text-gray-300">Job type</span>
            {kindChoices.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setChosenKind(k)}
                className={`px-3 py-1 rounded-full border text-xs ${kind === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'}`}
              >
                {k === 'repair' ? 'Repair' : k === 'tailoring' ? 'Tailoring' : 'Service'}
              </button>
            ))}
          </div>
        )}
        <CustomerFields customerId={customer.customerId} name={customer.name} phone={customer.phone} onChange={(v) => setCustomer(v)} />
        {!editing && !customer.customerId && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} className="h-4 w-4" />
            Save as a customer (matches an existing customer with this phone number)
          </label>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>{kind === 'repair' ? 'Problem / job *' : kind === 'tailoring' ? 'Order *' : 'Task *'}</label>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titlePlaceholder} />
          </div>
          <BranchSelect value={warehouseId} onChange={setWarehouseId} />
          <div>
            <label className={labelCls}>{assigneeLabel}</label>
            <select className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Not assigned</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Received</label>
            <input type="datetime-local" className={inputCls} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{kind === 'service' ? 'Due' : 'Promised (ready by)'}</label>
            <input type="datetime-local" className={inputCls} value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
            <div className="flex gap-1 mt-1">
              {[{ l: '+4h', v: 4 }, { l: 'Tomorrow', v: 'tomorrow' as const }, { l: '+1 week', v: 'week' as const }].map((q) => (
                <button key={q.l} type="button" onClick={() => quickPromise(q.v)} className="px-1.5 py-0.5 text-[11px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-500">{q.l}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm mt-5 cursor-pointer select-none">
            <input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} className="h-4 w-4" />
            <Zap size={14} className={isUrgent ? 'text-red-600' : 'text-gray-400'} />
            <span className={isUrgent ? 'text-red-600 font-semibold' : 'text-gray-700 dark:text-gray-300'}>Urgent</span>
          </label>
        </div>
      </section>

      {kind === 'repair' && (
        <section className={sectionCls}>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Device</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Device type</label>
              <select className={inputCls} value={device.deviceType} onChange={(e) => setDevice({ ...device, deviceType: e.target.value })}>
                <option value="">—</option>
                {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Brand</label><input className={inputCls} value={device.brand} onChange={(e) => setDevice({ ...device, brand: e.target.value })} placeholder="Samsung, LG, Singer…" /></div>
            <div><label className={labelCls}>Model</label><input className={inputCls} value={device.model} onChange={(e) => setDevice({ ...device, model: e.target.value })} /></div>
            <div><label className={labelCls}>Serial number</label><input className={inputCls} value={device.serialNumber} onChange={(e) => setDevice({ ...device, serialNumber: e.target.value })} /></div>
            <div>
              <label className={labelCls}>IMEI</label>
              <input className={inputCls} value={device.imei} inputMode="numeric" onChange={(e) => setDevice({ ...device, imei: e.target.value })} placeholder="15 digits (*#06#)" />
              {imeiWarn && <div className="text-[11px] text-amber-600 mt-0.5">{imeiWarn}</div>}
            </div>
            <div>
              <label className={labelCls}>IMEI 2</label>
              <input className={inputCls} value={device.imei2} inputMode="numeric" onChange={(e) => setDevice({ ...device, imei2: e.target.value })} />
              {imei2Warn && <div className="text-[11px] text-amber-600 mt-0.5">{imei2Warn}</div>}
            </div>
            <div className="sm:col-span-2 flex items-end gap-2">
              <button type="button" onClick={checkWarranty} disabled={checking} className="flex items-center gap-1.5 h-8 px-3 text-sm rounded border border-gray-300 dark:border-gray-600 hover:border-blue-500 disabled:opacity-50">
                {checking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Check warranty
              </button>
              {warranty && (
                warranty.found ? (
                  <div className={`text-xs rounded px-2 py-1 ${warranty.inWarranty ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'}`}>
                    {warranty.inWarranty ? <ShieldCheck size={12} className="inline mr-1" /> : <ShieldAlert size={12} className="inline mr-1" />}
                    {warranty.itemName || 'Unit'} sold on {warranty.saleDate || '—'} ({warranty.invoiceNo || '—'}) — {warranty.inWarranty ? `under warranty until ${warranty.warrantyUntil}` : warranty.warrantyUntil ? `warranty ended ${warranty.warrantyUntil}` : 'no warranty recorded'}
                  </div>
                ) : <div className="text-xs text-gray-500">Not sold by this shop (no warranty on record)</div>
              )}
            </div>
            <div>
              <label className={labelCls}>Passcode / pattern</label>
              {!editing || canPasscode ? (
                <div className="relative">
                  <input className={`${inputCls} pr-8`} type={showPass ? 'text' : 'password'} autoComplete="off" value={passcode}
                    onChange={(e) => { setPasscode(e.target.value); setClearPasscode(false) }}
                    placeholder={editing && initial?.hasPasscode ? 'Saved — type to change' : 'PIN or pattern e.g. 1-5-9-6'} />
                  <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2 top-2 text-gray-400" aria-label="Show passcode">{showPass ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  {editing && initial?.hasPasscode && (
                    <label className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5"><input type="checkbox" checked={clearPasscode} onChange={(e) => setClearPasscode(e.target.checked)} /> Remove saved passcode</label>
                  )}
                </div>
              ) : (
                <div className="text-xs text-gray-500 h-8 flex items-center">{initial?.hasPasscode ? 'Saved (hidden)' : 'None'}</div>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>Fault reported by the customer</label>
            <textarea className={`${areaCls} h-16`} value={fault} onChange={(e) => setFault(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Accessories received</label>
            <div className="flex flex-wrap gap-1 mb-1">
              {DEFAULT_ACCESSORIES.map((a) => {
                const on = accessories.split(',').map((x) => x.trim()).includes(a)
                return <button key={a} type="button" onClick={() => toggleAccessory(a)} className={`px-2 py-0.5 text-xs rounded-full border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>{a}</button>
              })}
            </div>
            <input className={inputCls} value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder="None" />
          </div>
          <div>
            <label className={labelCls}>Physical condition on intake</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {checklist.map((c, i) => (
                <div key={c.label} className="flex items-center gap-1.5 text-sm">
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{c.label}</span>
                  {([true, false, null] as const).map((v) => (
                    <button key={String(v)} type="button" onClick={() => setChecklist((cl) => cl.map((x, j) => (j === i ? { ...x, ok: v } : x)))}
                      className={`px-1.5 py-0.5 text-[11px] rounded border ${c.ok === v ? (v === true ? 'bg-green-600 border-green-600 text-white' : v === false ? 'bg-red-600 border-red-600 text-white' : 'bg-gray-500 border-gray-500 text-white') : 'border-gray-300 dark:border-gray-600 text-gray-500'}`}>
                      {v === true ? 'OK' : v === false ? 'No' : '–'}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <input className={`${inputCls} mt-2`} value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} placeholder="Scratches, cracks, missing screws…" />
          </div>
        </section>
      )}

      {kind === 'tailoring' && (
        <section className={sectionCls}>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Garment &amp; measurements</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>Garment</label><input className={inputCls} value={garment} onChange={(e) => setGarment(e.target.value)} placeholder="Shirt, blouse, trouser…" /></div>
            <div><label className={labelCls}>Trial / fitting date</label><input type="date" className={inputCls} value={fittingDate} onChange={(e) => setFittingDate(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm mt-5 cursor-pointer select-none text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={fabricSupplied} onChange={(e) => setFabricSupplied(e.target.checked)} className="h-4 w-4" /> Fabric supplied by the customer
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.keys(MEASUREMENT_PRESETS).map((p) => (
              <button key={p} type="button" onClick={() => applyPreset(p)} className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-500">+ {p} measurements</button>
            ))}
            <button type="button" onClick={() => setMeasurements((m) => [...m, { key: '', value: '' }])} className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-500">+ Measurement</button>
          </div>
          {measurements.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {measurements.map((m, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input className={`${inputCls} w-1/2`} value={m.key} placeholder="Name" onChange={(e) => setMeasurements((ms) => ms.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  <input className={`${inputCls} w-1/2`} value={m.value} placeholder='e.g. 38"' onChange={(e) => setMeasurements((ms) => ms.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <button type="button" onClick={() => setMeasurements((ms) => ms.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {editing && (
        <section className={sectionCls}>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{kind === 'repair' ? 'Diagnosis & work' : 'Work notes'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>{kind === 'repair' ? 'Diagnosis' : 'Assessment'}</label><textarea className={`${areaCls} h-16`} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></div>
            <div><label className={labelCls}>Work done</label><textarea className={`${areaCls} h-16`} value={workDone} onChange={(e) => setWorkDone(e.target.value)} /></div>
          </div>
        </section>
      )}

      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Charges: parts &amp; labour</h2>
          <div className="flex gap-1">
            <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine('part')])} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:border-blue-500"><Plus size={14} /> {kind === 'tailoring' ? 'Fabric / material' : 'Part'}</button>
            <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine('labour')])} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"><Plus size={14} /> {kind === 'tailoring' ? 'Stitching charge' : 'Labour'}</button>
          </div>
        </div>
        {lines.length === 0 && <p className="text-xs text-gray-500">No charges yet — add them now or after diagnosis. An estimate can be given below.</p>}
        {lines.map((l) => {
          const amount = Math.round(num(l.quantity) * num(l.unitPrice) * 100) / 100
          return (
            <div key={l.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded border border-gray-200 dark:border-gray-700 p-2">
              <div className="md:col-span-2">
                <label className={labelCls}>Type</label>
                <select className={inputCls} value={l.lineType} onChange={(e) => setLine(l.key, { lineType: e.target.value as LineState['lineType'] })}>
                  <option value="part">Part / material</option><option value="labour">Labour / service</option><option value="other">Other</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <label className={labelCls}>{l.itemId ? 'Item (stock is deducted on invoice)' : 'Description'}</label>
                {l.lineType === 'part' && !l.itemId ? (
                  <div className="space-y-1">
                    <ItemPicker onPick={(it) => setLine(l.key, { itemId: it.id, itemName: it.name, description: l.description || it.name, unitPrice: l.unitPrice || String(parseFloat(it.sellingPrice || '0')) })} />
                    <input className={inputCls} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="…or type a description" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <input className={inputCls} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                    {l.itemId && <button type="button" onClick={() => setLine(l.key, { itemId: null, itemName: null })} className="text-gray-400 hover:text-red-600" title={`Unlink ${l.itemName || 'item'}`}><X size={14} /></button>}
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Qty</label>
                <input type="number" min={0} step="0.0001" className={inputCls} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Price</label>
                <input type="number" min={0} step="0.01" className={inputCls} value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
              </div>
              <div className="md:col-span-1 text-right text-sm font-medium pb-1.5">{fCurrency(amount)}</div>
              <div className="md:col-span-1 text-right pb-1">
                <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={16} /></button>
              </div>
            </div>
          )
        })}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
          <div>
            <label className={labelCls}>Estimate given to the customer</label>
            <input type="number" min={0} step="0.01" className={inputCls} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className={labelCls}>Discount</label>
            <input type="number" min={0} step="0.01" className={inputCls} value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          {kind === 'repair' && (
            <div>
              <label className={labelCls}>Repair warranty (days)</label>
              <input type="number" min={0} max={3650} step="1" className={inputCls} value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} />
            </div>
          )}
          <div className="text-right self-end">
            <div className="text-xs text-gray-500">Subtotal {fCurrency(subtotal)}</div>
            <div className="text-lg font-semibold dark:text-white">{fCurrency(net)}</div>
            <div className="text-[11px] text-gray-500">before tax</div>
          </div>
        </div>
      </section>

      {!editing && canTakeMoney && (
        <section className={sectionCls}>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Advance (optional)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input type="number" min={0} step="0.01" className={inputCls} placeholder="Amount" value={advance.amount} onChange={(e) => setAdvance({ ...advance, amount: e.target.value })} />
            <select className={inputCls} value={advance.method} onChange={(e) => setAdvance({ ...advance, method: e.target.value })}>
              <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option>
            </select>
            <input className={inputCls} placeholder="Reference (optional)" value={advance.reference} onChange={(e) => setAdvance({ ...advance, reference: e.target.value })} />
          </div>
          <p className="text-[11px] text-gray-500">Up to the charges above, or the estimate when nothing is priced yet. Settled against the invoice on delivery.</p>
        </section>
      )}

      <section className={sectionCls}>
        <label className={labelCls}>Notes</label>
        <textarea className={`${areaCls} h-16`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-4 py-3 flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600">Cancel</button>
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : editing ? 'Save changes' : `Book ${terms.one.toLowerCase()}`}
        </button>
      </div>
    </form>
  )
}
