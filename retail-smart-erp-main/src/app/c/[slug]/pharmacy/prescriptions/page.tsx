'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCurrency } from '@/hooks/useCurrency'

interface PrescriptionRow {
  id: string
  createdAt: string
  saleId: string | null
  invoiceNo: string | null
  total: string | null
  prescriptionNo: string | null
  prescriptionDate: string | null
  patientName: string | null
  patientAge: string | null
  patientPhone: string | null
  doctorName: string
  doctorRegNo: string | null
  hospital: string | null
  hasControlled: boolean
  notes: string | null
  dispensedBy: string | null
  medicines: string | null
}

/** Prescription register: every sale that dispensed prescription / controlled medicines. */
export default function PrescriptionRegisterPage() {
  const { slug } = useParams<{ slug: string }>()
  const { fCurrency } = useCurrency()
  const [rows, setRows] = useState<PrescriptionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [controlledOnly, setControlledOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) p.set('q', search.trim())
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (controlledOnly) p.set('controlled', '1')
    try {
      const res = await fetch(`/api/prescriptions?${p.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the register')
      setRows(body.data)
      setTotal(body.pagination.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the register')
    } finally {
      setLoading(false)
    }
  }, [page, search, from, to, controlledOnly])

  useEffect(() => {
    const t = window.setTimeout(load, 250)
    return () => window.clearTimeout(t)
  }, [load])

  return (
    <ListPageLayout
      module="Selling"
      moduleHref="/selling"
      title="Prescription Register"
      search={search}
      setSearch={(v) => { setSearch(v); setPage(1) }}
      searchPlaceholder="Doctor, SLMC no., patient, Rx no. or bill no."
      onRefresh={load}
      filterContent={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">From <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded border px-2 py-1 dark:bg-gray-700" /></label>
          <label className="flex items-center gap-1">To <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="rounded border px-2 py-1 dark:bg-gray-700" /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={controlledOnly} onChange={(e) => { setControlledOnly(e.target.checked); setPage(1) }} /> Controlled drugs only</label>
        </div>
      }
    >
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2">Patient</th>
              <th className="px-3 py-2">Doctor</th>
              <th className="px-3 py-2">Rx no. / date</th>
              <th className="px-3 py-2">Medicines</th>
              <th className="px-3 py-2">Dispensed by</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No prescriptions recorded{search || from || to || controlledOnly ? ' for this filter' : ' yet'}.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t align-top dark:border-gray-700">
                <td className="whitespace-nowrap px-3 py-2">{new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.saleId ? <Link className="text-blue-600 hover:underline" href={`/c/${slug}/sales/${r.saleId}`}>{r.invoiceNo}</Link> : '—'}
                  {r.total && <div className="text-xs text-gray-500">{fCurrency(r.total)}</div>}
                </td>
                <td className="px-3 py-2">{r.patientName || '—'}{(r.patientAge || r.patientPhone) && <div className="text-xs text-gray-500">{[r.patientAge && `${r.patientAge} y`, r.patientPhone].filter(Boolean).join(' · ')}</div>}</td>
                <td className="px-3 py-2">
                  {r.doctorName}
                  <div className="text-xs text-gray-500">{[r.doctorRegNo && `SLMC ${r.doctorRegNo}`, r.hospital].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.prescriptionNo || '—'}{r.prescriptionDate && <div className="text-xs text-gray-500">{r.prescriptionDate}</div>}</td>
                <td className="px-3 py-2">
                  {r.hasControlled && <span className="mr-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">Controlled</span>}
                  {r.medicines || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.dispensedBy || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
          <span>{total} prescriptions · page {page} of {Math.ceil(total / pageSize)}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded border px-3 py-1 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="rounded border px-3 py-1 disabled:opacity-50" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </ListPageLayout>
  )
}
