'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Printer } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { BranchFilter, escapeHtml, printHtml } from '@/components/pharmacy/BranchFilter'
import { useCurrency } from '@/hooks/useCurrency'
import { toast } from '@/components/ui/toast'

interface Batch {
  batchId: string; batchNumber: string; expiryDate: string | null; daysLeft: number; quantity: number; value: number
  itemId: string; itemName: string; genericName: string | null; strength: string | null; warehouseName: string | null
  purchaseId: string | null; purchaseNo: string | null; supplierInvoiceNo: string | null
}
interface SupplierGroup { supplierId: string | null; supplierName: string; batches: Batch[]; value: number }

/**
 * Near-expiry "return to supplier" list: expired and short-dated batches per supplier, printable.
 * The purchase return itself is made from the purchase invoice each batch came from (linked).
 */
export default function ReturnToSupplierPage() {
  const { slug } = useParams<{ slug: string }>()
  const sp = useSearchParams()
  const { fCurrency } = useCurrency()
  const [days, setDays] = useState<string>(sp.get('days') || '')
  const [warehouseId, setWarehouseId] = useState('')
  const [search, setSearch] = useState('')
  const [groups, setGroups] = useState<SupplierGroup[]>([])
  const [usedDays, setUsedDays] = useState(90)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams()
    if (days) p.set('days', days)
    if (warehouseId) p.set('warehouseId', warehouseId)
    try {
      const res = await fetch(`/api/pharmacy/return-list?${p.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the list')
      setGroups(body.suppliers)
      setUsedDays(body.days)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the list')
    } finally {
      setLoading(false)
    }
  }, [days, warehouseId])

  useEffect(() => { void load() }, [load])

  const q = search.trim().toLowerCase()
  const shown = groups
    .map((g) => ({ ...g, batches: g.batches.filter((b) => !q || `${g.supplierName} ${b.itemName} ${b.genericName ?? ''} ${b.batchNumber}`.toLowerCase().includes(q)) }))
    .filter((g) => g.batches.length > 0)

  const expiryText = (b: Batch) => (b.daysLeft < 0 ? `expired ${-b.daysLeft} d ago` : b.daysLeft === 0 ? 'expires today' : `${b.daysLeft} d left`)

  function print(only?: SupplierGroup) {
    const list = only ? [only] : shown
    const body = list.map((g) => `<section><h1>Return to supplier — ${escapeHtml(g.supplierName)}</h1>
      <p>Expired or expiring within ${usedDays} days · printed ${escapeHtml(new Date().toLocaleDateString())}</p>
      <table><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Value (cost)</th><th>Our purchase / supplier invoice</th><th>Branch</th></tr></thead><tbody>
      ${g.batches.map((b) => `<tr><td>${escapeHtml(b.itemName)}${b.genericName ? `<br><small>${escapeHtml([b.genericName, b.strength].filter(Boolean).join(' '))}</small>` : ''}</td>
        <td>${escapeHtml(b.batchNumber)}</td><td>${escapeHtml(b.expiryDate)} (${escapeHtml(expiryText(b))})</td><td class="n">${b.quantity}</td>
        <td class="n">${escapeHtml(fCurrency(b.value))}</td><td>${escapeHtml([b.purchaseNo, b.supplierInvoiceNo].filter(Boolean).join(' / '))}</td><td>${escapeHtml(b.warehouseName)}</td></tr>`).join('')}
      <tr class="sum"><td colspan="4">Total</td><td class="n">${escapeHtml(fCurrency(g.batches.reduce((s, b) => s + b.value, 0)))}</td><td colspan="2"></td></tr>
      </tbody></table><p>Signed (pharmacist): ____________________ &nbsp; Received by (supplier): ____________________</p></section>`).join('<div style="page-break-after:always"></div>')
    if (!printHtml('Return to supplier', body)) toast.error('Allow pop-ups to print')
  }

  return (
    <ListPageLayout
      module="Stock"
      moduleHref="/stock"
      title="Return to Supplier (near expiry)"
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Supplier, medicine or batch"
      onRefresh={load}
      filterContent={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={days} onChange={(e) => setDays(e.target.value)} className="rounded border px-2 py-1 dark:bg-gray-700" aria-label="Expiring within">
            <option value="">Dashboard alert window ({usedDays} days)</option>
            {[0, 30, 60, 90, 180].map((d) => <option key={d} value={String(d)}>{d === 0 ? 'Expired only' : `Expired or expiring in ${d} days`}</option>)}
          </select>
          <BranchFilter value={warehouseId} onChange={setWarehouseId} />
          <button type="button" onClick={() => print()} disabled={shown.length === 0} className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"><Printer size={14} /> Print all</button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        Print a supplier&apos;s list and hand it over with the stock. To take the stock out and reduce what you owe, open the purchase and use <b>Return</b> (purchase return / debit note to the supplier).
      </p>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && groups.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">Loading…</p> : shown.length === 0 ? (
        <p className="rounded border bg-white py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">Nothing expired or expiring in the next {usedDays} days.</p>
      ) : (
        <div className="space-y-4">
          {shown.map((g) => (
            <section key={g.supplierId || 'none'} className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between border-b px-3 py-2 dark:border-gray-700">
                <div className="font-semibold">{g.supplierName} <span className="ml-2 text-sm font-normal text-gray-500">{fCurrency(g.batches.reduce((s, b) => s + b.value, 0))} at cost</span></div>
                <button type="button" onClick={() => print(g)} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"><Printer size={14} /> Print</button>
              </div>
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
                  <tr><th className="px-3 py-2">Medicine</th><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Expiry</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2">Purchase</th><th className="px-3 py-2">Branch</th></tr>
                </thead>
                <tbody>
                  {g.batches.map((b) => (
                    <tr key={b.batchId} className="border-t dark:border-gray-700">
                      <td className="px-3 py-2">{b.itemName}<div className="text-xs text-gray-500">{[b.genericName, b.strength].filter(Boolean).join(' ')}</div></td>
                      <td className="px-3 py-2 font-mono text-xs">{b.batchNumber}</td>
                      <td className="whitespace-nowrap px-3 py-2">{b.expiryDate} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-semibold ${b.daysLeft < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{expiryText(b)}</span></td>
                      <td className="px-3 py-2 text-right">{b.quantity}</td>
                      <td className="px-3 py-2 text-right">{fCurrency(b.value)}</td>
                      <td className="px-3 py-2">
                        {b.purchaseId ? <Link href={`/c/${slug}/purchases/${b.purchaseId}`} className="text-blue-600 hover:underline">{b.purchaseNo}</Link> : '—'}
                        {b.supplierInvoiceNo && <div className="text-xs text-gray-500">Inv. {b.supplierInvoiceNo}</div>}
                      </td>
                      <td className="px-3 py-2">{b.warehouseName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </ListPageLayout>
  )
}
