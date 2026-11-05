'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { AlertTriangle, Save, User } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { toast } from '@/components/ui/toast'

interface CustomerHit { id: string; name: string; phone: string | null; mobilePhone: string | null; allergies: string | null; medicalNotes: string | null }
interface WalkIn { patientName: string; patientPhone: string | null; prescriptions: number; lastVisit: string }
interface HistoryLine {
  saleId: string; invoiceNo: string; date: string; warehouseName: string | null; itemName: string; genericName: string | null
  strength: string | null; drugSchedule: string | null; quantity: number; dosageInstructions: string | null
  doctorName: string | null; doctorRegNo: string | null; patientName: string | null; prescriptionNo: string | null
}
type Patient = { kind: 'customer'; customer: CustomerHit } | { kind: 'walkin'; walkIn: WalkIn }

/** Patient medication history (by customer or the patient named on prescriptions) + allergy notes. */
export default function PatientHistoryPage() {
  const { slug } = useParams<{ slug: string }>()
  const sp = useSearchParams()
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<{ customers: CustomerHit[]; walkIns: WalkIn[] }>({ customers: [], walkIns: [] })
  const [patient, setPatient] = useState<Patient | null>(null)
  const [history, setHistory] = useState<HistoryLine[]>([])
  const [allLines, setAllLines] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState({ allergies: '', medicalNotes: '' })
  const [saving, setSaving] = useState(false)

  // Deep link from the POS / customer page: ?customerId=
  useEffect(() => {
    const id = sp.get('customerId')
    if (!id) return
    fetch(`/api/pharmacy/patients/${id}`).then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (c) setPatient({ kind: 'customer', customer: { id: c.id, name: c.name, phone: c.phone, mobilePhone: null, allergies: c.allergies, medicalNotes: c.medicalNotes } })
    }).catch(() => undefined)
  }, [sp])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) { setHits({ customers: [], walkIns: [] }); return }
    const t = window.setTimeout(async () => {
      const res = await fetch(`/api/pharmacy/patients?q=${encodeURIComponent(q)}`)
      if (res.ok) setHits(await res.json())
    }, 250)
    return () => window.clearTimeout(t)
  }, [search])

  const loadHistory = useCallback(async () => {
    if (!patient) return
    setLoading(true)
    const p = new URLSearchParams()
    if (patient.kind === 'customer') p.set('customerId', patient.customer.id)
    else {
      if (patient.walkIn.patientPhone) p.set('phone', patient.walkIn.patientPhone)
      p.set('name', patient.walkIn.patientName)
    }
    if (allLines) p.set('all', '1')
    try {
      const res = await fetch(`/api/pharmacy/patients/history?${p.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the history')
      setHistory(body.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the history')
    } finally {
      setLoading(false)
    }
  }, [patient, allLines])

  useEffect(() => { void loadHistory() }, [loadHistory])
  useEffect(() => {
    if (patient?.kind === 'customer') setNotes({ allergies: patient.customer.allergies || '', medicalNotes: patient.customer.medicalNotes || '' })
  }, [patient])

  async function saveNotes() {
    if (patient?.kind !== 'customer') return
    setSaving(true)
    try {
      const res = await fetch(`/api/pharmacy/patients/${patient.customer.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notes),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save')
      setPatient({ kind: 'customer', customer: { ...patient.customer, allergies: body.allergies, medicalNotes: body.medicalNotes } })
      toast.success('Saved — the POS warns when this customer is picked')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const pick = (p: Patient) => { setPatient(p); setSearch('') }

  return (
    <ListPageLayout
      module="Selling"
      moduleHref="/selling"
      title="Patient Medication History"
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Patient or customer name / phone"
      onRefresh={loadHistory}
      filterContent={
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={allLines} onChange={(e) => setAllLines(e.target.checked)} /> Include non-medicine items</label>
      }
    >
      {(hits.customers.length > 0 || hits.walkIns.length > 0) && (
        <div className="mb-3 rounded border bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          {hits.customers.map((c) => (
            <button key={c.id} type="button" onClick={() => pick({ kind: 'customer', customer: c })} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
              <User size={14} className="text-gray-400" /> <span className="font-medium">{c.name}</span>
              <span className="text-gray-500">{c.phone || c.mobilePhone || ''}</span>
              {(c.allergies || c.medicalNotes) && <AlertTriangle size={14} className="text-red-600" aria-label="Has allergy / medical notes" />}
            </button>
          ))}
          {hits.walkIns.map((w) => (
            <button key={`${w.patientName}-${w.patientPhone}`} type="button" onClick={() => pick({ kind: 'walkin', walkIn: w })} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
              <User size={14} className="text-gray-300" /> <span>{w.patientName}</span>
              <span className="text-gray-500">{w.patientPhone || ''} · walk-in, {w.prescriptions} prescription{w.prescriptions === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}

      {!patient ? (
        <p className="rounded border bg-white py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">Search for a patient by name or phone number.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-lg font-semibold">{patient.kind === 'customer' ? patient.customer.name : patient.walkIn.patientName}</div>
            <div className="text-sm text-gray-500">{patient.kind === 'customer' ? (patient.customer.phone || '') : `${patient.walkIn.patientPhone || ''} · walk-in patient (no customer record)`}</div>
            {patient.kind === 'customer' && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="font-medium text-red-700">Allergies</span>
                  <textarea rows={2} value={notes.allergies} onChange={(e) => setNotes((n) => ({ ...n, allergies: e.target.value }))} placeholder="e.g. Penicillin, sulfa drugs, aspirin" className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-700" />
                </label>
                <label className="text-sm">
                  <span className="font-medium">Medical notes</span>
                  <textarea rows={2} value={notes.medicalNotes} onChange={(e) => setNotes((n) => ({ ...n, medicalNotes: e.target.value }))} placeholder="e.g. Diabetic, pregnant, on warfarin" className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-700" />
                </label>
                <div className="md:col-span-2">
                  <button type="button" onClick={saveNotes} disabled={saving} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"><Save size={14} /> Save notes</button>
                  <span className="ml-2 text-xs text-gray-500">Shown as a warning at the POS when this customer is selected.</span>
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Bill</th><th className="px-3 py-2">Medicine</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Dose</th><th className="px-3 py-2">Doctor</th><th className="px-3 py-2">Branch</th></tr>
              </thead>
              <tbody>
                {loading && history.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No medicines dispensed to this patient yet.</td></tr>
                ) : history.map((h, i) => (
                  <tr key={`${h.saleId}-${i}`} className="border-t align-top dark:border-gray-700">
                    <td className="whitespace-nowrap px-3 py-2">{new Date(h.date).toLocaleDateString()}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Link href={`/c/${slug}/sales/${h.saleId}`} className="text-blue-600 hover:underline">{h.invoiceNo}</Link></td>
                    <td className="px-3 py-2">
                      {(h.drugSchedule === 'prescription' || h.drugSchedule === 'controlled') && <span className={`mr-1 rounded px-1 text-xs font-bold ${h.drugSchedule === 'controlled' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>Rx</span>}
                      {h.itemName}<div className="text-xs text-gray-500">{[h.genericName, h.strength].filter(Boolean).join(' ')}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{h.quantity}</td>
                    <td className="px-3 py-2">{h.dosageInstructions || '—'}</td>
                    <td className="px-3 py-2">{h.doctorName || '—'}{h.doctorRegNo && <div className="text-xs text-gray-500">SLMC {h.doctorRegNo}</div>}</td>
                    <td className="px-3 py-2">{h.warehouseName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ListPageLayout>
  )
}
