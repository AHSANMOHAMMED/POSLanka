'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Download, Printer } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { BranchFilter, escapeHtml, printHtml } from '@/components/pharmacy/BranchFilter'
import { toast } from '@/components/ui/toast'

type Category = 'received' | 'dispensed' | 'customer_return' | 'supplier_return' | 'transfer' | 'adjustment'
const LABELS: Record<Category, string> = {
  received: 'Received', dispensed: 'Dispensed', customer_return: 'Returned by patient',
  supplier_return: 'Returned to supplier', transfer: 'Branch transfer', adjustment: 'Adjustment',
}

interface Line {
  id: string; date: string; category: Category; referenceNo: string | null; saleId: string | null; warehouseName: string | null
  qtyIn: number; qtyOut: number; balance: number; doctorName: string | null; doctorRegNo: string | null
  patientName: string | null; prescriptionNo: string | null; notes: string | null; userName: string | null
}
interface Drug {
  itemId: string; name: string; genericName: string | null; strength: string | null; unit: string | null
  opening: number; received: number; dispensed: number; returns: number; adjustments: number; closing: number; lines: Line[]
}

const monthStart = () => `${new Date().toISOString().slice(0, 8)}01`
const today = () => new Date().toISOString().slice(0, 10)
const fmt = (n: number) => (n ? String(n) : '')
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** Controlled drug register: running balance per controlled medicine for a period (print / CSV). */
export default function ControlledRegisterPage() {
  const { slug } = useParams<{ slug: string }>()
  const sp = useSearchParams()
  const [from, setFrom] = useState(() => sp.get('from') || monthStart())
  const [to, setTo] = useState(() => sp.get('to') || today())
  const [warehouseId, setWarehouseId] = useState('')
  const [search, setSearch] = useState('')
  const [drugs, setDrugs] = useState<Drug[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback(() => {
    const p = new URLSearchParams({ from, to })
    if (warehouseId) p.set('warehouseId', warehouseId)
    return p
  }, [from, to, warehouseId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pharmacy/controlled-register?${query().toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the register')
      setDrugs(body.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the register')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  const q = search.trim().toLowerCase()
  const shown = q ? drugs.filter((d) => `${d.name} ${d.genericName ?? ''}`.toLowerCase().includes(q)) : drugs

  function print() {
    const body = `<h1>Controlled Drug Register</h1><p>${escapeHtml(from)} to ${escapeHtml(to)}</p>` + shown.map((d) => `
      <section><h2>${escapeHtml(d.name)}${d.genericName ? ` — ${escapeHtml(d.genericName)}` : ''}${d.strength ? ` ${escapeHtml(d.strength)}` : ''}</h2>
      <table><thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th>Patient</th><th>Doctor / SLMC</th><th>Rx no.</th><th class="n">In</th><th class="n">Out</th><th class="n">Balance</th><th>By</th></tr></thead><tbody>
      <tr class="sum"><td>${escapeHtml(from)}</td><td colspan="7">Opening balance</td><td class="n">${d.opening}</td><td></td></tr>
      ${d.lines.map((l) => `<tr><td>${escapeHtml(when(l.date))}</td><td>${escapeHtml(LABELS[l.category])}</td><td>${escapeHtml(l.referenceNo)}</td><td>${escapeHtml(l.patientName)}</td>
        <td>${escapeHtml([l.doctorName, l.doctorRegNo].filter(Boolean).join(' / '))}</td><td>${escapeHtml(l.prescriptionNo)}</td>
        <td class="n">${fmt(l.qtyIn)}</td><td class="n">${fmt(l.qtyOut)}</td><td class="n">${l.balance}</td><td>${escapeHtml(l.userName)}</td></tr>`).join('')}
      <tr class="sum"><td>${escapeHtml(to)}</td><td colspan="7">Closing balance (received ${d.received}, dispensed ${d.dispensed}, returns ${d.returns}, adjustments ${d.adjustments})</td><td class="n">${d.closing}</td><td></td></tr>
      </tbody></table></section>`).join('')
    if (!printHtml('Controlled Drug Register', body)) toast.error('Allow pop-ups to print')
  }

  return (
    <ListPageLayout
      module="Stock"
      moduleHref="/stock"
      title="Controlled Drug Register"
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Medicine or generic name"
      onRefresh={load}
      filterContent={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border px-2 py-1 dark:bg-gray-700" /></label>
          <label className="flex items-center gap-1">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border px-2 py-1 dark:bg-gray-700" /></label>
          <BranchFilter value={warehouseId} onChange={setWarehouseId} />
          <button type="button" onClick={print} disabled={shown.length === 0} className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"><Printer size={14} /> Print</button>
          <a href={`/api/pharmacy/controlled-register?${query().toString()}&format=csv`} className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700"><Download size={14} /> CSV</a>
        </div>
      }
    >
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && drugs.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded border bg-white py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          No controlled medicines{q ? ' match this search' : ''}. Mark a medicine as &ldquo;Controlled drug&rdquo; (drug schedule) on the item to keep its register here.
        </p>
      ) : (
        <div className="space-y-4">
          {shown.map((d) => (
            <section key={d.itemId} className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2 dark:border-gray-700">
                <div>
                  <span className="font-semibold">{d.name}</span>
                  <span className="ml-2 text-sm text-gray-500">{[d.genericName, d.strength].filter(Boolean).join(' ')}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-300">
                  <span>Opening <b>{d.opening}</b></span><span>Received <b>{d.received}</b></span><span>Dispensed <b>{d.dispensed}</b></span>
                  <span>Returns <b>{d.returns}</b></span><span>Adjustments <b>{d.adjustments}</b></span><span>Closing <b>{d.closing}</b> {d.unit || ''}</span>
                </div>
              </div>
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Patient</th>
                    <th className="px-3 py-2">Doctor</th><th className="px-3 py-2 text-right">In</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/40"><td className="px-3 py-1.5">{from}</td><td className="px-3 py-1.5" colSpan={6}>Opening balance</td><td className="px-3 py-1.5 text-right font-semibold">{d.opening}</td><td /></tr>
                  {d.lines.map((l) => (
                    <tr key={l.id} className="border-t align-top dark:border-gray-700">
                      <td className="whitespace-nowrap px-3 py-1.5">{when(l.date)}</td>
                      <td className="px-3 py-1.5">{LABELS[l.category]}{l.warehouseName && <div className="text-xs text-gray-500">{l.warehouseName}</div>}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {l.saleId ? <Link href={`/c/${slug}/sales/${l.saleId}`} className="text-blue-600 hover:underline">{l.referenceNo}</Link> : (l.referenceNo || '—')}
                        {l.prescriptionNo && <div className="text-xs text-gray-500">Rx {l.prescriptionNo}</div>}
                      </td>
                      <td className="px-3 py-1.5">{l.patientName || '—'}</td>
                      <td className="px-3 py-1.5">{l.doctorName || '—'}{l.doctorRegNo && <div className="text-xs text-gray-500">SLMC {l.doctorRegNo}</div>}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(l.qtyIn)}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(l.qtyOut)}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{l.balance}</td>
                      <td className="px-3 py-1.5 text-xs">{l.userName || ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/40"><td className="px-3 py-1.5">{to}</td><td className="px-3 py-1.5" colSpan={6}>Closing balance</td><td className="px-3 py-1.5 text-right font-semibold">{d.closing}</td><td /></tr>
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </ListPageLayout>
  )
}
