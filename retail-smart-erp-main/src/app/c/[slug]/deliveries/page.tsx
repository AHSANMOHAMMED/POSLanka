'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, MapPin, Phone, Plus, Printer, RefreshCw, Search, Truck, Wrench } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks/useCurrency'
import { useDateFormat, useTerminology } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { BranchSelect } from '@/components/ui/branch-select'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { DELIVERY_STATUS_COLORS, DELIVERY_STATUS_LABELS, DELIVERY_TIME_SLOTS } from '@/lib/installments/constants'
import { addDays } from '@/lib/installments/schedule'
import { companyHeader, esc, money, openPrint } from '@/lib/installments/print'

interface ItemLine { itemId?: string | null; saleItemId?: string | null; itemName: string; quantity: number; unitPrice: number; serialNumbers?: string[] }
interface Delivery {
  id: string; deliveryNo: string; saleId: string | null; invoiceNo: string | null; installmentPlanId: string | null; planNo: string | null
  customerName: string; customerPhone: string | null; address: string; city: string | null; scheduledDate: string; timeSlot: string | null
  vehicleNo: string | null; driverId: string | null; driverName: string | null; installationRequired: boolean; technicianId: string | null; technicianName: string | null
  items: ItemLine[]; deliveryCharge: string; status: string; recipientName: string | null; recipientPhone: string | null
  proofNotes: string | null; proofPhotoUrl: string | null; failureReason: string | null; notes: string | null; warehouseName: string | null
}
interface Staff { id: string; fullName: string; role: string }

const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

export default function DeliveriesPage() {
  const t = useTerminology()
  const searchParams = useSearchParams()
  const { fDate } = useDateFormat()
  const { currencySymbol } = useCurrency()
  const [date, setDate] = useState(todayLocal())
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<Staff[]>([])
  const [createOpen, setCreateOpen] = useState(!!searchParams.get('planId') || !!searchParams.get('invoiceNo'))
  const [proofFor, setProofFor] = useState<{ d: Delivery; status: 'delivered' | 'installed' | 'failed' } | null>(null)
  const [editFor, setEditFor] = useState<Delivery | null>(null)

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: '200' })
    if (search.trim()) qs.set('search', search.trim())
    else qs.set('date', date)
    if (status) qs.set('status', status)
    try {
      const res = await fetch(`/api/deliveries?${qs}`)
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to load deliveries'); return }
      setRows(data.data)
    } finally { setLoading(false) }
  }, [date, status, search])
  useRealtimeData(load, { entityType: 'delivery', refreshOnMount: false })
  // reload when the day, status or search changes (search debounced)
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  useEffect(() => {
    fetch('/api/users?activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setStaff(Array.isArray(d) ? d : d.data || [])).catch(() => {})
  }, [])

  async function setStatusOf(d: Delivery, next: string) {
    const res = await fetch(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Could not update'); return }
    toast.success(`${d.deliveryNo}: ${DELIVERY_STATUS_LABELS[next]}`)
    load()
  }

  async function printNote(d: Delivery) {
    const res = await fetch(`/api/deliveries/${d.id}`)
    const full = await res.json()
    if (!res.ok) { toast.error(full.error || 'Could not load'); return }
    const goods = (full.items as ItemLine[]).map((i) => `<tr><td>${esc(i.itemName)}</td><td class="n">${esc(i.quantity)}</td><td>${esc((i.serialNumbers || []).join(', '))}</td><td style="width:70px"></td></tr>`).join('')
    const ok = openPrint(`Delivery note ${full.deliveryNo}`, `
      ${companyHeader(full.company, 'Delivery Note', full.deliveryNo, `${fDate(full.scheduledDate)}${full.timeSlot ? ` · ${full.timeSlot}` : ''}`)}
      <div class="grid">
        <div class="box"><h3>Deliver to</h3><div><b>${esc(full.customerName)}</b></div><div>${esc(full.address)}${full.city ? `, ${esc(full.city)}` : ''}</div><div>Tel: ${esc(full.customerPhone)}</div></div>
        <div class="box"><h3>Details</h3>
          ${full.invoiceNo ? `<div>Invoice: <b>${esc(full.invoiceNo)}</b></div>` : ''}${full.planNo ? `<div>Hire purchase: ${esc(full.planNo)}</div>` : ''}
          <div>Vehicle: ${esc(full.vehicleNo || '—')}</div><div>Driver: ${esc(full.driverName || '—')}</div>
          ${full.installationRequired ? `<div>Installation: <b>Yes</b> — ${esc(full.technicianName || 'technician to be assigned')}</div>` : ''}
          ${Number(full.deliveryCharge) ? `<div>Delivery charge: ${money(full.deliveryCharge, currencySymbol)}</div>` : ''}
        </div>
      </div>
      <table><thead><tr><th>Item</th><th class="n">Qty</th><th>Serial / IMEI</th><th>Checked</th></tr></thead><tbody>${goods || '<tr><td colspan="4">As per invoice</td></tr>'}</tbody></table>
      ${full.notes ? `<div class="box">${esc(full.notes)}</div>` : ''}
      <p>Received the above goods in good condition${full.installationRequired ? ', installed and demonstrated' : ''}.</p>
      <div class="grid"><div>Name: ____________________________</div><div>NIC: ____________________________</div></div>
      <div class="sig"><div>Customer signature</div><div>Driver</div><div>${full.installationRequired ? 'Technician' : 'Store'}</div></div>
    `)
    if (!ok) toast.error('Allow pop-ups to print')
  }

  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {})

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="text-xs text-gray-500">{t.sellingModule}</div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Truck size={20} />Deliveries & Installation</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="p-2 border rounded dark:border-gray-600" aria-label="Previous day"><ChevronLeft size={16} /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="px-2 py-1.5 border rounded text-sm dark:bg-gray-700 dark:border-gray-600" />
          <button onClick={() => setDate(addDays(date, 1))} className="p-2 border rounded dark:border-gray-600" aria-label="Next day"><ChevronRight size={16} /></button>
          {date !== todayLocal() && <button onClick={() => setDate(todayLocal())} className="px-2 py-1.5 text-sm text-blue-600">Today</button>}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1.5 border rounded text-sm dark:bg-gray-700 dark:border-gray-600">
            <option value="">All statuses</option><option value="open">Open</option>
            {Object.entries(DELIVERY_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div className="relative"><Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all dates…" className="pl-7 pr-2 py-1.5 border rounded text-sm w-48 dark:bg-gray-700 dark:border-gray-600" /></div>
          <button onClick={load} className="p-2 border rounded dark:border-gray-600" aria-label="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => setCreateOpen(true)} className="px-3 py-2 rounded bg-blue-600 text-white text-sm flex items-center gap-1"><Plus size={15} />Schedule delivery</button>
        </div>
      </div>

      {!search && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">{fDate(date)} · {rows.length} deliveries</span>
          {Object.entries(counts).map(([k, n]) => <span key={k} className={`px-2 py-1 rounded ${DELIVERY_STATUS_COLORS[k]}`}>{DELIVERY_STATUS_LABELS[k]} {n}</span>)}
        </div>
      )}

      {loading ? <div className="text-center text-gray-500 py-10">Loading…</div> : rows.length === 0 ? (
        <div className="text-center text-gray-500 py-10 bg-white dark:bg-gray-800 rounded border dark:border-gray-700">No deliveries {search ? 'match your search' : `scheduled for ${fDate(date)}`}.</div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((d) => (
            <div key={d.id} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-3 space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">{d.deliveryNo}</div>
                  <div className="text-xs text-gray-500">{fDate(d.scheduledDate)}{d.timeSlot ? ` · ${d.timeSlot}` : ''}{d.invoiceNo ? ` · ${d.invoiceNo}` : ''}{d.planNo ? ` · ${d.planNo}` : ''}</div>
                </div>
                <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${DELIVERY_STATUS_COLORS[d.status]}`}>{DELIVERY_STATUS_LABELS[d.status]}</span>
              </div>
              <div>
                <div className="font-medium">{d.customerName}</div>
                <div className="flex items-start gap-1 text-gray-600 dark:text-gray-300"><MapPin size={13} className="mt-0.5 shrink-0" />{d.address}{d.city ? `, ${d.city}` : ''}</div>
                {d.customerPhone && <a href={`tel:${d.customerPhone}`} className="flex items-center gap-1 text-blue-600"><Phone size={13} />{d.customerPhone}</a>}
              </div>
              {d.items.length > 0 && <div className="text-gray-600 dark:text-gray-300">{d.items.map((i) => `${i.quantity} × ${i.itemName}`).join(', ')}</div>}
              <div className="text-xs text-gray-500 flex flex-wrap gap-x-3">
                <span><Truck size={12} className="inline mr-0.5" />{d.vehicleNo || 'No vehicle'} · {d.driverName || 'No driver'}</span>
                {d.installationRequired && <span><Wrench size={12} className="inline mr-0.5" />Install: {d.technicianName || 'unassigned'}</span>}
              </div>
              {d.failureReason && d.status === 'failed' && <div className="text-xs text-red-600">Failed: {d.failureReason}</div>}
              {d.recipientName && <div className="text-xs text-green-700 dark:text-green-400">Received by {d.recipientName}{d.proofNotes ? ` — ${d.proofNotes}` : ''}</div>}
              <div className="flex flex-wrap gap-1 pt-1">
                {d.status === 'scheduled' && <Btn onClick={() => setStatusOf(d, 'out_for_delivery')}>Out for delivery</Btn>}
                {(d.status === 'scheduled' || d.status === 'out_for_delivery') && <Btn tone="green" onClick={() => setProofFor({ d, status: 'delivered' })}>Delivered</Btn>}
                {d.status === 'delivered' && d.installationRequired && <Btn tone="green" onClick={() => setProofFor({ d, status: 'installed' })}>Installed</Btn>}
                {(d.status === 'scheduled' || d.status === 'out_for_delivery') && <Btn tone="red" onClick={() => setProofFor({ d, status: 'failed' })}>Failed</Btn>}
                {(d.status === 'failed' || d.status === 'out_for_delivery') && <Btn onClick={() => setEditFor(d)}>Reschedule</Btn>}
                {d.status === 'scheduled' && <Btn onClick={() => setEditFor(d)}>Edit</Btn>}
                {(d.status === 'scheduled' || d.status === 'failed') && <Btn onClick={() => { if (confirm(`Cancel delivery ${d.deliveryNo}?`)) setStatusOf(d, 'cancelled') }}>Cancel</Btn>}
                <Btn onClick={() => printNote(d)}><Printer size={13} className="inline mr-0.5" />Note</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && <CreateDeliveryModal staff={staff} defaultDate={date} planId={searchParams.get('planId')} invoiceNo={searchParams.get('invoiceNo')}
        onClose={() => setCreateOpen(false)} onCreated={(d) => { setCreateOpen(false); setSearch(''); setDate(d); load() }} />}
      {proofFor && <ProofModal d={proofFor.d} status={proofFor.status} onClose={() => setProofFor(null)} onDone={() => { setProofFor(null); load() }} />}
      {editFor && <EditDeliveryModal d={editFor} staff={staff} onClose={() => setEditFor(null)} onDone={() => { setEditFor(null); load() }} />}
    </div>
  )
}

function Btn({ children, onClick, tone }: { children: ReactNode; onClick: () => void; tone?: 'green' | 'red' }) {
  const cls = tone === 'green' ? 'bg-green-600 text-white border-green-600' : tone === 'red' ? 'text-red-600 border-red-300' : 'dark:border-gray-600'
  return <button onClick={onClick} className={`px-2 py-1 text-xs rounded border ${cls}`}>{children}</button>
}

function StaffSelect({ staff, value, onChange, prefer }: { staff: Staff[]; value: string; onChange: (v: string) => void; prefer?: string }) {
  const sorted = [...staff].sort((a, b) => (a.role === prefer ? -1 : 0) - (b.role === prefer ? -1 : 0) || a.fullName.localeCompare(b.fullName))
  return (
    <FormSelect value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Not assigned —</option>
      {sorted.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
    </FormSelect>
  )
}

function CreateDeliveryModal({ staff, defaultDate, planId, invoiceNo: initialInvoice, onClose, onCreated }: {
  staff: Staff[]; defaultDate: string; planId: string | null; invoiceNo: string | null; onClose: () => void; onCreated: (date: string) => void
}) {
  const [invoiceNo, setInvoiceNo] = useState(initialInvoice || '')
  const [saleId, setSaleId] = useState<string | null>(null)
  const [saleLabel, setSaleLabel] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [scheduledDate, setScheduledDate] = useState(defaultDate)
  const [timeSlot, setTimeSlot] = useState(DELIVERY_TIME_SLOTS[0])
  const [vehicleNo, setVehicleNo] = useState('')
  const [driverId, setDriverId] = useState('')
  const [install, setInstall] = useState(false)
  const [technicianId, setTechnicianId] = useState('')
  const [charge, setCharge] = useState('0')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemLine[]>([])
  const [saving, setSaving] = useState(false)

  async function lookup(no?: string) {
    const q = (no ?? invoiceNo).trim()
    if (!q) return
    const res = await fetch(`/api/deliveries/sale-lookup?invoiceNo=${encodeURIComponent(q)}`)
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Sale not found'); return }
    const s = data.sale
    setSaleId(s.id)
    setSaleLabel(`${s.invoiceNo} · ${s.customerName || 'Walk-in'}`)
    setCustomerId(s.customerId)
    setCustomerName(s.customerName || '')
    setCustomerPhone(s.customerPhone || '')
    setAddress(s.customerAddress || '')
    setItems(s.lines.map((l: { itemId: string | null; saleItemId: string; itemName: string; quantity: number; unitPrice: number; serialNumbers: Array<{ serialNumber: string }> }) => ({
      itemId: l.itemId, saleItemId: l.saleItemId, itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice,
      serialNumbers: l.serialNumbers.map((x) => x.serialNumber),
    })))
  }

  useEffect(() => {
    if (initialInvoice) { lookup(initialInvoice); return }
    if (!planId) return
    fetch(`/api/installments/${planId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return
      const p = d.plan
      setSaleLabel(`${p.planNo}${p.invoiceNo ? ` · ${p.invoiceNo}` : ''}`)
      setCustomerName(p.customerName); setCustomerPhone(p.customerPhone || ''); setAddress(p.customerAddress || '')
      setItems(p.items || [])
      setInstall(true)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    if (!customerName.trim() || address.trim().length < 3) { toast.error('Enter the customer and the delivery address'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId, installmentPlanId: planId || null, warehouseId: saleId || planId ? null : warehouseId || null, customerId,
          customerName, customerPhone, address, city, scheduledDate, timeSlot, vehicleNo,
          driverId: driverId || null, installationRequired: install, technicianId: install ? technicianId || null : null,
          items, deliveryCharge: Number(charge) || 0, notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not schedule'); return }
      toast.success(`Delivery ${data.deliveryNo} scheduled`)
      onCreated(scheduledDate)
    } finally { setSaving(false) }
  }

  return (
    <Modal isOpen onClose={onClose} title="Schedule delivery" size="lg" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Cancel</button>
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Schedule'}</button></div>
    }>
      <div className="space-y-3 text-sm">
        {saleLabel ? <div className="rounded bg-blue-50 dark:bg-blue-900/30 p-2">For {saleLabel}</div> : (
          <div className="flex gap-2">
            <FormInput value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Invoice number (optional)" onKeyDown={(e) => { if (e.key === 'Enter') lookup() }} />
            <button onClick={() => lookup()} className="px-3 rounded border dark:border-gray-600"><Search size={14} /></button>
          </div>
        )}
        {!saleId && !planId && <BranchSelect value={warehouseId} onChange={setWarehouseId} />}
        <div className="grid grid-cols-2 gap-2">
          <div><FormLabel required>Customer</FormLabel><FormInput value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
          <div><FormLabel>Phone</FormLabel><FormInput value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><FormLabel required>Address</FormLabel><FormTextarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div><FormLabel>City / area</FormLabel><FormInput value={city} onChange={(e) => setCity(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><FormLabel required>Date</FormLabel><FormInput type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} /></div>
          <div><FormLabel>Time slot</FormLabel><FormSelect value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)}>{DELIVERY_TIME_SLOTS.map((s) => <option key={s}>{s}</option>)}</FormSelect></div>
          <div><FormLabel>Vehicle no</FormLabel><FormInput value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="LB-1234" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><FormLabel>Driver</FormLabel><StaffSelect staff={staff} value={driverId} onChange={setDriverId} /></div>
          <div><FormLabel>Delivery charge</FormLabel><FormInput type="number" min={0} value={charge} onChange={(e) => setCharge(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={install} onChange={(e) => setInstall(e.target.checked)} />Installation required (AC, TV wall mount, washing machine …)</label>
        {install && <div><FormLabel>Technician</FormLabel><StaffSelect staff={staff} value={technicianId} onChange={setTechnicianId} prefer="technician" /></div>}
        {items.length > 0 && (
          <div className="rounded border dark:border-gray-700 p-2">
            {items.map((i, n) => <div key={n}>{i.quantity} × {i.itemName}{i.serialNumbers?.length ? <span className="text-xs text-gray-500"> · {i.serialNumbers.join(', ')}</span> : null}</div>)}
          </div>
        )}
        <div><FormLabel>Notes</FormLabel><FormTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Landmark, floor, call before arriving…" /></div>
      </div>
    </Modal>
  )
}

function ProofModal({ d, status, onClose, onDone }: { d: Delivery; status: 'delivered' | 'installed' | 'failed'; onClose: () => void; onDone: () => void }) {
  const [recipientName, setRecipientName] = useState(d.recipientName || d.customerName)
  const [recipientPhone, setRecipientPhone] = useState(d.recipientPhone || '')
  const [proofNotes, setProofNotes] = useState(d.proofNotes || '')
  const [proofPhotoUrl, setProofPhotoUrl] = useState(d.proofPhotoUrl || '')
  const [failureReason, setFailureReason] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      const body = status === 'failed'
        ? { status, failureReason }
        : { status, recipientName, recipientPhone, proofNotes, proofPhotoUrl: proofPhotoUrl || null }
      const res = await fetch(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not update'); return }
      toast.success(`${d.deliveryNo}: ${DELIVERY_STATUS_LABELS[status]}`)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`${d.deliveryNo} — ${DELIVERY_STATUS_LABELS[status]}`} size="sm" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Back</button>
        <button onClick={save} disabled={saving} className={`px-3 py-2 rounded text-white text-sm disabled:opacity-50 ${status === 'failed' ? 'bg-red-600' : 'bg-green-600'}`}>Save</button></div>
    }>
      {status === 'failed' ? (
        <div><FormLabel required>Why did it fail?</FormLabel><FormTextarea rows={3} value={failureReason} onChange={(e) => setFailureReason(e.target.value)} placeholder="Customer not home, wrong address, access problem…" /></div>
      ) : (
        <div className="space-y-2">
          <div><FormLabel required>Received by</FormLabel><FormInput value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></div>
          <div><FormLabel>Recipient phone / NIC</FormLabel><FormInput value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} /></div>
          <div><FormLabel>Notes (condition, demo given…)</FormLabel><FormTextarea rows={2} value={proofNotes} onChange={(e) => setProofNotes(e.target.value)} /></div>
          <div><FormLabel>Photo link (optional)</FormLabel><FormInput value={proofPhotoUrl} onChange={(e) => setProofPhotoUrl(e.target.value)} placeholder="https://…" /></div>
        </div>
      )}
    </Modal>
  )
}

function EditDeliveryModal({ d, staff, onClose, onDone }: { d: Delivery; staff: Staff[]; onClose: () => void; onDone: () => void }) {
  const [scheduledDate, setScheduledDate] = useState(d.scheduledDate)
  const [timeSlot, setTimeSlot] = useState(d.timeSlot || DELIVERY_TIME_SLOTS[0])
  const [vehicleNo, setVehicleNo] = useState(d.vehicleNo || '')
  const [driverId, setDriverId] = useState(d.driverId || '')
  const [technicianId, setTechnicianId] = useState(d.technicianId || '')
  const [address, setAddress] = useState(d.address)
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { scheduledDate, timeSlot, vehicleNo, driverId: driverId || null, address }
      if (d.installationRequired) body.technicianId = technicianId || null
      if (d.status !== 'scheduled') body.status = 'scheduled'
      const res = await fetch(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not update'); return }
      toast.success(`${d.deliveryNo} updated`)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`${d.status === 'scheduled' ? 'Edit' : 'Reschedule'} ${d.deliveryNo}`} size="sm" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Back</button>
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">Save</button></div>
    }>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><FormLabel>Date</FormLabel><FormInput type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} /></div>
          <div><FormLabel>Time slot</FormLabel><FormSelect value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)}>{DELIVERY_TIME_SLOTS.map((s) => <option key={s}>{s}</option>)}</FormSelect></div>
        </div>
        <div><FormLabel>Address</FormLabel><FormTextarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><FormLabel>Vehicle</FormLabel><FormInput value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} /></div>
          <div><FormLabel>Driver</FormLabel><StaffSelect staff={staff} value={driverId} onChange={setDriverId} /></div>
        </div>
        {d.installationRequired && <div><FormLabel>Technician</FormLabel><StaffSelect staff={staff} value={technicianId} onChange={setTechnicianId} prefer="technician" /></div>}
      </div>
    </Modal>
  )
}
