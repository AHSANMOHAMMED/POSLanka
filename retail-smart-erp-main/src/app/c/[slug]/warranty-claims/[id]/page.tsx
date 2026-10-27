'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer, ShieldCheck, ShieldOff } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks/useCurrency'
import { useDateFormat, useTerminology } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { WARRANTY_RESOLUTIONS, WARRANTY_STATUS_COLORS, WARRANTY_STATUS_LABELS } from '@/lib/installments/constants'
import { companyHeader, esc, money, openPrint, type PrintCompany } from '@/lib/installments/print'

interface Claim {
  id: string; claimNo: string; status: string; itemName: string; serialNumber: string | null
  customerName: string; customerPhone: string | null; purchaseDate: string | null; warrantyUntil: string | null; inWarranty: boolean
  complaint: string; accessories: string | null; conditionNotes: string | null; technicianId: string | null; technicianName: string | null
  supplierId: string | null; supplierName: string | null; supplierRef: string | null; diagnosis: string | null; resolution: string | null
  replacementSerial: string | null; estimatedCharge: string; finalCharge: string; expectedDate: string | null; deliveredAt: string | null
  history: Array<{ status: string; at: string; by?: string | null; note?: string | null }>; notes: string | null
  invoiceNo: string | null; warehouseName: string | null; createdAt: string; nextStatuses: string[]; company: PrintCompany | null
}

export default function WarrantyClaimPage() {
  const { id } = useParams<{ id: string }>()
  const t = useTerminology()
  const { tenantSlug } = useCompany()
  const { fCurrency, currencySymbol } = useCurrency()
  const { fDate, fDateTime } = useDateFormat()
  const [c, setC] = useState<Claim | null>(null)
  const [missing, setMissing] = useState(false)
  const [staff, setStaff] = useState<Array<{ id: string; fullName: string }>>([])
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState<Record<string, string>>({})
  const [statusNote, setStatusNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/warranty-claims/${id}`)
    if (res.status === 404) { setMissing(true); return }
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Failed to load'); return }
    setC(data)
    setForm({
      technicianId: data.technicianId || '', supplierId: data.supplierId || '', supplierRef: data.supplierRef || '',
      diagnosis: data.diagnosis || '', resolution: data.resolution || '', replacementSerial: data.replacementSerial || '',
      estimatedCharge: String(Number(data.estimatedCharge) || 0), finalCharge: String(Number(data.finalCharge) || 0),
      expectedDate: data.expectedDate || '', notes: data.notes || '',
    })
  }, [id])
  useRealtimeData(load, { entityType: 'warranty-claim' })

  useEffect(() => {
    fetch('/api/users?activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setStaff(Array.isArray(d) ? d : d.data || [])).catch(() => {})
    fetch('/api/suppliers?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setSuppliers(Array.isArray(d) ? d : d.data || [])).catch(() => {})
  }, [])

  if (missing) return <div className="p-8 text-center text-gray-500">Claim not found. <Link className="text-blue-600" href={`/c/${tenantSlug}/warranty-claims`}>Back</Link></div>
  if (!c) return <PageLoading text="Loading claim..." />
  const closed = c.status === 'delivered'

  async function save(status?: string) {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        technicianId: form.technicianId || null, supplierId: form.supplierId || null, supplierRef: form.supplierRef,
        diagnosis: form.diagnosis, resolution: form.resolution || null, replacementSerial: form.replacementSerial,
        estimatedCharge: Number(form.estimatedCharge) || 0, finalCharge: Number(form.finalCharge) || 0,
        expectedDate: form.expectedDate || null, notes: form.notes,
      }
      if (closed) { for (const k of Object.keys(body)) if (k !== 'notes') delete body[k] }
      if (status) { body.status = status; body.statusNote = statusNote }
      const res = await fetch(`/api/warranty-claims/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not save'); return }
      toast.success(status ? `Claim ${WARRANTY_STATUS_LABELS[status].toLowerCase()}` : 'Saved')
      setStatusNote('')
      await load()
    } finally { setSaving(false) }
  }

  function printSheet(kind: 'receipt' | 'jobsheet') {
    if (!c) return
    const charge = Number(c.finalCharge) || Number(c.estimatedCharge)
    const ok = openPrint(`${c.claimNo}`, `
      ${companyHeader(c.company, kind === 'receipt' ? 'Service Receipt' : 'Service Job Sheet', c.claimNo, fDateTime(c.createdAt))}
      <div class="grid">
        <div class="box"><h3>Customer</h3><div><b>${esc(c.customerName)}</b></div><div>Tel: ${esc(c.customerPhone)}</div>${c.invoiceNo ? `<div>Invoice: ${esc(c.invoiceNo)}${c.purchaseDate ? ` (${esc(fDate(c.purchaseDate))})` : ''}</div>` : ''}</div>
        <div class="box"><h3>Unit</h3><div><b>${esc(c.itemName)}</b></div><div>${esc(t.serialNumber || 'Serial')}: ${esc(c.serialNumber || '—')}</div>
          <div><span class="badge">${c.inWarranty ? 'IN WARRANTY' : 'OUT OF WARRANTY'}</span>${c.warrantyUntil ? ` until ${esc(fDate(c.warrantyUntil))}` : ''}</div></div>
      </div>
      <h3>Complaint</h3><div class="box" style="white-space:pre-wrap">${esc(c.complaint)}</div>
      <div class="grid"><div><b>Accessories:</b> ${esc(c.accessories || 'None')}</div><div><b>Condition:</b> ${esc(c.conditionNotes || '—')}</div></div>
      ${c.expectedDate ? `<div><b>Expected ready:</b> ${esc(fDate(c.expectedDate))}</div>` : ''}
      ${!c.inWarranty && charge ? `<div><b>${Number(c.finalCharge) ? 'Charge' : 'Estimated charge'}:</b> ${money(charge, currencySymbol)}</div>` : ''}
      ${kind === 'jobsheet' ? `
        <div><b>Technician:</b> ${esc(c.technicianName || '—')}${c.supplierName ? ` · <b>Sent to:</b> ${esc(c.supplierName)} ${esc(c.supplierRef || '')}` : ''}</div>
        <h3>Diagnosis / work done</h3><div class="box" style="min-height:80px;white-space:pre-wrap">${esc(c.diagnosis || '')}</div>
        ${c.resolution ? `<div><b>Resolution:</b> ${esc(WARRANTY_RESOLUTIONS.find(([k]) => k === c.resolution)?.[1] || c.resolution)}${c.replacementSerial ? ` — new unit ${esc(c.replacementSerial)}` : ''}</div>` : ''}
        <div class="sig"><div>Technician</div><div>Checked by</div><div>Customer (collected)</div></div>
      ` : `
        <p class="small">Please bring this receipt to collect the unit. Units not collected within 90 days of the ready date may be disposed of. Out-of-warranty repairs are charged; warranty does not cover physical, liquid or power-surge damage.</p>
        <div class="sig"><div>Customer</div><div>Received by</div></div>
      `}
    `)
    if (!ok) toast.error('Allow pop-ups to print')
  }

  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/c/${tenantSlug}/warranty-claims`} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Back"><ArrowLeft size={18} /></Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{c.claimNo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${WARRANTY_STATUS_COLORS[c.status]}`}>{WARRANTY_STATUS_LABELS[c.status]}</span>
            {c.inWarranty
              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 text-xs"><ShieldCheck size={12} />In warranty{c.warrantyUntil ? ` until ${fDate(c.warrantyUntil)}` : ''}</span>
              : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 text-xs"><ShieldOff size={12} />Out of warranty{c.warrantyUntil ? ` (ended ${fDate(c.warrantyUntil)})` : ''}</span>}
          </div>
          <div className="text-sm text-gray-500">{c.itemName}{c.serialNumber ? ` · ${c.serialNumber}` : ''} · {c.customerName}{c.customerPhone ? ` · ${c.customerPhone}` : ''}</div>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => printSheet('receipt')} className="px-3 py-2 rounded border dark:border-gray-600 text-sm flex items-center gap-1"><Printer size={15} />Claim receipt</button>
          <button onClick={() => printSheet('jobsheet')} className="px-3 py-2 rounded border dark:border-gray-600 text-sm flex items-center gap-1"><Printer size={15} />Job sheet</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3 text-sm">
          <div><div className="text-xs text-gray-500">Complaint</div><div className="whitespace-pre-wrap">{c.complaint}</div></div>
          <div className="grid grid-cols-2 gap-2 text-gray-600 dark:text-gray-300">
            <div><span className="text-xs text-gray-500 block">Accessories</span>{c.accessories || '—'}</div>
            <div><span className="text-xs text-gray-500 block">Condition</span>{c.conditionNotes || '—'}</div>
            <div><span className="text-xs text-gray-500 block">Invoice</span>{c.invoiceNo || '—'}{c.purchaseDate ? ` · ${fDate(c.purchaseDate)}` : ''}</div>
            <div><span className="text-xs text-gray-500 block">Branch</span>{c.warehouseName || '—'}</div>
          </div>
          <hr className="dark:border-gray-700" />
          <div className="grid md:grid-cols-2 gap-3">
            <div><FormLabel>Technician</FormLabel><FormSelect value={form.technicianId} onChange={set('technicianId')} disabled={closed}>
              <option value="">— Not assigned —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </FormSelect></div>
            <div><FormLabel>Expected ready</FormLabel><FormInput type="date" value={form.expectedDate} onChange={set('expectedDate')} disabled={closed} /></div>
            <div><FormLabel>Supplier / service agent</FormLabel><FormSelect value={form.supplierId} onChange={set('supplierId')} disabled={closed}>
              <option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect></div>
            <div><FormLabel>Supplier job / RMA no</FormLabel><FormInput value={form.supplierRef} onChange={set('supplierRef')} disabled={closed} /></div>
          </div>
          <div><FormLabel>Diagnosis / work done</FormLabel><FormTextarea rows={3} value={form.diagnosis} onChange={set('diagnosis')} disabled={closed} /></div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><FormLabel>Resolution</FormLabel><FormSelect value={form.resolution} onChange={set('resolution')} disabled={closed}>
              <option value="">—</option>{WARRANTY_RESOLUTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </FormSelect></div>
            {form.resolution === 'replaced' && <div><FormLabel>Replacement {t.serialNumber || 'serial'}</FormLabel><FormInput value={form.replacementSerial} onChange={set('replacementSerial')} disabled={closed} /></div>}
            {!c.inWarranty && <div><FormLabel>Estimated charge</FormLabel><FormInput type="number" min={0} value={form.estimatedCharge} onChange={set('estimatedCharge')} disabled={closed} /></div>}
            <div><FormLabel>Final charge {c.inWarranty ? '(if not covered)' : ''}</FormLabel><FormInput type="number" min={0} value={form.finalCharge} onChange={set('finalCharge')} disabled={closed} /></div>
          </div>
          <div><FormLabel>Notes</FormLabel><FormTextarea rows={2} value={form.notes} onChange={set('notes')} /></div>
          {Number(form.finalCharge) > 0 && <p className="text-xs text-gray-500">Collect the charge at the POS as a service sale ({fCurrency(form.finalCharge)}).</p>}
          <div className="flex justify-end"><button onClick={() => save()} disabled={saving} className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50">Save</button></div>
        </section>

        <div className="space-y-4">
          {c.nextStatuses.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-2 text-sm">
              <h2 className="font-medium">Move to</h2>
              <FormInput value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Note (optional; reason when rejecting)" />
              <div className="flex flex-wrap gap-2">
                {c.nextStatuses.map((s) => (
                  <button key={s} onClick={() => save(s)} disabled={saving}
                    className={`px-2 py-1 rounded text-xs border ${s === 'rejected' ? 'border-red-300 text-red-600' : s === 'ready' || s === 'delivered' ? 'bg-green-600 border-green-600 text-white' : 'dark:border-gray-600'}`}>
                    {WARRANTY_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm">
            <h2 className="font-medium mb-2">History</h2>
            <ol className="space-y-2">
              {[...(c.history || [])].reverse().map((h, i) => (
                <li key={i} className="border-l-2 border-blue-400 pl-2">
                  <div className="font-medium">{WARRANTY_STATUS_LABELS[h.status] || h.status}</div>
                  <div className="text-xs text-gray-500">{fDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}</div>
                  {h.note && <div className="text-xs">{h.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
