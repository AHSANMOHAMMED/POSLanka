'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Printer } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { BranchFilter, escapeHtml, printHtml } from '@/components/pharmacy/BranchFilter'
import { useCurrency } from '@/hooks/useCurrency'
import { toast } from '@/components/ui/toast'

interface GenericRow { genericName: string; brands: number; bills: number; quantity: number; revenue: number; cost: number }
interface RxSummary {
  prescriptions: number; controlledPrescriptions: number; rxBills: number; rxLines: number; rxValue: number
  controlledBills: number; controlledValue: number; totalBills: number; totalValue: number
}
interface ExpiryLoss {
  expiredOnHand: { batches: number; quantity: number; value: number }
  writtenOff: { movements: number; quantity: number; value: number }
  items: Array<{ itemId: string; name: string; expiredQty: number; expiredValue: number; writtenOffQty: number; writtenOffValue: number }>
}

const monthStart = () => `${new Date().toISOString().slice(0, 8)}01`
const today = () => new Date().toISOString().slice(0, 10)

/** Pharmacy reports: sales by generic name, prescription-only sales, expiry loss. */
export default function PharmacyReportsPage() {
  const { slug } = useParams<{ slug: string }>()
  const { fCurrency } = useCurrency()
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [warehouseId, setWarehouseId] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<{ byGeneric: GenericRow[]; prescriptions: RxSummary; expiry: ExpiryLoss } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const p = new URLSearchParams({ from, to })
    if (warehouseId) p.set('warehouseId', warehouseId)
    try {
      const res = await fetch(`/api/pharmacy/reports?${p.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the reports')
      setData(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the reports')
    }
  }, [from, to, warehouseId])

  useEffect(() => { void load() }, [load])

  const q = search.trim().toLowerCase()
  const generics = (data?.byGeneric || []).filter((g) => !q || g.genericName.toLowerCase().includes(q))
  const rx = data?.prescriptions
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—')

  function print() {
    if (!data || !rx) return
    const body = `<h1>Pharmacy report</h1><p>${escapeHtml(from)} to ${escapeHtml(to)}</p>
      <h2>Prescriptions</h2><table><tbody>
      <tr><td>Prescriptions recorded</td><td class="n">${rx.prescriptions}</td></tr>
      <tr><td>Bills with prescription-only medicines</td><td class="n">${rx.rxBills} of ${rx.totalBills}</td></tr>
      <tr><td>Prescription-only sales value</td><td class="n">${escapeHtml(fCurrency(rx.rxValue))}</td></tr>
      <tr><td>Bills with controlled drugs</td><td class="n">${rx.controlledBills}</td></tr>
      <tr><td>Controlled drug sales value</td><td class="n">${escapeHtml(fCurrency(rx.controlledValue))}</td></tr></tbody></table>
      <h2>Expiry loss</h2><table><tbody>
      <tr><td>Expired stock still on hand (${data.expiry.expiredOnHand.batches} batches)</td><td class="n">${escapeHtml(fCurrency(data.expiry.expiredOnHand.value))}</td></tr>
      <tr><td>Written off as expired in the period</td><td class="n">${escapeHtml(fCurrency(data.expiry.writtenOff.value))}</td></tr></tbody></table>
      <h2>Sales by generic name</h2><table><thead><tr><th>Generic</th><th class="n">Brands</th><th class="n">Bills</th><th class="n">Qty</th><th class="n">Sales</th><th class="n">Cost</th></tr></thead><tbody>
      ${generics.map((g) => `<tr><td>${escapeHtml(g.genericName)}</td><td class="n">${g.brands}</td><td class="n">${g.bills}</td><td class="n">${g.quantity}</td><td class="n">${escapeHtml(fCurrency(g.revenue))}</td><td class="n">${escapeHtml(fCurrency(g.cost))}</td></tr>`).join('')}
      </tbody></table>`
    if (!printHtml('Pharmacy report', body)) toast.error('Allow pop-ups to print')
  }

  const card = (label: string, value: ReactNode, sub?: string, tone = '') => (
    <div className="rounded border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )

  return (
    <ListPageLayout
      module="Reports"
      moduleHref="/reports"
      title="Pharmacy Reports"
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Generic name"
      onRefresh={load}
      filterContent={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border px-2 py-1 dark:bg-gray-700" /></label>
          <label className="flex items-center gap-1">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border px-2 py-1 dark:bg-gray-700" /></label>
          <BranchFilter value={warehouseId} onChange={setWarehouseId} />
          <button type="button" onClick={print} disabled={!data} className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"><Printer size={14} /> Print</button>
        </div>
      }
    >
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!data || !rx ? <p className="py-8 text-center text-sm text-gray-500">Loading…</p> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {card('Prescriptions recorded', rx.prescriptions, `${rx.controlledPrescriptions} with controlled drugs`)}
            {card('Bills with Rx-only medicines', rx.rxBills, `${pct(rx.rxBills, rx.totalBills)} of ${rx.totalBills} bills`)}
            {card('Rx-only sales', fCurrency(rx.rxValue), `${pct(rx.rxValue, rx.totalValue)} of sales · ${rx.rxLines} lines`)}
            {card('Controlled drug sales', fCurrency(rx.controlledValue), `${rx.controlledBills} bills`)}
            {card('Expired stock on hand', fCurrency(data.expiry.expiredOnHand.value), `${data.expiry.expiredOnHand.batches} batches · at cost`, 'text-red-600')}
            {card('Written off as expired', fCurrency(data.expiry.writtenOff.value), `${data.expiry.writtenOff.movements} adjustments in the period`, 'text-red-600')}
            {card('Total expiry loss', fCurrency(data.expiry.expiredOnHand.value + data.expiry.writtenOff.value), undefined, 'text-red-600')}
            <div className="flex flex-col justify-center gap-1 rounded border bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
              <Link href={`/c/${slug}/pharmacy/controlled-register?from=${from}&to=${to}`} className="text-blue-600 hover:underline">Controlled drug register →</Link>
              <Link href={`/c/${slug}/pharmacy/return-list`} className="text-blue-600 hover:underline">Return-to-supplier list →</Link>
            </div>
          </div>

          <section className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
            <h2 className="border-b px-3 py-2 font-semibold dark:border-gray-700">Sales by generic name</h2>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
                <tr><th className="px-3 py-2">Generic</th><th className="px-3 py-2 text-right">Brands</th><th className="px-3 py-2 text-right">Bills</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Sales</th><th className="px-3 py-2 text-right">Margin</th></tr>
              </thead>
              <tbody>
                {generics.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No medicine sales with a generic name in this period.</td></tr>
                ) : generics.map((g) => (
                  <tr key={g.genericName} className="border-t dark:border-gray-700">
                    <td className="px-3 py-2">{g.genericName}</td>
                    <td className="px-3 py-2 text-right">{g.brands}</td>
                    <td className="px-3 py-2 text-right">{g.bills}</td>
                    <td className="px-3 py-2 text-right">{g.quantity}</td>
                    <td className="px-3 py-2 text-right">{fCurrency(g.revenue)}</td>
                    <td className="px-3 py-2 text-right">{fCurrency(g.revenue - g.cost)} <span className="text-xs text-gray-500">{pct(g.revenue - g.cost, g.revenue)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {data.expiry.items.length > 0 && (
            <section className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
              <h2 className="border-b px-3 py-2 font-semibold dark:border-gray-700">Expiry loss by medicine</h2>
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
                  <tr><th className="px-3 py-2">Medicine</th><th className="px-3 py-2 text-right">Expired on hand</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2 text-right">Written off</th><th className="px-3 py-2 text-right">Value</th></tr>
                </thead>
                <tbody>
                  {data.expiry.items.map((i) => (
                    <tr key={i.itemId} className="border-t dark:border-gray-700">
                      <td className="px-3 py-2">{i.name}</td>
                      <td className="px-3 py-2 text-right">{i.expiredQty || ''}</td>
                      <td className="px-3 py-2 text-right">{i.expiredValue ? fCurrency(i.expiredValue) : ''}</td>
                      <td className="px-3 py-2 text-right">{i.writtenOffQty || ''}</td>
                      <td className="px-3 py-2 text-right">{i.writtenOffValue ? fCurrency(i.writtenOffValue) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </ListPageLayout>
  )
}
