'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, X, Zap, Upload, Link2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { BranchSelect } from '@/components/ui/branch-select'
import { useCurrency } from '@/hooks'
import {
  calculateSizeLine, FINISHING_ADDONS, FINISHING_BY_CODE, SIZE_PRESETS, SIZE_UNITS, AREA_UNIT_LABEL, LENGTH_UNIT_LABEL,
  type AreaUnit, type FinishingInput, type PricingMode, type SizeUnit,
} from '@/lib/print-jobs/size-pricing'
import { PRINT_MATERIALS, PROOF_STATUS_LABELS } from '@/lib/print-jobs/constants'

const inputCls = 'w-full h-8 px-2.5 text-sm rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1'

interface ItemOption {
  id: string
  name: string
  sku?: string | null
  sellingPrice: string
  unit?: string | null
  pricingMode?: PricingMode | null
  areaUnit?: AreaUnit | null
  minChargeArea?: string | null
}

export interface PrintJobLineState {
  key: string
  itemId: string | null
  itemName: string | null
  description: string
  pricingMode: PricingMode
  width: string
  height: string
  sizeUnit: SizeUnit
  quantity: string
  material: string
  sides: number
  areaUnit: AreaUnit
  minChargeArea: string
  rate: string
  finishing: FinishingInput[]
  notes: string
}

export interface PrintJobFormInitial {
  id: string
  updatedAt: string
  customerId: string | null
  customerName: string
  customerPhone: string | null
  title: string
  warehouseId: string | null
  receivedAt: string | null
  dueAt: string | null
  isUrgent: boolean
  assignedTo: string | null
  discountAmount: string
  notes: string | null
  proofStatus: string
  proofFiles: Array<{ url: string; name?: string | null; fileId?: string | null; addedAt?: string | null }>
  proofNote: string | null
  lines: Array<{
    itemId: string | null; itemName?: string | null; description: string; pricingMode: PricingMode; width: string | null; height: string | null
    sizeUnit: SizeUnit | null; quantity: string; material: string | null; sides: number; areaUnit: AreaUnit | null
    rate: string; finishing: Array<{ code: string; label: string; qty: number; rate: number }>; notes: string | null
  }>
}

let keySeq = 0
const newKey = () => `l${Date.now().toString(36)}${(keySeq++).toString(36)}`

function emptyLine(): PrintJobLineState {
  return {
    key: newKey(), itemId: null, itemName: null, description: '', pricingMode: 'area', width: '', height: '', sizeUnit: 'ft',
    quantity: '1', material: '', sides: 1, areaUnit: 'sqft', minChargeArea: '', rate: '', finishing: [], notes: '',
  }
}

/** ISO → value for <input type="datetime-local"> in the browser's time zone */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

function lineFromInitial(l: PrintJobFormInitial['lines'][number]): PrintJobLineState {
  return {
    key: newKey(),
    itemId: l.itemId,
    itemName: l.itemName || null,
    description: l.description,
    pricingMode: l.pricingMode,
    width: l.width ? String(parseFloat(l.width)) : '',
    height: l.height ? String(parseFloat(l.height)) : '',
    sizeUnit: (l.sizeUnit || 'inch') as SizeUnit,
    quantity: String(parseFloat(l.quantity)),
    material: l.material || '',
    sides: l.sides || 1,
    areaUnit: (l.areaUnit || 'sqft') as AreaUnit,
    minChargeArea: '',
    rate: String(parseFloat(l.rate)),
    // stored finishing keeps the computed qty; 'count' add-ons are re-derived from count per piece
    finishing: (l.finishing || []).map((f) => {
      const def = FINISHING_BY_CODE[f.code]
      const pieces = parseFloat(l.quantity) || 1
      const count = def?.basis === 'count' ? Math.round((f.qty / pieces) * 100) / 100 : def?.basis === 'fixed' ? f.qty : undefined
      return { code: f.code, label: f.label, rate: f.rate, count }
    }),
    notes: l.notes || '',
  }
}

function lineCalc(l: PrintJobLineState) {
  return calculateSizeLine({
    pricingMode: l.pricingMode,
    width: parseFloat(l.width) || 0,
    height: parseFloat(l.height) || 0,
    sizeUnit: l.sizeUnit,
    quantity: parseFloat(l.quantity) || 0,
    rate: parseFloat(l.rate) || 0,
    areaUnit: l.areaUnit,
    minChargeArea: parseFloat(l.minChargeArea) || null,
    sides: l.sides,
    finishing: l.finishing,
  })
}

/** Item picker: type to search the catalogue; choosing fills description, pricing mode and rate. */
function ItemPicker({ value, onPick, onClear }: { value: string | null; onPick: (item: ItemOption) => void; onClear: () => void }) {
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
      } catch { /* offline: free text still works */ }
    }, 250)
    return () => clearTimeout(t)
  }, [q, open])

  if (value) {
    return (
      <div className="flex items-center gap-1 text-sm">
        <span className="truncate font-medium text-blue-700 dark:text-blue-300">{value}</span>
        <button type="button" onClick={onClear} className="text-gray-400 hover:text-red-600" aria-label="Clear item"><X size={14} /></button>
      </div>
    )
  }
  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2 top-2 text-gray-400" />
        <input
          className={`${inputCls} pl-7`}
          placeholder="Search item / product (optional)"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-white dark:bg-gray-800 dark:border-gray-600 shadow-lg">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(o); setQ(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-gray-700 flex justify-between gap-2"
            >
              <span className="truncate">{o.name}{o.sku ? <span className="text-gray-400"> · {o.sku}</span> : null}</span>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {parseFloat(o.sellingPrice || '0').toFixed(2)}
                {o.pricingMode === 'area' ? ` / ${AREA_UNIT_LABEL[(o.areaUnit || 'sqft') as AreaUnit]}` : o.pricingMode === 'length' ? ` / ${LENGTH_UNIT_LABEL[(o.areaUnit || 'sqft') as AreaUnit]}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Customer: type a name or phone; pick a saved customer or keep it as a walk-in. */
function CustomerFields({ customerId, name, phone, onChange }: {
  customerId: string | null; name: string; phone: string
  onChange: (v: { customerId: string | null; name: string; phone: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [found, setOptions] = useState<Array<{ id: string; name: string; phone: string | null; mobilePhone?: string | null }>>([])
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
        setOptions(Array.isArray(data) ? data : data.data || [])
      } catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(t)
  }, [query, searching])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
      <div>
        <label className={labelCls}>Customer name *</label>
        <div className="relative">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => onChange({ customerId: null, name: e.target.value, phone })}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder="Walk-in or saved customer"
          />
          {customerId && (
            <span className="absolute right-2 top-1.5 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200">saved</span>
          )}
        </div>
      </div>
      <div>
        <label className={labelCls}>Mobile</label>
        <input
          className={inputCls}
          value={phone}
          inputMode="tel"
          onChange={(e) => onChange({ customerId, name, phone: e.target.value })}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="07X XXX XXXX"
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-30 top-full mt-1 w-full max-h-56 overflow-auto rounded-md border bg-white dark:bg-gray-800 dark:border-gray-600 shadow-lg">
          {options.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange({ customerId: c.id, name: c.name, phone: c.mobilePhone || c.phone || phone }); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-gray-700 flex justify-between"
            >
              <span>{c.name}</span>
              <span className="text-gray-500 text-xs">{c.mobilePhone || c.phone || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FinishingEditor({ line, onChange, unitLabel }: { line: PrintJobLineState; onChange: (f: FinishingInput[]) => void; unitLabel: string }) {
  const calc = lineCalc(line)
  const add = (code: string) => {
    const def = FINISHING_BY_CODE[code]
    onChange([...line.finishing, { code, label: def.label, rate: 0, count: def.basis === 'count' || def.basis === 'fixed' ? def.defaultCount ?? 1 : undefined }])
  }
  return (
    <div className="space-y-1.5">
      {line.finishing.map((f, i) => {
        const def = FINISHING_BY_CODE[f.code] || FINISHING_BY_CODE.other
        const res = calc.finishing[i]
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            {def.code === 'other' ? (
              <input className={`${inputCls} w-36`} value={f.label || ''} placeholder="Add-on" onChange={(e) => onChange(line.finishing.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
            ) : (
              <span className="w-36 truncate font-medium text-gray-700 dark:text-gray-200">{def.label}</span>
            )}
            {(def.basis === 'count' || def.basis === 'fixed') && (
              <label className="flex items-center gap-1 text-xs text-gray-500">
                {def.countLabel}
                <input type="number" min={0} step="1" className={`${inputCls} w-16`} value={f.count ?? ''} onChange={(e) => onChange(line.finishing.map((x, j) => j === i ? { ...x, count: e.target.value === '' ? null : parseFloat(e.target.value) } : x))} />
              </label>
            )}
            <label className="flex items-center gap-1 text-xs text-gray-500">
              Rate
              <input type="number" min={0} step="0.01" className={`${inputCls} w-24`} value={f.rate || ''} onChange={(e) => onChange(line.finishing.map((x, j) => j === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x))} />
              <span className="whitespace-nowrap">{def.basis === 'area' ? `/ ${unitLabel}` : def.basis === 'perimeter' ? `/ running ${line.areaUnit === 'sqm' ? 'm' : 'ft'}` : def.basis === 'count' ? '/ each' : ''}</span>
            </label>
            <span className="text-xs text-gray-500 ml-auto">{res ? `${res.qty} × ${res.rate} = ${res.amount.toFixed(2)}` : ''}</span>
            <button type="button" onClick={() => onChange(line.finishing.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove add-on"><X size={14} /></button>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-1">
        {FINISHING_ADDONS.map((f) => (
          <button key={f.code} type="button" onClick={() => add(f.code)} className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-500 hover:text-blue-600">
            + {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PrintJobForm({ slug, initial }: { slug: string; initial?: PrintJobFormInitial }) {
  const router = useRouter()
  const { fCurrency } = useCurrency()
  const editing = !!initial
  const [saving, setSaving] = useState(false)
  const [customer, setCustomer] = useState({ customerId: initial?.customerId || null, name: initial?.customerName || '', phone: initial?.customerPhone || '' })
  const [title, setTitle] = useState(initial?.title || '')
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || '')
  const [receivedAt, setReceivedAt] = useState(toLocalInput(initial?.receivedAt || new Date().toISOString()))
  const [dueAt, setDueAt] = useState(toLocalInput(initial?.dueAt))
  const [isUrgent, setIsUrgent] = useState(initial?.isUrgent || false)
  // Walk-in (no customer picked): link / create the customer by phone on booking
  const [saveCustomer, setSaveCustomer] = useState(true)
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo || '')
  const [discount, setDiscount] = useState(initial ? String(parseFloat(initial.discountAmount) || '') : '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [proofStatus, setProofStatus] = useState(initial?.proofStatus || 'not_needed')
  const [proofFiles, setProofFiles] = useState(initial?.proofFiles || [])
  const [proofNote, setProofNote] = useState(initial?.proofNote || '')
  const [proofUrl, setProofUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [lines, setLines] = useState<PrintJobLineState[]>(initial?.lines?.length ? initial.lines.map(lineFromInitial) : [emptyLine()])
  const [advance, setAdvance] = useState({ amount: '', method: 'cash', reference: '' })
  const [staff, setStaff] = useState<Array<{ id: string; fullName: string; role: string }>>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/users?activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setStaff(Array.isArray(d) ? d : d.data || [])).catch(() => {})
  }, [])

  const calcs = useMemo(() => lines.map(lineCalc), [lines])
  const subtotal = calcs.reduce((s, c) => s + c.amount, 0)
  const discountNum = Math.min(parseFloat(discount) || 0, subtotal)
  const net = Math.max(0, subtotal - discountNum)

  const setLine = (key: string, patch: Partial<PrintJobLineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function quickDue(hours: number | 'tomorrow') {
    const d = new Date()
    if (hours === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0) } else d.setTime(d.getTime() + hours * 3600_000)
    setDueAt(toLocalInput(d.toISOString()))
  }

  async function uploadProof(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    try {
      const added: typeof proofFiles = []
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('category', 'print_proof')
        if (initial?.id) { fd.append('attachedToType', 'print_job'); fd.append('attachedToId', initial.id) }
        const res = await fetch('/api/files', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || `Could not upload ${file.name}`); continue }
        added.push({ url: data.fileUrl, name: data.fileName || file.name, fileId: data.id, addedAt: new Date().toISOString() })
      }
      if (added.length) {
        setProofFiles((p) => [...p, ...added])
        if (proofStatus === 'not_needed') setProofStatus('pending')
      }
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function addProofUrl() {
    const url = proofUrl.trim()
    if (!url) return
    setProofFiles((p) => [...p, { url, name: url.split('/').pop() || url, addedAt: new Date().toISOString() }])
    setProofUrl('')
    if (proofStatus === 'not_needed') setProofStatus('pending')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!customer.name.trim()) return toast.error('Enter the customer name')
    if (!title.trim()) return toast.error('Enter a job title')
    const valid = lines.filter((l) => l.description.trim())
    if (valid.length === 0) return toast.error('Add at least one line')
    for (const l of valid) {
      if (l.pricingMode === 'area' && !(parseFloat(l.width) > 0 && parseFloat(l.height) > 0)) return toast.error(`Enter width × height for "${l.description}"`)
      if (l.pricingMode === 'length' && !(parseFloat(l.width) > 0)) return toast.error(`Enter the length for "${l.description}"`)
      if (!(parseFloat(l.quantity) > 0)) return toast.error(`Quantity must be more than 0 for "${l.description}"`)
    }
    const payload = {
      customerId: customer.customerId || undefined,
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim() || undefined,
      title: title.trim(),
      warehouseId: warehouseId || undefined,
      receivedAt: fromLocalInput(receivedAt) || undefined,
      dueAt: fromLocalInput(dueAt) || undefined,
      isUrgent,
      assignedTo: assignedTo || undefined,
      discountAmount: parseFloat(discount) || 0,
      notes: notes.trim() || undefined,
      proofStatus,
      proofFiles,
      proofNote: proofNote.trim() || undefined,
      lines: valid.map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        pricingMode: l.pricingMode,
        width: parseFloat(l.width) || undefined,
        height: parseFloat(l.height) || undefined,
        sizeUnit: l.width || l.height ? l.sizeUnit : undefined,
        quantity: parseFloat(l.quantity),
        material: l.material.trim() || undefined,
        sides: l.sides,
        areaUnit: l.areaUnit,
        minChargeArea: parseFloat(l.minChargeArea) || undefined,
        rate: parseFloat(l.rate) || 0,
        finishing: l.finishing.map((f) => ({ code: f.code, label: f.label || undefined, rate: f.rate || 0, count: f.count ?? undefined })),
        notes: l.notes.trim() || undefined,
      })),
      ...(editing ? {} : { saveCustomer }),
      ...(editing
        ? { expectedUpdatedAt: initial!.updatedAt }
        : parseFloat(advance.amount) > 0
          ? { advance: { amount: parseFloat(advance.amount), paymentMethod: advance.method, reference: advance.reference.trim() || undefined } }
          : {}),
    }
    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/print-jobs/${initial!.id}` : '/api/print-jobs', {
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
      toast.success(editing ? 'Job updated' : `Job ${data.jobNo} booked`)
      router.push(`/c/${slug}/print-jobs/${data.id}`)
    } catch {
      toast.error('Could not save the job')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-24">
      {/* Customer & job */}
      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Customer &amp; job</h2>
        <CustomerFields customerId={customer.customerId} name={customer.name} phone={customer.phone} onChange={(v) => setCustomer({ customerId: v.customerId, name: v.name, phone: v.phone })} />
        {!editing && !customer.customerId && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} className="h-4 w-4" />
            Save as a customer (matches an existing customer with this phone number)
          </label>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Job title *</label>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shop banner 10×4 + 200 visiting cards" />
          </div>
          <BranchSelect value={warehouseId} onChange={setWarehouseId} />
          <div>
            <label className={labelCls}>Designer / operator</label>
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
            <label className={labelCls}>Due</label>
            <input type="datetime-local" className={inputCls} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <div className="flex gap-1 mt-1">
              {[{ l: '+2h', v: 2 }, { l: '+4h', v: 4 }, { l: 'Tomorrow 5pm', v: 'tomorrow' as const }].map((q) => (
                <button key={q.l} type="button" onClick={() => quickDue(q.v)} className="px-1.5 py-0.5 text-[11px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-500">{q.l}</button>
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

      {/* Lines */}
      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Items &amp; sizes</h2>
          <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"><Plus size={14} /> Add line</button>
        </div>
        {lines.map((l, idx) => {
          const c = calcs[idx]
          const unitLabel = l.pricingMode === 'length' ? LENGTH_UNIT_LABEL[l.areaUnit] : AREA_UNIT_LABEL[l.areaUnit]
          return (
            <div key={l.key} className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-4">
                  <label className={labelCls}>Item</label>
                  <ItemPicker
                    value={l.itemName}
                    onClear={() => setLine(l.key, { itemId: null, itemName: null })}
                    onPick={(it) => setLine(l.key, {
                      itemId: it.id,
                      itemName: it.name,
                      description: l.description || it.name,
                      pricingMode: (it.pricingMode || 'unit') as PricingMode,
                      areaUnit: (it.areaUnit || 'sqft') as AreaUnit,
                      minChargeArea: it.minChargeArea ? String(parseFloat(it.minChargeArea)) : '',
                      rate: String(parseFloat(it.sellingPrice || '0')),
                      sizeUnit: it.pricingMode === 'area' || it.pricingMode === 'length' ? (it.areaUnit === 'sqm' ? 'm' : 'ft') : l.sizeUnit,
                    })}
                  />
                </div>
                <div className="md:col-span-5">
                  <label className={labelCls}>Description *</label>
                  <input className={inputCls} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Flex banner / Photo print / Mug…" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Priced</label>
                  <select className={inputCls} value={l.pricingMode} disabled={!!l.itemId} onChange={(e) => setLine(l.key, { pricingMode: e.target.value as PricingMode })} title={l.itemId ? 'Set on the item' : undefined}>
                    <option value="unit">Per piece</option>
                    <option value="area">Per area</option>
                    <option value="length">Per length</option>
                  </select>
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={16} /></button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-1">
                  <label className={labelCls}>{l.pricingMode === 'length' ? 'Length' : 'Width'}</label>
                  <input type="number" min={0} step="0.01" className={inputCls} value={l.width} onChange={(e) => setLine(l.key, { width: e.target.value })} />
                </div>
                {l.pricingMode !== 'length' && (
                  <div className="md:col-span-1">
                    <label className={labelCls}>Height</label>
                    <input type="number" min={0} step="0.01" className={inputCls} value={l.height} onChange={(e) => setLine(l.key, { height: e.target.value })} />
                  </div>
                )}
                <div className="md:col-span-1">
                  <label className={labelCls}>Unit</label>
                  <select className={inputCls} value={l.sizeUnit} onChange={(e) => setLine(l.key, { sizeUnit: e.target.value as SizeUnit })}>
                    {SIZE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Preset size</label>
                  <select
                    className={inputCls}
                    value=""
                    onChange={(e) => {
                      const p = SIZE_PRESETS.find((x) => x.code === e.target.value)
                      if (p) setLine(l.key, { width: String(p.width), height: String(p.height), sizeUnit: p.unit })
                    }}
                  >
                    <option value="">Choose…</option>
                    <optgroup label="Photo / frame">{SIZE_PRESETS.filter((p) => p.group === 'photo').map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</optgroup>
                    <optgroup label="Paper">{SIZE_PRESETS.filter((p) => p.group === 'paper').map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</optgroup>
                  </select>
                </div>
                <div className="md:col-span-1">
                  <label className={labelCls}>Qty</label>
                  <input type="number" min={0} step="1" className={inputCls} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                </div>
                <div className="md:col-span-1">
                  <label className={labelCls}>Sides</label>
                  <select className={inputCls} value={l.sides} onChange={(e) => setLine(l.key, { sides: parseInt(e.target.value, 10) })}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Rate {l.pricingMode === 'unit' ? '/ piece' : `/ ${unitLabel}`}</label>
                  <input type="number" min={0} step="0.01" className={inputCls} value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                </div>
                {l.pricingMode !== 'unit' && (
                  <div className="md:col-span-1">
                    <label className={labelCls}>Area in</label>
                    <select className={inputCls} value={l.areaUnit} disabled={!!l.itemId} onChange={(e) => setLine(l.key, { areaUnit: e.target.value as AreaUnit })}>
                      <option value="sqft">sq ft</option>
                      <option value="sqm">sq m</option>
                    </select>
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className={labelCls}>Material / media</label>
                  <input className={inputCls} list="print-materials" value={l.material} onChange={(e) => setLine(l.key, { material: e.target.value })} placeholder="Flex, vinyl, canvas…" />
                </div>
              </div>

              <FinishingEditor line={l} unitLabel={AREA_UNIT_LABEL[l.areaUnit]} onChange={(f) => setLine(l.key, { finishing: f })} />

              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300 border-t border-dashed dark:border-gray-700 pt-2">
                <input className={`${inputCls} flex-1 min-w-[12rem]`} value={l.notes} onChange={(e) => setLine(l.key, { notes: e.target.value })} placeholder="Line notes for production (bleed, colours, cut marks…)" />
                {c.areaPerPiece > 0 && <span>Area: <b>{c.areaPerPiece}</b> {AREA_UNIT_LABEL[l.areaUnit]}/pc</span>}
                {l.pricingMode !== 'unit' && <span>Billable: <b>{c.billQty}</b> {unitLabel}{c.minChargeApplied ? <span className="text-amber-600"> (min. charge)</span> : null}</span>}
                <span>Print: <b>{c.baseAmount.toFixed(2)}</b></span>
                {c.finishingAmount > 0 && <span>Finishing: <b>{c.finishingAmount.toFixed(2)}</b></span>}
                <span className="text-sm text-gray-900 dark:text-white">Line: <b>{fCurrency(c.amount)}</b></span>
              </div>
            </div>
          )
        })}
        <datalist id="print-materials">{PRINT_MATERIALS.map((m) => <option key={m} value={m} />)}</datalist>
      </section>

      {/* Proof */}
      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Design files &amp; proof</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Proof status</label>
            <select className={inputCls} value={proofStatus} onChange={(e) => setProofStatus(e.target.value)}>
              {Object.entries(PROOF_STATUS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Customer approval / change note</label>
            <input className={inputCls} value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="e.g. Approved by phone — make logo bigger" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={uploadProof} accept="image/*,application/pdf" />
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:border-blue-500 disabled:opacity-50">
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload file'}
          </button>
          <div className="flex items-center gap-1 flex-1 min-w-[16rem]">
            <Link2 size={14} className="text-gray-400" />
            <input className={inputCls} value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="…or paste a link (Drive, WhatsApp, Canva)" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProofUrl() } }} />
            <button type="button" onClick={addProofUrl} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700">Add</button>
          </div>
        </div>
        {proofFiles.length > 0 && (
          <ul className="text-sm space-y-1">
            {proofFiles.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline truncate">{f.name || f.url}</a>
                <button type="button" onClick={() => setProofFiles((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove file"><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Totals & advance */}
      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className={`${inputCls} h-20 py-1.5`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery, installation, special instructions…" />
          </div>
          {!editing && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Advance</label>
                <input type="number" min={0} step="0.01" className={inputCls} value={advance.amount} onChange={(e) => setAdvance({ ...advance, amount: e.target.value })} placeholder="0.00" />
              </div>
              <div>
                <label className={labelCls}>Method</label>
                <select className={inputCls} value={advance.method} onChange={(e) => setAdvance({ ...advance, method: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Reference</label>
                <input className={inputCls} value={advance.reference} onChange={(e) => setAdvance({ ...advance, reference: e.target.value })} />
              </div>
              <div className="col-span-3 flex gap-1">
                {[25, 50, 100].map((pct) => (
                  <button key={pct} type="button" onClick={() => setAdvance({ ...advance, amount: (Math.round(net * pct) / 100).toFixed(2) })} className="px-2 py-0.5 text-[11px] rounded border border-gray-300 dark:border-gray-600 hover:border-blue-500">{pct}%</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Subtotal</span><span>{fCurrency(subtotal)}</span></div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-gray-600 dark:text-gray-300">Discount</span>
            <input type="number" min={0} step="0.01" className={`${inputCls} w-32 text-right`} value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="flex justify-between text-xs text-gray-500"><span>Tax</span><span>per your tax setup, on save</span></div>
          <div className="flex justify-between text-base font-semibold border-t dark:border-gray-700 pt-1.5"><span>Total (before tax)</span><span>{fCurrency(net)}</span></div>
          {!editing && parseFloat(advance.amount) > 0 && (
            <div className="flex justify-between text-gray-600 dark:text-gray-300"><span>Balance after advance</span><span>{fCurrency(Math.max(0, net - (parseFloat(advance.amount) || 0)))}</span></div>
          )}
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 md:left-auto md:right-6 md:bottom-4 z-30 flex justify-end gap-2 p-3 md:p-0 bg-white/90 dark:bg-gray-900/90 md:bg-transparent">
        <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">Cancel</button>
        <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Book job'}
        </button>
      </div>
    </form>
  )
}
