'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Printer, Save } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface Line {
  saleItemId: string
  itemName: string
  quantity: string
  uom: string | null
  dosageInstructions: string | null
  genericName: string | null
  strength: string | null
  dosageForm: string | null
  drugSchedule: string | null
}
interface Data {
  sale: { id: string; invoiceNo: string; createdAt: string; customerName: string | null }
  pharmacy: { name: string; phone: string | null; address: string | null } | null
  prescription: { patientName: string | null; patientAge: string | null; doctorName: string; doctorRegNo: string | null; prescriptionNo: string | null } | null
  lines: Line[]
}

/** Common dose wordings (typed text is kept as it is) */
const DOSE_HINTS = [
  '1 tablet 3 times a day after meals',
  '1 tablet twice a day after meals',
  '1 tablet once a day at night',
  '1 capsule 3 times a day — finish the course',
  '5 ml 3 times a day',
  'Apply thinly twice a day',
  'When required for pain (max 4 a day)',
]

const esc = (s: string | null | undefined) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/** Dispensing labels for one bill: patient, medicine, dose instructions, quantity, date, pharmacy. */
export default function DispensingLabelsPage() {
  const { slug, saleId } = useParams<{ slug: string; saleId: string }>()
  const [data, setData] = useState<Data | null>(null)
  const [doses, setDoses] = useState<Record<string, string>>({})
  const [patient, setPatient] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [size, setSize] = useState<'70x40' | '50x30' | '100x50'>('70x40')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pharmacy/sales/${saleId}/dispensing`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the bill')
      const d = body as Data
      setData(d)
      setDoses(Object.fromEntries(d.lines.map((l) => [l.saleItemId, l.dosageInstructions || ''])))
      // Medicines are ticked; other lines (soap, plasters …) are not
      setSelected(Object.fromEntries(d.lines.map((l) => [l.saleItemId, !!(l.drugSchedule || l.genericName)])))
      setPatient(d.prescription?.patientName || d.sale.customerName || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the bill')
    }
  }, [saleId])

  useEffect(() => { void load() }, [load])

  async function save(): Promise<boolean> {
    if (!data) return false
    setSaving(true)
    try {
      const res = await fetch(`/api/pharmacy/sales/${saleId}/dispensing`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: data.lines.map((l) => ({ saleItemId: l.saleItemId, dosageInstructions: doses[l.saleItemId] ?? '' })) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error || 'Could not save'); return false }
      return true
    } finally {
      setSaving(false)
    }
  }

  async function print() {
    if (!data) return
    const lines = data.lines.filter((l) => selected[l.saleItemId])
    if (lines.length === 0) { toast.error('Tick at least one medicine'); return }
    if (!(await save())) return
    const [w, h] = size.split('x').map(Number)
    const date = new Date(data.sale.createdAt).toLocaleDateString()
    const rx = data.prescription
    const labels = lines.map((l) => `
      <div class="label">
        <div class="ph">${esc(data.pharmacy?.name)}${data.pharmacy?.phone ? ` · ${esc(data.pharmacy.phone)}` : ''}</div>
        <div class="pt">${esc(patient) || '&nbsp;'}${rx?.patientAge ? ` (${esc(rx.patientAge)} y)` : ''}</div>
        <div class="drug">${esc(l.itemName)}${l.strength && !l.itemName.toLowerCase().includes(l.strength.toLowerCase()) ? ` ${esc(l.strength)}` : ''}</div>
        ${l.genericName ? `<div class="gen">${esc(l.genericName)}${l.dosageForm ? ` · ${esc(l.dosageForm)}` : ''}</div>` : ''}
        <div class="dose">${esc(doses[l.saleItemId]) || '&nbsp;'}</div>
        <div class="foot"><span>Qty ${Number(l.quantity)}${l.uom ? ` ${esc(l.uom)}` : ''}</span><span>${esc(date)}</span><span>${esc(data.sale.invoiceNo)}</span></div>
        ${rx ? `<div class="dr">Dr. ${esc(rx.doctorName.replace(/^dr\.?\s*/i, ''))}${rx.prescriptionNo ? ` · Rx ${esc(rx.prescriptionNo)}` : ''}</div>` : ''}
      </div>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dispensing labels ${esc(data.sale.invoiceNo)}</title>
      <style>
        @page { size: ${w}mm ${h}mm; margin: 0 }
        * { box-sizing: border-box } body { margin: 0; font-family: Arial, sans-serif; color: #000 }
        .label { width: ${w}mm; height: ${h}mm; padding: 1.5mm 2mm; overflow: hidden; page-break-after: always; display: flex; flex-direction: column; gap: .4mm; font-size: ${h <= 30 ? 6.5 : 8}pt }
        .ph { font-weight: bold; border-bottom: .2mm solid #000; padding-bottom: .4mm; white-space: nowrap; overflow: hidden }
        .pt { font-weight: bold } .drug { font-weight: bold; font-size: 1.15em } .gen, .dr { font-size: .85em }
        .dose { flex: 1; font-size: 1.1em; border: .2mm solid #000; padding: .5mm 1mm }
        .foot { display: flex; justify-content: space-between; font-size: .85em }
      </style></head><body>${labels}</body></html>`
    const win = window.open('', '_blank', 'width=480,height=640')
    if (!win) { toast.error('Allow pop-ups to print labels'); return }
    win.document.open()
    win.document.write(html)
    win.document.close()
    // Printed from here: the popup inherits the app's CSP, which blocks inline scripts
    win.onafterprint = () => win.close()
    win.focus()
    win.print()
  }

  if (error) return <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
  if (!data) return <div className="m-4 text-sm text-gray-500">Loading…</div>

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/c/${slug}/pharmacy/prescriptions`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:underline"><ArrowLeft size={14} /> Prescription Register</Link>
          <h1 className="text-xl font-semibold">Dispensing labels — {data.sale.invoiceNo}</h1>
          <p className="text-sm text-gray-500">
            {new Date(data.sale.createdAt).toLocaleString()}
            {data.prescription && <> · Dr. {data.prescription.doctorName.replace(/^dr\.?\s*/i, '')}{data.prescription.doctorRegNo && ` (SLMC ${data.prescription.doctorRegNo})`}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={size} onChange={(e) => setSize(e.target.value as typeof size)} className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700" aria-label="Label size">
            <option value="70x40">70 × 40 mm</option>
            <option value="50x30">50 × 30 mm</option>
            <option value="100x50">100 × 50 mm</option>
          </select>
          <button type="button" onClick={() => { void save().then((ok) => ok && toast.success('Dose instructions saved')) }} disabled={saving} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"><Save size={14} /> Save</button>
          <button type="button" onClick={print} disabled={saving} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"><Printer size={14} /> Print labels</button>
        </div>
      </div>
      <label className="block text-sm">
        Patient name on the labels
        <input value={patient} onChange={(e) => setPatient(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-gray-700" />
      </label>
      <datalist id="dose-hints">{DOSE_HINTS.map((d) => <option key={d} value={d} />)}</datalist>
      <div className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
            <tr><th className="w-10 px-3 py-2">Print</th><th className="px-3 py-2">Medicine</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Dose instructions</th></tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.saleItemId} className="border-t align-top dark:border-gray-700">
                <td className="px-3 py-2"><input type="checkbox" aria-label={`Print a label for ${l.itemName}`} checked={!!selected[l.saleItemId]} onChange={(e) => setSelected((s) => ({ ...s, [l.saleItemId]: e.target.checked }))} /></td>
                <td className="px-3 py-2">{l.itemName}<div className="text-xs text-gray-500">{[l.genericName, l.strength, l.dosageForm].filter(Boolean).join(' · ')}</div></td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{Number(l.quantity)} {l.uom || ''}</td>
                <td className="px-3 py-2">
                  <input list="dose-hints" maxLength={255} value={doses[l.saleItemId] ?? ''} onChange={(e) => setDoses((d) => ({ ...d, [l.saleItemId]: e.target.value }))}
                    placeholder="e.g. 1 tablet 3 times a day after meals" className="w-full rounded border px-2 py-1 dark:bg-gray-700" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Dose instructions are saved on the bill and appear in the patient&apos;s medication history.</p>
    </div>
  )
}
